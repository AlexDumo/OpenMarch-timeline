import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { useEditorReadiness } from "@/shortcuts/handlers/useEditorReadiness";
import { useShapeShown } from "../tool/shapeToolStore";
import { copyFormation, pasteFormation } from "./copyPaste";
import { useCopiedPictureStore } from "./pictureStore";

/**
 * Copy, Paste and Paste in place (#961), for their keys, the field's menu and the command palette
 * alike. Each needs performers selected (a prop takes no spot), and no shape open and showing:
 * that one is placed or discarded first. The pastes also need something copied. Unavailable,
 * their keys are left alone, so Ctrl/Cmd+C and V keep working on text.
 */
export function useClipboardActions(): void {
    const { ready, selectedPerformers } = useEditorReadiness();
    const shapeShown = useShapeShown();
    const copied = useCopiedPictureStore((s) => s.picture !== null);
    const selected = ready && !shapeShown && selectedPerformers.length > 0;
    const ids = () => selectedPerformers.map((m) => m.id);
    useActionHandler("copyFormation", () => void copyFormation(ids()), {
        enabled: selected,
        ignoreRepeat: true,
    });
    useActionHandlerGroup(
        ["pasteFormation", "pasteFormationInPlace"],
        (id) =>
            void pasteFormation(ids(), {
                inPlace: id === "pasteFormationInPlace",
            }),
        { enabled: selected && copied, ignoreRepeat: true },
    );
}
