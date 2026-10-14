import { useEffect, useRef } from "react";
import type { fabric } from "fabric";
import CanvasMarcher from "@/global/classes/canvasObjects/CanvasMarcher";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { clickOnMarcher } from "./boxClick";
import { setInsideBox, useBoxSelectionStore } from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import { placedBoxesAt, usePlacedBoxStore } from "./placedBoxStore";

/** Fabric's cached press target (fabric 5.5: set before `mouse:down:before`, read after it) */
type WithTarget = { _target?: fabric.Object | null };

/** Selects `ids` on the canvas; the canvas's selection listeners pass it on to the app */
export function selectOnCanvas(
    canvas: OpenMarchCanvas,
    ids: readonly number[],
): void {
    const wanted = new Set(ids);
    canvas.setActiveObjects(
        canvas.getCanvasMarchers().filter((m) => wanted.has(m.marcherObj.id)),
    );
}

const boxesNow = (): PlacedBox[] =>
    placedBoxesAt(displayedBeat(useTimelineSelectionStore.getState()));

/**
 * Placed boxes in the canvas's selection, Figma-style (07-placed-boxes.md, `clickOnMarcher`):
 * a click on a member selects its box, a double click goes inside it to pick one marcher, and
 * Shift-click adds or removes a whole box. Also keeps `useBoxSelectionStore.selected`: the box
 * whose members are exactly the selection. Off when the View tab's Shapes setting is Off, during
 * playback and while the Shape tool is open.
 */
export function useBoxSelection({
    canvas,
    isPlaying,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
}): void {
    const mode = useUiSettingsStore((s) => s.uiSettings.shapes ?? "selected");
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const enabled = mode !== "off" && !isPlaying && !toolOpen;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    useEffect(() => {
        if (!canvas) return;
        const { onDown, onDoubleClick } = pressHandlers(canvas, enabledRef);
        const onCleared = () => setInsideBox(null);
        canvas.on("mouse:down:before", onDown);
        canvas.on("mouse:dblclick", onDoubleClick);
        canvas.on("selection:cleared", onCleared);
        return () => {
            canvas.off("mouse:down:before", onDown as never);
            canvas.off("mouse:dblclick", onDoubleClick as never);
            canvas.off("selection:cleared", onCleared as never);
        };
    }, [canvas]);

    // The box selected as a whole: its members are exactly the selection
    const selected = useSelectedMarchers()?.selectedMarchers;
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = useTimelineSelectionStore(displayedBeat);
    const timelines = useTimelineSelectionStore((s) => s.storedTimelines);
    useEffect(() => {
        const ids = new Set((selected ?? []).map((m) => m.id));
        const box = enabled
            ? (placedBoxesAt(beat, recipes).find(
                  (b) =>
                      b.recipe.members.length === ids.size &&
                      b.recipe.members.every((m) => ids.has(m.marcherId)),
              ) ?? null)
            : null;
        useBoxSelectionStore.setState({ selected: box });
    }, [enabled, selected, recipes, version, beat, timelines]);
}

/** Fabric's press and double-click handlers for placed boxes, while `enabled` says so */
function pressHandlers(
    canvas: OpenMarchCanvas,
    enabled: { readonly current: boolean },
) {
    const onDown = (opt: fabric.IEvent<MouseEvent>) => {
        if (!enabled.current) return;
        const e = opt.e;
        if (e.button !== 0 || e.altKey) return;
        const target = (canvas as unknown as WithTarget)._target;
        if (!(target instanceof CanvasMarcher)) {
            // A press on the empty field leaves the box you were inside
            if (!target && !e.shiftKey) setInsideBox(null);
            return;
        }
        const marcherId = target.marcherObj.id;
        const box =
            boxesNow().find((b) =>
                b.recipe.members.some((m) => m.marcherId === marcherId),
            ) ?? null;
        const selected = new Set(
            canvas
                .getActiveObjects()
                .filter((o): o is CanvasMarcher => o instanceof CanvasMarcher)
                .map((m) => m.marcherObj.id),
        );
        const out = clickOnMarcher({
            marcherId,
            shift: e.shiftKey,
            selected,
            box: box && {
                id: box.recipe.id,
                members: box.recipe.members.map((m) => m.marcherId),
            },
            inside: useBoxSelectionStore.getState().inside,
        });
        if (!out.select) {
            setInsideBox(out.inside);
            return;
        }
        // Selecting first: replacing the selection clears it, which leaves any box
        selectOnCanvas(canvas, out.select);
        setInsideBox(out.inside);
        // The press now holds what was selected: a drag moves the whole box, and a
        // Shift-click is done (no lasso, no fabric grouping)
        (canvas as unknown as WithTarget)._target =
            canvas.getActiveObject() ?? null;
        if (e.shiftKey) {
            canvas.selection = false;
            canvas.pressTakenBefore = true;
        }
    };
    const onDoubleClick = (opt: fabric.IEvent<MouseEvent>) => {
        if (!enabled.current) return;
        // A selected box takes its own double clicks (useLiveBox); this is a marcher's
        const marcher = opt.target instanceof CanvasMarcher ? opt.target : null;
        if (!marcher) return;
        enterBox(canvas, marcher.marcherObj.id);
    };
    return { onDown, onDoubleClick };
}

/** Goes inside the box `marcherId` is in, selecting just that marcher */
export function enterBox(canvas: OpenMarchCanvas, marcherId: number): void {
    const box = boxesNow().find((b) =>
        b.recipe.members.some((m) => m.marcherId === marcherId),
    );
    if (!box) return;
    selectOnCanvas(canvas, [marcherId]);
    setInsideBox(box.recipe.id);
}

/** Leaves the box you're inside, selecting it whole again */
export function leaveBox(canvas: OpenMarchCanvas): void {
    const { inside } = useBoxSelectionStore.getState();
    const box = boxesNow().find((b) => b.recipe.id === inside);
    if (box)
        selectOnCanvas(
            canvas,
            box.recipe.members.map((m) => m.marcherId),
        );
    setInsideBox(null);
}
