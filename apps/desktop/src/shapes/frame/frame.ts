// cspell:words nesw nwse
import type { XY } from "../types";

/**
 * The frame every shape kind sits in (docs/timeline/research/shapes/08-shape-system-ux.md, "What a
 * shape is"): a center, a size, a rotation and a flip. Moving, rotating and flipping are written
 * once against the frame, so they work the same on every kind; a kind only says how its own
 * parameters map to a frame and how its spots sit inside it. Everything here is pure.
 *
 * Local coordinates are the frame's own: x across (left to right before any rotation), y deep
 * (back to front), both from the center. Rotation turns local +x from field +x toward field +y,
 * in radians. A flip mirrors the shape inside its frame, so the marcher on the left ends up on
 * the right.
 */
export interface ShapeFrame {
    readonly center: XY;
    /** Half the distance between the outermost spots across, in field units */
    readonly halfWidth: number;
    /** Half the distance between the outermost spots deep, in field units */
    readonly halfDepth: number;
    readonly rotation: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
}

/**
 * The nine points a shape can turn and flip around: its corners, edge middles and center, by
 * compass point (north is the frame's back)
 */
export type PivotKey = "nw" | "n" | "ne" | "w" | "c" | "e" | "sw" | "s" | "se";

/**
 * What a shape turns, flips and resizes around until the user picks another point: its back-left
 * corner, so a box stays where it was drawn when it grows (owner, 2026-10-17). Basic mode, which
 * has no pivot grid, always uses it.
 */
export const DEFAULT_PIVOT: PivotKey = "nw";

export const PIVOT_KEYS: readonly PivotKey[] = [
    "nw",
    "n",
    "ne",
    "w",
    "c",
    "e",
    "sw",
    "s",
    "se",
];

const axes = (rotation: number) => {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return { ux: { x: c, y: s }, uy: { x: -s, y: c } };
};

/** A point in the frame's local coordinates, in field units */
export function frameToField(frame: ShapeFrame, local: XY): XY {
    const { ux, uy } = axes(frame.rotation);
    return {
        x: frame.center.x + ux.x * local.x + uy.x * local.y,
        y: frame.center.y + ux.y * local.x + uy.y * local.y,
    };
}

/** A field point in the frame's local coordinates */
export function fieldToFrame(frame: ShapeFrame, p: XY): XY {
    const { ux, uy } = axes(frame.rotation);
    const d = { x: p.x - frame.center.x, y: p.y - frame.center.y };
    return { x: d.x * ux.x + d.y * ux.y, y: d.x * uy.x + d.y * uy.y };
}

/** Where `key` is in the frame's local coordinates */
export function pivotLocal(frame: ShapeFrame, key: PivotKey): XY {
    const x = key.includes("w")
        ? -frame.halfWidth
        : key.includes("e")
          ? frame.halfWidth
          : 0;
    const y = key.includes("n")
        ? -frame.halfDepth
        : key.includes("s")
          ? frame.halfDepth
          : 0;
    return { x, y };
}

export const pivotPoint = (frame: ShapeFrame, key: PivotKey): XY =>
    frameToField(frame, pivotLocal(frame, key));

/** The frame turned to `rotation`, `pivot` (a field point) staying put */
export function rotateFrame(
    frame: ShapeFrame,
    rotation: number,
    pivot: XY,
): ShapeFrame {
    const turn = rotation - frame.rotation;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const d = { x: frame.center.x - pivot.x, y: frame.center.y - pivot.y };
    return {
        ...frame,
        rotation,
        center: {
            x: pivot.x + d.x * c - d.y * s,
            y: pivot.y + d.x * s + d.y * c,
        },
    };
}

/**
 * The frame mirrored side to side (`across`: side 1 and side 2 swap) or front to back (`deep`)
 * on the field, about a line through the pivot `key`. Mirroring a turned frame turns it the other
 * way and mirrors it inside, so its spots land on their mirror images.
 */
export function flipFrame(
    frame: ShapeFrame,
    axis: "across" | "deep",
    key: PivotKey,
): ShapeFrame {
    const pivot = pivotPoint(frame, key);
    const center =
        axis === "across"
            ? { x: 2 * pivot.x - frame.center.x, y: frame.center.y }
            : { x: frame.center.x, y: 2 * pivot.y - frame.center.y };
    // A mirror on the field is the opposite turn and a mirror in the frame's own axes
    const rotation = normalizeAngle(-frame.rotation);
    return axis === "across"
        ? { ...frame, center, rotation, flipX: !frame.flipX }
        : { ...frame, center, rotation, flipY: !frame.flipY };
}

/** The frame's outline: its four corners, back-left first, clockwise on screen */
export function frameCorners(frame: ShapeFrame): XY[] {
    const { halfWidth: w, halfDepth: d } = frame;
    return [
        frameToField(frame, { x: -w, y: -d }),
        frameToField(frame, { x: w, y: -d }),
        frameToField(frame, { x: w, y: d }),
        frameToField(frame, { x: -w, y: d }),
    ];
}

const TAU = 2 * Math.PI;

/** An angle in [0, 2π) */
export const normalizeAngle = (rad: number): number =>
    ((rad % TAU) + TAU) % TAU;

/** Whether the frame is square to the field: turned a whole number of quarter turns */
export function squareToField(rotation: number): boolean {
    const quarters = rotation / (Math.PI / 2);
    return Math.abs(quarters - Math.round(quarters)) < 1e-6;
}

export const DEGREE = Math.PI / 180;

/**
 * A rotation as dragged or typed: whole degrees, 15° with Shift, as is with Alt (no snapping, as
 * in the rest of the timeline). Kept in [0, 2π).
 */
export function snapRotation(
    rad: number,
    keys: { readonly shift: boolean; readonly snap: boolean },
): number {
    if (!keys.snap) return normalizeAngle(rad);
    const step = (keys.shift ? 15 : 1) * DEGREE;
    const snapped = normalizeAngle(Math.round(rad / step) * step);
    // A full turn reads as 0
    return Math.abs(snapped - TAU) < 1e-9 ? 0 : snapped;
}

/** A rotation in degrees for people: 0 to 359, whole unless Alt left it between */
export function rotationDegrees(rad: number): number {
    const deg = (normalizeAngle(rad) / DEGREE) % 360;
    const rounded = Math.round(deg * 10) / 10;
    return rounded === 360 ? 0 : rounded;
}

/**
 * The resize cursor for a handle facing `local` (a direction in the frame's axes), as the frame is
 * turned on screen
 */
export function resizeCursor(
    frame: Pick<ShapeFrame, "rotation">,
    local: XY,
): "ew-resize" | "nwse-resize" | "ns-resize" | "nesw-resize" {
    const { ux, uy } = axes(frame.rotation);
    const dx = ux.x * local.x + uy.x * local.y;
    const dy = ux.y * local.x + uy.y * local.y;
    // Screen y grows down, so 45° here is down and to the right: nwse
    const eighth =
        Math.round(normalizeAngle(Math.atan2(dy, dx)) / (TAU / 8)) % 4;
    return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[
        eighth
    ]!;
}
