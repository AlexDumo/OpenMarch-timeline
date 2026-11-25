import { useEffect } from "react";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { clickOnMarcher } from "./boxClick";
import {
    savingBoxAt,
    setInsideBox,
    setInsideFigure,
    useBoxSelectionStore,
    useSavingBoxStore,
} from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import { wholeShapesOf } from "./movedShapes";
import {
    placedBoxesAt,
    usePlacedBoxStore,
    usePlacedBoxBeat,
} from "./placedBoxStore";
import { linkedFigure, linksOf, liveLinks } from "./shapeLinks";

/** Selects `ids` on the field, through its editor, which writes the app's selection */
export function selectOnField(ids: readonly number[]): void {
    activeFieldEditor()?.select(ids);
}

const boxesNow = (): PlacedBox[] =>
    placedBoxesAt(displayedBeat(useTimelineSelectionStore.getState()));

/**
 * The linked figure (#1236) placed shape `box` is in, among `boxes` shown at `beat`: its shapes,
 * by recipe id. Empty for a shape in no link.
 */
export function figureOf(
    box: PlacedBox,
    boxes: readonly PlacedBox[],
    beat: number,
): PlacedBox[] {
    const links = liveLinks(boxes, beat);
    return linksOf(box, links).length === 0
        ? []
        : linkedFigure(box, links).sort((a, b) => a.recipe.id - b.recipe.id);
}

/** The member ids of `boxes`, in order, each once */
export const membersOf = (boxes: readonly PlacedBox[]): number[] => [
    ...new Set(boxes.flatMap((b) => b.recipe.members.map((m) => m.marcherId))),
];

const boxOf = (marcherId: number): PlacedBox | undefined =>
    boxesNow().find((b) =>
        b.recipe.members.some((m) => m.marcherId === marcherId),
    );

/**
 * The selection a press on marcher `hit` makes when placed boxes are on the field
 * (`FieldEditorPorts.pressSelection`), Figma-style (07-placed-boxes.md, `clickOnMarcher`): a
 * member selects its whole box, Shift adds or removes a whole box, and inside a box (after a
 * double click) Shift toggles one marcher. A linked figure is a level above its shapes (#1236): a
 * click selects it whole, and a click on it selected goes into it at the shape clicked
 * (`click`). A press that reaches inside ($mod, `reachInside`) goes
 * inside the box and is then a press inside it: the editor picks the marcher. Null leaves the
 * press to the editor's rules. Also keeps which box you're inside. Off when the View tab's Shapes
 * setting is Off, during playback and while the Shape tool is open (`useBoxSelection` says so).
 */
export function boxPressSelection(
    hit: number,
    shift: boolean,
    selection: readonly number[],
    reachInside = false,
    click?: "single" | "double",
): readonly number[] | null {
    const state = useBoxSelectionStore.getState();
    if (!state.enabled) return null;
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const boxes = placedBoxesAt(beat);
    const box =
        boxes.find((b) => b.recipe.members.some((m) => m.marcherId === hit)) ??
        null;
    const selected = new Set(selection);
    const figure = box ? figureOf(box, boxes, beat) : [];
    const out = clickOnMarcher({
        marcherId: hit,
        shift,
        reachInside,
        selected,
        box: box && {
            id: box.recipe.id,
            members: box.recipe.members.map((m) => m.marcherId),
        },
        inside: state.inside,
        figure: figure.length > 0 ? membersOf(figure) : null,
        inFigure: figure.some((b) => b.recipe.id === state.figure),
        click,
    });
    setInsideBox(out.inside);
    const wasInFigure = figure.some((b) => b.recipe.id === state.figure);
    setInsideFigure(out.inFigure && box ? box.recipe.id : null);
    // A double-click's second click comes after this: when its first went into the figure, that
    // was the double-click's step down (`doubleClickMember`)
    if (click !== "double")
        enteredFigureAt =
            click === "single" && out.inFigure && !wasInFigure ? hit : null;
    // A click on a member of a box selected whole keeps the box, where the editor's rule would
    // narrow the selection to that marcher (a drag moves the box either way)
    if (!out.select && box && out.inside === null && !shift) {
        const members = box.recipe.members.map((m) => m.marcherId);
        if (members.every((id) => selected.has(id))) return [...selection];
    }
    return out.select;
}

/** The marcher whose click last went into a linked figure, until the next press */
let enteredFigureAt: number | null = null;

/**
 * Whether the click just before a double-click's second on marcher `id` went into its linked
 * figure (#1236), so the double-click has gone down its one level already: a double-click on a
 * figure selected whole selects the shape clicked, as a double-click on a group does in Figma,
 * not one of its marchers. Answers once.
 */
export function enteredFigureByClick(id: number): boolean {
    const entered = enteredFigureAt === id;
    enteredFigureAt = null;
    return entered;
}

/**
 * Whether a press on marcher `hit` can reach inside ($mod, `FieldEditorPorts.reachesInside`): it's
 * a member of a placed box on the field while box selection is on, and you're not inside that box
 * already, where a click picks one marcher anyway and $mod stays `constrain`
 */
export function canReachInside(hit: number): boolean {
    const { enabled, inside } = useBoxSelectionStore.getState();
    if (!enabled) return false;
    const box = boxOf(hit);
    return box !== undefined && box.recipe.id !== inside;
}

/** Goes inside the box `marcherId` is in, selecting just that marcher */
export function enterBox(marcherId: number): void {
    if (!useBoxSelectionStore.getState().enabled) return;
    const box = boxOf(marcherId);
    if (!box) return;
    selectOnField([marcherId]);
    setInsideBox(box.recipe.id);
}

/**
 * Leaves the linked figure you've gone into (#1236), selecting it whole again, when a shape of it
 * is selected whole; returns whether it did
 */
export function leaveFigure(): boolean {
    const { figure, selected } = useBoxSelectionStore.getState();
    if (figure === null || !selected) return false;
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    const boxes = placedBoxesAt(beat);
    const box = boxes.find((b) => b.recipe.id === selected.recipe.id);
    const shapes = box ? figureOf(box, boxes, beat) : [];
    if (!shapes.some((b) => b.recipe.id === figure)) return false;
    selectOnField(membersOf(shapes));
    setInsideFigure(null);
    return true;
}

/** Leaves the box you're inside, selecting it whole again */
export function leaveBox(): void {
    const { inside } = useBoxSelectionStore.getState();
    const box = boxesNow().find((b) => b.recipe.id === inside);
    if (box) selectOnField(box.recipe.members.map((m) => m.marcherId));
    setInsideBox(null);
}

/**
 * Placed boxes in the field's selection: whether a click selects a whole box (on unless the View
 * tab's Shapes setting is Off, during playback or while the Shape tool is open),
 * `useBoxSelectionStore.selected`, the box whose members are exactly the selection, and `shapes`,
 * the shapes it's made of when it's several selected whole. You leave the
 * box you're inside when the selection leaves it (a click on the empty field, Escape).
 */
export function useBoxSelection({ isPlaying }: { isPlaying: boolean }): void {
    const mode = useUiSettingsStore((s) => s.uiSettings.shapes ?? "selected");
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const enabled = mode !== "off" && !isPlaying && !toolOpen;
    useEffect(() => {
        useBoxSelectionStore.setState({ enabled });
    }, [enabled]);

    // A double-click on a member as a menu entry (tablet 1.5): the field's menu, opened on a member
    // of the box selected whole, goes inside at that marcher
    const boxSelected = useBoxSelectionStore((s) => s.selected !== null);
    useActionHandler(
        "shapeEnterBox",
        (args) => {
            const box = useBoxSelectionStore.getState().selected;
            const marcherId = args?.marcherId;
            if (
                box &&
                typeof marcherId === "number" &&
                box.recipe.members.some((m) => m.marcherId === marcherId)
            )
                enterBox(marcherId);
        },
        { enabled: enabled && boxSelected },
    );

    // The box selected as a whole: its members are exactly the selection
    const selected = useSelectedMarchers()?.selectedMarchers;
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = usePlacedBoxBeat();
    const ends = usePlacedBoxStore((s) => s.ends);
    const saving = useSavingBoxStore((s) => savingBoxAt(s, beat));
    useEffect(() => {
        const ids = new Set((selected ?? []).map((m) => m.id));
        const boxes = enabled ? placedBoxesAt(beat, recipes) : [];
        const exactly = (b: PlacedBox) =>
            b.recipe.members.length === ids.size &&
            b.recipe.members.every((m) => ids.has(m.marcherId));
        // Until its save is read back, a box being saved is selected as it will be: the positions
        // and recipes read back in between don't agree, and would drop or move it back
        const box =
            (enabled && saving && exactly(saving) ? saving : null) ??
            boxes.find(exactly) ??
            null;
        // Inside a box until the selection leaves it
        const { inside } = useBoxSelectionStore.getState();
        const insideBox = boxes.find((b) => b.recipe.id === inside);
        const stillInside =
            insideBox !== undefined &&
            ids.size > 0 &&
            [...ids].every((id) =>
                insideBox.recipe.members.some((m) => m.marcherId === id),
            );
        // In a linked figure until the selection leaves it
        const figureBox = boxes.find(
            (b) => b.recipe.id === useBoxSelectionStore.getState().figure,
        );
        const figureIds = new Set(
            figureBox ? membersOf(figureOf(figureBox, boxes, beat)) : [],
        );
        const stillInFigure =
            ids.size > 0 && [...ids].every((id) => figureIds.has(id));
        // Several shapes selected whole, which the nudge keys move together (#1236)
        const shapes = box ? [] : wholeShapesOf(ids, boxes);
        useBoxSelectionStore.setState({
            selected: box,
            shapes,
            ...(stillInside ? {} : { inside: null }),
            ...(stillInFigure ? {} : { figure: null }),
        });
    }, [enabled, selected, recipes, ends, version, beat, saving]);
}
