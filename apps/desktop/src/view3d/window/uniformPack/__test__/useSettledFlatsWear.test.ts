/**
 * A mode switch changes the band's art and colors together (fork #1257 step 5): the new wear
 * reaches the marchers only once its atlases are composed for the body types wearing flats.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { SAMPLE_FLATS } from "@/view3d/core/marchers/uniformArtwork";
import type {
    FlatsWear,
    UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import { useSettledFlatsWear, type FlatsCache } from "../useSettledFlatsWear";

vi.mock("../../performers/marchers/flatsAtlas", () => ({
    acquireFlats: vi.fn(),
    releaseFlats: vi.fn(),
}));

const pack = `library:cadets@${"a".repeat(64)}` as UniformPackValue;
const wear = (mode: string, primary: number): FlatsWear => ({
    key: `${pack}#${mode}` as UniformPackValue,
    look: {
        ...SAMPLE_FLATS.look,
        colors: { ...SAMPLE_FLATS.look.colors, primary },
    },
});

/** A cache whose atlases finish when the test says */
function cache() {
    const pending = new Map<string, () => void>();
    const held = new Map<string, number>();
    const c: FlatsCache = {
        acquire: (id, body) => {
            const k = `${id}|${body}`;
            held.set(k, (held.get(k) ?? 0) + 1);
            return new Promise<void>((done) => pending.set(k, done));
        },
        release: (id, body) => {
            const k = `${id}|${body}`;
            held.set(k, (held.get(k) ?? 0) - 1);
        },
    };
    return { c, pending, held };
}

describe("useSettledFlatsWear", () => {
    it("keeps the previous mode's wear, palette included, until the new atlases are ready", async () => {
        const { c, pending, held } = cache();
        const plain = wear("plain-0001", 0x111111);
        const sash = wear("sash-out-0002", 0x222222);
        const { result, rerender } = renderHook(
            ({ w }) => useSettledFlatsWear(w, "average,tall", 32, c),
            { initialProps: { w: plain } },
        );
        expect(result.current).toBe(plain);
        rerender({ w: sash });
        // composing: the marchers keep plain's art and colors
        expect(result.current).toBe(plain);
        expect([...pending.keys()].sort()).toEqual([
            `${sash.key}|average`,
            `${sash.key}|tall`,
        ]);
        await act(async () => pending.get(`${sash.key}|average`)!());
        expect(result.current).toBe(plain);
        await act(async () => pending.get(`${sash.key}|tall`)!());
        // both ready: art and colors switch together, and the hold lets go
        expect(result.current).toBe(sash);
        expect([...held.values()].every((n) => n === 0)).toBe(true);
    });

    it("passes the first wear, no wear, and wears nobody has on straight through", () => {
        const { c, pending } = cache();
        const plain = wear("plain-0001", 0x111111);
        const { result, rerender } = renderHook(
            ({ w, bodies }) => useSettledFlatsWear(w, bodies, 32, c),
            {
                initialProps: {
                    w: null as FlatsWear | null,
                    bodies: "average",
                },
            },
        );
        rerender({ w: plain, bodies: "average" });
        expect(result.current).toBe(plain);
        rerender({ w: null, bodies: "average" });
        expect(result.current).toBeNull();
        rerender({ w: plain, bodies: "" });
        rerender({ w: wear("sash-out-0002", 0x222222), bodies: "" });
        expect(result.current?.key).toBe(`${pack}#sash-out-0002`);
        expect(pending.size).toBe(0);
    });

    it("hands the wear on even when composing fails, so the colors never stick", async () => {
        const plain = wear("plain-0001", 0x111111);
        const sash = wear("sash-out-0002", 0x222222);
        const c: FlatsCache = {
            acquire: () => Promise.reject(new Error("no atlas")),
            release: () => undefined,
        };
        const { result, rerender } = renderHook(
            ({ w }) => useSettledFlatsWear(w, "average", 32, c),
            { initialProps: { w: plain } },
        );
        rerender({ w: sash });
        await act(async () => undefined);
        expect(result.current).toBe(sash);
    });
});
