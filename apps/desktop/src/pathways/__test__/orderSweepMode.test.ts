// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { OrderSweepMode } from "../orderSweepMode";
import {
    cancelOrderSweep,
    endOrderSweep,
    openOrderSweep,
    takeBackLastPick,
    useMarcherOrderStore,
} from "../marcherOrderStore";
import type { XY } from "../orderSweep";

/**
 * Set order's field mode (pathways step 4g, DL-27): a drag that picks someone keeps the order at
 * its release; a drag that picks no one leaves it on; a click starts following the pointer with the
 * button up, and a second click keeps the order (owner, 2026-11-17); a cancelled press keeps nothing.
 * The node environment has no animation frames, so each move is worked out at once.
 */

/** Four marchers in a row, 12 apart: ids 1–4 left to right */
const ROW = new Map<number, XY>(
    [1, 2, 3, 4].map((id) => [id, { x: id * 12, y: 0 }]),
);

const at = (x: number, y = 0): FieldPointer => ({
    field: { x, y },
    screen: { x, y },
    button: 0,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    kind: "mouse",
});
const CLICK = { double: false, ownFirst: false };
const sweep = () => useMarcherOrderStore.getState().sweep;

const open = () => {
    openOrderSweep({ ids: [1, 2, 3, 4], at: ROW, beat: 17, before: null });
    const finish = vi.fn();
    return { mode: new OrderSweepMode(finish), finish };
};

afterEach(() => void cancelOrderSweep());

describe("OrderSweepMode", () => {
    it("claims presses only while Set order is on", () => {
        const { mode } = open();
        expect(mode.claims()).toBe(true);
        cancelOrderSweep();
        expect(mode.claims()).toBe(false);
    });

    it("a drag through the marchers picks them in the order passed, and its release keeps the order", () => {
        const { mode, finish } = open();
        mode.press(at(48));
        mode.move(at(30));
        mode.move(at(12));
        expect(sweep()!.picked).toEqual([4, 3, 2, 1]);
        expect(sweep()!.pointer).toEqual({ x: 12, y: 0 });
        mode.release(at(12), null);
        expect(finish).toHaveBeenCalledTimes(1);
        expect(sweep()!.pointer).toBeNull();
    });

    it("a drag that passes no one leaves Set order on, with nothing kept", () => {
        const { mode, finish } = open();
        mode.press(at(30, 100));
        mode.move(at(60, 100));
        mode.release(at(60, 100), null);
        expect(finish).not.toHaveBeenCalled();
        expect(sweep()).not.toBeNull();
        expect(sweep()!.picked).toEqual([]);
    });

    it("click, then move (owner, 2026-11-17): the click picks the marcher under it, the button-up moves pick whoever they pass, and a second click keeps the order", () => {
        const { mode, finish } = open();
        mode.press(at(24));
        mode.release(at(24), CLICK);
        expect(sweep()!.picked).toEqual([2]);
        expect(sweep()!.following).toBe(true);
        expect(finish).not.toHaveBeenCalled();
        // Moving with the button up picks as a drag does; the line follows the pointer
        mode.cursorAt(at(30));
        mode.cursorAt(at(36));
        expect(sweep()!.picked).toEqual([2, 3]);
        expect(sweep()!.pointer).toEqual({ x: 36, y: 0 });
        // A second click keeps the order, picking what's under it
        mode.cursorAt(at(48, 30));
        mode.press(at(48));
        mode.release(at(48), CLICK);
        expect(sweep()!.picked).toEqual([2, 3, 4]);
        expect(finish).toHaveBeenCalledTimes(1);
        expect(sweep()!.following).toBe(false);
    });

    it("following, the press picks only what's under it, not the jump from the last point (a finger put down elsewhere)", () => {
        const { mode, finish } = open();
        mode.press(at(12));
        mode.release(at(12), CLICK);
        mode.press(at(48));
        mode.release(at(48), CLICK);
        expect(sweep()!.picked).toEqual([1, 4]);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("button-up moves pick no one before the first click, or after a drag that picked no one", () => {
        const { mode, finish } = open();
        mode.cursorAt(at(12));
        mode.cursorAt(at(48));
        expect(sweep()!.picked).toEqual([]);
        expect(sweep()!.pointer).toBeNull();
        mode.press(at(30, 100));
        mode.move(at(60, 100));
        mode.release(at(60, 100), null);
        mode.cursorAt(at(12));
        expect(sweep()!.picked).toEqual([]);
        expect(finish).not.toHaveBeenCalled();
    });

    it("press, hold and drag still keeps the order at the release after a click started following", () => {
        const { mode, finish } = open();
        mode.press(at(12));
        mode.release(at(12), CLICK);
        mode.press(at(24));
        mode.move(at(36));
        mode.release(at(36), null);
        expect(sweep()!.picked).toEqual([1, 2, 3]);
        expect(finish).toHaveBeenCalledTimes(1);
    });

    it("Backspace takes the newest pick back, newest first; one taken back waits until the pointer has left it", () => {
        const { mode } = open();
        mode.press(at(12));
        mode.release(at(12), CLICK);
        mode.cursorAt(at(36));
        expect(sweep()!.picked).toEqual([1, 2, 3]);
        expect(takeBackLastPick()).toBe(true);
        expect(takeBackLastPick()).toBe(true);
        expect(sweep()!.picked).toEqual([1]);
        // The pointer still on M3: a small move doesn't bring it straight back
        mode.cursorAt(at(37));
        expect(sweep()!.picked).toEqual([1]);
        // Away and back: swept again, in the new order
        mode.cursorAt(at(36, 40));
        mode.cursorAt(at(36));
        expect(sweep()!.picked).toEqual([1, 3]);
        mode.cursorAt(at(24));
        expect(sweep()!.picked).toEqual([1, 3, 2]);
        // Nobody left to take back: nothing happens
        for (let i = 0; i < 3; i++) takeBackLastPick();
        expect(takeBackLastPick()).toBe(false);
        expect(sweep()!.picked).toEqual([]);
    });

    it("Enter keeps what's picked, the rest after in the order they had; Escape keeps nothing", () => {
        const first = open();
        first.mode.press(at(36));
        first.mode.release(at(36), CLICK);
        expect(endOrderSweep()).toMatchObject({ order: [3, 1, 2, 4] });
        expect(sweep()).toBeNull();
        const again = open();
        again.mode.press(at(36));
        again.mode.release(at(36), CLICK);
        expect(cancelOrderSweep()).toBe(true);
        expect(sweep()).toBeNull();
    });

    it("a cancelled press keeps nothing more and leaves Set order on; moves after it pick no one", () => {
        const { mode, finish } = open();
        mode.press(at(12));
        mode.move(at(24));
        expect(sweep()!.picked).toEqual([1, 2]);
        mode.cancel();
        expect(sweep()!.pointer).toBeNull();
        mode.move(at(48));
        expect(sweep()!.picked).toEqual([1, 2]);
        expect(finish).not.toHaveBeenCalled();
        expect(sweep()).not.toBeNull();
    });
});
