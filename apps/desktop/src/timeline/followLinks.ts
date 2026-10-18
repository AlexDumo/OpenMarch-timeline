import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { subscribeHistoryChanges } from "@/db-functions/history";
import {
    activeFieldEditor,
    subscribeActiveFieldEditor,
} from "@/field/editor/activeFieldEditor";

/**
 * **Follow links** (study variant, 2026-10-18): show which later pages follow an edit before and
 * while it happens, instead of saying so in a toast after it. With it on:
 *
 * - the linked chain shows on every page box that follows the selected page for the selected
 *   marchers (`followingPages`), not only on the selected page and on hover;
 * - while a field drag moves, scales or rotates them, those chains light up in the accent;
 * - a click on one beforehand unlinks that page (keeps the marchers there), so the edit won't move it;
 * - after an edit that carried into them, the "Pages 3–4 followed · Only Page 2" toast doesn't
 *   show: the chains light for a moment, and until the next edit a click on one unlinks it as it
 *   was before the edit (**Only Page 2**, `CarriedEdit`).
 *
 * On by default; `localStorage["openmarch.followLinks"] = "off"` turns it off (from the next render).
 */
export const FOLLOW_LINKS_KEY = "openmarch.followLinks";

/** Whether the follow links variant is on (read on every call, so a study can switch it live) */
export function followLinksOn(): boolean {
    try {
        return globalThis.localStorage?.getItem(FOLLOW_LINKS_KEY) !== "off";
    } catch {
        return false;
    }
}

/** An edit that carried into later pages, as the chains offer to take it back there. */
export interface CarriedEdit {
    /** The edited page's name */
    readonly editedName: string;
    /** The pages that followed the edit, by name, in page order */
    readonly pages: readonly string[];
    /** The marchers that followed into the next page box */
    readonly marcherIds: readonly number[];
    /** **Only Page N**: keeps the later pages as they looked before the edit (its own undo step) */
    readonly onlyThisPage: () => void;
}

interface FollowLinksState {
    /** The last edit's carry, until the next edit, undo or redo */
    carried: CarriedEdit | null;
    /** The carry's chains are lit: for `CARRIED_LIT_MS` after it, then they go quiet again */
    carriedLit: boolean;
    setCarried: (carried: CarriedEdit | null) => void;
}

/** How long the chains stay lit after an edit carried into their pages (ms) */
export const CARRIED_LIT_MS = 1500;

let quietTimer: ReturnType<typeof setTimeout> | undefined;

export const useFollowLinksStore = create<FollowLinksState>((set) => ({
    carried: null,
    carriedLit: false,
    setCarried: (carried) => {
        clearTimeout(quietTimer);
        set({ carried, carriedLit: carried !== null });
        if (carried)
            quietTimer = setTimeout(
                () => set({ carriedLit: false }),
                CARRIED_LIT_MS,
            );
    },
}));

/*
 * Any history change (the next edit, an undo or a redo) ends the offer: Only Page N would describe
 * an edit that's no longer the last. A run of nudges sets it again once each one has reached the
 * resolver, with the run's spots from before its first nudge (`offerOnlyThisPage`).
 */
subscribeHistoryChanges(() => {
    if (useFollowLinksStore.getState().carried)
        useFollowLinksStore.getState().setCarried(null);
});

/** The field gestures that change where the selected marchers are */
const EDIT_GESTURES = new Set(["move", "scale", "rotate"]);

const fieldEditing = () =>
    EDIT_GESTURES.has(activeFieldEditor()?.activeGesture() ?? "");

function subscribeFieldEditing(listener: () => void): () => void {
    let unsubscribeEditor: (() => void) | undefined;
    const follow = () => {
        unsubscribeEditor?.();
        unsubscribeEditor = activeFieldEditor()?.subscribe(listener);
        listener();
    };
    const unsubscribeActive = subscribeActiveFieldEditor(follow);
    unsubscribeEditor = activeFieldEditor()?.subscribe(listener);
    return () => {
        unsubscribeActive();
        unsubscribeEditor?.();
    };
}

/** Whether a field drag is moving, scaling or rotating marchers right now */
export function useFieldEditing(enabled: boolean): boolean {
    return useSyncExternalStore(
        enabled ? subscribeFieldEditing : subscribeNothing,
        enabled ? fieldEditing : alwaysFalse,
    );
}

const subscribeNothing = () => () => {};
const alwaysFalse = () => false;
