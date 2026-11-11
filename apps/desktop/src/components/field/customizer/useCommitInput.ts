import { useState } from "react";
import type React from "react";
import { blurOnEnterFunc } from "./utils";

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
    /** The stored value, as the input shows it. */
    stored: string;
    /** The stored value itself; typing it again saves nothing. */
    current: T;
    /** The value the typed text means, or null when it isn't valid. */
    parse: (text: string) => { value: T } | null;
    /** Saves a new value. Called on blur (or Enter), only for a valid value that differs. */
    commit: (value: T) => void;
    /** Cleans each keystroke, such as dropping letters from a number. */
    filter?: (text: string) => string;
}

/**
 * Props for a text input that saves on blur or Enter. It follows the stored value (see
 * `useDraft`), saves nothing when the value is unchanged, and goes back to the stored value
 * when what was typed isn't valid.
 */
export function useCommitInput<T>({
    stored,
    current,
    parse,
    commit,
    filter,
}: CommitInputOptions<T>) {
    const [draft, setDraft] = useDraft(stored);
    return {
        value: draft,
        /** Whether the text typed so far is a valid value */
        valid: parse(draft) !== null,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setDraft(filter ? filter(e.target.value) : e.target.value),
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            e.preventDefault();
            const parsed = parse(draft);
            if (parsed === null || Object.is(parsed.value, current)) {
                setDraft(stored);
                return;
            }
            commit(parsed.value);
        },
        onKeyDown: blurOnEnterFunc,
    };
}

/** What `useCommitInput` returns: the input's props, and whether the text is valid. */
export type CommitInputProps = ReturnType<typeof useCommitInput>;
