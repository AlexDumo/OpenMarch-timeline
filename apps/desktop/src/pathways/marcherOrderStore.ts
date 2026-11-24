/**
 * Showing and setting a line's order (pathways step 4g, DL-26..DL-33), outside React:
 *
 * - `forms`: the order forms Show order needs (`readOrderForms`): those of the selected marchers,
 *   or every one in the show for Always. Read once and again after each undoable edit, undo and
 *   redo, only while something shows the order. What each beat shows is worked out from them in
 *   memory, so the line costs no read per frame.
 * - `sweep`: Set order while it's on: the selected marchers, where they stand at its beat, who has
 *   been picked so far and where the pointer is. Its line redraws on the pointer's frame.
 */
import { create } from "zustand";
import { db } from "@/global/database/db";
import { subscribeHistoryChanges } from "@/db-functions/history";
import {
    ordersInForce,
    readOrderForms,
    rememberedOrder,
    type OrderForm,
    type OrderInForce,
} from "@/db-functions/rememberedOrder";
import { guessedOrder } from "@/db-functions/timelineTrailDrag";
import { readAllMarcherIds } from "@/db-functions/marcherOrder";
import { orderAfterSweep, type XY } from "./orderSweep";

/** Set order while it's on */
export interface OrderSweep {
    /** The selected marchers it orders, by id */
    readonly ids: readonly number[];
    /** Where each stands at `beat`, which the sweep passes */
    readonly at: ReadonlyMap<number, XY>;
    /** The beat it was opened at: the order is made there */
    readonly beat: number;
    /** The order shown when it opened (remembered or guessed): the skipped keep it, after */
    readonly before: readonly number[] | null;
    /** Picked so far, leader first */
    readonly picked: readonly number[];
    /** The pointer while a drag is held, or while it follows with the button up: the line grows behind it */
    readonly pointer: XY | null;
    /**
     * Clicked, then moved (owner, 2026-11-17): the sweep follows the pointer with the button up,
     * picking whoever it passes, until a click or Enter keeps the order. False until a click.
     */
    readonly following: boolean;
    /**
     * Taken back by Backspace, newest last: not picked again until the pointer has left them, so
     * the one under a still pointer doesn't come straight back
     */
    readonly takenBack: readonly number[];
}

/** Whose forms are read: every marcher's (`all`, for Always), or these marchers' */
export type OrderFormsScope = "all" | readonly number[];

/** A scope as a key: `all`, or the ids ascending, joined */
export const orderScopeKey = (scope: OrderFormsScope): string =>
    scope === "all" ? "all" : [...scope].sort((a, b) => a - b).join(",");

interface MarcherOrderState {
    /** The forms of `formsScope`'s marchers, or null before the first read */
    readonly forms: readonly OrderForm[] | null;
    /** Whose `forms` are (`orderScopeKey`): they hold every form of those marchers */
    readonly formsScope: string | null;
    readonly sweep: OrderSweep | null;
}

export const useMarcherOrderStore = create<MarcherOrderState>(() => ({
    forms: null,
    formsScope: null,
    sweep: null,
}));

/** Whose forms the next read reads */
let scope: OrderFormsScope = "all";
let reading: Promise<void> | null = null;
let again = false;

/** Reads the forms again; calls while a read runs fold into one more read after it */
export function invalidateOrderForms(): void {
    if (reading) {
        again = true;
        return;
    }
    const reads = scope;
    const key = orderScopeKey(reads);
    reading = (reads === "all" ? readAllMarcherIds(db) : Promise.resolve(reads))
        .then((ids) => readOrderForms(db, ids))
        .then((forms) =>
            useMarcherOrderStore.setState({ forms, formsScope: key }),
        )
        .catch((e: unknown) => console.error("Couldn't read line orders", e))
        .finally(() => {
            reading = null;
            if (again) {
                again = false;
                invalidateOrderForms();
            }
        });
}

/** Settles once the forms asked for so far are read */
export async function orderFormsRead(): Promise<void> {
    while (reading) await reading;
}

/**
 * Keeps the forms of `whose` read while something shows the order: reads them now, then after
 * every undoable edit, undo and redo. Returns the stop.
 */
export function followOrderForms(whose: OrderFormsScope = "all"): () => void {
    scope = whose;
    invalidateOrderForms();
    return subscribeHistoryChanges(invalidateOrderForms);
}

/** Whether forms read for `formsScope` hold every form of the marchers of `want` */
export const formsCover = (
    formsScope: string | null,
    want: OrderFormsScope,
): boolean =>
    formsScope !== null &&
    (formsScope === "all" || formsScope === orderScopeKey(want));

/** A line to draw: its marchers, leader first, and whether the order is only guessed */
export interface ShownOrder {
    readonly order: readonly number[];
    /**
     * Nothing remembers it: guessed from where they stand (`guessedOrder`: a box's snake, else
     * `followSource`), drawn faded and dashed
     */
    readonly guessed: boolean;
}

/** A stored trail shown on the field (selected, or in Edit path): its move and its line */
export interface ShownTrail {
    /** The move's start and end beats */
    readonly start: number;
    readonly end: number;
    /** Its marchers, leader first */
    readonly order: readonly number[];
}

/**
 * The shown trail's own order for exactly its marchers at `beat` inside its move, or null. A
 * trail's order is remembered from its move's end (`rememberedOrder`), but while the trail is shown
 * its line walks in that order the whole move, so the band keeps its dark leader end and its tip
 * from the start flag on (owner, 2026-11-17: the band lost its direction mid-move).
 */
export function shownTrailOrder(
    trail: ShownTrail | null | undefined,
    ids: readonly number[],
    beat: number,
): ShownOrder | null {
    if (!trail || trail.order.length !== ids.length || ids.length < 2)
        return null;
    if (beat < trail.start - 1e-9 || beat >= trail.end - 1e-9) return null;
    const want = new Set(ids);
    return trail.order.every((m) => want.has(m))
        ? { order: trail.order, guessed: false }
        : null;
}

/**
 * The order shown for `ids` at `beat` (DL-31): the shown trail's inside its move
 * (`shownTrailOrder`), else the one remembered (`rememberedOrder`), or else the one guessed from
 * where they stand (`at`, by id), or null when neither has one. A box's guess is its default
 * snake, row by row from the top left (step 11, SN-2), which the Follow tool runs from whichever
 * corner is dragged out of.
 */
export function shownOrderOf(
    forms: readonly OrderForm[] | null,
    ids: readonly number[],
    beat: number,
    at: ReadonlyMap<number, XY>,
    trail?: ShownTrail | null,
): ShownOrder | null {
    if (ids.length < 2) return null;
    const ofTrail = shownTrailOrder(trail, ids, beat);
    if (ofTrail) return ofTrail;
    const remembered = forms ? rememberedOrder(forms, ids, beat) : null;
    if (remembered && remembered.length === ids.length)
        return { order: remembered, guessed: false };
    const sorted = [...ids].sort((a, b) => a - b);
    const starts = sorted.flatMap((id) => {
        const p = at.get(id);
        return p ? [[p.x, p.y] as [number, number]] : [];
    });
    if (starts.length !== sorted.length) return null;
    const guess = guessedOrder(starts);
    return guess
        ? { order: guess.order.map((i) => sorted[i]!), guessed: true }
        : null;
}

/**
 * The lines Show order draws (DL-31): with `always`, every line whose order holds at `beat`;
 * the selection's own order (remembered or guessed) when it isn't one of them
 */
export function shownOrders({
    forms,
    selected,
    beat,
    at,
    always,
}: {
    forms: readonly OrderForm[] | null;
    selected: readonly number[];
    beat: number;
    at: ReadonlyMap<number, XY>;
    always: boolean;
}): ShownOrder[] {
    const own = shownOrderOf(forms, selected, beat, at);
    if (!always) return own ? [own] : [];
    return withOwnOrder(forms ? ordersInForce(forms, beat) : [], own);
}

/**
 * The lines in force (`ordersInForce`) and the selection's own order, when it isn't one of them
 * or part of one drawn already
 */
export function withOwnOrder(
    inForce: readonly OrderInForce[],
    own: ShownOrder | null,
): ShownOrder[] {
    const lines: ShownOrder[] = inForce.map((line) => ({
        order: line.order,
        guessed: false,
    }));
    if (own) {
        const key = own.order.join(",");
        if (
            !lines.some(
                (l) =>
                    l.order.join(",") === key ||
                    // The selection is part of a line drawn already
                    (!own.guessed &&
                        own.order.every((id) => l.order.includes(id))),
            )
        )
            lines.push(own);
    }
    return lines;
}

/** Opens Set order on `ids` (two or more), standing at `at` at `beat` */
export function openOrderSweep(
    sweep: Omit<OrderSweep, "picked" | "pointer" | "following" | "takenBack">,
) {
    useMarcherOrderStore.setState({
        sweep: {
            ...sweep,
            picked: [],
            pointer: null,
            following: false,
            takenBack: [],
        },
    });
}

/** Picks and the pointer, as the sweep goes */
export function updateOrderSweep(
    change: Partial<
        Pick<OrderSweep, "picked" | "pointer" | "following" | "takenBack">
    >,
) {
    const { sweep } = useMarcherOrderStore.getState();
    if (!sweep) return;
    useMarcherOrderStore.setState({ sweep: { ...sweep, ...change } });
}

/**
 * Backspace while Set order is on (owner, 2026-11-17): the marcher picked last is taken back, and
 * can be swept again once the pointer has left it. False when nobody is picked.
 */
export function takeBackLastPick(): boolean {
    const { sweep } = useMarcherOrderStore.getState();
    const last = sweep?.picked.at(-1);
    if (!sweep || last === undefined) return false;
    useMarcherOrderStore.setState({
        sweep: {
            ...sweep,
            picked: sweep.picked.slice(0, -1),
            takenBack: [...sweep.takenBack.filter((id) => id !== last), last],
        },
    });
    return true;
}

/** Leaves Set order with nothing kept (Escape, Cancel). True when it was on */
export function cancelOrderSweep(): boolean {
    if (!useMarcherOrderStore.getState().sweep) return false;
    useMarcherOrderStore.setState({ sweep: null });
    return true;
}

/**
 * Leaves Set order: the order it ends with (those picked, then the skipped in the order they had),
 * or null when nobody was picked and nothing is kept. Writing it is the caller's
 */
export function endOrderSweep(): {
    order: number[];
    beat: number;
    at: ReadonlyMap<number, XY>;
} | null {
    const { sweep } = useMarcherOrderStore.getState();
    useMarcherOrderStore.setState({ sweep: null });
    if (!sweep || sweep.picked.length === 0) return null;
    return {
        order: orderAfterSweep({
            picked: sweep.picked,
            before: sweep.before,
            selected: sweep.ids,
        }),
        beat: sweep.beat,
        at: sweep.at,
    };
}

/** The marchers Set order is on, which stay in focus while everyone else fades; null when it's off */
export const useOrderSweepFocus = (): readonly number[] | null =>
    useMarcherOrderStore((s) => s.sweep?.ids ?? null);
