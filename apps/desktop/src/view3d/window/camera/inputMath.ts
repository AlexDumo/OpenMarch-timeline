/**
 * Pure input math for the 3D View camera: telling a trackpad from a mouse,
 * where the pointer meets the ground, zooming toward a point, and
 * frame-rate-independent damping. No React and no scene access.
 */
import type { Vector3Tuple } from "three";

/** The wheel fields the classifier reads (a `WheelEvent` satisfies it). */
export interface WheelLike {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    /** Chromium's legacy field: −3 × deltaY for trackpads, ±120 per notch for a mouse. */
    wheelDeltaY?: number;
}

export type WheelKind = "pinch" | "trackpad" | "mouse";

/**
 * What produced a wheel event. macOS reports a trackpad pinch as a wheel
 * with `ctrlKey`; a trackpad's two-finger scroll is pixel-mode with
 * fine-grained or horizontal deltas; a mouse wheel moves in notches.
 */
export function classifyWheel(e: WheelLike): WheelKind {
    if (e.ctrlKey) return "pinch";
    if (e.deltaMode !== 0) return "mouse";
    if (e.deltaX !== 0) return "trackpad";
    if (!Number.isInteger(e.deltaY)) return "trackpad";
    if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0)
        return e.wheelDeltaY === -3 * e.deltaY ? "trackpad" : "mouse";
    return Math.abs(e.deltaY) < 50 ? "trackpad" : "mouse";
}

/** A wheel delta in pixels, whatever its mode. */
export function wheelPixels(delta: number, deltaMode: number): number {
    return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * 400 : delta;
}

/** Farther than this (meters) a ground hit is treated as a miss. */
export const MAX_GROUND_HIT = 2000;

/** Where a ray from `origin` along `dir` meets the ground plane y = `groundY`, or null. */
export function groundHit(
    origin: Vector3Tuple,
    dir: Vector3Tuple,
    groundY = 0,
): Vector3Tuple | null {
    if (!(dir[1] < -1e-6)) return null;
    const t = (groundY - origin[1]) / dir[1];
    if (!(t > 0)) return null;
    const hit: Vector3Tuple = [
        origin[0] + dir[0] * t,
        groundY,
        origin[2] + dir[2] * t,
    ];
    if (Math.hypot(hit[0] - origin[0], hit[2] - origin[2]) > MAX_GROUND_HIT)
        return null;
    return hit;
}

/**
 * The orbit target after zooming from `oldRadius` to `newRadius` toward
 * `point`: scaling the camera and target about the point keeps the point
 * under the cursor. The target keeps its height.
 */
export function zoomTargetTowards(
    target: Vector3Tuple,
    point: Vector3Tuple,
    oldRadius: number,
    newRadius: number,
): Vector3Tuple {
    const k = 1 - newRadius / oldRadius;
    return [
        target[0] + (point[0] - target[0]) * k,
        target[1],
        target[2] + (point[2] - target[2]) * k,
    ];
}

/** `value` after `dtMs` of exponential decay with the given half-life. */
export function damp(value: number, dtMs: number, halfLifeMs: number): number {
    return value * Math.pow(0.5, dtMs / halfLifeMs);
}
