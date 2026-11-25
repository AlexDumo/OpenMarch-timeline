import { useMemo } from "react";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import tolgee from "@/global/singletons/Tolgee";
import { getActionLabel } from "@/shortcuts/labels";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    enterBox,
    enteredFigureByClick,
    figureOf,
    membersOf,
    selectOnField,
} from "./boxSelection";
import {
    setInsideBox,
    setInsideFigure,
    useBoxSelectionStore,
} from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import {
    placedBoxesAt,
    usePlacedBoxBeat,
    usePlacedBoxStore,
} from "./placedBoxStore";
import { linkedFigure, linksOf, liveLinks } from "./shapeLinks";

/**
 * **Select linked shapes** (`shapeSelectLinked`, #1236): every placed line, curve and arc linked
 * to a selected one, following the links of each in turn (`linkedFigure`), selected whole
 * together, as an undo or redo of a linked edit selects them. A click on a linked shape does it
 * (`clickOnMarcher`), as do the joint's menu, the field's menu and the command palette.
 */

/**
 * The marchers Select linked shapes selects for the selection `selected`, among the placed shapes
 * `boxes` shown at `beat`: those of every figure that holds a linked shape with a selected
 * marcher (a whole shape, a marcher picked inside one, the joint's marcher). Empty when no
 * selected marcher is on a linked shape.
 */
export function linkedShapesSelection(
    selected: ReadonlySet<number>,
    boxes: readonly PlacedBox[],
    beat: number,
): number[] {
    const links = liveLinks(boxes, beat);
    if (links.length === 0) return [];
    const figure = new Map<number, PlacedBox>();
    for (const box of boxes) {
        if (figure.has(box.recipe.id)) continue;
        if (!box.recipe.members.some((m) => selected.has(m.marcherId)))
            continue;
        if (linksOf(box, links).length === 0) continue;
        for (const b of linkedFigure(box, links)) figure.set(b.recipe.id, b);
    }
    return membersOf(
        [...figure.values()].sort((a, b) => a.recipe.id - b.recipe.id),
    );
}

/**
 * What a double-click on marcher `marcherId` selects (#1236): on a linked figure selected whole,
 * the shape clicked, going into the figure as a double-click on a group does in Figma. Null for
 * what a double-click does anywhere else: go inside the shape at that marcher (a shape in no
 * link, a shape of a figure you've gone into, a marcher in no shape). A double-click from nothing
 * selected lands on the shape: its first click selects the figure.
 */
export function doubleClickSelection(
    marcherId: number,
    selected: ReadonlySet<number>,
    boxes: readonly PlacedBox[],
    beat: number,
): number[] | null {
    const box = boxes.find((b) =>
        b.recipe.members.some((m) => m.marcherId === marcherId),
    );
    if (!box) return null;
    const figure = figureOf(box, boxes, beat);
    if (figure.length === 0) return null;
    const own = box.recipe.members.map((m) => m.marcherId);
    const whole = membersOf(figure).every((id) => selected.has(id));
    return whole &&
        !(selected.size === own.length && own.every((id) => selected.has(id)))
        ? own
        : null;
}

/** Selects `ids` on the field, out of any shape or figure you were inside */
export function selectLinkedShapes(ids: readonly number[]): void {
    if (ids.length === 0) return;
    selectOnField(ids);
    setInsideBox(null);
    setInsideFigure(null);
}

/** Select linked shapes for the figure placed shape `recipeId` is in, as the field shows it now */
export function selectFigureOf(recipeId: number): void {
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const boxes = placedBoxesAt(beat);
    const box = boxes.find((b) => b.recipe.id === recipeId);
    if (!box) return;
    selectLinkedShapes(membersOf(linkedFigure(box, liveLinks(boxes, beat))));
}

/**
 * A double-click on marcher `marcherId` while placed shapes can be selected (the field editor's
 * `doubleClickMarcher`, and a selected shape's own double-click): on a linked figure selected
 * whole, the shape clicked ({@link doubleClickSelection}), going into the figure; else inside the
 * shape there, as before
 */
export function doubleClickMember(marcherId: number): void {
    const { enabled, figure } = useBoxSelectionStore.getState();
    if (!enabled) return;
    // Its first click went from the figure into the shape: that's this double-click's level
    if (enteredFigureByClick(marcherId)) return;
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const boxes = placedBoxesAt(beat);
    const ids = doubleClickSelection(
        marcherId,
        new Set(activeFieldEditor()?.selected() ?? []),
        boxes,
        beat,
    );
    const box = boxes.find((b) =>
        b.recipe.members.some((m) => m.marcherId === marcherId),
    );
    if (ids && box) {
        selectOnField(ids);
        setInsideBox(null);
        setInsideFigure(box.recipe.id);
        return;
    }
    enterBox(marcherId);
    // Inside a shape of a figure is inside the figure too
    if (box && figureOf(box, boxes, beat).length > 0)
        setInsideFigure(box.recipe.id);
    else if (figure !== null) setInsideFigure(null);
}

/** The action's name, as the palette, the field's menu and the joint's menu say it */
export const selectLinkedLabel = (): string =>
    getActionLabel("shapeSelectLinked", (key, params) =>
        tolgee.t(key, params as never),
    );

/**
 * The **Select linked shapes** action for the selection (`selectedIds`): on while a selected
 * marcher is on a linked shape, refused with its reason otherwise; off while placed shapes can't
 * be selected (the Shape tool open, playback, the View tab's Shapes off)
 */
export function useSelectLinkedShapes(
    ready: boolean,
    selectedIds: readonly number[],
): void {
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const ends = usePlacedBoxStore((s) => s.ends);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = usePlacedBoxBeat();
    const ids = useMemo(
        () =>
            ready && enabled
                ? linkedShapesSelection(
                      new Set(selectedIds),
                      placedBoxesAt(beat, recipes),
                      beat,
                  )
                : [],
        // `ends` and `version` change what `placedBoxesAt` reads from its stores
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ready, enabled, selectedIds, recipes, ends, version, beat],
    );
    useActionHandler("shapeSelectLinked", () => selectLinkedShapes(ids), {
        enabled: ids.length > 0,
        ignoreRepeat: true,
        disabledReason:
            ready && enabled
                ? tolgee.t(
                      "shapes.links.selectLinkedNeedsLink",
                      "Select a linked line, curve or arc first",
                  )
                : undefined,
    });
}
