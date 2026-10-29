import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useAlignmentEventStore } from "@/stores/AlignmentEventStore";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useActionHandler } from "../useActionHandler";
import type { EditorReadiness } from "./useEditorReadiness";
import type { UpdateCoordinates } from "./useUpdateCoordinates";

// eslint-disable-next-line max-lines-per-function
export function useCursorActionHandlers(
    editor: EditorReadiness,
    updateCoordinates: UpdateCoordinates,
) {
    const { ready, selectedPerformers } = editor;
    const selectedMarchersContext = useSelectedMarchers();
    const setSelectedMarchers =
        selectedMarchersContext?.setSelectedMarchers ?? (() => {});
    const alignmentEventStore = useAlignmentEventStore();
    const resetAlignmentEvent =
        alignmentEventStore?.resetAlignmentEvent ?? (() => {});
    const setAlignmentEvent =
        alignmentEventStore?.setAlignmentEvent ?? (() => {});
    const setAlignmentEventMarchers =
        alignmentEventStore?.setAlignmentEventMarchers ?? (() => {});
    const alignmentEventNewMarcherPages =
        alignmentEventStore?.alignmentEventNewMarcherPages ?? [];
    const alignmentEventMarchers =
        alignmentEventStore?.alignmentEventMarchers ?? [];

    // Not gated on `ready`: resetting the alignment event is what clears a half-drawn line
    // (via the listener swap in Canvas), and that must work even while page data is loading.
    useActionHandler("cancelAlignmentUpdates", () => {
        // Drawing a prop (C2.1): Escape turns the prop tool off, and nothing else
        const propTool = useItemDrawingStore.getState();
        if (propTool.drawingMode) {
            propTool.resetDrawingState();
            return;
        }
        if (alignmentEventMarchers.length > 0) {
            setSelectedMarchers(alignmentEventMarchers);
            resetAlignmentEvent();
        } else {
            // Deselect all marchers
            setSelectedMarchers([]);
        }
    });

    useActionHandler(
        "applyQuickShape",
        () => {
            updateCoordinates(
                alignmentEventNewMarcherPages.map((marcherPage) => ({
                    marcher_id: marcherPage.marcher_id,
                    page_id: marcherPage.page_id,
                    x: marcherPage.x as number,
                    y: marcherPage.y as number,
                    notes: marcherPage.notes || undefined,
                })),
            );
            resetAlignmentEvent();
        },
        { enabled: ready && alignmentEventNewMarcherPages.length > 0 },
    );

    useActionHandler(
        "alignmentEventDefault",
        () => {
            resetAlignmentEvent();
        },
        { enabled: ready },
    );

    useActionHandler(
        "alignmentEventLine",
        () => {
            // Performers only: a selected prop takes no slot in the line (C2.2)
            if (selectedPerformers.length < 2) {
                console.error(
                    "Not enough marchers selected to create a line. Need at least 2 marchers selected.",
                );
                return;
            }
            setAlignmentEvent("line");
            setAlignmentEventMarchers(selectedPerformers);
            setSelectedMarchers([]);
        },
        { enabled: ready && selectedPerformers.length >= 2 },
    );

    useActionHandler(
        "selectAllMarchers",
        () => {
            // The field selects through its editor
            activeFieldEditor()?.selectAll();
        },
        { enabled: ready },
    );
}
