import type {
    FieldCursor,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import { ReadableCoords } from "@/global/classes/ReadableCoords";
import type { XY } from "../types";
import { boxCorners, type BoxParams } from "../box/boxGeometry";
import {
    frameControls,
    type ShapeGesture,
    type ShapeTarget,
} from "../frame/gestures";
import { rotationDegrees } from "../frame/frame";
import { lengthReadout } from "../frame/scale";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { ShapeField } from "./shapeField";

/** The keys a shape gesture reads from a pointer event */
export const keysOf = (pointer: FieldPointer) => ({
    shift: pointer.shift,
    alt: pointer.alt,
});

/** A handle's cursor from a shape kind, as the field shows it */
export const asCursor = (cursor: string): FieldCursor => cursor as FieldCursor;

/** The outline through a box's edge marchers, turned with it */
export function boxOutline(params: BoxParams, spots: number): XY[] {
    return boxCorners(params, spots);
}

/** The cursor over what a press would grab on a shape */
export function shapeCursor(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    target: ShapeTarget,
): FieldCursor {
    switch (target.type) {
        case "move":
        case "center":
            return "move";
        case "rotate":
            return "grab";
        case "handle": {
            const handle = kind
                .handles(params, n)
                .find((h) => h.key === target.key);
            return handle ? asCursor(handle.cursor) : "default";
        }
    }
}

/** Spot labels show up to this many marchers; above it they pile up (08) */
export const SPOT_LABEL_LIMIT = 24;

/** The marchers' drill numbers by id, for spot labels */
export function drillNumbers(field: ShapeField): Map<number, string> {
    return new Map(field.marchers().map((m) => [m.id, m.drill_number]));
}

/** Where `p` is in drill terms, tersely: "S1: 3.5 in 45 · 8 FH" */
export function drillTerms(p: XY): string | null {
    try {
        const coords = new ReadableCoords({
            x: p.x,
            y: p.y,
            roundingDenominator: 4,
        });
        return `${coords.toTerseStringX()} · ${coords.toTerseStringY()}`;
    } catch {
        // No field properties yet
        return null;
    }
}

/**
 * What every open or selected shape draws for its frame (08, "Handles and gestures"): the knob
 * and the center dot, and during a gesture its guide: the pivot and the angle while turning,
 * where the center is in drill terms while moving, its length and spacing while stretching.
 */
export function frameDrawing(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    gesture: ShapeGesture | null,
    pointer: XY | null,
    env: ToolEnv,
): Pick<FieldModeDrawing, "knob" | "centerDot" | "pivot" | "tip"> {
    const controls = frameControls(kind, params, n, env);
    const out: Pick<FieldModeDrawing, "knob" | "centerDot" | "pivot" | "tip"> =
        {
            knob: { at: controls.knob, stem: controls.stem },
            centerDot: controls.center,
        };
    if (!gesture || !pointer) return out;
    if (gesture.type === "rotate") {
        const degrees = rotationDegrees(kind.frameOf(params, n).rotation);
        return {
            ...out,
            pivot: { at: gesture.pivot, to: pointer },
            tip: { at: pointer, text: `${degrees}°` },
        };
    }
    if (gesture.type === "handle") {
        // How long the shape is and how far apart, so a long one shows where the next snap lands
        const text = lengthReadout(kind, params, n, env);
        return text ? { ...out, tip: { at: pointer, text } } : out;
    }
    if (gesture.type === "center" || gesture.type === "move") {
        const text = drillTerms(controls.center);
        return text ? { ...out, tip: { at: pointer, text } } : out;
    }
    return out;
}

/**
 * A drawing worked out once per state: the overlay reads it as a snapshot, so the same state
 * must give the same object.
 */
export function memoDrawing<S>(
    draw: (state: S) => FieldModeDrawing | null,
): (state: S | null) => FieldModeDrawing | null {
    let last: { state: S; drawing: FieldModeDrawing | null } | null = null;
    return (state) => {
        if (state === null) return null;
        if (last?.state !== state) last = { state, drawing: draw(state) };
        return last.drawing;
    };
}
