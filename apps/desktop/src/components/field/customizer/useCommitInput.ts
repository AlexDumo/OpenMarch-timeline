import { useRef, useState } from "react";
import type React from "react";
import { toast } from "sonner";
import { useTranslate } from "@tolgee/react";

/**
 * Text a person is typing into an input, starting from the stored value. Whenever the stored
 * value changes (undo or redo, a field import, an edit from another window, or this input's own
 * save) the draft starts over from it, so the input never shows a value the field no longer has.
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

export interface CommitInputOptions<T> {
    /** The stored value. */
    current: T;
    /**
     * The text the input shows for a value. Two values that show the same text are the same
     * value, so typing the stored value again, or one that only differs by float noise or
     * whitespace, saves nothing.
     */
    format: (value: T) => string;
    /** The value the typed text means, or null when it isn't valid. */
    parse: (text: string) => { value: T } | null;
    /**
     * Saves a new value. Called on blur (or Enter), only for a valid value that differs. When it
     * throws or its promise rejects, the input goes back to the stored value and shows an error.
     */
    commit: (value: T) => void | Promise<unknown>;
    /** Cleans each keystroke, such as dropping letters from a number; null refuses it. */
    filter?: (text: string) => string | null;
}

/**
 * Props for a text input that saves on blur or Enter. It follows the stored value (see
 * `useDraft`), saves nothing when the value is unchanged, goes back to the stored value when
 * what was typed isn't valid, and Escape cancels the edit.
 */
export function useCommitInput<T>({
    current,
    format,
    parse,
    commit,
    filter,
}: CommitInputOptions<T>) {
    const { t } = useTranslate();
    const stored = format(current);
    const [draft, setDraft] = useDraft(stored);
    // Escape blurs the input; the blur that follows must not save
    const cancelled = useRef(false);
    const valid = parse(draft) !== null;

    const failed = (error: unknown) => {
        console.error("Couldn't save the field editor value", error);
        setDraft(stored);
        toast.error(t("fieldProperties.errors.saveFailed"));
    };

    return {
        value: draft,
        /** Whether the text typed so far is a valid value */
        valid,
        "aria-invalid": valid ? undefined : true,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const next = filter ? filter(e.target.value) : e.target.value;
            if (next !== null) setDraft(next);
        },
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            e.preventDefault();
            const parsed = cancelled.current ? null : parse(draft);
            cancelled.current = false;
            if (parsed === null || format(parsed.value) === stored) {
                setDraft(stored);
                return;
            }
            // Shows the value as it is stored ("1." as "1") until the saved value comes back
            setDraft(format(parsed.value));
            try {
                const result = commit(parsed.value);
                if (result instanceof Promise) result.catch(failed);
            } catch (error) {
                failed(error);
            }
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.currentTarget.blur();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelled.current = true;
                setDraft(stored);
                e.currentTarget.blur();
            }
        },
    };
}

/** What `useCommitInput` returns: the input's props, and whether the text is valid. */
export type CommitInputProps = ReturnType<typeof useCommitInput>;
