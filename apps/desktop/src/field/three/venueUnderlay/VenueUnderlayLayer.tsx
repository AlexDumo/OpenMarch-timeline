import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import { useShallow } from "zustand/react/shallow";
import {
    Box3,
    CanvasTexture,
    DirectionalLight,
    DoubleSide,
    HemisphereLight,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    Vector3,
    WebGLRenderer,
} from "three";
import {
    worldToPixels,
    type FieldFootprint,
    type FieldProperties,
} from "@openmarch/core";
import { useVenueSettings } from "@/hooks/queries/useVenueSettings";
import { useFieldImage } from "@/view3d/window/useFieldImage";
import {
    paintPlan,
    planField,
    textureLayout,
    venueFootprint,
    type FieldPlan,
    type FieldRole,
} from "@/view3d/core/field";
import { KIT_BUILDERS, KIT_FIELD_STYLE } from "@/view3d/core/kits";
import { buildCrowd, defaultCrowdPalette } from "@/view3d/core/environment";
import {
    DEFAULT_VENUE_PARAMS,
    type VenueSettings,
} from "@/view3d/core/venueSettings";
import type { VenueKitId, VenueParams } from "@/view3d/core/types";
import { LOOKS, useUnderlayStore, type LookParams } from "./underlayStore";

/**
 * PROTOTYPE: the 3D View's venue, top down, under the 2D grid. The field
 * surface is the 3D View's own plan (`planField`) repainted without the
 * markings the 2D grid already draws, then washed toward the field background
 * in a shader. Surroundings are an apron of turf feathered into the page, or a
 * one-off top-down render of the venue kit (stands and crowd).
 *
 * Render orders: field background -2, stands -1.8, venue field -1.6, the
 * show's field image -1, lines 0.
 */
const STANDS_ORDER = -1.8;
const FIELD_ORDER = -1.6;

/** Roles the 2D grid draws itself; doubled lines a pixel apart look broken. */
const MARKINGS: ReadonlySet<FieldRole> = new Set<FieldRole>([
    "grid",
    "halfLine",
    "yardLine",
    "yLine",
    "hash",
    "tick",
    "dot",
    "border",
    "yardNumber",
    "arrow",
    "grain",
]);
const INK_ZONES: ReadonlySet<FieldRole> = new Set<FieldRole>([
    "endZone",
    "endZoneHatch",
    "endZoneFade",
    "endZoneBorder",
]);
const INK_MARKS: ReadonlySet<FieldRole> = new Set<FieldRole>([
    "centerLogo",
    "endZoneText",
    "tarpArt",
]);

/** Apron of turf around the field, in meters, feathered over its outer half. */
const APRON = 9;
const LONG_SIDE = 4096;

interface Painted {
    canvas: HTMLCanvasElement;
    /** Where the canvas lies, in world meters. */
    footprint: FieldFootprint;
    /** The color most of the canvas is (turf base), for the detail boost. */
    base: [number, number, number];
}

function hexToRgb(color: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return [0.24, 0.48, 0.2];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function paintField(
    plan: FieldPlan,
    look: LookParams,
    apron: boolean,
    image: CanvasImageSource | null,
): Painted {
    const f = plan.footprint;
    const m = apron ? APRON : 0;
    const footprint: FieldFootprint = {
        minX: f.minX - m,
        maxX: f.maxX + m,
        minZ: f.minZ - m,
        maxZ: f.maxZ + m,
    };
    const layout = textureLayout(footprint, LONG_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const g = canvas.getContext("2d")!;
    const background = plan.items.find(
        (i) => i.role === "background" && "color" in i,
    ) as { color?: string } | undefined;
    const baseColor = background?.color ?? "#3d7a33";

    if (look.ink) {
        const zones = plan.items.filter((i) => INK_ZONES.has(i.role));
        const marks = plan.items.filter((i) => INK_MARKS.has(i.role));
        g.globalAlpha = 0.35;
        paintPlan(g, { ...plan, items: zones }, layout, image);
        g.globalAlpha = 1;
        paintPlan(g, { ...plan, items: marks }, layout, image);
    } else {
        if (m > 0) {
            g.fillStyle = baseColor;
            g.fillRect(0, 0, layout.width, layout.height);
        }
        const items = look.keepMarkings
            ? plan.items
            : plan.items.filter((i) => !MARKINGS.has(i.role));
        paintPlan(g, { ...plan, items }, layout, image);
        if (m > 0) feather(g, layout.width, layout.height, m * layout.scaleX);
    }
    return { canvas, footprint, base: hexToRgb(baseColor) };
}

/** Fades the canvas's outer `px` pixels to transparent on every side. */
function feather(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    px: number,
): void {
    g.globalCompositeOperation = "destination-in";
    const ramp = (x0: number, y0: number, x1: number, y1: number) => {
        const grad = g.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,1)");
        return grad;
    };
    g.fillStyle = ramp(0, 0, px, 0);
    g.fillRect(0, 0, w, h);
    g.fillStyle = ramp(w, 0, w - px, 0);
    g.fillRect(0, 0, w, h);
    g.fillStyle = ramp(0, 0, 0, px);
    g.fillRect(0, 0, w, h);
    g.fillStyle = ramp(0, h, 0, h - px);
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "source-over";
}

/**
 * Renders the venue kit (stands, crowd, buildings) straight down into a 2D
 * canvas, once, on its own short-lived WebGL context.
 */
function renderStands(
    kitId: VenueKitId,
    fp: FieldProperties,
    params: VenueParams,
): Painted | null {
    const style = KIT_FIELD_STYLE[kitId];
    const fieldFootprint = venueFootprint(fp, style);
    const kit = KIT_BUILDERS[kitId]({
        footprint: fieldFootprint,
        params,
        quality: "low",
        venuePodium: true,
    });
    const scene = new Scene();
    scene.add(kit.root);
    const crowd =
        kit.seatRows.length > 0
            ? buildCrowd(kit.seatRows, {
                  density: kit.crowdDensity ?? 0.6,
                  palette: defaultCrowdPalette(params),
                  quality: "high",
              })
            : null;
    if (crowd) kit.root.add(crowd.mesh);
    scene.add(new HemisphereLight(0xffffff, 0x9a9a9a, 1.8));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 120, 60);
    scene.add(sun, sun.target);
    try {
        kit.setLighting(kit.defaultLighting);
    } catch {
        // Lighting needs the environment in some kits; plain lights do here
    }
    kit.onFrame?.({ cameraPosition: [0, 600, 0], dt: 0 });

    const box = new Box3().setFromObject(kit.root);
    const reach = 140;
    const footprint: FieldFootprint = {
        minX: Math.max(box.min.x, fieldFootprint.minX - reach),
        maxX: Math.min(box.max.x, fieldFootprint.maxX + reach),
        minZ: Math.max(box.min.z, fieldFootprint.minZ - reach),
        maxZ: Math.min(box.max.z, fieldFootprint.maxZ + reach),
    };
    if (
        !(footprint.maxX > footprint.minX) ||
        !(footprint.maxZ > footprint.minZ)
    ) {
        kit.dispose();
        crowd?.dispose();
        return null;
    }
    const layout = textureLayout(footprint, LONG_SIDE);
    const cx = (footprint.minX + footprint.maxX) / 2;
    const cz = (footprint.minZ + footprint.maxZ) / 2;
    // Looking straight down with the back of the field (min z) at the top
    const camera = new OrthographicCamera(
        footprint.minX - cx,
        footprint.maxX - cx,
        cz - footprint.minZ,
        -(footprint.maxZ - cz),
        1,
        2000,
    );
    camera.up.set(0, 0, -1);
    camera.position.set(cx, 800, cz);
    camera.lookAt(new Vector3(cx, 0, cz));
    camera.updateProjectionMatrix();

    const renderer = new WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: true,
    });
    renderer.setSize(layout.width, layout.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    canvas.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
    renderer.dispose();
    renderer.forceContextLoss();
    kit.dispose();
    crowd?.dispose();
    return { canvas, footprint, base: [0.5, 0.5, 0.5] };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 bg;
uniform vec3 base;
uniform float amount;
uniform float saturation;
uniform float detail;
uniform float ink;
varying vec2 vUv;
vec3 saturate(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return mix(vec3(l), c, s);
}
void main() {
    vec4 c = texture2D(map, vUv);
    if (ink > 0.5) {
        gl_FragColor = vec4(vec3(0.0), c.a * amount);
        return;
    }
    vec3 g = saturate(c.rgb, saturation);
    vec3 washed = mix(bg, g, amount) + (g - saturate(base, saturation)) * detail;
    gl_FragColor = vec4(clamp(washed, 0.0, 1.0), c.a);
}`;

function useUnderlayMesh(
    painted: Painted | null,
    fp: FieldProperties,
    uniforms: {
        amount: number;
        saturation: number;
        detail: number;
        ink: boolean;
    },
    renderOrder: number,
): Mesh | null {
    const invalidate = useThree((s) => s.invalidate);
    const texture = useMemo(() => {
        if (!painted) return null;
        const t = new CanvasTexture(painted.canvas);
        t.flipY = false;
        t.magFilter = LinearFilter;
        t.minFilter = LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 8;
        return t;
    }, [painted]);

    const mesh = useMemo(() => {
        if (!painted || !texture) return null;
        const bg = fp.theme.background;
        const material = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                map: { value: texture },
                bg: { value: [bg.r / 255, bg.g / 255, bg.b / 255] },
                base: { value: painted.base },
                amount: { value: uniforms.amount },
                saturation: { value: uniforms.saturation },
                detail: { value: uniforms.detail },
                ink: { value: uniforms.ink ? 1 : 0 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
        });
        const f = painted.footprint;
        const a = worldToPixels(fp, { x: f.minX, z: f.minZ });
        const b = worldToPixels(fp, { x: f.maxX, z: f.maxZ });
        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        mesh.scale.set(b.x - a.x, b.y - a.y, 1);
        mesh.frustumCulled = false;
        mesh.renderOrder = renderOrder;
        return mesh;
    }, [
        painted,
        texture,
        fp,
        uniforms.amount,
        uniforms.saturation,
        uniforms.detail,
        uniforms.ink,
        renderOrder,
    ]);

    useEffect(() => {
        invalidate();
        return () => {
            mesh?.geometry.dispose();
            (mesh?.material as ShaderMaterial | undefined)?.dispose();
        };
    }, [mesh, invalidate]);
    useEffect(() => () => texture?.dispose(), [texture]);
    return mesh;
}

export default function VenueUnderlayLayer({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const { look, surroundings, kit } = useUnderlayStore(
        useShallow((s) => ({
            look: s.look,
            surroundings: s.surroundings,
            kit: s.kit,
        })),
    );
    const { data: venue } = useVenueSettings();
    const { image } = useFieldImage();
    const kitId: VenueKitId =
        kit ?? (venue as VenueSettings | undefined)?.kit ?? "hs";
    const params = venue?.params ?? DEFAULT_VENUE_PARAMS;
    const paramsKey = JSON.stringify(params);
    const lookParams = look === "plain" ? null : LOOKS[look];
    const style = KIT_FIELD_STYLE[kitId];

    // Repaint once the web font is in, so end-zone text isn't a fallback face
    const [fontsReady, setFontsReady] = useState(false);
    useEffect(() => {
        let live = true;
        void Promise.all([
            document.fonts.load('700 64px "DM Sans"'),
            document.fonts.load('600 64px "DM Sans"'),
        ])
            .catch(() => undefined)
            .then(() => live && setFontsReady(true));
        return () => {
            live = false;
        };
    }, []);

    const fieldPainted = useMemo(() => {
        if (!lookParams) return null;
        const plan = planField({
            fieldProperties,
            style,
            params: JSON.parse(paramsKey) as VenueParams,
            image,
        });
        return paintField(
            plan,
            lookParams,
            surroundings !== "none" && style !== "theme",
            image,
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        fieldProperties,
        style,
        paramsKey,
        image,
        lookParams,
        surroundings,
        fontsReady,
    ]);

    // The kit render is slow (a second WebGL context): only on a kit or field change
    const [stands, setStands] = useState<Painted | null>(null);
    const wantStands = !!lookParams && surroundings === "stands";
    useEffect(() => {
        if (!wantStands) {
            setStands(null);
            return;
        }
        let live = true;
        const timer = window.setTimeout(() => {
            try {
                const painted = renderStands(
                    kitId,
                    fieldProperties,
                    JSON.parse(paramsKey) as VenueParams,
                );
                if (live) setStands(painted);
            } catch (error) {
                console.warn("Venue underlay: stands render failed", error);
            }
        }, 50);
        return () => {
            live = false;
            window.clearTimeout(timer);
        };
    }, [wantStands, kitId, fieldProperties, paramsKey]);

    const fieldMesh = useUnderlayMesh(
        fieldPainted,
        fieldProperties,
        {
            amount: lookParams?.amount ?? 0,
            saturation: lookParams?.saturation ?? 1,
            detail: lookParams?.detail ?? 0,
            ink: lookParams?.ink ?? false,
        },
        FIELD_ORDER,
    );
    const standsMesh = useUnderlayMesh(
        stands,
        fieldProperties,
        {
            amount: lookParams?.surroundAmount ?? 0,
            saturation: lookParams?.ink ? 0 : (lookParams?.saturation ?? 1),
            detail: 0,
            ink: false,
        },
        STANDS_ORDER,
    );

    return (
        <>
            {standsMesh && <primitive object={standsMesh} />}
            {fieldMesh && <primitive object={fieldMesh} />}
        </>
    );
}
