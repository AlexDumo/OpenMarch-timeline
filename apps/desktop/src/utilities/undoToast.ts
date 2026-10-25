import { toast, type ExternalToast } from "sonner";
import { subscribeHistoryChanges } from "@/db-functions/history";

/** The close handlers a toast shown by `toastUntilNextHistoryChange` must be given */
export type UndoToastCloseHandlers = Required<
    Pick<ExternalToast, "onDismiss" | "onAutoClose">
>;

/**
 * Shows a toast whose action undoes the edit that just committed, and closes it on the next
 * history change (an edit, an undo, a redo), so its Undo can't undo something else (as UI-14's
 * delete toast). Call it once the edit has committed. `show` shows the toast with `handlers`
 * among its options and returns its id.
 */
export function toastUntilNextHistoryChange(
    show: (handlers: UndoToastCloseHandlers) => string | number,
): void {
    let unsubscribe = () => {};
    const id = show({
        onDismiss: () => unsubscribe(),
        onAutoClose: () => unsubscribe(),
    });
    unsubscribe = subscribeHistoryChanges(() => {
        unsubscribe();
        toast.dismiss(id);
    });
}
