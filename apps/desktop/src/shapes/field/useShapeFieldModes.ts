import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useBoxSelection } from "../placed/boxSelection";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import { LiveBoxMode } from "../placed/liveBoxMode";
import { closeShapeTool, useShapeToolStore } from "../tool/shapeToolStore";
import { shapeToolMode } from "../tool/shapeToolMode";

/**
 * Puts the shapes on the field's editor (#204): the open Shape tool takes every edit press
 * (`shapeToolMode`), and otherwise a selected placed box takes the presses on its handles and
 * inside it (`LiveBoxMode`). Also keeps placed boxes in the selection (`useBoxSelection`).
 *
 * The tool is about one moment and one group of marchers, so it closes, placing nothing, when
 * playback starts, the edit window moves or the selection changes.
 */
export function useShapeFieldModes(
    editor: FieldEditor,
    isPlaying: boolean,
): void {
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
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
    }, [live, box]);

    useEffect(() => {
        editor.setMode(toolOpen ? shapeToolMode : live);
    }, [editor, toolOpen, live]);
    useEffect(() => () => editor.setMode(null), [editor]);

    useCloseWhenTheMomentChanges(isPlaying, toolOpen);
}

function useCloseWhenTheMomentChanges(isPlaying: boolean, open: boolean): void {
    useEffect(() => {
        if (isPlaying) closeShapeTool();
    }, [isPlaying]);

    const selected = useSelectedMarchers()?.selectedMarchers;
    useEffect(() => {
        const tool = useShapeToolStore.getState().tool;
        if (!tool || !selected) return;
        const ids = new Set(selected.map((m) => m.id));
        const same =
            ids.size === tool.marchers.length &&
            tool.marchers.every((m) => ids.has(m.id));
        if (!same) closeShapeTool();
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
    const openedAt = useRef(windowKey);
    useEffect(() => {
        if (open) openedAt.current = windowKey;
        // Only the opening: a later change of window is handled below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    useEffect(() => {
        if (open && windowKey !== openedAt.current) closeShapeTool();
    }, [windowKey, open]);
}
