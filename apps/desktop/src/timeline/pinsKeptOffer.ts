import { create } from "zustand";
import type { RoutePin } from "@openmarch/core";
import { subscribeHistoryChanges } from "@/db-functions/history";
import { scaleMovePins } from "@/db-functions/timelineRoutePins";
import type { DbConnection } from "@/db-functions/types";

/**
 * AP-P5's offer (pathways step 5, spec Appendix M): after a resize that kept a move's pins on
 * their counts, **Scale pins instead** (the toast's button) and **Scale pins with the move** (the
 * command) scale them from the pins read just before the resize. The offer lives exactly as long
 * as its toast and the resize stay on top: it goes when the toast closes, and with any edit, undo
 * or redo after the resize. Kept apart from the timeline panel so it has no React in it.
 */
export interface PinsKeptOffer {
    database: DbConnection;
    timelineId: number;
    /** The move's range before the resize, and the range the resize gave it */
    before: { start: number; end: number };
    after: { start: number; end: number };
    pinsBefore: readonly { routeId: number; pins: RoutePin[] }[];
}

export const usePinsKeptOffer = create<{ offer: PinsKeptOffer | null }>(() => ({
    offer: null,
}));

/** The offer's way out: let go of history, clear it from the store, and tell its toast */
let closeCurrent: (() => void) | null = null;

/**
 * Makes `offer` the current one, replacing any other. `onClose` runs once when it goes for any
 * reason (a history change, `closePinsKeptOffer`, or taken). Returns the close.
 */
export function openPinsKeptOffer(
    offer: PinsKeptOffer,
    onClose: () => void = () => {},
): () => void {
    closeCurrent?.();
    let open = true;
    let unsubscribe = () => {};
    const close = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        if (closeCurrent === close) closeCurrent = null;
        if (usePinsKeptOffer.getState().offer === offer)
            usePinsKeptOffer.setState({ offer: null });
        onClose();
    };
    closeCurrent = close;
    usePinsKeptOffer.setState({ offer });
    unsubscribe = subscribeHistoryChanges(close);
    return close;
}

/** Lets go of the current offer, if any (its toast closed) */
export function closePinsKeptOffer(): void {
    closeCurrent?.();
}

/**
 * Scales the current offer's pins as one edit of their own, and lets the offer go. Nothing (and
 * false) without one. The database refuses, writing nothing, when the move isn't as the resize
 * left it.
 */
export async function takePinsKeptOffer(): Promise<boolean> {
    const { offer } = usePinsKeptOffer.getState();
    if (!offer) return false;
    closeCurrent?.();
    await scaleMovePins({
        db: offer.database,
        timelineId: offer.timelineId,
        before: offer.before,
        after: offer.after,
        pinsBefore: offer.pinsBefore,
    });
    return true;
}
