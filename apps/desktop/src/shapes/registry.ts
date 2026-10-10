import { arcKind } from "./kinds/arc";
import { blockKind } from "./kinds/block";
import { circleKind } from "./kinds/circle";
import { curveKind } from "./kinds/curve";
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
];

export function shapeKind(id: string): AnyShapeKind | undefined {
    return SHAPE_KINDS.find((kind) => kind.id === id);
}
