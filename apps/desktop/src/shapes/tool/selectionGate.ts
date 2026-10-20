/** Why a shape can't be drawn with nobody selected; the Shapes tab greys its kinds out with it */
export const SELECT_MARCHERS_FIRST = "Select marchers first";

export type ShapeGate =
    | { readonly ok: true; readonly ids: readonly number[] }
    | { readonly ok: false; readonly reason: string };

/**
 * Whether a shape can be opened on `selected` (the selected performers: a selected prop takes no
 * spot, C2.2), and on whom. The one home of the "needs marchers selected" rule (#344), so shapes
 * with spots nobody stands on can relax it in one place later (#358).
 */
export function shapeSelectionGate(
    selected: readonly { readonly id: number }[],
): ShapeGate {
    if (selected.length === 0)
        return { ok: false, reason: SELECT_MARCHERS_FIRST };
    return { ok: true, ids: selected.map((m) => m.id) };
}
