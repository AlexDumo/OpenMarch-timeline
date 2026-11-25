/**
 * A set drawn from atlases already composed (`peekFlatsResources`) is held for the marchers in the
 * commit that draws it, not after paint (fork #1257 hardening, re-review of #1298). An A → none →
 * A switch passes straight through `useSettledFlatsWear`, so nothing else holds A then: a dispose
 * timer left from letting go of A could free it between the draw and a passive effect.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
    SAMPLE_FLATS,
    type FlatsWear,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";

/** The atlas cache: held counts, composed atlases, and frees waiting for their timer */
const atlases = vi.hoisted(() => {
    const entries = new Map<
        string,
        { refs: number; done: boolean; freed: boolean }
    >();
    const entry = (k: string) => {
        let e = entries.get(k);
        if (!e) entries.set(k, (e = { refs: 0, done: false, freed: false }));
        return e;
    };
    return {
        entries,
        entry,
        acquire: (id: string, body: string) => {
            const e = entry(`${id}|${body}`);
            e.refs++;
            e.freed = false;
            return Promise.resolve().then(() => {
                e.done = true;
                return { id };
            });
        },
        release: (id: string, body: string) => {
            entry(`${id}|${body}`).refs--;
        },
        /** The dispose timers fire: every atlas nobody holds is freed */
        fireTimers: () => {
            for (const e of entries.values())
                if (e.refs <= 0 && e.done) e.freed = true;
        },
    };
});

vi.mock("../flatsAtlas", () => ({
    acquireFlats: atlases.acquire,
    releaseFlats: atlases.release,
    loadFlatsLut: () => Promise.resolve({}),
    loadFlatsGeometry: () => Promise.resolve({ layout: {} }),
    peekFlatsResources: (id: string, body: string) => {
        const e = atlases.entries.get(`${id}|${body}`);
        return e?.done && !e.freed
            ? { atlas: { id }, lut: {}, layout: {} }
            : null;
    },
}));

const { useMarcherFlats } = await import("../useMarcherFlats");
const { useSettledFlatsWear } =
    await import("@/view3d/window/uniformPack/useSettledFlatsWear");

const A = `library:cadets@${"a".repeat(64)}#home` as UniformPackValue;
const wearA: FlatsWear = { key: A, look: SAMPLE_FLATS.look };
const look = (artwork: string) =>
    ({
        uniform: { options: { artwork } },
        body: { bodyType: "average", heightClass: 0 },
    }) as never;

describe("a peeked atlas and useSettledFlatsWear", () => {
    it("holds the art it draws from the commit that draws it, through an A → none → A switch", async () => {
        /** Each commit's drawn atlases that nothing held at the end of it */
        const notHeld: string[] = [];
        const cache = {
            acquire: atlases.acquire,
            release: atlases.release,
        };
        const { rerender } = renderHook(
            ({ wanted }: { wanted: FlatsWear | null }) => {
                // as Performers does: the settled wear, then the marchers' art from it
                const settled = useSettledFlatsWear(
                    wanted,
                    wanted ? "average" : "",
                    32,
                    cache,
                );
                const flats = useMarcherFlats(
                    settled ? [look(settled.key)] : [],
                    "high",
                );
                // after useMarcherFlats' own layout effect, in the same commit
                useLayoutEffect(() => {
                    for (const key of flats.keys())
                        if ((atlases.entries.get(key)?.refs ?? 0) <= 0)
                            notHeld.push(key);
                });
                return flats;
            },
            { initialProps: { wanted: wearA as FlatsWear | null } },
        );
        // A composes and goes on the marchers
        await act(async () => {
            await Promise.resolve();
        });
        expect(atlases.entries.get(`${A}|average`)?.done).toBe(true);
        // to no wear: the marchers let go of A, and its dispose timer starts
        rerender({ wanted: null });
        expect(atlases.entries.get(`${A}|average`)?.refs).toBe(0);
        // back to A before the timer fires: drawn at once from the composed atlas
        rerender({ wanted: wearA });
        // the timer fires straight after the draw's commit
        atlases.fireTimers();
        expect(notHeld).toEqual([]);
        expect(atlases.entries.get(`${A}|average`)?.freed).toBe(false);
        await act(async () => {
            await Promise.resolve();
        });
    });
});
