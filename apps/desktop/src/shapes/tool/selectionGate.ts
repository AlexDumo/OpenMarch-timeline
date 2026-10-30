import tolgee from "@/global/singletons/Tolgee";
/**
 * Why a shape can't be drawn with nobody selected; the Shapes tab greys its kinds out with it. A
 * function, so it's in the app's language when it's asked for.
 */
export const selectMarchersFirst = (): string =>
    tolgee.t("shapes.tool.selectMarchersFirst", "Select marchers first");

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
        return { ok: false, reason: selectMarchersFirst() };
    return { ok: true, ids: selected.map((m) => m.id) };
}
