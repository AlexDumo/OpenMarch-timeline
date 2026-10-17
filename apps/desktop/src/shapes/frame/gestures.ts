import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { XY } from "../types";
import {
    fieldToFrame,
    flipFrame,
    frameCorners,
    frameToField,
    normalizeAngle,
    pivotPoint,
    rotateFrame,
    snapRotation,
    type PivotKey,
} from "./frame";

/**
 * The gestures every open or selected shape has, whatever its kind
 * (08-shape-system-ux.md, "Handles and gestures"): its own handles, the rotate knob, turning
 * from just outside a corner, the center dot, and a drag on its body. The new shape tool and a
 * selected placed shape both use these, so they behave the same. Everything here is pure.
 */

/** What a press on a shape grabs */
export type ShapeTarget =
    | { readonly type: "handle"; readonly key: string }
    /** The knob above the shape, or just outside a corner */
    | { readonly type: "rotate"; readonly from: "knob" | "corner" }
    /** The center dot: the shape's center follows the pointer */
    | { readonly type: "center" }
    /** The shape's body */
    | { readonly type: "move" };

export type ShapeGesture =
    | { readonly type: "handle"; readonly key: string; readonly base: unknown }
    | {
          readonly type: "rotate";
          readonly from: "knob" | "corner";
          readonly base: unknown;
          /** What it turns around, in field units, fixed at the press */
          readonly pivot: XY;
          /** The pointer's angle from the pivot at the press */
          readonly startAngle: number;
      }
    | { readonly type: "center"; readonly base: unknown }
    | { readonly type: "move"; readonly base: unknown; readonly grab: XY };

/** How far the knob stands above the shape's back edge, in handle reaches */
const KNOB_STEM = 2.4;
/** How far outside a corner still turns the shape, in handle reaches */
const CORNER_ROTATE_REACH = 2.6;

/** The knob, its stem's foot on the back edge, and the center dot, in field units */
export function frameControls(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    env: Pick<ToolEnv, "hitRadius">,
): { knob: XY; stem: XY; center: XY } {
    const frame = kind.frameOf(params, n);
    const back = -frame.halfDepth;
    return {
        stem: frameToField(frame, { x: 0, y: back }),
        knob: frameToField(frame, {
            x: 0,
            y: back - KNOB_STEM * env.hitRadius,
        }),
        center: frame.center,
    };
}

const near = (a: XY, b: XY, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

/**
 * What a press at `at` grabs on the shape, nearest the front of what's drawn first: a handle,
 * the knob, the center dot, the ring just outside a corner, then the body. Null when it misses.
 */
export function shapeTargetAt(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    at: XY,
    env: ToolEnv,
): ShapeTarget | null {
    let best: { key: string; d: number } | undefined;
    for (const h of kind.handles(params, n)) {
        const d = Math.hypot(h.at.x - at.x, h.at.y - at.y);
        if (d <= env.hitRadius && (!best || d < best.d))
            best = { key: h.key, d };
    }
    if (best) return { type: "handle", key: best.key };
    const controls = frameControls(kind, params, n, env);
    if (near(controls.knob, at, env.hitRadius))
        return { type: "rotate", from: "knob" };
    if (near(controls.center, at, env.hitRadius)) return { type: "center" };
    const frame = kind.frameOf(params, n);
    const local = fieldToFrame(frame, at);
    // Diagonally past a corner, as in design apps; past an edge is the body (it has a margin)
    const pastCorner =
        Math.abs(local.x) > frame.halfWidth &&
        Math.abs(local.y) > frame.halfDepth;
    if (
        pastCorner &&
        frameCorners(frame).some((c) =>
            near(c, at, CORNER_ROTATE_REACH * env.hitRadius),
        )
    )
        return { type: "rotate", from: "corner" };
    if (kind.contains(params, n, at)) return { type: "move" };
    return null;
}

const angleFrom = (pivot: XY, p: XY) =>
    Math.atan2(p.y - pivot.y, p.x - pivot.x);

/** The gesture a press at `at` starts on the shape, or null when it misses */
export function startShapeGesture(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    at: XY,
    env: ToolEnv,
): ShapeGesture | null {
    const target = shapeTargetAt(kind, params, n, at, env);
    if (!target) return null;
    switch (target.type) {
        case "handle":
            return { type: "handle", key: target.key, base: params };
        case "center":
            return { type: "center", base: params };
        case "move":
            return { type: "move", base: params, grab: at };
        case "rotate": {
            const pivot = pivotPoint(kind.frameOf(params, n), env.pivot ?? "c");
            return {
                type: "rotate",
                from: target.from,
                base: params,
                pivot,
                startAngle: angleFrom(pivot, at),
            };
        }
    }
}

/** The shape as `gesture` has it with the pointer at `at` */
export function dragShape(
    kind: AnyToolKind,
    n: number,
    gesture: ShapeGesture,
    at: XY,
    env: ToolEnv,
): unknown {
    const base = gesture.base;
    switch (gesture.type) {
        case "handle":
            return kind.dragHandle(base, n, gesture.key, at, env);
        case "move":
            return kind.move(
                base,
                n,
                { x: at.x - gesture.grab.x, y: at.y - gesture.grab.y },
                env,
            );
        case "center": {
            const { center } = kind.frameOf(base, n);
            return kind.move(
                base,
                n,
                { x: at.x - center.x, y: at.y - center.y },
                env,
            );
        }
        case "rotate": {
            const frame = kind.frameOf(base, n);
            if (near(at, gesture.pivot, 1e-9)) return base;
            const turn = angleFrom(gesture.pivot, at) - gesture.startAngle;
            const rotation = snapRotation(frame.rotation + turn, env);
            const turned = kind.withFrame(
                base,
                n,
                rotateFrame(frame, rotation, gesture.pivot),
            );
            return kind.settle ? kind.settle(turned, n, env) : turned;
        }
    }
}

/** The shape turned to `rotation` (radians) about `pivot` */
export function turnShape(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    rotation: number,
    pivot: PivotKey,
    env: ToolEnv,
): unknown {
    const frame = kind.frameOf(params, n);
    const turned = kind.withFrame(
        params,
        n,
        rotateFrame(frame, normalizeAngle(rotation), pivotPoint(frame, pivot)),
    );
    return kind.settle ? kind.settle(turned, n, env) : turned;
}

/** The shape mirrored along its own axis about `pivot` */
export function flipShape(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    axis: "across" | "deep",
    pivot: PivotKey,
    env: ToolEnv,
): unknown {
    const flipped = kind.withFrame(
        params,
        n,
        flipFrame(kind.frameOf(params, n), axis, pivot),
    );
    return kind.settle ? kind.settle(flipped, n, env) : flipped;
}
