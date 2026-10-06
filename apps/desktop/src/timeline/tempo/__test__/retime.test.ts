import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
    applyTaps,
    countTimes,
    durationsFromTimes,
    holdCount,
    keepSyncedAfter,
    MAX_COUNT_SECONDS,
    MIN_COUNT_SECONDS,
    moveCount,
    respaceEven,
    respaceProportional,
    scaleRange,
    setRangeBpm,
    spanLimits,
} from "../retime";

const EPS = 1e-9;
/** A show: the fixed zero-length beat 0, then `n` counts of `d` seconds. */
const steady = (n: number, d = 0.5) => [0, ...Array<number>(n).fill(d)];

const expectClose = (
    actual: readonly number[],
    expected: readonly number[],
) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
};

/** Durations of counts 1..n, each within the limits, with beat 0 in front. */
const showArb = (min = 2, max = 40) =>
    fc
        .array(fc.double({ min: 0.2, max: 3, noNaN: true }), {
            minLength: min,
            maxLength: max,
        })
        .map((ds) => [0, ...ds]);

describe("countTimes / durationsFromTimes", () => {
    it("starts every show at 0 and ends at the total", () => {
        expect(countTimes([0, 0.5, 0.25])).toEqual([0, 0, 0.5, 0.75]);
    });
    it("round-trips", () => {
        fc.assert(
            fc.property(showArb(), (ds) => {
                expectClose(durationsFromTimes(countTimes(ds)), ds);
            }),
        );
    });
});

describe("respacing", () => {
    it("proportional keeps relative lengths", () => {
        const out = respaceProportional([0, 1, 2, 1, 5], 1, 4, 2);
        expectClose(out, [0, 0.5, 1, 0.5, 5]);
    });
    it("proportional falls back to even for zero-length counts", () => {
        expectClose(
            respaceProportional([0, 0, 0, 1], 1, 3, 1),
            [0, 0.5, 0.5, 1],
        );
    });
    it("even spaces evenly", () => {
        expectClose(respaceEven([0, 1, 2, 3], 1, 3, 1), [0, 0.5, 0.5, 3]);
    });
    it("scaleRange multiplies and setRangeBpm is exact", () => {
        expectClose(scaleRange([0, 1, 2], 1, 3, 1.5), [0, 1.5, 3]);
        const ds = setRangeBpm(steady(4), 1, 5, 152.5);
        for (let i = 1; i < 5; i++) expect(ds[i]).toBe(60 / 152.5);
        const rel = setRangeBpm([0, 1, 2], 1, 3, 60, { keepRelative: true });
        expectClose(rel, [0, 2 / 3, 4 / 3]);
    });
    it("rejects bad ranges", () => {
        expect(() => respaceEven([0, 1], 1, 3, 1)).toThrow(RangeError);
        expect(() => scaleRange([0, 1], 0, 1, 0)).toThrow(RangeError);
    });
    it("spanLimits always allows the current span", () => {
        fc.assert(
            fc.property(showArb(), (ds) => {
                const [lo, hi] = spanLimits(ds, 1, ds.length);
                const span = ds.slice(1).reduce((a, b) => a + b, 0);
                expect(lo).toBeLessThanOrEqual(span + EPS);
                expect(hi).toBeGreaterThanOrEqual(span - EPS);
            }),
        );
    });
});

describe("moveCount", () => {
    it("scales left and moves right when nothing later is synced", () => {
        // 8 counts of 0.5 s; move count 5 (at 2 s) to 2.4 s
        const r = moveCount({ durations: steady(8), index: 5, toTime: 2.4 });
        expect(r.clamped).toBe(false);
        expectClose(r.durations.slice(1, 5), [0.6, 0.6, 0.6, 0.6]);
        expectClose(r.durations.slice(5), [0.5, 0.5, 0.5, 0.5]);
        expect(r.effect.shifted?.from).toBe(5);
        expect(r.effect.shifted?.bySeconds).toBeCloseTo(0.4, 9);
        expect(r.effect.heldFrom).toBeNull();
        expect(r.originShift).toBe(0);
    });

    it("re-spaces from the previous synced count and up to the next", () => {
        const r = moveCount({
            durations: steady(8),
            index: 5,
            toTime: 2.4,
            synced: [3, 7],
        });
        const t = countTimes(r.durations);
        expect(t[3]).toBeCloseTo(1, 9);
        expect(t[5]).toBeCloseTo(2.4, 9);
        expect(t[7]).toBeCloseTo(3, 9);
        expectClose(r.durations.slice(1, 3), [0.5, 0.5]);
        expect(r.effect.respaced).toEqual([
            { from: 3, to: 5 },
            { from: 5, to: 7 },
        ]);
        expect(r.effect.heldFrom).toBe(7);
        expect(r.effect.shifted).toBeNull();
    });

    it("shift overrides a later synced count", () => {
        const r = moveCount({
            durations: steady(8),
            index: 5,
            toTime: 2.4,
            synced: [7],
            after: "shift",
        });
        expect(countTimes(r.durations)[7]).toBeCloseTo(3.4, 9);
    });

    it("keeps a hold when re-spacing", () => {
        const ds = [0, 0.5, 2, 0.5, 0.5];
        const r = moveCount({ durations: ds, index: 4, toTime: 6 });
        // span 3 -> 6: everything doubles, the hold stays four times as long
        expectClose(r.durations, [0, 1, 4, 1, 0.5]);
    });

    it("clamps at 400 BPM and reports why", () => {
        const r = moveCount({ durations: steady(8), index: 5, toTime: 0.1 });
        expect(r.clamped).toBe(true);
        expect(r.clampReason).toBe("minCount");
        expect(r.clampSide).toBe("before");
        expect(r.time).toBeCloseTo(4 * MIN_COUNT_SECONDS, 9);
    });

    it("clamps against the counts up to the next synced count", () => {
        const r = moveCount({
            durations: steady(8),
            index: 5,
            toTime: 2.45,
            synced: [6],
        });
        expect(r.clampReason).toBe("minCount");
        expect(r.clampSide).toBe("after");
        expect(countTimes(r.durations)[6]).toBeCloseTo(2.5, 9);
        expect(r.durations[5]).toBeCloseTo(MIN_COUNT_SECONDS, 9);
    });

    it("clamps long counts", () => {
        const r = moveCount({ durations: steady(2), index: 2, toTime: 1000 });
        expect(r.clampReason).toBe("maxCount");
        expect(r.durations[1]).toBeCloseTo(MAX_COUNT_SECONDS, 9);
    });

    it("moving count 1 is an origin shift", () => {
        const r = moveCount({ durations: steady(8), index: 1, toTime: 0.8 });
        expect(r.originShift).toBeCloseTo(0.8, 9);
        expectClose(r.durations, steady(8));
        const held = moveCount({
            durations: steady(8),
            index: 1,
            toTime: 1,
            synced: [5],
        });
        // count 5 was at 2 s; in the new show time it's at 2 - 1 = 1 s
        expect(countTimes(held.durations)[5]).toBeCloseTo(1, 9);
        expect(held.originShift).toBe(1);
    });

    it("properties: length kept, beat 0 kept, synced counts stay, limits held", () => {
        fc.assert(
            fc.property(
                showArb(3),
                fc.nat(),
                fc.double({ min: -5, max: 100, noNaN: true }),
                fc.array(fc.nat(), { maxLength: 5 }),
                (ds, i, toTime, syncedRaw) => {
                    const index = 1 + (i % (ds.length - 1));
                    const synced = syncedRaw.map((s) => 1 + (s % ds.length));
                    const before = countTimes(ds);
                    const r = moveCount({
                        durations: ds,
                        index,
                        toTime,
                        synced,
                    });
                    expect(r.durations).toHaveLength(ds.length);
                    expect(r.durations[0]).toBe(0);
                    const after = countTimes(r.durations);
                    for (const s of synced) {
                        if (s === index) continue;
                        // synced counts keep their place in the music
                        expect(after[s] + r.originShift).toBeCloseTo(
                            before[s],
                            6,
                        );
                    }
                    for (let k = 1; k < ds.length; k++) {
                        expect(r.durations[k]).toBeGreaterThanOrEqual(
                            Math.min(MIN_COUNT_SECONDS, ds[k]) - EPS,
                        );
                        expect(r.durations[k]).toBeLessThanOrEqual(
                            Math.max(MAX_COUNT_SECONDS, ds[k]) + EPS,
                        );
                    }
                    if (!r.clamped)
                        expect(after[index] + r.originShift).toBeCloseTo(
                            toTime,
                            6,
                        );
                },
            ),
        );
    });
});

describe("moveCount respaceFrom", () => {
    it("re-spaces back to respaceFrom when it is after the previous synced count", () => {
        const d = steady(16);
        const r = moveCount({
            durations: d,
            index: 13,
            toTime: 7,
            respaceFrom: 9,
        });
        expect(r.effect.respaced[0]).toEqual({ from: 9, to: 13 });
        expectClose(r.durations.slice(0, 9), d.slice(0, 9));
        expect(countTimes(r.durations)[13]).toBeCloseTo(7, 9);
    });
    it("is ignored when a synced count is later, or when it isn't before the count", () => {
        const d = steady(16);
        expect(
            moveCount({
                durations: d,
                index: 13,
                toTime: 7,
                synced: [11],
                respaceFrom: 9,
            }).effect.respaced[0],
        ).toEqual({ from: 11, to: 13 });
        expect(
            moveCount({ durations: d, index: 13, toTime: 7, respaceFrom: 13 })
                .effect.respaced[0],
        ).toEqual({ from: 1, to: 13 });
    });
    it("keeps every count before respaceFrom exactly (property)", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 3, max: 30 }),
                fc.double({ min: -2, max: 2, noNaN: true }),
                (index, by) => {
                    const d = steady(32);
                    const from = index - 2;
                    const r = moveCount({
                        durations: d,
                        index,
                        toTime: countTimes(d)[index] + by,
                        respaceFrom: from,
                    });
                    for (let i = 0; i < from; i++)
                        expect(r.durations[i]).toBe(d[i]);
                },
            ),
        );
    });
});

describe("holdCount absorbUntil", () => {
    it("absorbs the hold up to absorbUntil when it comes before the next synced count", () => {
        const d = steady(16);
        const r = holdCount({
            durations: d,
            index: 3,
            newDuration: 1,
            absorbUntil: 9,
        });
        expect(r.effect.heldFrom).toBe(9);
        expectClose(r.durations.slice(9), d.slice(9));
        expect(countTimes(r.durations)[9]).toBeCloseTo(4, 9);
    });
    it("falls back to the next synced count when absorbUntil leaves no room", () => {
        const d = steady(16);
        expect(
            holdCount({
                durations: d,
                index: 3,
                newDuration: 1,
                absorbUntil: 4,
                synced: [12],
            }).effect.heldFrom,
        ).toBe(12);
        expect(
            holdCount({
                durations: d,
                index: 3,
                newDuration: 1,
                absorbUntil: 9,
                after: "shift",
            }).effect.heldFrom,
        ).toBeNull();
    });
});

describe("holdCount", () => {
    it("shifts later counts with nothing synced", () => {
        const r = holdCount({ durations: steady(6), index: 3, newDuration: 2 });
        expectClose(r.durations, [0, 0.5, 0.5, 2, 0.5, 0.5, 0.5]);
        expect(r.effect.shifted).toEqual({ from: 4, bySeconds: 1.5 });
    });
    it("is absorbed by the counts up to the next synced count", () => {
        const r = holdCount({
            durations: steady(6),
            index: 2,
            newDuration: 0.8,
            synced: [5],
        });
        const t = countTimes(r.durations);
        expect(r.durations[2]).toBeCloseTo(0.8, 9);
        expect(t[5]).toBeCloseTo(2, 9);
        expect(r.effect.heldFrom).toBe(5);
    });
    it("has no room right before a synced count", () => {
        const r = holdCount({
            durations: steady(6),
            index: 4,
            newDuration: 1,
            synced: [5],
        });
        expect(r.clamped).toBe(true);
        expect(r.durations[4]).toBeCloseTo(0.5, 9);
    });
    it("clamps to the limits", () => {
        const r = holdCount({
            durations: steady(3),
            index: 1,
            newDuration: 0.01,
        });
        expect(r.durations[1]).toBeCloseTo(MIN_COUNT_SECONDS, 9);
        expect(r.clampReason).toBe("minCount");
    });
});

describe("applyTaps", () => {
    it("pins each tap and re-spaces between them", () => {
        const r = applyTaps({
            durations: steady(12),
            taps: [
                { index: 5, time: 2.2 },
                { index: 9, time: 4.6 },
            ],
        });
        const t = countTimes(r.durations);
        expect(t[5]).toBeCloseTo(2.2, 9);
        expect(t[9]).toBeCloseTo(4.6, 9);
        expectClose(r.durations.slice(9), [0.5, 0.5, 0.5, 0.5]);
        expect(r.clamped).toBe(false);
        expect(r.effect.shifted?.from).toBe(9);
    });
    it("taps on count 1 shift the origin", () => {
        const r = applyTaps({
            durations: steady(8),
            taps: [
                { index: 1, time: 1.5 },
                { index: 5, time: 3.3 },
            ],
        });
        expect(r.originShift).toBeCloseTo(1.5, 9);
        expect(countTimes(r.durations)[5]).toBeCloseTo(1.8, 9);
    });
    it("re-spaces to the next synced count after the last tap", () => {
        const r = applyTaps({
            durations: steady(12),
            taps: [{ index: 3, time: 1.2 }],
            synced: [9],
        });
        expect(countTimes(r.durations)[9]).toBeCloseTo(4, 9);
        expect(r.effect.heldFrom).toBe(9);
    });
    it("count unit spaces a missed tap evenly", () => {
        const ds = [0, 0.5, 1.5, 0.5, 0.5];
        const r = applyTaps({
            durations: ds,
            taps: [
                { index: 1, time: 0 },
                { index: 3, time: 1 },
            ],
            unit: "count",
        });
        expectClose(r.durations.slice(1, 3), [0.5, 0.5]);
    });
    it("clamps a tap that comes before the previous one", () => {
        const r = applyTaps({
            durations: steady(8),
            taps: [
                { index: 3, time: 2 },
                { index: 4, time: 1.5 },
            ],
        });
        expect(r.clampedTaps).toEqual([4]);
        expect(r.durations[3]).toBeCloseTo(MIN_COUNT_SECONDS, 9);
    });
    it("properties: limits held and no counts added", () => {
        fc.assert(
            fc.property(
                showArb(4),
                fc.array(
                    fc.record({
                        i: fc.nat(),
                        time: fc.double({ min: -2, max: 60, noNaN: true }),
                    }),
                    { minLength: 1, maxLength: 6 },
                ),
                fc.array(fc.nat(), { maxLength: 3 }),
                (ds, rawTaps, syncedRaw) => {
                    const taps = rawTaps.map(({ i, time }) => ({
                        index: 1 + (i % (ds.length - 1)),
                        time,
                    }));
                    const synced = syncedRaw.map((s) => 1 + (s % ds.length));
                    const r = applyTaps({ durations: ds, taps, synced });
                    expect(r.durations).toHaveLength(ds.length);
                    expect(r.durations[0]).toBe(0);
                    for (let k = 1; k < ds.length; k++) {
                        expect(r.durations[k]).toBeGreaterThanOrEqual(
                            Math.min(MIN_COUNT_SECONDS, ds[k]) - EPS,
                        );
                        expect(r.durations[k]).toBeLessThanOrEqual(
                            Math.max(MAX_COUNT_SECONDS, ds[k]) + EPS,
                        );
                    }
                    const t = countTimes(r.durations);
                    for (const tap of r.taps)
                        expect(t[tap.index] + r.originShift).toBeCloseTo(
                            tap.time,
                            6,
                        );
                },
            ),
        );
    });
});

describe("keepSyncedAfter", () => {
    it("holds the next synced count after a typed tempo", () => {
        const before = steady(12);
        const edited = setRangeBpm(before, 1, 5, 100);
        const r = keepSyncedAfter({ before, edited, from: 5, synced: [9] });
        expect(countTimes(r.durations)[9]).toBeCloseTo(4, 9);
        expectClose(r.durations.slice(1, 5), edited.slice(1, 5));
        expect(r.effect.heldFrom).toBe(9);
    });
    it("shifts without a synced count", () => {
        const before = steady(6);
        const edited = setRangeBpm(before, 1, 3, 60);
        const r = keepSyncedAfter({ before, edited, from: 3 });
        expectClose(r.durations, edited);
        expect(r.effect.shifted).toEqual({ from: 3, bySeconds: 1 });
    });
});
