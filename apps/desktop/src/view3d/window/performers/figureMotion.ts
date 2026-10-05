/**
 * How the performer figures move: the pure, per-frame part of `Performers.tsx`
 * when performers are drawn as figures.
 *
 * - **Steps follow the counts.** Everyone steps together, one step per count,
 *   left foot landing on count 1 of each page. The phase comes from the
 *   show's beats, so it holds still when paused and follows seeks.
 * - **Moving or holding** is measured from the performer's own path: the
 *   share of a short window around the show time that it spends moving. It
 *   is a stateless function of time, so scrubbing gives the same pose as
 *   playing, and it eases in and out over the window as a move starts and
 *   stops.
 * - **Facing:** the direction of travel while moving, the front (+Z, toward
 *   the audience) while holding, eased with the same weight.
 *
 * Every function writes into caller-owned arrays; the per-frame path
 * allocates nothing.
 */
import type { FieldProperties } from "@openmarch/core";
import { positionAtInto } from "@/view3d/positions";
import type { PerformerSlots } from "./performerData";

/** Half the window used to measure movement, in milliseconds. */
export const MOTION_HALF_WINDOW_MS = 125;
/** Below this many meters per half window, a performer is holding. */
const STILL_METERS = 0.002;
/** Steps per loop of the marching clip. */
export const STEPS_PER_CYCLE = 2;
/** Step length, in seconds, outside the show's beats. */
const FALLBACK_BEAT_SECONDS = 0.5;

/** The show's beats, flattened for {@link stepPhaseAt}. */
export interface StepClock {
    /** Beat start times, in ms, ascending. */
    starts: Float64Array;
    /** Beat lengths, in ms. */
    durations: Float64Array;
    /** Counts from the start of the beat's page to the beat's start. */
    counts: Float64Array;
}

/** Anything with page-ordered beats, like the timing objects' pages. */
export interface StepClockPage {
    beats: readonly { timestamp: number; duration: number }[];
}

/** Flattens the pages' beats (timestamps in seconds) into a clock. */
export function buildStepClock(pages: readonly StepClockPage[]): StepClock {
    const starts: number[] = [];
    const durations: number[] = [];
    const counts: number[] = [];
    for (const page of pages) {
        page.beats.forEach((beat, index) => {
            starts.push(beat.timestamp * 1000);
            durations.push(beat.duration * 1000);
            counts.push(index);
        });
    }
    return {
        starts: Float64Array.from(starts),
        durations: Float64Array.from(durations),
        counts: Float64Array.from(counts),
    };
}

/**
 * Where everyone is in the marching loop at `ms`, in [0, 1). The loop has
 * {@link STEPS_PER_CYCLE} steps: the left foot lands at 0.5 (count 1, 3, …)
 * and the right at 0 (count 2, 4, …).
 */
export function stepPhaseAt(clock: StepClock, ms: number): number {
    const { starts, durations, counts } = clock;
    let count: number;
    const n = starts.length;
    if (n === 0 || !(ms >= starts[0])) {
        count = ms / (FALLBACK_BEAT_SECONDS * 1000);
    } else {
        // Last beat starting at or before ms.
        let low = 0;
        let high = n - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= ms) low = mid;
            else high = mid - 1;
        }
        const duration = durations[low];
        const into = ms - starts[low];
        count =
            counts[low] +
            (duration > 0
                ? into / duration
                : into / (FALLBACK_BEAT_SECONDS * 1000));
    }
    const phase = (count / STEPS_PER_CYCLE) % 1;
    return phase < 0 ? phase + 1 : phase;
}

/** Bone-table rows the figures use (`BakedFigure.clips`). */
export interface FigureRows {
    /** The held pose. */
    hold: number;
    /** First row of the marching loop. */
    march: number;
    /** Rows in the marching loop. */
    marchSamples: number;
}

// Positions at ms - 2h, ms - h, ms, ms + h and ms + 2h.
const samples = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 0 },
];
const OFFSETS = [-2, -1, 0, 1, 2];

function gap(a: { x: number; z: number }, b: { x: number; z: number }) {
    return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * How much of the window `[ms - h, ms + h]` a performer spends moving, in
 * [0, 1], from its positions at `ms - 2h … ms + 2h`. The move's speed comes
 * from the fastest half window: one half window either side is always fully
 * inside a move that is under way (moves are longer than `h`), so the inner
 * window's distance divided by that speed is the time spent moving.
 */
export function movingShare(
    d0: number,
    d1: number,
    d2: number,
    d3: number,
): number {
    const fastest = Math.max(d0, d1, d2, d3);
    if (fastest < STILL_METERS) return 0;
    return Math.min(1, (d1 + d2) / (2 * fastest));
}

/** Shortest-way interpolation between two angles, in radians. */
export function lerpAngle(from: number, to: number, t: number): number {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    else if (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * t;
}

/**
 * Writes each placed figure's instance matrix (position and facing) and its
 * animation (`anim`, three floats: hold row, march row, march weight). An
 * unplaced figure gets a zero matrix, so nothing is drawn.
 *
 * `xz` and `placed` come from `writePerformerPositions` for the same `ms`.
 */
export function writeFigureMotion(
    slots: PerformerSlots,
    ms: number,
    fieldProperties: FieldProperties,
    xz: Float32Array,
    placed: Uint8Array,
    phase: number,
    rows: FigureRows,
    matrices: Float32Array,
    anim: Float32Array,
): void {
    const marchRow =
        rows.march +
        Math.min(rows.marchSamples - 1, Math.floor(phase * rows.marchSamples));
    const half = MOTION_HALF_WINDOW_MS;
    for (let i = 0; i < slots.ids.length; i++) {
        const o = i * 16;
        const timeline = slots.timelines[i];
        if (!placed[i] || !timeline) {
            matrices.fill(0, o, o + 16);
            anim[i * 3] = rows.hold;
            anim[i * 3 + 1] = rows.hold;
            anim[i * 3 + 2] = 0;
            continue;
        }
        for (let k = 0; k < 5; k++) {
            if (k === 2) {
                samples[2].x = xz[i * 2];
                samples[2].z = xz[i * 2 + 1];
            } else {
                positionAtInto(
                    timeline,
                    Math.max(0, ms + OFFSETS[k] * half),
                    fieldProperties,
                    samples[k],
                );
            }
        }
        const weight = movingShare(
            gap(samples[0], samples[1]),
            gap(samples[1], samples[2]),
            gap(samples[2], samples[3]),
            gap(samples[3], samples[4]),
        );
        let yaw = 0;
        if (weight > 0) {
            // The model faces +Z; yaw turns it toward (sin, 0, cos). The
            // whole window's chord gives the direction of travel.
            const dx = samples[4].x - samples[0].x;
            const dz = samples[4].z - samples[0].z;
            yaw = lerpAngle(0, Math.atan2(dx, dz), weight);
        }
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        // Column-major rotation about +Y, then the translation.
        matrices[o] = c;
        matrices[o + 1] = 0;
        matrices[o + 2] = -s;
        matrices[o + 3] = 0;
        matrices[o + 4] = 0;
        matrices[o + 5] = 1;
        matrices[o + 6] = 0;
        matrices[o + 7] = 0;
        matrices[o + 8] = s;
        matrices[o + 9] = 0;
        matrices[o + 10] = c;
        matrices[o + 11] = 0;
        matrices[o + 12] = xz[i * 2];
        matrices[o + 13] = 0;
        matrices[o + 14] = xz[i * 2 + 1];
        matrices[o + 15] = 1;
        anim[i * 3] = rows.hold;
        anim[i * 3 + 1] = marchRow;
        anim[i * 3 + 2] = weight;
    }
}
