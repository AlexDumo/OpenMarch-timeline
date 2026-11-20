// cspell:ignore Panini hfov vfov multisampling
/**
 * Seat view's part of the post pipeline (docs/3d/ui.md UI-3): what a person
 * in the seat sees, not a phone photo from it. Framework-free three.js
 * (ADR 0010 D-1); the window drives it (`window/SeatView.tsx`) and the
 * pipeline (`pipeline.ts`) draws with it.
 *
 * It holds two things the pipeline can't work out alone:
 *
 * - the source camera: a rectilinear camera at the view's eye and turned as
 *   it is, but wide enough to cover the whole picture (`paniniFrame`). The
 *   pipeline draws the scene with it, at the size `paniniSourceSize` asks;
 * - the lens per picture column (`paniniColumnTable`), a `width` by 1 float
 *   texture, so the pipeline's composite samples the source through the
 *   Panini lens with a table fetch and a few multiplies a pixel.
 *
 * With `d`, `s` and `lift` at 0 and the camera's own field of view, the
 * pipeline draws exactly what the camera would, so the window blends into
 * and out of seat view by moving the settings.
 */
import {
    DataTexture,
    FloatType,
    NearestFilter,
    PerspectiveCamera,
    RGBAFormat,
    type WebGLRenderer,
} from "three";
import {
    paniniColumnTable,
    paniniFrame,
    paniniSourceSize,
    type PaniniFrame,
    type PaniniLens,
} from "./panini";
import type { PostLens } from "./pipeline";

export interface SeatViewSettings extends PaniniLens {
    /** Horizontal field of view across the picture, in degrees. */
    hfovDeg: number;
    /** The most the middle of the picture sees top to bottom, in degrees. */
    maxVfovDeg: number;
    /** Shadow lift: deep shadows are brightened by 1 + lift. 0 is none. */
    lift: number;
    /** Exposed luminance where the lift has halved. */
    liftKnee: number;
    /**
     * Source pixels per picture pixel at the middle: 1 is as sharp as a
     * plain camera. Below 1 draws fewer pixels.
     */
    sharpness: number;
}

/**
 * Seat view's look. 105° is about what both eyes take in with attention,
 * against a phone's 60-70°. `d` 1 is the classic Panini; `s` 0.25 keeps
 * people at the sides near their true shape while bending the sidelines
 * only a little. The lift brightens the darkest parts by 45% and the field
 * by under 5%.
 */
export const SEAT_VIEW_DEFAULTS: Readonly<SeatViewSettings> = {
    hfovDeg: 105,
    maxVfovDeg: 85,
    d: 1,
    s: 0.25,
    lift: 0.45,
    liftKnee: 0.04,
    sharpness: 1,
};

/** Seat view's lens in one venue: its widest field of view and its Panini `d` and `s`. */
export interface SeatViewLook extends PaniniLens {
    hfovDeg: number;
}

/**
 * The lens for a venue: the kit's own (`KitResult.seatView`) over the
 * defaults. A much bigger room than the usual stadium, where the field is a
 * smaller part of the view and sits well below the eye, reads better a
 * little narrower and with straighter horizontals (`markDiesel.ts`).
 */
export function seatViewLook(kit?: Partial<SeatViewLook> | null): SeatViewLook {
    return {
        hfovDeg: kit?.hfovDeg ?? SEAT_VIEW_DEFAULTS.hfovDeg,
        d: kit?.d ?? SEAT_VIEW_DEFAULTS.d,
        s: kit?.s ?? SEAT_VIEW_DEFAULTS.s,
    };
}

export interface SeatViewSource {
    /** Live: change a field and the next frame uses it. */
    settings: SeatViewSettings;
    /** The wide camera the scene is drawn with, following the view's camera. */
    readonly camera: PerspectiveCamera;
    /** The lens and extents of the last frame fitted, for picking. */
    readonly frame: PaniniFrame | null;
    /**
     * Fits the source to `camera` and a picture `width` by `height` pixels,
     * and returns what the pipeline draws the frame with.
     */
    update(camera: PerspectiveCamera, width: number, height: number): PostLens;
    dispose(): void;
}

const DEG = 180 / Math.PI;

// eslint-disable-next-line max-lines-per-function
export function createSeatViewSource(
    gl: WebGLRenderer,
    settings: SeatViewSettings,
): SeatViewSource {
    const camera = new PerspectiveCamera();
    const context = gl.getContext();
    // The source is a target with multisampling: both limits apply.
    const maxSize = Math.min(
        gl.capabilities.maxTextureSize,
        context.getParameter(context.MAX_RENDERBUFFER_SIZE) as number,
    );

    // Rebuilt when the picture's width or the frame changes.
    let columns = new DataTexture(
        new Float32Array(4),
        1,
        1,
        RGBAFormat,
        FloatType,
    );
    let columnsKey = "";
    const columnTable = (width: number, f: PaniniFrame) => {
        const key = `${width} ${f.halfX} ${f.halfY} ${f.sourceTanX} ${f.sourceTanY} ${f.d} ${f.s}`;
        if (key === columnsKey) return;
        columnsKey = key;
        if (columns.image.width !== width) {
            columns.dispose();
            columns = new DataTexture(
                new Float32Array(width * 4),
                width,
                1,
                RGBAFormat,
                FloatType,
            );
            columns.minFilter = NearestFilter;
            columns.magFilter = NearestFilter;
            columns.generateMipmaps = false;
        }
        paniniColumnTable(width, f, columns.image.data as Float32Array);
        columns.needsUpdate = true;
    };

    let frame: PaniniFrame | null = null;
    const lens: PostLens = {
        camera,
        width: 1,
        height: 1,
        columns,
        lift: 0,
        liftKnee: settings.liftKnee,
    };

    const source: SeatViewSource = {
        settings,
        camera,
        get frame() {
            return frame;
        },
        update(view, width, height) {
            const s = source.settings;
            frame = paniniFrame({
                hfovDeg: s.hfovDeg,
                aspect: width / height,
                d: s.d,
                s: s.s,
                maxVfovDeg: s.maxVfovDeg,
            });
            const [sw, sh] = paniniSourceSize(
                width,
                height,
                frame,
                s.sharpness,
                maxSize,
            );

            // From the view's eye, turned as it is, wide enough for the lens.
            view.updateMatrixWorld();
            view.matrixWorld.decompose(
                camera.position,
                camera.quaternion,
                camera.scale,
            );
            camera.updateMatrixWorld();
            camera.layers.mask = view.layers.mask;
            const fov = 2 * Math.atan(frame.sourceTanY) * DEG;
            const aspect = frame.sourceTanX / frame.sourceTanY;
            if (
                camera.fov !== fov ||
                camera.aspect !== aspect ||
                camera.near !== view.near ||
                camera.far !== view.far
            ) {
                camera.fov = fov;
                camera.aspect = aspect;
                camera.near = view.near;
                camera.far = view.far;
                camera.updateProjectionMatrix();
            }

            columnTable(width, frame);
            lens.width = sw;
            lens.height = sh;
            lens.columns = columns;
            lens.lift = s.lift;
            lens.liftKnee = s.liftKnee;
            return lens;
        },
        dispose() {
            columns.dispose();
        },
    };
    return source;
}
