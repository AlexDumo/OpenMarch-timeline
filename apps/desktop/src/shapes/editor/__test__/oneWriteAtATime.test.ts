import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacedBox } from "@/shapes/placed/placedBox";
import { oneWriteAtATime } from "../editTargets";

/**
 * A placed shape's writes (#432): presses during a write wait for the box read back, however slow
 * that is, so two quick Alt+R presses make a half turn even on a busy machine.
 */
describe("oneWriteAtATime", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const box = { recipe: { id: 1 } } as unknown as PlacedBox;
    const setup = () => {
        const writing = { current: null as PlacedBox | null };
        const queued = { current: [] as ((p: unknown) => unknown)[] };
        return {
            writing,
            queued,
            write: oneWriteAtATime(writing, queued, box),
        };
    };

    it("keeps the waiting changes past a second after the save, while the box isn't read back yet", async () => {
        const { writing, queued, write } = setup();
        write(() => Promise.resolve());
        queued.current.push((p) => p);
        await vi.advanceTimersByTimeAsync(1500);
        expect(writing.current).toBe(box);
        expect(queued.current).toHaveLength(1);
    });

    it("drops them if the box never comes back", async () => {
        const { writing, queued, write } = setup();
        write(() => Promise.resolve());
        queued.current.push((p) => p);
        await vi.advanceTimersByTimeAsync(5000);
        expect(writing.current).toBeNull();
        expect(queued.current).toEqual([]);
    });

    it("drops them at once when the write fails", async () => {
        const { writing, queued, write } = setup();
        write(() => Promise.reject(new Error("no")));
        queued.current.push((p) => p);
        await vi.advanceTimersByTimeAsync(0);
        expect(writing.current).toBeNull();
        expect(queued.current).toEqual([]);
    });

    it("starts no second write while one is under way", () => {
        const { write } = setup();
        const run = vi.fn(() => new Promise<void>(() => {}));
        write(run);
        write(run);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
