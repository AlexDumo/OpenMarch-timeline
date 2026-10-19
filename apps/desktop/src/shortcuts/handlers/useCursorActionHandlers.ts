import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

export function useCursorActionHandlers() {
    const { ready } = useEditorReadiness();
    const selectedMarchersContext = useSelectedMarchers();
    const setSelectedMarchers =
        selectedMarchersContext?.setSelectedMarchers ?? (() => {});

    // Not gated on `ready`: deselecting must work even while page data is loading
    useActionHandler("cancelAlignmentUpdates", () => {
        // Drawing a prop (C2.1): Escape turns the prop tool off, and nothing else
        const propTool = useItemDrawingStore.getState();
        if (propTool.drawingMode) {
            propTool.resetDrawingState();
            return;
        }
        // Deselect all marchers
        setSelectedMarchers([]);
    });

    useActionHandler(
        "selectAllMarchers",
        () => {
            // The field selects through its editor
            activeFieldEditor()?.selectAll();
        },
        { enabled: ready },
    );
}
