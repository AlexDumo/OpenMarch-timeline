import type { FieldProperties } from "@openmarch/core";
import type { ScenePoint } from "./coordinates";

/**
 * Field-aware snapping (UX spec 7.1). "shapes" is Excalidraw's own object snapping, so it does
 * nothing here.
 */
export type SnapMode = "off" | "steps" | "lines" | "shapes";

export const SNAP_MODE_LABELS: Record<SnapMode, string> = {
    off: "Off",
    steps: "Steps",
    lines: "Yard lines & hashes",
    shapes: "Shapes",
};

export interface SnapGuide {
    axis: "x" | "y";
    /** In scene units */
    value: number;
    label: string;
}

export interface SnapResult {
    point: ScenePoint;
    guides: SnapGuide[];
}

interface Target {
    value: number;
    label: string;
}

/** The lines "Yard lines & hashes" snaps to, in scene units */
export function snapTargets(fp: FieldProperties): { x: Target[]; y: Target[] } {
    const pps = fp.pixelsPerStep;
    const { terseLeft, terseRight } = fp.sideDescriptions;
    const x: Target[] = [];
    const y: Target[] = [];
    for (const c of fp.xCheckpoints) {
        if (!c.visible) continue;
        const side =
            c.stepsFromCenterFront === 0
                ? ""
                : `${c.stepsFromCenterFront < 0 ? terseLeft : terseRight} `;
        x.push({
            value: c.stepsFromCenterFront * pps,
            label: `${side}${c.terseName} line`,
        });
    }
    for (const c of fp.yCheckpoints) {
        if (!c.visible) continue;
        y.push({ value: c.stepsFromCenterFront * pps, label: c.name });
    }
    const minX = -fp.centerFrontPoint.xPixels;
    const maxX = fp.width - fp.centerFrontPoint.xPixels;
    if (fp.halfLineXInterval) {
        const step = fp.halfLineXInterval * pps;
        for (let v = 0; v <= maxX + 1e-6; v += step)
            if (!x.some((t) => Math.abs(t.value - v) < 1e-6))
                x.push({ value: v, label: "half line" });
        for (let v = -step; v >= minX - 1e-6; v -= step)
            if (!x.some((t) => Math.abs(t.value - v) < 1e-6))
                x.push({ value: v, label: "half line" });
    }
    if (fp.halfLineYInterval) {
        const step = fp.halfLineYInterval * pps;
        for (let v = 0; v >= -fp.height - 1e-6; v -= step)
            if (!y.some((t) => Math.abs(t.value - v) < 1e-6))
                y.push({ value: v, label: "half line" });
    }
    return { x, y };
}

function nearest(
    targets: Target[],
    v: number,
    threshold: number,
): Target | undefined {
    let best: Target | undefined;
    for (const t of targets) {
        const d = Math.abs(t.value - v);
        if (d <= threshold && (!best || d < Math.abs(best.value - v))) best = t;
    }
    return best;
}

/**
 * Snaps a scene point. Steps always snaps to the nearest step. Yard lines and hashes snap each
 * axis on its own when a line is within `thresholdPx` screen pixels.
 */
export function snapScenePoint(
    fp: FieldProperties,
    mode: SnapMode,
    p: ScenePoint,
    zoom = 1,
    thresholdPx = 10,
    targets = mode === "lines" ? snapTargets(fp) : undefined,
): SnapResult {
    if (mode === "steps") {
        const pps = fp.pixelsPerStep;
        return {
            point: {
                x: Math.round(p.x / pps) * pps,
                y: Math.round(p.y / pps) * pps,
            },
            guides: [],
        };
    }
    if (mode === "lines" && targets) {
        const threshold = thresholdPx / zoom;
        const tx = nearest(targets.x, p.x, threshold);
        const ty = nearest(targets.y, p.y, threshold);
        const guides: SnapGuide[] = [];
        if (tx) guides.push({ axis: "x", value: tx.value, label: tx.label });
        if (ty) guides.push({ axis: "y", value: ty.value, label: ty.label });
        return { point: { x: tx?.value ?? p.x, y: ty?.value ?? p.y }, guides };
    }
    return { point: p, guides: [] };
}

/** Snaps a movement (dragging selected elements) to whole steps, in either snapping mode */
export function snapDelta(
    fp: FieldProperties,
    mode: SnapMode,
    d: ScenePoint,
): ScenePoint {
    if (mode !== "steps" && mode !== "lines") return d;
    const pps = fp.pixelsPerStep;
    return { x: Math.round(d.x / pps) * pps, y: Math.round(d.y / pps) * pps };
}
