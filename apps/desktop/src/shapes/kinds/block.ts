import { SquaresFourIcon } from "@phosphor-icons/react";
import { principalExtremes } from "../geometry/fit";
import {
    add,
    centroid,
    cross,
    dot,
    perp,
    scale,
    sub,
    unit,
    xy,
} from "../geometry/vec";
import type { ShapeContext, ShapeKind, Slot, XY } from "../types";

/**
 * A filled block: ranks (rows) of files (columns), in the block's own frame. Local +x runs along
 * a rank (left to right), local +y from the back rank toward the front. At rotation 0 local axes
 * are the field's, so +y is toward the front sideline.
 */
export interface BlockParams {
    readonly center: XY;
    /** Radians; turns local +x from field +x toward field +y */
    readonly rotation: number;
    /** Marchers across a full rank */
    readonly files: number;
    /** Interval between files, field units */
    readonly across: number;
    /** Interval between ranks, field units */
    readonly deep: number;
    /** `offset` shifts every other rank by half the across interval (a staggered block) */
    readonly pattern: "grid" | "offset";
    /** Where the last, short rank's marchers sit along it */
    readonly shortRank: "start" | "center" | "end";
    /**
     * The across and deep intervals are locked (the default): dragging the side changes how many
     * files there are. Unlocked, dragging the sides stretches the intervals.
     */
    readonly keepIntervals?: boolean;
}

const filesOf = (p: BlockParams) => Math.max(1, Math.round(p.files));
const ranksOf = (p: BlockParams, n: number) =>
    Math.max(1, Math.ceil(n / filesOf(p)));

const axes = (p: BlockParams) => {
    const ux = xy(Math.cos(p.rotation), Math.sin(p.rotation));
    return { ux, uy: perp(ux) };
};

/** Local block coordinates to field units */
const toField = (p: BlockParams, lx: number, ly: number): XY => {
    const { ux, uy } = axes(p);
    return add(p.center, add(scale(ux, lx), scale(uy, ly)));
};

const toLocal = (p: BlockParams, q: XY): { x: number; y: number } => {
    const { ux, uy } = axes(p);
    const d = sub(q, p.center);
    return { x: dot(d, ux), y: dot(d, uy) };
};

interface LocalSlot {
    readonly x: number;
    readonly y: number;
    readonly row: number;
    readonly col: number;
}

/** Slots in the block's frame, row-major from the back rank, left to right */
function localSlots(p: BlockParams, n: number): LocalSlot[] {
    if (n <= 0) return [];
    const files = filesOf(p);
    const ranks = ranksOf(p, n);
    const slots: LocalSlot[] = [];
    for (let row = 0; row < ranks; row++) {
        const inRank = row === ranks - 1 ? n - row * files : files;
        // A short rank's first file: flush left, centered (may sit between files) or flush right
        const lead =
            p.shortRank === "end"
                ? files - inRank
                : p.shortRank === "center"
                  ? (files - inRank) / 2
                  : 0;
        // Staggered: alternate ranks half an interval apart, split either side so the block
        // stays centered
        const shift =
            p.pattern === "offset" && ranks > 1
                ? row % 2 === 1
                    ? 0.25
                    : -0.25
                : 0;
        const y = (row - (ranks - 1) / 2) * p.deep;
        for (let i = 0; i < inRank; i++) {
            const file = lead + i;
            slots.push({
                x: (file - (files - 1) / 2 + shift) * p.across,
                y,
                row,
                col: Math.floor(file),
            });
        }
    }
    return slots;
}

/** Half the block's size along each local axis, for the size handles (never zero-length) */
const halfSize = (p: BlockParams, n: number) => ({
    x: (Math.max(filesOf(p) - 1, 1) * p.across) / 2,
    y: (Math.max(ranksOf(p, n) - 1, 1) * p.deep) / 2,
});

const snapRotation = (angle: number, stepRad: number) => {
    const snapped = Math.round(angle / stepRad) * stepRad;
    return snapped === 0 ? 0 : snapped;
};

const ROTATE_OFFSET = Math.PI / 2;

/**
 * The marchers' usual distance to their nearest neighbor, rounded to the quarter step: the
 * interval a block fitted to them starts with. Two steps for one marcher.
 */
function typicalSpacing(points: readonly XY[], ctx: ShapeContext): number {
    if (points.length < 2) return 2 * ctx.stepPx;
    const nearest = points
        .map((p, i) =>
            Math.min(
                ...points.map((q, j) =>
                    i === j ? Infinity : Math.hypot(p.x - q.x, p.y - q.y),
                ),
            ),
        )
        .sort((a, b) => a - b);
    const median = nearest[Math.floor(nearest.length / 2)]!;
    const quarters = Math.max(1, Math.round((median / ctx.stepPx) * 4));
    return (quarters / 4) * ctx.stepPx;
}

const trim = (v: number) => String(Math.round(v * 100) / 100);

export const blockKind: ShapeKind<BlockParams> = {
    id: "block",
    version: 1,
    label: "Block",
    icon: SquaresFourIcon,
    family: "fill",
    groups: [
        {
            label: "Size",
            fields: [
                {
                    type: "lock",
                    key: "keepIntervals",
                    label: "Intervals",
                    lockedHelp:
                        "Intervals locked: dragging the side adds or removes files. Click to stretch the intervals instead",
                    unlockedHelp:
                        "Dragging the side stretches the intervals. Click to lock them, so it adds or removes files",
                },
                { type: "count", key: "files", label: "Files", min: 1 },
                { type: "length", key: "across", label: "Across" },
                { type: "length", key: "deep", label: "Deep" },
            ],
        },
        {
            label: "Pattern",
            fields: [
                {
                    type: "enum",
                    key: "pattern",
                    label: "Pattern",
                    options: [
                        { value: "grid", label: "Grid" },
                        { value: "offset", label: "Staggered" },
                    ],
                },
                {
                    type: "enum",
                    key: "shortRank",
                    label: "Short rank",
                    options: [
                        { value: "start", label: "Left" },
                        { value: "center", label: "Center" },
                        { value: "end", label: "Right" },
                    ],
                },
            ],
        },
        {
            label: "Rotation",
            advanced: true,
            fields: [{ type: "angle", key: "rotation", label: "Rotation" }],
        },
    ],

    fit({ current }, ctx: ShapeContext) {
        const n = current.length;
        const ends = principalExtremes(current);
        let rotation = 0;
        let files = Math.max(1, Math.round(Math.sqrt(n)));
        if (ends) {
            const axis = unit(sub(ends[1], ends[0]));
            rotation = snapRotation(Math.atan2(axis.y, axis.x), Math.PI / 2);
            // One straight row: keep it one rank deep.
            const straight = current.every(
                (q) =>
                    Math.abs(cross(axis, sub(q, ends[0]))) <= 0.25 * ctx.stepPx,
            );
            if (straight) files = n;
        }
        const spacing = typicalSpacing(current, ctx);
        return {
            center: n === 0 ? xy(0, 0) : centroid(current),
            rotation,
            files,
            // The marchers' own spacing, so the block opens through where they stand
            across: spacing,
            deep: spacing,
            pattern: "grid",
            shortRank: "start",
            keepIntervals: true,
        };
    },

    handles(p, n) {
        const half = halfSize(p, n);
        const backRank = -((ranksOf(p, n) - 1) / 2) * p.deep;
        const reach = Math.max(Math.abs(p.deep), 1);
        return [
            { key: "move", role: "move", at: p.center },
            {
                key: "rotate",
                role: "rotate",
                at: toField(p, 0, backRank - reach),
            },
            { key: "across", role: "bulge", at: toField(p, half.x, 0) },
            // With the intervals kept, the ranks follow the files, so depth has no handle
            ...(p.keepIntervals
                ? []
                : [
                      {
                          key: "deep",
                          role: "bulge" as const,
                          at: toField(p, 0, half.y),
                      },
                  ]),
        ];
    },

    drag(p, key, to, { shift }, n) {
        if (key === "move") return { ...p, center: to };
        if (key === "rotate") {
            // The handle stands behind the block (local -y), a quarter turn from local +x.
            const d = sub(to, p.center);
            if (d.x === 0 && d.y === 0) return p;
            const angle = Math.atan2(d.y, d.x) + ROTATE_OFFSET;
            return {
                ...p,
                rotation: shift ? snapRotation(angle, Math.PI / 12) : angle,
            };
        }
        if (key === "across") {
            const along = Math.abs(toLocal(p, to).x);
            if (p.keepIntervals) {
                // Whole files at the kept interval, one per interval dragged, never more than
                // there are marchers. The opposite side stays where it is.
                const left = -((filesOf(p) - 1) / 2) * p.across;
                const reach = toLocal(p, to).x - left;
                const files = Math.min(
                    Math.max(
                        Math.round(reach / Math.max(p.across, 1e-9)) + 1,
                        1,
                    ),
                    Math.max(n, 1),
                );
                const middle = left + ((files - 1) / 2) * p.across;
                return { ...p, files, center: toField(p, middle, 0) };
            }
            return { ...p, across: (2 * along) / Math.max(filesOf(p) - 1, 1) };
        }
        if (key === "deep") {
            const along = Math.abs(toLocal(p, to).y);
            return {
                ...p,
                deep: (2 * along) / Math.max(ranksOf(p, n) - 1, 1),
            };
        }
        return p;
    },

    outline(p, n) {
        const slots = localSlots(p, n);
        if (slots.length === 0) return [];
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const s of slots) {
            x0 = Math.min(x0, s.x);
            x1 = Math.max(x1, s.x);
            y0 = Math.min(y0, s.y);
            y1 = Math.max(y1, s.y);
        }
        const corners = [
            toField(p, x0, y0),
            toField(p, x1, y0),
            toField(p, x1, y1),
            toField(p, x0, y1),
        ];
        return [[...corners, corners[0]!]];
    },

    generate: (p, n): Slot[] =>
        localSlots(p, n).map((s) => ({
            ...toField(p, s.x, s.y),
            row: s.row,
            col: s.col,
        })),

    orderKey(p, point, _ctx, n) {
        const local = toLocal(p, point);
        const ranks = ranksOf(p, n);
        const rank =
            p.deep === 0 ? 0 : Math.round(local.y / p.deep + (ranks - 1) / 2);
        return [rank, local.x];
    },

    readouts(p, n, ctx) {
        return [
            {
                label: "Ranks × files",
                value: `${ranksOf(p, n)} × ${filesOf(p)}`,
            },
            {
                label: "Interval",
                value: `${trim(p.across / ctx.stepPx)} × ${trim(p.deep / ctx.stepPx)} steps`,
            },
        ];
    },

    validate(p) {
        if (!(p.files >= 1)) {
            return [
                { level: "error", message: "A block needs at least 1 file" },
            ];
        }
        return [];
    },
};
