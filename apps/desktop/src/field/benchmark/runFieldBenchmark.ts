import { addAfterEffect, addEffect } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import {
    summarizeFrames,
    type BenchmarkKind,
    type BenchmarkResult,
} from "./frameStats";

/** One thing the benchmark does to the field, for a few seconds. */
export type BenchmarkScenario = {
    kind: BenchmarkKind;
    /** Throws {@link ScenarioSkipped} when it can't run; the result says why. */
    start(): void | Promise<void>;
    /**
     * Moves the scenario on, once per animation frame, `elapsed` ms after it
     * started. Returning false ends it early (playback reached the end).
     */
    step(elapsed: number): boolean | void;
    /** Puts back what the scenario changed. */
    stop(): void | Promise<void>;
};

/**
 * How the benchmark sees the field draw: calls `onStart` as a frame of the
 * field starts and `onEnd` once it has drawn, until the returned function is
 * called. One per field: {@link r3fFrames} for the new field, and
 * `fabricFrames` for Fabric.
 */
export type FrameProbe = {
    listen(onStart: () => void, onEnd: () => void): () => void;
    /** Draw calls in the last frame, if the field counts them. */
    drawCalls(): number;
};

/** The new field's frames: R3F's effects around a render that drew something. */
export function r3fFrames(renderer: () => WebGLRenderer | null): FrameProbe {
    return {
        listen(onStart, onEnd) {
            let framesBefore = 0;
            const offBefore = addEffect(() => {
                onStart();
                framesBefore = renderer()?.info.render.frame ?? 0;
            });
            const offAfter = addAfterEffect(() => {
                const gl = renderer();
                // R3F runs its effects on a frame that drew nothing, as its loop stops
                if (!gl || gl.info.render.frame === framesBefore) return;
                onEnd();
            });
            return () => {
                offBefore();
                offAfter();
            };
        },
        drawCalls: () => renderer()?.info.render.calls ?? 0,
    };
}

/** Thrown by a scenario's `start` when it can't run on this show; the result says why. */
export class ScenarioSkipped extends Error {}

/** How long each scenario runs, as the prototype's "Run benchmarks". */
export const SCENARIO_MS = 4000;

export const nextFrame = () =>
    new Promise<number>((resolve) => requestAnimationFrame(resolve));

/**
 * Runs one scenario and measures every frame the field draws meanwhile: when
 * it finished, and the main-thread time from the start of the field's frame
 * to the end of its render (on the new field: frame hooks, buffer uploads and
 * draw submission; on Fabric: its whole render).
 */
export async function measureScenario(
    scenario: BenchmarkScenario,
    probe: FrameProbe,
    ms = SCENARIO_MS,
): Promise<BenchmarkResult> {
    try {
        await scenario.start();
    } catch (error) {
        if (error instanceof ScenarioSkipped)
            return { kind: scenario.kind, skipped: error.message };
        throw error;
    }
    await nextFrame();

    const frameEnds: number[] = [];
    const cpu: number[] = [];
    let frameStart = 0;
    let drawCalls = 0;
    const off = probe.listen(
        () => {
            frameStart = performance.now();
        },
        () => {
            const end = performance.now();
            frameEnds.push(end);
            cpu.push(end - frameStart);
        },
    );

    const started = performance.now();
    try {
        await new Promise<void>((resolve, reject) => {
            const tick = () => {
                try {
                    const elapsed = performance.now() - started;
                    if (elapsed >= ms || scenario.step(elapsed) === false)
                        return resolve();
                    requestAnimationFrame(tick);
                } catch (error) {
                    reject(error);
                }
            };
            requestAnimationFrame(tick);
        });
    } finally {
        off();
        drawCalls = probe.drawCalls();
        await scenario.stop();
    }
    return {
        kind: scenario.kind,
        stats: summarizeFrames({
            frameEnds,
            cpu,
            seconds: (performance.now() - started) / 1000,
            drawCalls,
        }),
    };
}
