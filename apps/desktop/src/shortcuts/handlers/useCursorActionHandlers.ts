import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

export function useCursorActionHandlers() {
    const { ready } = useEditorReadiness();
    const selectedMarchersContext = useSelectedMarchers();
    const setSelectedMarchers =
        selectedMarchersContext?.setSelectedMarchers ?? (() => {});

    // Not gated on `ready`: deselecting must work even while page data is loading
    useActionHandler("cancelAlignmentUpdates", () => {
        // Deselect all marchers
        setSelectedMarchers([]);
    });

    useActionHandler(
        "selectAllMarchers",
        () => {
            const canvas = window.canvas as OpenMarchCanvas | undefined;
            if (!canvas) {
                return;
            }

            const marchers = canvas.getCanvasMarchers();
            canvas.setActiveObjects(marchers);
            // Then the app's selection, which the canvas follows. The canvas's own events can
            // read a stale selection (the canvas still holding marchers the app had let go),
            // and its deselect would win, leaving nothing selected (shape sims)
            setSelectedMarchers(marchers.map((m) => m.marcherObj));
        },
        { enabled: ready },
    );
}
