import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectionStore } from "@/stores/SelectionStore";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

export function useCursorActionHandlers() {
    const { ready } = useEditorReadiness();
    const selectedMarchersContext = useSelectedMarchers();
    const setSelectedMarchers =
        selectedMarchersContext?.setSelectedMarchers ?? (() => {});
    const selectionStore = useSelectionStore();
    const setSelectedShapePageIds =
        selectionStore?.setSelectedShapePageIds ?? (() => {});

    // Not gated on `ready`: deselecting must work even while page data is loading
    useActionHandler("cancelAlignmentUpdates", () => {
        // Deselect all shapes and marchers
        setSelectedMarchers([]);
        setSelectedShapePageIds([]);
    });

    useActionHandler(
        "selectAllMarchers",
        () => {
            const canvas = window.canvas as OpenMarchCanvas | undefined;
            if (!canvas) {
                return;
            }

            canvas.setActiveObjects(canvas.getCanvasMarchers());
        },
        { enabled: ready },
    );
}
