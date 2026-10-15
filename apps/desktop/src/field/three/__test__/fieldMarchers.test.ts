import { describe, expect, it } from "vitest";
import type { PositionSource } from "@/timeline/positionBuffer";
import { FieldMarchers } from "../fieldMarchers";

/** Marchers at (id * 10 + beat, id * 100), until `ready` turns off. */
const source = (ids: number[]) => {
    const state = { ids, ready: true };
    const positionSource: PositionSource = {
        marcherIds: () => state.ids,
        positionsAt(beat, out) {
            if (!state.ready) return false;
            state.ids.forEach((id, i) => {
                out[i * 2] = id * 10 + beat;
                out[i * 2 + 1] = id * 100;
            });
            return true;
        },
    };
    return { state, positionSource };
};

describe("FieldMarchers", () => {
    it("holds every marcher's position at the last beat filled", () => {
        const { positionSource } = source([1, 2]);
        const marchers = new FieldMarchers(positionSource);
        expect(marchers.fill(3)).toBe(true);
        expect(marchers.ids).toEqual([1, 2]);
        expect(Array.from(marchers.positions)).toEqual([13, 100, 23, 200]);
    });

    it("bumps the version on each fill, and the ids version only when the marchers change", () => {
        const { state, positionSource } = source([1, 2]);
        const marchers = new FieldMarchers(positionSource);
        marchers.fill(0);
        const { version, idsVersion } = marchers;
        marchers.fill(1);
        expect(marchers.version).toBe(version + 1);
        expect(marchers.idsVersion).toBe(idsVersion);
        state.ids = [1, 2, 3];
        marchers.fill(1);
        expect(marchers.idsVersion).toBe(idsVersion + 1);
        expect(marchers.positions).toHaveLength(6);
    });

    it("keeps what's drawn when the resolver isn't ready", () => {
        const { state, positionSource } = source([1]);
        const marchers = new FieldMarchers(positionSource);
        marchers.fill(2);
        const version = marchers.version;
        state.ready = false;
        expect(marchers.fill(5)).toBe(false);
        expect(marchers.version).toBe(version);
        expect(marchers.ids).toEqual([1]);
        expect(Array.from(marchers.positions)).toEqual([12, 100]);
    });
});
