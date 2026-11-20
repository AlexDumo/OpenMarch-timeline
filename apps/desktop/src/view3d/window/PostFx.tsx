/**
 * Mounts the post pass (`core/post/pipeline.ts`) on the canvas: bloom and
 * lens ghosts for a venue whose lighting asks for them, at high quality, and
 * Seat view's lens (`SeatView.tsx`) at any venue. They are one pipeline:
 * both take the canvas's drawing over, so only one thing may draw.
 *
 * While this is mounted it draws every frame itself (a `useFrame` with a
 * priority takes rendering over from the canvas), so the scene is drawn
 * once, into the pipeline. It only draws when the canvas would have: the
 * draw-when-needed policy (`DrawWhenNeeded.tsx`) is unchanged. With no bloom
 * and Seat view out, it isn't mounted and the canvas draws as before.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WebGLRenderTarget } from "three";
import {
    createPostPipeline,
    type BloomSettings,
    type PostPipeline,
} from "@/view3d/core/post";
import { requestDraw } from "./drawWake";
import { useSeatView, useSeatViewLens, type SeatViewState } from "./SeatView";

let active: PostPipeline | null = null;

/**
 * The target the scene is drawn into while the post pass is on (bloom or
 * Seat view), or null. Shaders compiled ahead of time (`warmLighting.ts`)
 * must be compiled with it bound: a material compiles differently for a
 * target than for the canvas.
 */
export function postSceneTarget(): WebGLRenderTarget | null {
    return active?.sceneTarget ?? null;
}

/** The mounted pipeline, for checks and tuning. */
export function activePostPipeline(): PostPipeline | null {
    return active;
}

/** Bloom off: the pipeline draws the scene and Seat view's lens only. */
const NO_BLOOM: Readonly<BloomSettings> = {
    strength: 0,
    radius: 0.5,
    threshold: 1,
    knee: 0.5,
    ghost: 0,
    ghostThreshold: 8,
    ghostTint: 0xffffff,
};

export default function PostFx({ bloom }: { bloom?: BloomSettings }) {
    const seat = useSeatView();
    if (!bloom && !seat.mounted) return null;
    return <PostDraw bloom={bloom} seat={seat} />;
}

function PostDraw({
    bloom,
    seat,
}: {
    bloom: BloomSettings | undefined;
    seat: SeatViewState;
}) {
    const gl = useThree((s) => s.gl);
    const pipeline = useMemo(
        () => createPostPipeline(gl, { ...(bloom ?? NO_BLOOM) }),
        // The settings are applied live below; only a new renderer rebuilds.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [gl],
    );
    useEffect(() => {
        Object.assign(pipeline.settings, bloom ?? NO_BLOOM);
        requestDraw(500);
    }, [pipeline, bloom]);
    useEffect(() => {
        active = pipeline;
        requestDraw(1000);
        return () => {
            if (active === pipeline) active = null;
            pipeline.dispose();
            gl.setRenderTarget(null);
            requestDraw(1000);
        };
    }, [gl, pipeline]);

    const lens = useSeatViewLens(seat);
    const blooming = useRef(!!bloom);
    blooming.current = !!bloom;
    useFrame(({ scene, camera }) => {
        const l = lens.step(camera);
        if (!l && !blooming.current) {
            // Seat view blending out of a venue without bloom: the last
            // frames are the camera's own view, drawn straight.
            gl.setRenderTarget(null);
            gl.render(scene, camera);
            return;
        }
        pipeline.render(scene, camera, l);
    }, 1);
    return null;
}
