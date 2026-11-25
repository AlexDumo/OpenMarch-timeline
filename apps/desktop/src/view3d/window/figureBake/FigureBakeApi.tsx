/**
 * `window.view3dFigureBake`: renders performers straight down, alone, evenly
 * lit, on a transparent background, for the 2D field's performer figures
 * (fork #1319). A capture script places one performer per instrument, sets
 * one body and uniform for everyone (`figureBakeStore.ts`), and asks for a
 * square picture around each one.
 *
 * Nothing changes on screen: each picture renders into its own target with
 * the rest of the scene hidden for that render only.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
    AmbientLight,
    DirectionalLight,
    HemisphereLight,
    OrthographicCamera,
    PMREMGenerator,
    SRGBColorSpace,
    WebGLRenderTarget,
    type Object3D,
    type WebGLRenderer,
    type Scene,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PerformerBody } from "@/view3d/core/marchers/looks";
import { useFigureBakeStore, type FigureBakeLook } from "./figureBakeStore";

export interface FigureCaptureRequest {
    /** Each picture's center, in world meters (x, z). */
    centers: readonly (readonly [number, number])[];
    /** The square each picture covers, in meters. */
    sizeM: number;
    /** Each picture's side, in pixels. */
    px: number;
    /** A dark edge this many pixels wide around each figure, so white parts read on a light field. */
    outlinePx?: number;
}

export interface FigureBakeApi {
    /** Dresses everyone alike (null: the show's own looks). */
    dress(body: PerformerBody | null, look: FigureBakeLook | null): void;
    /** PNG data URLs, one per center. Screen-up is the back sideline (-z), as on the 2D field. */
    capture(request: FigureCaptureRequest): string[];
}

declare global {
    // eslint-disable-next-line no-unused-vars
    interface Window {
        /** The 2D field's figure bake; see `FigureBakeApi.tsx`. */
        view3dFigureBake?: FigureBakeApi;
    }
}

/** Each picture renders this many times larger, then scales down, for smooth edges. */
const OVERSIZE = 2;

/** Installs `window.view3dFigureBake` while mounted inside the scene's canvas. */
export function FigureBakeApiInstaller() {
    const gl = useThree((s) => s.gl);
    const scene = useThree((s) => s.scene);
    useEffect(() => {
        window.view3dFigureBake = {
            dress: (body, look) =>
                useFigureBakeStore.getState().set(body, look),
            capture: (request) => captureFigures(gl, scene, request),
        };
        return () => {
            delete window.view3dFigureBake;
        };
    }, [gl, scene]);
    return null;
}

function captureFigures(
    gl: WebGLRenderer,
    scene: Scene,
    { centers, sizeM, px, outlinePx = 0 }: FigureCaptureRequest,
): string[] {
    const marchers = scene.getObjectByName("view3d-marchers");
    if (!marchers) throw new Error("the marchers aren't drawn yet");

    // Hide everything but the marchers (and their contact shadows).
    const chain = new Set<Object3D>();
    for (let o: Object3D | null = marchers; o; o = o.parent) chain.add(o);
    const hidden: Object3D[] = [];
    const hide = (o: Object3D) => {
        if (o.visible) {
            o.visible = false;
            hidden.push(o);
        }
    };
    for (const node of chain)
        if (node !== marchers)
            for (const child of node.children)
                if (!chain.has(child)) hide(child);
    marchers.traverse((o) => {
        if (o.name === "view3d-marcher-contact") hide(o);
    });
    const background = scene.background;
    const fog = scene.fog;
    const environment = scene.environment;
    const environmentIntensity = scene.environmentIntensity;
    scene.background = null;
    scene.fog = null;
    // Neutral studio reflections: the venue's sky and turf tint the metal.
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const studio = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = studio.texture;
    scene.environmentIntensity = 1;

    // Even light from overhead: no side the shading favors when a figure turns.
    const lights = [
        new AmbientLight(0xffffff, 0.9),
        new HemisphereLight(0xffffff, 0x9a9a9a, 1.1),
        new DirectionalLight(0xffffff, 1.4),
    ];
    lights[2]!.position.set(0, 10, 0);
    for (const l of lights) scene.add(l);

    const side = px * OVERSIZE;
    const target = new WebGLRenderTarget(side, side);
    target.texture.colorSpace = SRGBColorSpace;
    const half = sizeM / 2;
    const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 100);
    camera.up.set(0, 0, -1);
    // the scene draws on several layers (ground, contact, selection)
    camera.layers.enableAll();
    const pixels = new Uint8Array(side * side * 4);
    const big = document.createElement("canvas");
    big.width = big.height = side;
    const bigCtx = big.getContext("2d")!;
    const small = document.createElement("canvas");
    small.width = small.height = px;
    const smallCtx = small.getContext("2d")!;
    smallCtx.imageSmoothingQuality = "high";

    const previousTarget = gl.getRenderTarget();
    const previousClear = gl.getClearAlpha();
    const out: string[] = [];
    try {
        gl.setClearAlpha(0);
        for (const [x, z] of centers) {
            camera.position.set(x, 30, z);
            camera.lookAt(x, 0, z);
            camera.updateMatrixWorld();
            camera.updateProjectionMatrix();
            gl.setRenderTarget(target);
            gl.clear(true, true, true);
            gl.render(scene, camera);
            gl.readRenderTargetPixels(target, 0, 0, side, side, pixels);
            // WebGL rows run bottom up
            const image = bigCtx.createImageData(side, side);
            const row = side * 4;
            for (let y = 0; y < side; y++)
                image.data.set(
                    pixels.subarray((side - 1 - y) * row, (side - y) * row),
                    y * row,
                );
            bigCtx.putImageData(image, 0, 0);
            smallCtx.clearRect(0, 0, px, px);
            smallCtx.drawImage(big, 0, 0, px, px);
            if (outlinePx > 0) outline(smallCtx, px, outlinePx);
            out.push(small.toDataURL("image/png"));
        }
    } finally {
        gl.setRenderTarget(previousTarget);
        gl.setClearAlpha(previousClear);
        target.dispose();
        for (const l of lights) {
            scene.remove(l);
            l.dispose();
        }
        scene.background = background;
        scene.fog = fog;
        scene.environment = environment;
        scene.environmentIntensity = environmentIntensity;
        studio.dispose();
        pmrem.dispose();
        for (const o of hidden) o.visible = true;
    }
    return out;
}

/**
 * Puts a dark edge behind the figure: its silhouette, spread by `width`
 * pixels in every direction, under the figure itself.
 */
function outline(ctx: CanvasRenderingContext2D, px: number, width: number) {
    const figure = document.createElement("canvas");
    figure.width = figure.height = px;
    figure.getContext("2d")!.drawImage(ctx.canvas, 0, 0);
    const edge = document.createElement("canvas");
    edge.width = edge.height = px;
    const e = edge.getContext("2d")!;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        e.drawImage(figure, Math.cos(a) * width, Math.sin(a) * width);
    }
    e.globalCompositeOperation = "source-in";
    e.fillStyle = "rgba(20, 22, 26, 0.85)";
    e.fillRect(0, 0, px, px);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(edge, 0, 0);
    ctx.drawImage(figure, 0, 0);
}
