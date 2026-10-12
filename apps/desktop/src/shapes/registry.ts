import { arcKind } from "./kinds/arc";
import { blockKind } from "./kinds/block";
import { circleKind } from "./kinds/circle";
import { curveKind } from "./kinds/curve";
import { fillKind } from "./kinds/fill";
import { lineKind } from "./kinds/line";
import type { AnyShapeKind } from "./types";

/**
 * Every shape kind, in the order the kind picker shows them. Adding a kind is one module and one
 * line here; the panel, canvas and command palette are generated from this list.
 */
export const SHAPE_KINDS: readonly AnyShapeKind[] = [
    lineKind,
    arcKind,
    circleKind,
    curveKind,
    blockKind,
    fillKind,
];

/** The kinds the shape pickers offer */
export const LISTED_SHAPE_KINDS = SHAPE_KINDS.filter((kind) => !kind.unlisted);

/**
 * The listed kind a session shows as in the pickers: a filled shape as its circle or box
 */
export function pickerKindOf(kindId: string, params: unknown): string {
    if (kindId !== "fill") return kindId;
    return (params as { outline?: string }).outline === "circle"
        ? "circle"
        : "block";
}

export function shapeKind(id: string): AnyShapeKind | undefined {
    return SHAPE_KINDS.find((kind) => kind.id === id);
}
