// cspell:words omasset
/**
 * Renders a uniform pack with the 3D View's own marchers (`MarcherBodies`: the om-pose bodies,
 * the composer's skinning, the uniform shader with the hybrid flats wrap, the feather plume) and
 * its own atlas composer (`flatsAtlas.ts`: the pack read in the uniform pack worker, items graded
 * per body type, edges bled), under the venue's day lighting. Only the show database is replaced
 * (`packStore.ts`). `render.ts` in the parent folder drives it shot by shot.
 *
 * Portraits are a turntable: the camera stays put with the sun over its shoulder and the marcher
 * turns, so every view is lit the same way. The stands view stands the 7 bodies on the high school
 * kit's field and looks from 40 m out and 15 m up.
 */
import * as THREE from "three";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { fieldFootprint } from "@openmarch/core";
import regionsJson from "@/view3d/assets/uniform-flats/regions.json";
import {
    buildCrowd,
    createEnvironment,
    createEnvironmentMap,
    defaultCrowdPalette,
} from "@/view3d/core/environment";
import { buildFieldSurface, venueFootprint } from "@/view3d/core/field";
import {
    DEFAULT_CROWD_DENSITY,
    KIT_BUILDERS,
    KIT_FIELD_ART,
    KIT_FIELD_TURF,
    kitFieldProperties,
    kitFieldStyle,
    placeKitField,
} from "@/view3d/core/kits";
import { defaultVenueForKit } from "@/view3d/core/venueSettings";
import {
    BODY_TYPES,
    SKIN_TONES,
    sectionUniform,
    type BodyType,
} from "@/view3d/core/marchers/looks";
import { showAssetRefValue, type ShowAssetRef } from "@/showAssets/ref";
import * as uniformArtwork from "@/view3d/core/marchers/uniformArtwork";
import type {
    FlatsArtworkKey,
    FlatsRegions,
    UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import * as format from "@/view3d/core/uniformPack/format";
import {
    FLATS_PAGE_DPI,
    FLATS_PAGE_PX,
    pngHeaderSize,
    readUniformPack,
    type UniformPack,
    type UniformPackItem,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import {
    pageNotes,
    type PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";
import {
    acquireFlats,
    loadFlatsGeometry,
    loadFlatsLut,
    releaseFlats,
} from "@/view3d/window/performers/marchers/flatsAtlas";
import {
    loadBodies,
    loadClassClips,
    type LoadedBody,
} from "@/view3d/window/performers/marchers/marcherAssets";
import {
    MarcherBodies,
    bakeForBodies,
    flatsResourceKey,
    type FlatsResource,
    type MarcherSlotLook,
} from "@/view3d/window/performers/marchers/marcherBodies";
import type { ChannelBake } from "@/view3d/render/channelBake";
import type { FeetPlay } from "@/view3d/render/channelState";
import { itemChecks, layerNotes } from "../lib/packChecks";
import { putPack } from "./packStore";
import { fromBase64, toBase64 } from "./bytes";

const regions = regionsJson as unknown as FlatsRegions;
const MEDIAN: BodyType = "neutral-average";
const IN = 0.0254;
/** The stride slot: the median body marching, after the 7 standing ones */
const STRIDE = BODY_TYPES.length;
const SLOTS = BODY_TYPES.length + 1;

/** Camera azimuth from the performer's front, toward their left (degrees) */
export const VIEW_AZIMUTH: Record<string, number> = {
    front: 0,
    back: 180,
    left: 90,
    right: -90,
    "three-quarter": 45,
};

// ------------------------------------------------------------------ the renderer
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
});
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 3000);
const scene = new THREE.Scene();

/** The WebGL renderer string: what the GPU check reads */
export function gpu(): string {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return String(
        gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
}

// ------------------------------------------------------------------ the set
interface Venue {
    root: THREE.Group;
    centre: THREE.Vector3;
    dispose(): void;
}
let env: ReturnType<typeof createEnvironment> | null = null;
let venue: Venue | null = null;
const studio = new THREE.Group();
let turntableAz = 0;

/** The high school kit and its field under day lighting, as the 3D View draws them */
async function buildVenue(): Promise<Venue> {
    const kitId = "hs" as const;
    const fp =
        FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;
    const params = defaultVenueForKit(kitId).params;
    const style = kitFieldStyle(kitId, fp);
    env = createEnvironment({ quality: "high" });
    scene.add(env.root);
    const footprint = venueFootprint(fp, style);
    const kit = KIT_BUILDERS[kitId]({
        footprint,
        params,
        quality: "high",
        fieldStyle: style,
    });
    const root = new THREE.Group();
    root.add(kit.root);
    const painted = kitFieldProperties(kitId, fp, undefined);
    const surface = buildFieldSurface({
        fieldProperties: painted,
        theme: fp.theme,
        style,
        centerArt: KIT_FIELD_ART[kitId],
        turf: KIT_FIELD_TURF[kitId],
        params,
        image: null,
        maxTextureSize: renderer.capabilities.maxTextureSize,
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    placeKitField(surface.mesh, painted, fp, footprint);
    root.add(surface.mesh);
    await surface.ready.catch(() => undefined);
    const crowd =
        kit.seatRows.length === 0
            ? null
            : buildCrowd(kit.seatRows, {
                  density: kit.crowdDensity ?? DEFAULT_CROWD_DENSITY,
                  palette: defaultCrowdPalette(params),
                  quality: "high",
                  ...kit.crowd,
              });
    if (crowd) kit.root.add(crowd.mesh);
    const box = fieldFootprint(fp);
    const centre = new THREE.Vector3(
        (box.minX + box.maxX) / 2,
        0,
        (box.minZ + box.maxZ) / 2,
    );
    env.setLighting("day", [centre.x, 0, centre.z], kit.lightingVenue);
    kit.setLighting("day");
    renderer.toneMappingExposure = env.exposure;
    const map = createEnvironmentMap(renderer, "day", kit.lightingVenue);
    scene.environment = map.texture;
    scene.environmentIntensity = 0.6;
    scene.add(root);
    return {
        root,
        centre,
        dispose() {
            map.dispose();
            crowd?.dispose();
            surface.dispose();
            kit.dispose();
        },
    };
}

/** The portrait set: a floor disc and a 10 in scale bar of 1 in black and white blocks */
function buildStudio(at: THREE.Vector3) {
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(3, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xb9bfc6, roughness: 1 }),
    );
    floor.position.y = 0.002;
    studio.add(floor);
    const bar = new THREE.Group();
    for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(
            new THREE.BoxGeometry(0.012, IN, 0.012),
            new THREE.MeshBasicMaterial({
                color: i % 2 ? 0xffffff : 0x111111,
            }),
        );
        m.position.y = (i + 0.5) * IN;
        bar.add(m);
    }
    bar.name = "scale-bar";
    studio.add(bar);
    studio.position.copy(at);
    scene.add(studio);
}

function portraitSet(on: boolean) {
    if (!env || !venue) return;
    venue.root.visible = !on;
    env.sky.mesh.visible = !on;
    if (env.horizon) env.horizon.mesh.visible = !on;
    if (env.land) env.land.mesh.visible = !on;
    studio.visible = on;
    scene.background = on ? new THREE.Color(0xdfe4ea) : null;
    scene.fog = on ? null : env.fog;
}

// ------------------------------------------------------------------ the marchers
let bodies: Map<BodyType, LoadedBody> | null = null;
let bake: ChannelBake | null = null;
/** The stride's count: when the median body's feet are furthest apart */
let strideCount = 0;
let strideApart = 0;

/** Loads the bodies, the class 1.00 clips and the venue, and bakes attention and 8 to 5 */
export async function init(): Promise<{ gpu: string; seconds: number }> {
    const t0 = performance.now();
    const [loaded, clips] = await Promise.all([
        loadBodies(),
        loadClassClips(1),
    ]);
    bodies = loaded;
    // the arms stay in the bodies' rest pose (relaxed, a little out from the sides): in the
    // clips they hold a horn, which with nothing carried crosses the chest and hides the art
    const clip = (name: string) => {
        const c = clips.find((x) => x.name === name);
        if (!c) throw new Error(`the om-pose clips have no ${name}`);
        const legs = c.clone();
        legs.tracks = legs.tracks.filter(
            (t) => !/DEF-(shoulder|upper_arm|forearm|hand)/.test(t.name),
        );
        return legs;
    };
    bake = bakeForBodies(bodies, {
        attention: clip("attention"),
        "8to5": clip("8to5"),
    });
    venue = await buildVenue();
    buildStudio(venue.centre);
    // the camera keeps the sun over its left shoulder
    const sun = env!.sun.position.clone().sub(venue.centre);
    turntableAz = Math.atan2(sun.x, sun.z) - (35 * Math.PI) / 180;
    return { gpu: gpu(), seconds: (performance.now() - t0) / 1000 };
}

let pack: UniformPack | null = null;
let packValue: UniformPackValue | null = null;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const d = await crypto.subtle.digest(
        "SHA-256",
        bytes as Uint8Array<ArrayBuffer>,
    );
    return [...new Uint8Array(d)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** A mode of the pack: null for a pack without modes (it draws everything) */
interface ModeInfo {
    id: string | null;
    name: string;
}

/** The modes a manifest has (format 3, step 5), or the one implicit mode */
function modesOf(manifest: UniformPackManifest): ModeInfo[] {
    const modes = (manifest as { modes?: { id: string; name: string }[] })
        .modes;
    return modes?.length
        ? modes.map((m) => ({ id: m.id, name: m.name }))
        : [{ id: null, name: "default" }];
}

/** What mode `mode` draws: its layers and items (format 3), else all of them */
function drawn(manifest: UniformPackManifest, mode: string | null) {
    const f = format as unknown as {
        drawnInMode?: (
            m: UniformPackManifest,
            id: string | null,
        ) => {
            layers: { id: string }[];
            items: UniformPackItem[];
        };
    };
    if (mode && f.drawnInMode) return f.drawnInMode(manifest, mode);
    return { layers: manifest.layers, items: manifest.items ?? [] };
}

/** The look a mode wears: the manifest's palette and options with the mode's changes */
function lookOf(manifest: UniformPackManifest, mode: string | null) {
    const f = format as unknown as {
        lookOfManifest: (
            m: UniformPackManifest,
            id?: string | null,
        ) => ReturnType<typeof format.lookOfManifest>;
    };
    return f.lookOfManifest(manifest, mode);
}

/** The 3D View's key for the pack in a mode (`withMode`, format 3), else the pack's own */
function keyOf(mode: string | null): FlatsArtworkKey {
    const a = uniformArtwork as unknown as {
        withMode?: (k: UniformPackValue, m: string | null) => UniformPackValue;
    };
    return mode && a.withMode ? a.withMode(packValue!, mode) : packValue!;
}

/** Each layer's notes (the app's page checks), by id, and whether its image is the page's size */
async function layerPageNotes(p: UniformPack) {
    const out: Record<string, string[]> = {};
    for (const layer of p.layers) {
        const size = pngHeaderSize(layer.png);
        const notes: string[] = [];
        if (
            size &&
            (size.width !== FLATS_PAGE_PX.width ||
                size.height !== FLATS_PAGE_PX.height)
        )
            notes.push("scaled");
        const bitmap = await createImageBitmap(
            new Blob([layer.png as Uint8Array<ArrayBuffer>], {
                type: "image/png",
            }),
            { premultiplyAlpha: "none", colorSpaceConversion: "none" },
        );
        const c = new OffscreenCanvas(
            FLATS_PAGE_PX.width,
            FLATS_PAGE_PX.height,
        );
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.drawImage(bitmap, 0, 0, c.width, c.height);
        bitmap.close();
        const pixels = x.getImageData(0, 0, c.width, c.height).data;
        notes.push(
            ...pageNotes(
                pixels,
                c.width,
                c.height,
                FLATS_PAGE_DPI,
                regionsJson as unknown as PageRegions,
            ),
        );
        out[layer.id] = notes;
    }
    return out;
}

let notesByLayer: Record<string, string[]> = {};

/** Reads a pack file and puts it where the atlas composer reads it; returns its modes */
export async function loadPack(data: string) {
    const bytes = fromBase64(data);
    pack = readUniformPack(bytes);
    const ref: ShowAssetRef = {
        id: "uniform-render",
        versionHash: await sha256Hex(bytes),
    };
    packValue = showAssetRefValue(ref) as UniformPackValue;
    putPack(packValue, pack.manifest.name, bytes);
    notesByLayer = await layerPageNotes(pack);
    return {
        name: pack.manifest.name,
        formatVersion: pack.manifest.formatVersion,
        modes: modesOf(pack.manifest),
        layers: pack.manifest.layers.map((l) => l.id),
        items: (pack.manifest.items ?? []).map((i) => i.id),
    };
}

let marchers: MarcherBodies | null = null;
let flats: Map<string, FlatsResource> = new Map();
let thumbs: Record<string, HTMLCanvasElement> = {};
/** The atlases this mode holds, let go of when the next mode is prepared */
let held: (() => void)[] = [];

/**
 * Dresses the 7 bodies (and the stride slot) in mode `modeId` at `dpi`: composes each body's
 * atlas with the app's composer, builds the marchers, and returns the mode's quiet notes.
 */
export async function prepareMode(modeId: string | null, dpi: number) {
    if (!pack || !bodies || !bake) throw new Error("load a pack first");
    const t0 = performance.now();
    marchers?.dispose();
    marchers = null;
    for (const release of held) release();
    held = [];
    const info = modesOf(pack.manifest).find((m) => m.id === modeId);
    if (!info) throw new Error(`the pack has no mode ${modeId}`);
    thumbs = {};
    const key = keyOf(modeId);
    const look = lookOf(pack.manifest, modeId);
    const { layout } = await loadFlatsGeometry();
    flats = new Map();
    let atlasBytes = 0;
    for (const body of BODY_TYPES) {
        const [atlas, lut] = await Promise.all([
            acquireFlats(key, body, dpi),
            loadFlatsLut(body),
        ]);
        held.push(() => releaseFlats(key, body, dpi));
        atlasBytes += atlas.bytes;
        flats.set(flatsResourceKey(key, body), { atlas, lut, layout });
    }
    const composeSeconds = (performance.now() - t0) / 1000;
    const wear = { key, look };
    const looks: MarcherSlotLook[] = [...BODY_TYPES, MEDIAN].map(
        (bodyType) => ({
            body: { bodyType, skinTone: SKIN_TONES[2], heightClass: 1 },
            // a band member who carries nothing, dressed as the band is
            uniform: sectionUniform(
                "",
                "up",
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {},
                wear,
            ),
        }),
    );
    marchers = new MarcherBodies(bodies, bake, looks, "high", flats);
    scene.add(marchers.group);
    const attention = bake.rows.attention as unknown as FeetPlay["row"];
    const march = bake.rows["8to5"] as unknown as FeetPlay["row"];
    for (let i = 0; i < BODY_TYPES.length; i++)
        marchers.setClip(i, { row: attention });
    findStride(march);
    marchers.setClip(STRIDE, { row: march, phase: strideCount });

    // the app's quiet notes for what this mode draws
    const shown = drawn(pack.manifest, modeId);
    const errors: string[] = [];
    const warnings: string[] = [];
    shown.layers.forEach((layer, i) => {
        const n = layerNotes(
            layer.id,
            (notesByLayer[layer.id] ?? []) as Parameters<typeof layerNotes>[1],
            i === 0,
        );
        errors.push(...n.errors);
        warnings.push(...n.warnings);
    });
    const aspects: Record<string, number> = {};
    for (const { file, png } of pack.itemFiles) {
        const s = pngHeaderSize(png);
        if (s) aspects[file] = s.width / s.height;
    }
    const ic = itemChecks(shown.items, aspects, regions);
    errors.push(...ic.errors);
    warnings.push(...ic.warnings);
    // a print's region with too many copies is left plain on that body
    for (const item of shown.items) {
        if (item.grade !== "tile") continue;
        const size = uniformArtwork.itemSize(item, aspects[item.file] ?? 1);
        if (!size) continue;
        for (const body of BODY_TYPES) {
            const laid = uniformArtwork.tileLayout(
                layout,
                regions,
                body,
                item.panel,
                item,
                size.w,
                size.h,
            );
            const plain = (item.regions ?? []).filter(
                (r) => !laid.some((t) => t.region === r),
            );
            if (plain.length)
                warnings.push(
                    `item "${item.id}": on ${body}, ${plain.join(", ")} would need over ${uniformArtwork.MAX_TILES_PER_REGION} copies, so it is left plain`,
                );
        }
    }
    return {
        mode: info,
        layers: shown.layers.map((l) => l.id),
        items: shown.items.map((i) => i.id),
        palette: look,
        errors,
        warnings,
        atlasMB: +(atlasBytes / 1e6).toFixed(1),
        composeSeconds: +composeSeconds.toFixed(2),
        stride: {
            clip: "8to5 (class 1.00)",
            count: +strideCount.toFixed(3),
            feetApartM: +strideApart.toFixed(3),
        },
    };
}

/** The count in the first two of `march` with the median body's feet furthest apart */
function findStride(march: FeetPlay["row"]) {
    if (!marchers || !bake || !bodies) return;
    const skeleton = bodies.get(MEDIAN)!.mesh.skeleton;
    const rest = (name: string) => {
        const i = skeleton.bones.findIndex(
            (b) => b.name.replace(/\./g, "") === name,
        );
        return new THREE.Vector3().setFromMatrixPosition(
            skeleton.boneInverses[i].clone().invert(),
        );
    };
    const feet = ["DEF-footL", "DEF-footR"].map((n) => ({
        bone: bake!.boneNames.indexOf(n),
        at: rest(n),
    }));
    if (feet.some((f) => f.bone < 0)) return;
    marchers.setClip(STRIDE, { row: march });
    const m = new Float32Array(bake.bones * 16);
    const m4 = new THREE.Matrix4();
    let best = -1;
    for (let i = 0; i <= 64; i++) {
        const count = (2 * i) / 64;
        marchers.composer.composeSlotCpu(STRIDE, count, m);
        const [a, b] = feet.map((f) =>
            f.at.clone().applyMatrix4(m4.fromArray(m, f.bone * 16)),
        );
        const d = Math.abs(a.z - b.z);
        if (d > best) {
            best = d;
            strideCount = count;
        }
    }
    strideApart = best;
}

/** Places the slots (`at` per slot, or none) and composes their bones */
function place(at: ({ x: number; z: number; heading: number } | null)[]) {
    if (!marchers) throw new Error("prepare a mode first");
    const xz = new Float32Array(SLOTS * 2);
    const heading = new Float32Array(SLOTS);
    const placed = new Uint8Array(SLOTS);
    at.forEach((p, i) => {
        if (!p) return;
        xz[i * 2] = p.x;
        xz[i * 2 + 1] = p.z;
        heading[i] = p.heading;
        placed[i] = 1;
    });
    const c = camera.position;
    marchers.writeFrame(xz, heading, placed, 0, [c.x, c.y, c.z]);
    marchers.compose(renderer, true);
}

async function snap(w: number, h: number, thumb: string) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const blob = await new Promise<Blob>((res, rej) =>
        renderer.domElement.toBlob(
            (b) => (b ? res(b) : rej(new Error("no PNG"))),
            "image/png",
        ),
    );
    const t = document.createElement("canvas");
    t.width = w;
    t.height = h;
    t.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
    thumbs[thumb] = t;
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The turntable camera, looking at `target` (relative to the field centre), `dist` m out */
function turntable(target: THREE.Vector3, dist: number, height: number) {
    const c = venue!.centre;
    camera.fov = 20;
    camera.position.set(
        c.x + target.x + Math.sin(turntableAz) * dist,
        height,
        c.z + target.z + Math.cos(turntableAz) * dist,
    );
    camera.lookAt(c.x + target.x, target.y, c.z + target.z);
    // the scale bar 0.55 m to the camera's right of the performer
    const bar = studio.getObjectByName("scale-bar")!;
    bar.position.set(
        target.x + Math.cos(turntableAz) * 0.55,
        0,
        target.z - Math.sin(turntableAz) * 0.55,
    );
}

/** One body standing at attention, seen from `view` */
export async function shotStand(body: BodyType, view: string) {
    const az = VIEW_AZIMUTH[view];
    if (az === undefined) throw new Error(`unknown view ${view}`);
    portraitSet(true);
    const c = venue!.centre;
    const slot = BODY_TYPES.indexOf(body);
    place(
        Array.from({ length: SLOTS }, (_, i) =>
            i === slot
                ? { x: c.x, z: c.z, heading: turntableAz - rad(az) }
                : null,
        ),
    );
    turntable(new THREE.Vector3(0, 1.07, 0), 7.2, 1.15);
    return snap(640, 960, `${body}|${view}`);
}

/** The median body mid-stride (8 to 5), from the front or its left side */
export async function shotStride(view: "front" | "side") {
    portraitSet(true);
    const c = venue!.centre;
    const az = view === "front" ? 0 : 90;
    place(
        Array.from({ length: SLOTS }, (_, i) =>
            i === STRIDE
                ? { x: c.x, z: c.z, heading: turntableAz - rad(az) }
                : null,
        ),
    );
    turntable(new THREE.Vector3(0, 1.07, 0), 7.2, 1.15);
    return snap(640, 960, `stride|${view}`);
}

/** All 7 in a line on the field, from 40 m out and 15 m up: a 20° lens, or 7° zoomed in */
export async function shotStands(zoom: boolean) {
    portraitSet(false);
    const c = venue!.centre;
    place(
        Array.from({ length: SLOTS }, (_, i) =>
            i < BODY_TYPES.length
                ? { x: c.x + (i - 3) * 1.4, z: c.z, heading: 0 }
                : null,
        ),
    );
    camera.fov = zoom ? 7 : 20;
    camera.position.set(c.x, 15, c.z + 40);
    camera.lookAt(c.x, 1, c.z);
    return snap(1920, 1080, zoom ? "stands-zoom" : "stands");
}

/** The median body's composed atlas for this mode, as the shader samples it */
export async function atlasPng(): Promise<string> {
    const r = [...flats.entries()].find(([k]) => k.endsWith(`|${MEDIAN}`));
    if (!r) throw new Error("no atlas");
    const image = r[1].atlas.texture.image as ImageBitmap;
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")!.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!)));
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** This mode's contact sheet: the 7 bodies by `views`, the stride pair and the stands view */
export async function contactSheet(title: string, views: string[]) {
    const tw = 220;
    const th = 330;
    const pad = 10;
    const lab = 22;
    const left = 150;
    const stands = thumbs.stands;
    const W = left + views.length * (tw + pad) + pad;
    const standsW = Math.max(W - 2 * pad - 2 * (tw + pad), 400);
    const standsH = stands
        ? Math.round((standsW * stands.height) / stands.width)
        : 0;
    const sheetW = Math.max(W, 2 * pad + 2 * (tw + pad) + standsW);
    const H =
        50 +
        lab +
        BODY_TYPES.length * (th + pad) +
        Math.max(th, standsH) +
        lab +
        pad * 2;
    const c = document.createElement("canvas");
    c.width = sheetW;
    c.height = H;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, sheetW, H);
    x.fillStyle = "#111";
    x.font = "bold 22px sans-serif";
    x.fillText(title, pad, 32);
    x.font = "15px sans-serif";
    x.fillStyle = "#333";
    views.forEach((v, i) => x.fillText(v, left + i * (tw + pad) + 4, 66));
    BODY_TYPES.forEach((bt, r) => {
        const y = 50 + lab + r * (th + pad);
        x.fillStyle = "#333";
        x.fillText(bt, pad, y + th / 2);
        views.forEach((v, i) => {
            const t = thumbs[`${bt}|${v}`];
            if (t) x.drawImage(t, left + i * (tw + pad), y, tw, th);
        });
    });
    const y = 50 + lab + BODY_TYPES.length * (th + pad) + lab;
    x.fillText("stride front", pad, y - 6);
    x.fillText("stride side", pad + tw + pad, y - 6);
    x.fillText("stands (40 m out, 15 m up)", pad + 2 * (tw + pad), y - 6);
    if (thumbs["stride|front"])
        x.drawImage(thumbs["stride|front"], pad, y, tw, th);
    if (thumbs["stride|side"])
        x.drawImage(thumbs["stride|side"], pad + tw + pad, y, tw, th);
    if (stands) x.drawImage(stands, pad + 2 * (tw + pad), y, standsW, standsH);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!)));
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

export const MEDIAN_BODY = MEDIAN;
export const BODIES = BODY_TYPES;
