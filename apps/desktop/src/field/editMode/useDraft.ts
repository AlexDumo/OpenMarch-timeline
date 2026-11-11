import { useState } from "react";

/**
 * Text being typed into an input, starting from the stored value. Whenever the stored value
 * changes (undo or redo, an edit from elsewhere, this input's own save) the draft starts over
 * from it, so an input never shows a value the field no longer has (B1).
 *
 * The same rule as the customizer's `useDraft` in fork PR #828; when both land, one of them
 * should go.
 */
export function useDraft(stored: string): [string, (text: string) => void] {
    const [draft, setDraft] = useState(stored);
    const [synced, setSynced] = useState(stored);
    if (synced !== stored) {
        // Adjusting state while rendering, as React suggests for state that follows a prop
        setSynced(stored);
        setDraft(stored);
        return [stored, setDraft];
    }
    return [draft, setDraft];
}
