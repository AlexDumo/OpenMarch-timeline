import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useBoxSelection } from "../placed/boxSelection";
import {
    previewPlacedBox,
    useBoxSelectionStore,
} from "../placed/boxSelectionStore";
import { LiveBoxMode } from "../placed/liveBoxMode";
import {
    closeShapeTool,
    useShapeHidden,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { isAwayFrom } from "../tool/shapeMoment";
import { forgetDiscardedShape } from "../tool/shapeLeave";
import { subscribeHistoryChanges } from "@/db-functions/history";
import { shapeToolMode } from "../tool/shapeToolMode";

/**
 * Puts the shapes on the field's editor (#204): the open Shape tool takes every edit press
 * (`shapeToolMode`), and otherwise a selected placed box takes the presses on its handles and
 * inside it (`LiveBoxMode`). Also keeps placed boxes in the selection (`useBoxSelection`).
 *
 * The tool is about one moment and one group of marchers. Only Place (Enter) places it (#416):
 * moving around the timeline, playing, Visuals and a new selection leave it open. While it waits
 * out of sight (`useShapeHidden`) the field doesn't draw it or give it presses, and an armed tool
 * with nothing drawn yet closes once the timeline moves off its moment.
 */
export function useShapeFieldModes(
    editor: FieldEditor,
    isPlaying: boolean,
): void {
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const hidden = useShapeHidden();
    const box = useBoxSelectionStore((s) => s.selected);
    const queryClient = useQueryClient();
    useBoxSelection({ isPlaying });

    // One live mode per box, told when the box is saved or read again
    const boxId = box?.recipe.id ?? null;
    const live = useMemo(
        () => (box ? new LiveBoxMode(box, queryClient) : null),
        // A new mode only for another box
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [boxId, queryClient],
    );
    useEffect(() => {
        if (box) live?.setBox(box);
        // The box read back (or another one) replaces a number drag's preview
        previewPlacedBox(null);
    }, [live, box]);

    useEffect(() => {
        editor.setMode(toolOpen ? (hidden ? null : shapeToolMode) : live);
    }, [editor, toolOpen, hidden, live]);
    useEffect(() => () => editor.setMode(null), [editor]);

    useShapeWaits(isPlaying, toolOpen);
}

function useShapeWaits(isPlaying: boolean, open: boolean): void {
    // A discarded shape comes back only on the undo right after Escape: any edit to the show
    // in between takes undo back
    useEffect(() => subscribeHistoryChanges(forgetDiscardedShape), []);

    useEffect(() => {
        if (isPlaying) forgetDiscardedShape();
    }, [isPlaying]);

    const selected = useSelectedMarchers()?.selectedMarchers;
    useEffect(() => {
        if (!selected) return;
        const ids = new Set(selected.map((m) => m.id));
        const { discarded } = useShapeToolStore.getState();
        const same =
            !!discarded &&
            ids.size === discarded.tool.marchers.length &&
            discarded.tool.marchers.every((m) => ids.has(m.id));
        if (discarded && !same) forgetDiscardedShape();
    }, [selected]);

    const windowKey = useTimelineSelectionStore((s) => {
        const sel = s.selection;
        const iso = s.isolation;
        return [
            sel.kind,
            sel.kind === "range" ? `${sel.start}-${sel.end}` : "",
            iso ? `${iso.timelineId}:${iso.start}-${iso.end}` : "",
        ].join("|");
    });
    useEffect(() => {
        if (!open) return;
        const { tool, moment } = useShapeToolStore.getState();
        // Nothing drawn yet: the marchers it armed on were where they stood at that moment
        if (tool?.params === null && isAwayFrom(moment)) closeShapeTool();
    }, [windowKey, open]);
    // Undo after Escape opens the shape at the moment it was discarded, so a new moment ends it
    const discardedAt = useRef(windowKey);
    const discarded = useShapeToolStore((s) => s.discarded !== null);
    useEffect(() => {
        if (discarded) discardedAt.current = windowKey;
        // Only the discarding: a later change of window is handled below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [discarded]);
    useEffect(() => {
        if (discarded && windowKey !== discardedAt.current)
            forgetDiscardedShape();
    }, [windowKey, discarded]);
}
