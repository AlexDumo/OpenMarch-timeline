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
import { enterBox, selectOnField } from "./boxSelection";
import { setInsideBox, useBoxSelectionStore } from "./boxSelectionStore";
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
 * together, as an undo or redo of a linked edit selects them. A double-click on a linked shape
 * does it, as do the joint's menu, the field's menu and the command palette.
 */

/** The member ids of `boxes`, in order, each once */
const membersOf = (boxes: readonly PlacedBox[]): number[] => [
    ...new Set(boxes.flatMap((b) => b.recipe.members.map((m) => m.marcherId))),
];

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
 * What a double-click on marcher `marcherId` selects (#1236): on a member of a linked shape, its
 * whole figure, unless that's selected already. Null for what a double-click did before: go
 * inside the shape at that marcher (a shape in no link, a marcher in no shape, a figure already
 * selected, so a second double-click goes on in as a double-click on a group does).
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
    const links = liveLinks(boxes, beat);
    if (linksOf(box, links).length === 0) return null;
    const ids = membersOf(linkedFigure(box, links));
    return ids.every((id) => selected.has(id)) ? null : ids;
}

/** Selects `ids` on the field, out of any shape you were inside */
export function selectLinkedShapes(ids: readonly number[]): void {
    if (ids.length === 0) return;
    selectOnField(ids);
    setInsideBox(null);
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
 * `doubleClickMarcher`, and a selected shape's own double-click): a linked shape's figure is
 * selected ({@link doubleClickSelection}), else it goes inside the shape there, as before
 */
export function doubleClickMember(marcherId: number): void {
    if (!useBoxSelectionStore.getState().enabled) return;
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const ids = doubleClickSelection(
        marcherId,
        new Set(activeFieldEditor()?.selected() ?? []),
        placedBoxesAt(beat),
        beat,
    );
    if (ids) selectLinkedShapes(ids);
    else enterBox(marcherId);
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
