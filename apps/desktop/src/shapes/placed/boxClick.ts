/**
 * What a press on a marcher selects when placed boxes are on the field, Figma-style
 * (docs/timeline/research/shapes/07-placed-boxes.md):
 *
 * - A click on a box member selects the whole box. A press on a marcher that's already selected
 *   (the whole box, or one picked by a marquee) is left to the canvas, so it drags the selection.
 * - Inside a box (after a double click), a press is the canvas's: a click selects one marcher,
 *   and Shift adds one (a drag then moves the selection). Shift on a selected marcher takes it
 *   out, and the press ends there.
 * - From outside, Shift-click adds or removes the whole box.
 * - Reaching inside ($mod, `reachInside`) goes inside the box from anywhere, and the press is then
 *   a press inside it: it picks just that marcher, and Shift+$mod toggles it.
 * - A marcher in no box is the canvas's as before, and leaves the box you were inside.
 *
 * A linked figure (#1236) is one level more, as a group is in Figma: a click on any of its shapes
 * selects the whole figure, and a click on it once it's selected goes into it, selecting the shape
 * clicked; a double-click does the same (`doubleClickMember`). Inside the figure a click picks one
 * shape, as a click picks one box anywhere else, and the next goes inside that shape as above.
 *
 * @returns the marchers to select, or null to leave the press to the canvas; and the box you're
 *   inside after it
 */
export function clickOnMarcher({
    marcherId,
    shift,
    reachInside = false,
    selected,
    box,
    inside,
    figure = null,
    inFigure = false,
    click,
}: {
    marcherId: number;
    shift: boolean;
    /** The press reaches inside the box ($mod) */
    reachInside?: boolean;
    selected: ReadonlySet<number>;
    box: { readonly id: number; readonly members: readonly number[] } | null;
    inside: number | null;
    /** The members of the linked figure the box is in (two or more shapes), null in none */
    figure?: readonly number[] | null;
    /** You've gone into that figure: a click picks one of its shapes */
    inFigure?: boolean;
    /** How the press ended: a click, the second click of a double-click, or neither (a drag) */
    click?: "single" | "double";
}): { select: number[] | null; inside: number | null; inFigure: boolean } {
    if (!box) return { select: null, inside: null, inFigure: false };
    const linked = figure !== null && figure.length > 0;
    if (reachInside || inside === box.id) {
        // The canvas's, except that Shift takes a selected marcher out, so the press ends there
        // instead of dragging the selection
        if (!shift || !selected.has(marcherId))
            return { select: null, inside: box.id, inFigure: linked };
        return {
            select: [...selected].filter((id) => id !== marcherId),
            inside: box.id,
            inFigure: linked,
        };
    }
    // What a click picks: the whole figure from outside it, one shape inside it
    const whole = linked && !inFigure;
    const target = whole ? figure : box.members;
    const out = (select: number[] | null) => ({
        select,
        inside: null,
        inFigure: linked && !whole,
    });
    const all = target.every((id) => selected.has(id));
    if (shift) {
        const members = new Set(target);
        return out(
            all
                ? [...selected].filter((id) => !members.has(id))
                : [...selected, ...target.filter((id) => !selected.has(id))],
        );
    }
    // A click on a figure selected whole goes into it, at the shape clicked, as a second click
    // on a group does in Slides (a drag still moves the figure)
    if (whole && all && click === "single")
        return { select: [...box.members], inside: null, inFigure: true };
    if (all || selected.has(marcherId)) return out(null);
    return out([...target]);
}
