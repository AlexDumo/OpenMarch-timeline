import { useEffect } from "react";
import { useAlignmentEventStore } from "@/stores/AlignmentEventStore";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import type { MarcherPosition } from "@/field/editor/moveGesture";

/**
 * Turns the new field's line tool on and off with the app's alignment event
 * (#203): L sets it to "line" with the selected marchers, and applying
 * (Shift+Enter) or cancelling (Escape) resets it. The tool keeps no state
 * the app doesn't: its previews go back to the alignment event.
 */
export function useFieldLineTool(editor: FieldEditor) {
    useEffect(() => {
        const sync = ({
            alignmentEvent,
            alignmentEventMarchers,
        }: ReturnType<typeof useAlignmentEventStore.getState>) =>
            editor.setLineTool(
                alignmentEvent === "line"
                    ? alignmentEventMarchers.map((marcher) => marcher.id)
                    : null,
            );
        sync(useAlignmentEventStore.getState());
        const unsubscribe = useAlignmentEventStore.subscribe((now, before) => {
            if (
                now.alignmentEvent !== before.alignmentEvent ||
                now.alignmentEventMarchers !== before.alignmentEventMarchers
            )
                sync(now);
        });
        return () => {
            unsubscribe();
            editor.setLineTool(null);
        };
    }, [editor]);
}

/**
 * Gives the line's positions to the alignment event, which the
 * `applyQuickShape` action (Shift+Enter) saves through the timeline's rules,
 * in one undo step, as it does Fabric's. The page id is ignored there.
 */
export function publishLinePreviews(
    positions: readonly MarcherPosition[],
    pageId: number | null,
) {
    useAlignmentEventStore.getState().setAlignmentEventNewMarcherPages(
        positions.map(({ id, x, y }) => ({
            marcher_id: id,
            page_id: pageId ?? -1,
            x,
            y,
        })),
    );
}
