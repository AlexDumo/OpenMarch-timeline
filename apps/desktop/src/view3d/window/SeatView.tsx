// cspell:ignore Panini hfov
/**
 * Seat view (docs/3d/ui.md UI-3): at a seat or floor camera, the canvas
 * shows what a person sitting there sees rather than what a phone photo
 * from there shows. A wide field of view through a Panini lens, the
 * shadows lifted a little as an adapted eye sees them, and the head turns
 * with a drag (`camera/CameraRig.tsx`).
 *
 * The drawing is the post pipeline's (`core/post/pipeline.ts`, mounted by
 * `PostFx.tsx`), the same one that blooms a venue's lamps, so Seat view and
 * bloom draw together. This is the blend controller that feeds it: the lens's
 * source camera and column table (`core/post/seatViewSource.ts`) and how far
 * in the blend is.
 *
 * It is on while the viewer's Seat view choice is on (`renderPrefs.ts`,
 * default on), the view is at a person's eye (`useCameraStore().seated`)
 * and the Director is off. Elsewhere (top-down, the blimp, saved views, a
 * free view, the Director's shots) and with the choice off, the canvas
 * shows the photo-matched camera as before, which is how venues are
 * checked against reference photos.
 *
 * Going in or out blends over about a second (a jump under reduced
 * motion): the lens, the width and the lift move together from the
 * camera's own projection, which the pipeline draws exactly at 0. Once out,
 * a venue without bloom unmounts the pipeline and the canvas draws the scene
 * directly again, at no extra cost.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector2, type Camera } from "three";
import {
    createSeatViewSource,
    mixLens,
    rectilinearHfovDeg,
    SEAT_VIEW_DEFAULTS,
    seatViewLook,
    supportsPostPipeline,
    type PostLens,
} from "@/view3d/core/post";
import { useView3dSceneStore, type View3dQuality } from "./sceneStore";
import { useCameraStore } from "./camera/cameraStore";
import { seatLens } from "./camera/seatLens";
import { useDirectorStore } from "./cinema/directorStore";
import { requestDraw } from "./drawWake";

/** How long seat view takes to blend in or out (ms), about a fly-to's length. */
export const SEAT_VIEW_BLEND_MS = 900;
/** Longest frame step the blend takes (ms): a draw after a pause doesn't skip it. */
const MAX_STEP_MS = 50;

/**
 * Source pixels per picture pixel at the middle (`SeatViewSettings.sharpness`).
 * High draws the middle as sharp as the photo camera; low draws 0.8 of that,
 * about two-thirds of the pixels, as low already trades detail for speed.
 */
export const SEAT_VIEW_SHARPNESS: Record<View3dQuality, number> = {
    high: 1,
    low: 0.8,
};
/**
 * The most source pixels per screen (CSS) pixel at the middle. A HiDPI
 * screen drawn at 2x gets 1.5: sharper than a 1x screen still, and the
 * source then has fewer pixels than the canvas instead of 2.3 times as many.
 */
export const SEAT_VIEW_MAX_SOURCE_PER_CSS_PX = 1.5;

/** The source's sharpness for a quality and the canvas's pixel ratio. */
export function seatViewSharpness(
    quality: View3dQuality,
    pixelRatio: number,
): number {
    return Math.min(
        SEAT_VIEW_SHARPNESS[quality],
        SEAT_VIEW_MAX_SOURCE_PER_CSS_PX / Math.max(1, pixelRatio),
    );
}

function prefersReducedMotion(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/** Smoothstep: the blend starts and ends gently. */
const ease = (u: number) => u * u * (3 - 2 * u);

export interface SeatViewState {
    /** Seat view should show now. */
    on: boolean;
    /** The pipeline must draw for seat view: on, or still blending out. */
    mounted: boolean;
    /** Called once the blend is all the way out. */
    onOut: () => void;
}

/** Whether seat view is on, and whether it still needs the pipeline. */
export function useSeatView(): SeatViewState {
    const gl = useThree((s) => s.gl);
    const supported = useMemo(() => supportsPostPipeline(gl), [gl]);
    const choice = useView3dSceneStore((s) => s.seatView);
    const seated = useCameraStore((s) => s.seated);
    const directing = useDirectorStore((s) => s.directing);
    useEffect(() => {
        seatLens.available = supported;
    }, [supported]);

    const on = supported && choice && seated && !directing;
    const [mounted, setMounted] = useState(on);
    useEffect(() => {
        if (on) setMounted(true);
        requestDraw(SEAT_VIEW_BLEND_MS + 200);
    }, [on]);
    const onOut = useMemo(() => () => setMounted(false), []);
    return { on, mounted: mounted || on, onOut };
}

/**
 * The blend controller, for the component that draws the pipeline. Call
 * `step` once a drawn frame, before the pipeline renders: it moves the blend,
 * fits the source to the camera and returns the lens to draw with, or null
 * while the blend is all the way out (the camera's own view).
 */
export function useSeatViewLens(seat: SeatViewState): {
    step(camera: Camera): PostLens | null;
} {
    const gl = useThree((s) => s.gl);
    const quality = useView3dSceneStore((s) => s.quality);
    const pixelRatio = useThree((s) => s.viewport.dpr);
    const source = useMemo(
        () => createSeatViewSource(gl, { ...SEAT_VIEW_DEFAULTS }),
        [gl],
    );
    useEffect(() => {
        source.settings.sharpness = seatViewSharpness(quality, pixelRatio);
        requestDraw(500);
    }, [source, quality, pixelRatio]);
    useEffect(
        () => () => {
            seatLens.frame = null;
            source.dispose();
        },
        [source],
    );

    const seatRef = useRef(seat);
    seatRef.current = seat;
    const state = useRef({ blend: 0, lastMs: null as number | null });
    const size = useMemo(() => new Vector2(), []);

    return useMemo(
        () => ({
            step(camera: Camera): PostLens | null {
                const st = state.current;
                const now = performance.now();
                const dt =
                    st.lastMs === null
                        ? 0
                        : Math.min(MAX_STEP_MS, now - st.lastMs);
                st.lastMs = now;
                const { on, onOut } = seatRef.current;
                const goal = on ? 1 : 0;
                const delta = prefersReducedMotion()
                    ? 1
                    : dt / SEAT_VIEW_BLEND_MS;
                st.blend =
                    goal > st.blend
                        ? Math.min(goal, st.blend + delta)
                        : Math.max(goal, st.blend - delta);
                if (st.blend !== goal) requestDraw(100);

                if (!(camera instanceof PerspectiveCamera) || st.blend === 0) {
                    seatLens.frame = null;
                    if (!on) onOut();
                    return null;
                }
                const e = ease(st.blend);
                const s = source.settings;
                const photo = rectilinearHfovDeg(camera.fov, camera.aspect);
                s.hfovDeg = photo + (seatLens.hfovDeg - photo) * e;
                // The venue's lens; the width is the head's (the rig's zoom).
                const look = seatViewLook(
                    useView3dSceneStore.getState().kit?.seatView,
                );
                const lens = mixLens(look, e);
                s.d = lens.d;
                s.s = lens.s;
                s.lift = SEAT_VIEW_DEFAULTS.lift * e;
                gl.getDrawingBufferSize(size);
                const out = source.update(
                    camera,
                    Math.max(1, size.x),
                    Math.max(1, size.y),
                );
                seatLens.frame = source.frame;
                return out;
            },
        }),
        [gl, source, size],
    );
}
