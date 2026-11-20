// cspell:ignore Panini hfov
/**
 * Seat view (docs/3d/ui.md UI-3): at a seat or floor camera, the canvas
 * shows what a person sitting there sees rather than what a phone photo
 * from there shows. A wide field of view through a Panini lens, the
 * shadows lifted a little as an adapted eye sees them, and the head turns
 * with a drag (`camera/CameraRig.tsx`). The draw itself is framework-free
 * (`core/post/seatViewPass.ts`); this mounts it on the canvas.
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
 * camera's own projection, which the pass draws exactly at 0. While mounted
 * it draws every frame itself (a `useFrame` with a priority takes rendering
 * over from the canvas), and only when the canvas would have: the
 * draw-when-needed policy (`DrawWhenNeeded.tsx`) is unchanged. Once out, it
 * unmounts and the canvas draws the scene directly again, at no extra cost.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, type WebGLRenderTarget } from "three";
import {
    createSeatViewPass,
    SEAT_VIEW_DEFAULTS,
    supportsSeatView,
    type SeatViewPass,
} from "@/view3d/core/post/seatViewPass";
import { mixLens, rectilinearHfovDeg } from "@/view3d/core/post/panini";
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

/** The pass's sharpness for a quality and the canvas's pixel ratio. */
export function seatViewSharpness(
    quality: View3dQuality,
    pixelRatio: number,
): number {
    return Math.min(
        SEAT_VIEW_SHARPNESS[quality],
        SEAT_VIEW_MAX_SOURCE_PER_CSS_PX / Math.max(1, pixelRatio),
    );
}

let active: SeatViewPass | null = null;

/**
 * The target the scene is drawn into while seat view is on, or null.
 * Shaders compiled ahead of time (`warmLighting.ts`) must be compiled with
 * it bound: a material compiles differently for a target than for the canvas.
 */
export function seatViewSceneTarget(): WebGLRenderTarget | null {
    return active?.sceneTarget ?? null;
}

/** The mounted pass, for checks and tuning. */
export function activeSeatViewPass(): SeatViewPass | null {
    return active;
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

export default function SeatView() {
    const gl = useThree((s) => s.gl);
    const supported = useMemo(() => supportsSeatView(gl), [gl]);
    const choice = useView3dSceneStore((s) => s.seatView);
    const quality = useView3dSceneStore((s) => s.quality);
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
    if (!mounted) return null;
    return (
        <SeatViewDraw
            on={on}
            quality={quality}
            onOut={() => setMounted(false)}
        />
    );
}

function SeatViewDraw({
    on,
    quality,
    onOut,
}: {
    on: boolean;
    quality: View3dQuality;
    /** Called once the blend is all the way out. */
    onOut: () => void;
}) {
    const gl = useThree((s) => s.gl);
    const pass = useMemo(
        () => createSeatViewPass(gl, { ...SEAT_VIEW_DEFAULTS }),
        [gl],
    );
    const onRef = useRef(on);
    onRef.current = on;
    const onOutRef = useRef(onOut);
    onOutRef.current = onOut;
    const blend = useRef(0);
    const lastMs = useRef<number | null>(null);

    const pixelRatio = useThree((s) => s.viewport.dpr);
    useEffect(() => {
        pass.settings.sharpness = seatViewSharpness(quality, pixelRatio);
        requestDraw(500);
    }, [pass, quality, pixelRatio]);
    useEffect(() => {
        active = pass;
        return () => {
            if (active === pass) active = null;
            seatLens.frame = null;
            pass.dispose();
            gl.setRenderTarget(null);
            requestDraw(500);
        };
    }, [gl, pass]);

    useFrame(({ scene, camera }) => {
        const now = performance.now();
        const step =
            lastMs.current === null
                ? 0
                : Math.min(MAX_STEP_MS, now - lastMs.current);
        lastMs.current = now;
        const goal = onRef.current ? 1 : 0;
        const delta = prefersReducedMotion() ? 1 : step / SEAT_VIEW_BLEND_MS;
        blend.current =
            goal > blend.current
                ? Math.min(goal, blend.current + delta)
                : Math.max(goal, blend.current - delta);
        if (blend.current !== goal) requestDraw(100);

        if (!(camera instanceof PerspectiveCamera) || blend.current === 0) {
            seatLens.frame = null;
            gl.setRenderTarget(null);
            gl.render(scene, camera);
            if (!onRef.current) onOutRef.current();
            return;
        }
        const e = ease(blend.current);
        const s = pass.settings;
        const photo = rectilinearHfovDeg(camera.fov, camera.aspect);
        s.hfovDeg = photo + (seatLens.hfovDeg - photo) * e;
        const lens = mixLens(SEAT_VIEW_DEFAULTS, e);
        s.d = lens.d;
        s.s = lens.s;
        s.lift = SEAT_VIEW_DEFAULTS.lift * e;
        pass.render(scene, camera);
        seatLens.frame = pass.frame;
    }, 1);
    return null;
}
