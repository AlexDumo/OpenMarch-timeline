/**
 * Bakes performer figures in the editor (ADR 0019): each look standing at attention, its piece
 * held as the look says, rendered straight down, alone, evenly lit, on a transparent background,
 * with a dark edge, at `FIGURE_PX_PER_METER`. Built from the 3D View's own marchers
 * (`MarcherBodies`: the bodies, uniforms, instruments, silks and plumes), so a figure is what the
 * 3D View draws.
 *
 * It runs on a WebGL renderer of its own, made for the bake and thrown away after, so the field's
 * renderer never changes. The editor runs it in a worker (`figureBake.worker.ts`), so the editor
 * never waits on it; where a worker can't draw, on the editor's main thread, one figure per turn.
 */
import {
    AmbientLight,
    DirectionalLight,
    HemisphereLight,
    OrthographicCamera,
    PMREMGenerator,
    SRGBColorSpace,
    NoToneMapping,
    Scene,
    type WebGLRenderTarget,
    WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { UniformLook } from "@/view3d/core/marchers/looks";
import { FIGURE_BODY } from "@/view3d/core/marchers/figureDress";
import { FRONT_HEADING } from "@/view3d/core/marchers/facing";
import { holdId } from "@/view3d/core/instruments/holds";
import {
    loadClassClips,
    loadOneBody,
} from "@/view3d/window/performers/marchers/marcherAssets";
import {
    MarcherBodies,
    bakeForBodies,
} from "@/view3d/window/performers/marchers/marcherBodies";
import {
    ClipSet,
    clipName,
} from "@/view3d/window/performers/marchers/useMarcherBodies";
import {
    holdRowName,
    hornPlay,
    hornRowSpec,
} from "@/view3d/window/performers/marchers/hornRows";
import { FIGURE_EDGE_M, FIGURE_PX_PER_METER } from "./figureLooks";

/** Where the performer stands in a figure's picture, and its scale. */
export interface FigureLayout {
    /** The picture's size, px */
    w: number;
    h: number;
    pxPerMeter: number;
    /** The performer's spot, px from the picture's top left */
    cx: number;
    cy: number;
}

export interface BakedFigure {
    /** WebP (PNG where the browser can't write WebP) */
    image: Uint8Array;
    layout: FigureLayout;
}

/** The square each figure renders in, m: room for a 6 ft flag held up. */
const SIZE_M = 3.2;
/** The square's side, px. */
const PX = Math.round(SIZE_M * FIGURE_PX_PER_METER);
/** Each picture renders this many times larger, then scales down, for smooth edges. */
const OVERSIZE = 2;
/** How far apart the performers stand while baking, m: none reaches into another's square. */
const SPACING_M = 8;
/** A pixel counts as part of the figure from this alpha (of 255). */
const ALPHA_MIN = 3;

type Canvas2d = OffscreenCanvas | HTMLCanvasElement;

function canvas2d(w: number, h: number): Canvas2d {
    if (typeof OffscreenCanvas !== "undefined")
        return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
}

/** A 2D context; `read` keeps it in memory for `getImageData`, else it draws on the GPU. */
const context2d = (c: Canvas2d, read = false) =>
    c.getContext("2d", { willReadFrequently: read }) as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D;

async function encode(c: Canvas2d): Promise<Uint8Array> {
    const blob =
        "convertToBlob" in c
            ? await c.convertToBlob({ type: "image/webp", quality: 0.9 })
            : await new Promise<Blob>((resolve, reject) =>
                  c.toBlob(
                      (b) => (b ? resolve(b) : reject(new Error("no picture"))),
                      "image/webp",
                      0.9,
                  ),
              );
    return new Uint8Array(await blob.arrayBuffer());
}

/** Lets the editor draw a frame between figures. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const aborted = () => new DOMException("The figure bake stopped", "AbortError");

/** Where a bake's time went, for the console. */
export type BakeReport = (text: string) => void;

// eslint-disable-next-line no-console -- where a bake's time goes
const logReport: BakeReport = (text) => console.info(text);

/**
 * Bakes a figure of each look, in order: null for a look that drew nothing. Stops with an
 * `AbortError` when `signal` aborts.
 */
// eslint-disable-next-line max-lines-per-function -- one bake, set up and torn down together
export async function bakeFigures(
    looks: readonly UniformLook[],
    signal?: AbortSignal,
    report: BakeReport = logReport,
): Promise<(BakedFigure | null)[]> {
    if (looks.length === 0) return [];
    const t0 = performance.now();
    // the longest stretch each step holds the main thread, ms
    const held: Record<string, number> = {};
    let since = t0;
    const wait = async <T>(step: string, p: Promise<T>): Promise<T> => {
        held[step] = Math.max(held[step] ?? 0, performance.now() - since);
        try {
            return await p;
        } finally {
            since = performance.now();
        }
    };
    const [body, classClips] = await Promise.all([
        loadOneBody(FIGURE_BODY.bodyType),
        loadClassClips(FIGURE_BODY.heightClass),
    ]);
    if (signal?.aborted) throw aborted();
    const t1 = performance.now();
    const bodies = new Map([[FIGURE_BODY.bodyType, body]]);
    const attention = clipName("attention", FIGURE_BODY.heightClass);
    const clip = new ClipSet(classClips, null).get(attention);
    if (!clip) throw new Error(`Performer figures: no ${attention} clip`);
    const holds = new Set<string>();
    for (const look of looks) {
        const carry = look.options.carry;
        if (carry)
            holds.add(holdRowName(holdId(carry.family, look.options.hold)));
    }
    await wait("clips", nextTurn());
    const bake = bakeForBodies(
        bodies,
        { [attention]: clip },
        "left",
        [...holds]
            .map((name) => hornRowSpec(name, body.mesh.skeleton))
            .filter((r) => r !== null),
        new Set([attention]),
    );

    const side = PX * OVERSIZE;
    const n = looks.length;
    let renderer: WebGLRenderer | null = null;
    let marchers: MarcherBodies | null = null;
    let pmrem: PMREMGenerator | null = null;
    let studio: WebGLRenderTarget | null = null;
    try {
        // drawn straight onto its own canvas, which the 2D canvases then scale down: nothing read back
        const canvas = canvas2d(side, side);
        renderer = new WebGLRenderer({
            canvas,
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            antialias: false,
            powerPreference: "low-power",
        });
        // sRGB colors with no tone mapping: as the shipped figures were baked
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NoToneMapping;
        renderer.setSize(side, side, false);
        await wait("bodies", nextTurn());
        marchers = new MarcherBodies(
            bodies,
            bake,
            looks.map((uniform) => ({ body: FIGURE_BODY, uniform })),
            "high",
        );
        const scene = new Scene();
        pmrem = new PMREMGenerator(renderer);
        // everyone at attention, holding their piece as their look says
        const feet = bake.rows[attention];
        if (!feet) throw new Error("Performer figures: attention isn't baked");
        const xz = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
            marchers.setClip(i, {
                row: feet,
                row2: null,
                weight: 0,
                phase: 0,
                rate: 1,
                legYaw: 0,
            });
            const carry = looks[i].options.carry;
            if (carry)
                marchers.setHorn(
                    i,
                    hornPlay(
                        {
                            from: 0,
                            to: 0,
                            state: looks[i].options.hold,
                            fromState: null,
                        },
                        carry.family,
                        bake.rows,
                    ),
                );
            xz[i * 2] = i * SPACING_M;
        }
        // still: the silks hang as at a halt; null camera: every piece at full detail
        marchers.writeFrame(
            xz,
            new Float32Array(n).fill(FRONT_HEADING),
            new Uint8Array(n).fill(1),
            0,
            null,
            {
                seconds: 0,
                speed: new Float32Array(n),
                turn: new Float32Array(n),
                distance: new Float64Array(n),
            },
            null,
        );
        await wait("compose", nextTurn());
        marchers.compose(renderer, true);
        const contact = marchers.group.getObjectByName(
            "view3d-marcher-contact",
        );
        if (contact) contact.visible = false;
        scene.add(marchers.group);

        await wait("studio", nextTurn());
        // neutral studio reflections, and even light from overhead: no side the shading favors
        const room = new RoomEnvironment();
        studio = pmrem.fromScene(room, 0.04);
        room.dispose();
        scene.environment = studio.texture;
        scene.environmentIntensity = 1;
        const sun = new DirectionalLight(0xffffff, 1.4);
        sun.position.set(0, 10, 0);
        scene.add(
            new AmbientLight(0xffffff, 0.9),
            new HemisphereLight(0xffffff, 0x9a9a9a, 1.1),
            sun,
        );

        const half = SIZE_M / 2;
        const camera = new OrthographicCamera(
            -half,
            half,
            half,
            -half,
            0.1,
            100,
        );
        // screen up is the back sideline (-z), as on the 2D field
        camera.up.set(0, 0, -1);
        camera.layers.enableAll();
        const t2 = performance.now();
        await wait("lights", renderer.compileAsync(scene, camera));
        if (signal?.aborted) throw aborted();
        const t3 = performance.now();

        const small = canvas2d(PX, PX);
        const smallCtx = context2d(small);
        smallCtx.imageSmoothingQuality = "high";
        renderer.setClearAlpha(0);
        const out: (BakedFigure | null)[] = [];
        for (let i = 0; i < n; i++) {
            const x = xz[i * 2];
            camera.position.set(x, 30, 0);
            camera.lookAt(x, 0, 0);
            camera.updateMatrixWorld();
            camera.updateProjectionMatrix();
            renderer.clear(true, true, true);
            renderer.render(scene, camera);
            smallCtx.clearRect(0, 0, PX, PX);
            smallCtx.drawImage(canvas, 0, 0, PX, PX);
            edge(smallCtx, PX, FIGURE_EDGE_M * FIGURE_PX_PER_METER);
            out.push(await wait("draw", cropped(smallCtx)));
            await wait("crop", nextTurn());
            if (signal?.aborted) throw aborted();
        }
        report(
            `Performer figures: load ${(t1 - t0).toFixed(0)} ms, set up ${(t2 - t1).toFixed(0)} ms, ` +
                `compile ${(t3 - t2).toFixed(0)} ms, draw ${(performance.now() - t3).toFixed(0)} ms; ` +
                `longest held ${JSON.stringify(Object.fromEntries(Object.entries(held).map(([k, v]) => [k, Math.round(v)])))}`,
        );
        return out;
    } finally {
        studio?.dispose();
        marchers?.dispose();
        bake.texture.dispose();
        pmrem?.dispose();
        renderer?.dispose();
        renderer?.forceContextLoss();
    }
}

/** The figure cut to what it draws, and where its performer stands in it; null when empty. */
async function cropped(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
): Promise<BakedFigure | null> {
    const read = canvas2d(PX, PX);
    const readCtx = context2d(read, true);
    readCtx.drawImage(ctx.canvas, 0, 0);
    const data = readCtx.getImageData(0, 0, PX, PX).data;
    let x0 = PX;
    let y0 = PX;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < PX; y++)
        for (let x = 0; x < PX; x++)
            if (data[(y * PX + x) * 4 + 3] >= ALPHA_MIN) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const cut = canvas2d(w, h);
    context2d(cut).drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
    return {
        image: await encode(cut),
        layout: {
            w,
            h,
            pxPerMeter: FIGURE_PX_PER_METER,
            cx: PX / 2 - x0,
            cy: PX / 2 - y0,
        },
    };
}

/**
 * Puts a dark edge behind the figure: its silhouette, spread by `width` pixels in every
 * direction, under the figure itself.
 */
function edge(
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    px: number,
    width: number,
) {
    const figure = canvas2d(px, px);
    context2d(figure).drawImage(ctx.canvas, 0, 0);
    const spread = canvas2d(px, px);
    const e = context2d(spread);
    const steps = 16;
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        e.drawImage(figure, Math.cos(a) * width, Math.sin(a) * width);
    }
    e.globalCompositeOperation = "source-in";
    e.fillStyle = "rgba(20, 22, 26, 0.85)";
    e.fillRect(0, 0, px, px);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(spread, 0, 0);
    ctx.drawImage(figure, 0, 0);
}
