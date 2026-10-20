import { LineSegmentIcon } from "@phosphor-icons/react";
import { fieldToFrame, frameToField, type ShapeFrame } from "../frame/frame";
import { formatSteps } from "../editor/format";
import { parseSteps, scrubDistance, scrubValue } from "../editor/scrub";
import type { ToolKind } from "../tool/toolKind";
import type { ShapeKind, XY } from "../types";

/**
 * A small kind that exists only for tests (#345): a straight row with one gap, turned and flipped
 * through its frame. It goes through the same shape session as the box without any host code
 * knowing it, which shows the host doesn't depend on one kind.
 */
export interface RowParams {
    readonly center: XY;
    /** Field units between neighbors */
    readonly gap: number;
    readonly rotation: number;
    readonly flipX?: boolean;
    readonly flipY?: boolean;
}

function rowFrame(p: RowParams, n: number): ShapeFrame {
    return {
        center: p.center,
        halfWidth: ((n - 1) * p.gap) / 2,
        halfDepth: 0,
        rotation: p.rotation,
        flipX: p.flipX === true,
        flipY: p.flipY === true,
    };
}

function rowSpots(p: RowParams, n: number) {
    const frame = rowFrame(p, n);
    const side = p.flipX ? -1 : 1;
    return Array.from({ length: n }, (_, i) => ({
        ...frameToField(frame, {
            x: side * (i - (n - 1) / 2) * p.gap,
            y: 0,
        }),
        row: 0,
        col: i,
    }));
}

const rowShape: ShapeKind<RowParams> = {
    id: "test-row",
    version: 1,
    label: "Row",
    icon: LineSegmentIcon,
    family: "path",
    unlisted: true,
    groups: [],
    fit: () => ({ center: { x: 0, y: 0 }, gap: 10, rotation: 0 }),
    handles: () => [],
    drag: (p) => p,
    outline: (p, n) => [rowSpots(p, n).map(({ x, y }) => ({ x, y }))],
    generate: rowSpots,
    orderKey: (p, point, _ctx, n) => [fieldToFrame(rowFrame(p, n), point).x],
};

/** Field units between neighbors, never under half a step */
const gapOf = (steps: number, stepPx: number) =>
    Math.max(stepPx / 2, Math.round(steps * 2) * (stepPx / 2));

export const rowTool: ToolKind<RowParams> = {
    shape: rowShape,
    params: [
        {
            key: "gap",
            label: "Gap, in steps",
            unit: "steps",
            primary: true,
            drag: "x",
            interval: true,
            blends: true,
            default: 2,
            range: { min: 0.5 },
            glyph: "↔",
            display: (p, _n, stepPx) => formatSteps(p.gap / stepPx),
            type(p, _n, text, env) {
                const steps = parseSteps(text);
                return steps === null
                    ? null
                    : { ...p, gap: gapOf(steps, env.stepPx) };
            },
            scrub(base, _n, m, env) {
                const was = base.gap / env.stepPx;
                const steps = scrubValue(
                    was,
                    scrubDistance("x", m.dx, m.dy),
                    0,
                    {
                        axis: "x",
                        px: 8,
                        step: 0.5,
                    },
                );
                return steps === was
                    ? base
                    : { ...base, gap: gapOf(steps, env.stepPx) };
            },
        },
    ],
    scaling: "interval",
    draw(from, to, n, env) {
        const length = Math.abs(to.x - from.x);
        if (length < env.stepPx / 2) return undefined;
        return {
            center: env.gridSnap({ x: (from.x + to.x) / 2, y: from.y }),
            gap: gapOf(length / Math.max(1, n - 1) / env.stepPx, env.stepPx),
            rotation: 0,
        };
    },
    handles: (p, n) => {
        const spots = rowSpots(p, n);
        return [
            { key: "start", at: spots[0]!, cursor: "ew-resize" },
            { key: "end", at: spots.at(-1)!, cursor: "ew-resize" },
        ];
    },
    dragHandle(base, n, _key, to, env) {
        const local = fieldToFrame(rowFrame(base, n), to);
        const half = Math.abs(local.x);
        return {
            ...base,
            gap: gapOf(
                (2 * half) / Math.max(1, n - 1) / env.stepPx,
                env.stepPx,
            ),
        };
    },
    contains(p, n, at) {
        const frame = rowFrame(p, n);
        const local = fieldToFrame(frame, at);
        return (
            Math.abs(local.x) <= frame.halfWidth + p.gap / 2 &&
            Math.abs(local.y) <= p.gap / 2
        );
    },
    move: (base, _n, delta, env) => ({
        ...base,
        center: env.gridSnap({
            x: base.center.x + delta.x,
            y: base.center.y + delta.y,
        }),
    }),
    frameOf: rowFrame,
    fromFrame: (frame, n, env) => ({
        center: frame.center,
        gap: gapOf(
            (2 * frame.halfWidth) / Math.max(1, n - 1) / env.stepPx,
            env.stepPx,
        ),
        rotation: frame.rotation,
        flipX: frame.flipX || undefined,
        flipY: frame.flipY || undefined,
    }),
    withFrame: (p, _n, frame) => ({
        ...p,
        center: frame.center,
        rotation: frame.rotation,
        flipX: frame.flipX || undefined,
        flipY: frame.flipY || undefined,
    }),
};
