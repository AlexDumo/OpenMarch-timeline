/**
 * Pins, pathways step 5 (spec Appendix M: R-15 with pins, R-14′ with pins, T-6, D-PIN, M-COUNTS).
 * The cached resolver, the package's oracle and the independent copy in `docs/timeline/ref` read
 * the same timing; QA-PIN-1 to QA-PIN-7.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
// @ts-expect-error: the spec's reference implementation is plain JavaScript
import { makeOracle } from "../../../../../docs/timeline/ref/oracle.mjs";
import {
    clockBeatAt,
    clockPlace,
    createResolver,
    createTimelineOracleForTesting,
    groupSchedule,
    placeOnCounts,
    routeClock,
    type AdjustProfile,
    type RouteGeometry,
    type RoutePin,
    type RouteTiming,
    type TimelineSnapshot,
    walkedPath,
    walkedPathPointAt,
    WALKED_SAMPLE_TOLERANCE,
    type XY,
} from "../index";

const timing = (...pins: RoutePin[]): RouteTiming => ({ v: 1, pins });
const pin = (point: string, at: number): RoutePin => ({ point, at });

/** One marcher walking its own path over `[0, c)` from `from` to `to` */
function ownShow(
    geometry: RouteGeometry,
    t: RouteTiming | null,
    c = 16,
): TimelineSnapshot {
    return {
        marchers: [{ id: 1, home: geometry.from }],
        shapes: {},
        transitions: {
            1: {
                id: 1,
                start: 0,
                end: c,
                dest: null,
                points: [geometry.to],
                slots: 1,
                style: "direct",
                order: "slot",
                params: null,
            },
        },
        assignments: [
            {
                id: 1,
                marcher: 1,
                transition: 1,
                slot: 0,
                start: 0,
                end: c,
                layer: 0,
            },
        ],
        routes: { 1: { geometry, ...(t ? { timing: t } : {}) } },
        lanes: { 1: { transition: 1, slot: 0, route: 1, offset: null } },
    };
}

/** Two members of a group path over `[0, c)`, 10 apart; the second may carry an Adjust */
function groupShow(
    geometry: RouteGeometry,
    t: RouteTiming | null,
    adjust: AdjustProfile | null = null,
    c = 16,
): TimelineSnapshot {
    const [fx, fy] = geometry.from;
    const [gx, gy] = geometry.to;
    return {
        marchers: [
            { id: 1, home: [fx, fy - 5] },
            { id: 2, home: [fx, fy + 5] },
        ],
        shapes: {},
        transitions: {
            1: {
                id: 1,
                start: 0,
                end: c,
                dest: null,
                points: [
                    [gx, gy - 5],
                    [gx + 3, gy + 7],
                ],
                slots: 2,
                style: "direct",
                order: "slot",
                params: null,
            },
        },
        assignments: [1, 2].map((m) => ({
            id: m,
            marcher: m,
            transition: 1,
            slot: m - 1,
            start: 0,
            end: c,
            layer: 0,
        })),
        routes: { 1: { geometry, ...(t ? { timing: t } : {}) } },
        lanes: {
            1: { transition: 1, slot: 0, route: 1, offset: [0, -5] },
            2: { transition: 1, slot: 1, route: 1, offset: [0, 5], adjust },
        },
    };
}

const BEATS = (c = 16) => Array.from({ length: c * 16 + 1 }, (_, i) => i / 16);

/** Resolver, package oracle and ref oracle agree bit for bit at every 1/16 beat */
function expectAllAgree(host: TimelineSnapshot, c = 16) {
    const r = createResolver(host);
    const o = createTimelineOracleForTesting(host);
    const ref = makeOracle(host) as { positionAt(m: number, b: number): XY };
    for (const b of BEATS(c))
        for (const { id } of host.marchers) {
            const at = r.positionAt(id, b);
            expect(at, `M${id}@${b}`).toEqual(o.positionAt(id, b));
            expect(at, `ref M${id}@${b}`).toEqual(ref.positionAt(id, b));
        }
}

const L_PATH: RouteGeometry = {
    v: 1,
    from: [0, 0],
    to: [30, 40],
    points: [{ id: "p1", at: [30, 0] }],
};

describe("QA-PIN-1: one marcher's own path pinned at a corner", () => {
    it("passes the corner on its count and keeps a steady speed either side", () => {
        const r = createResolver(ownShow(L_PATH, timing(pin("p1", 4))));
        expect(r.positionAt(1, 2)).toEqual([15, 0]);
        expect(r.positionAt(1, 4)).toEqual([30, 0]);
        expect(r.positionAt(1, 10)).toEqual([30, 20]);
        expect(r.positionAt(1, 16)).toEqual([30, 40]);
        expect(r.positionAt(1, 0)).toEqual([0, 0]);
        expectAllAgree(ownShow(L_PATH, timing(pin("p1", 4))));
    });

    it("without the pin walks the whole path at one speed", () => {
        const r = createResolver(ownShow(L_PATH, null));
        // 70 long over 16 counts: the corner (30 along) at 16·30/70
        const at = r.positionAt(1, (16 * 30) / 70);
        expect(at[0]).toBeCloseTo(30, 9);
        expect(at[1]).toBeCloseTo(0, 9);
    });
});

const BLOCK: RouteGeometry = {
    v: 1,
    from: [0, 0],
    to: [200, 60],
    points: [
        { id: "q1", at: [50, 0] },
        { id: "q2", at: [150, 0] },
    ],
};

describe("QA-PIN-2: a group path's pin holds for every member, adjusted ones too", () => {
    const adjust: AdjustProfile = {
        v: 1,
        keys: [{ a: "q1", b: "q2", f: 0.5, d: [0, 10] }],
    };
    it("every member passes its copy of the pinned corner on the count", () => {
        const host = groupShow(BLOCK, timing(pin("q2", 6)), adjust);
        const r = createResolver(host);
        expect(r.positionAt(1, 6)).toEqual([150, -5]);
        // the Adjust is constant past its last key: its copy of q2 is 10 further
        expect(r.positionAt(2, 6)).toEqual([150, 15]);
        expectAllAgree(host);
    });

    it("a pin on the first corner times the legs onto the path", () => {
        const host = groupShow(BLOCK, timing(pin("q1", 2), pin("q2", 10)));
        const r = createResolver(host);
        expect(r.positionAt(1, 2)).toEqual([50, -5]);
        expect(r.positionAt(2, 2)).toEqual([50, 5]);
        expect(r.positionAt(1, 10)).toEqual([150, -5]);
        expectAllAgree(host);
    });

    it("is continuous everywhere (P-14)", () => {
        const host = groupShow(BLOCK, timing(pin("q2", 6)), adjust);
        const r = createResolver(host);
        for (const m of [1, 2]) {
            let prev = r.positionAt(m, 0);
            for (let b = 1 / 64; b <= 16; b += 1 / 64) {
                const now = r.positionAt(m, b);
                expect(
                    Math.hypot(now[0] - prev[0], now[1] - prev[1]),
                ).toBeLessThan(2);
                prev = now;
            }
        }
    });
});

describe("QA-PIN-3: midset and quarter sets on a straight path", () => {
    const line: RouteGeometry = {
        v: 1,
        from: [0, 0],
        to: [160, 0],
        points: [
            { id: "a", at: [40, 0] },
            { id: "m", at: [80, 0] },
            { id: "b", at: [120, 0] },
        ],
    };
    it("pins where steady speed already puts them change nothing", () => {
        const pinned = createResolver(
            ownShow(line, timing(pin("a", 4), pin("m", 8), pin("b", 12))),
        );
        const plain = createResolver(ownShow(line, null));
        for (const b of BEATS()) {
            const p = pinned.positionAt(1, b);
            const q = plain.positionAt(1, b);
            expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-9);
        }
        expect(pinned.positionAt(1, 8)).toEqual([80, 0]);
    });

    it("a midset off the middle: fast to it, slow after", () => {
        const r = createResolver(ownShow(line, timing(pin("m", 4))));
        expect(r.positionAt(1, 2)).toEqual([40, 0]);
        expect(r.positionAt(1, 4)).toEqual([80, 0]);
        expect(r.positionAt(1, 10)).toEqual([120, 0]);
    });
});

describe("QA-PIN-4: random pinned routes agree with both oracles", () => {
    const point = fc.tuple(
        fc.integer({ min: -60, max: 260 }),
        fc.integer({ min: -60, max: 160 }),
    );
    const routeArb = fc
        .record({
            pts: fc.array(fc.record({ at: point, smooth: fc.boolean() }), {
                minLength: 1,
                maxLength: 5,
            }),
            from: point,
            to: point,
            c: fc.integer({ min: 4, max: 24 }),
            pinMask: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
            group: fc.boolean(),
        })
        .map(({ pts, from, to, c, pinMask, group }) => {
            const points = pts.map((p, i) => ({
                id: `p${i}`,
                at: [p.at[0], p.at[1]] as XY,
                ...(p.smooth ? { tension: 1 } : {}),
            }));
            const chosen = points.filter((_, i) => pinMask[i]);
            // increasing whole counts in (0, c), as the app writes them
            const counts = placeOnCounts(
                chosen.map((_, i) => ((i + 1) * c) / (chosen.length + 1)),
                c,
            );
            const pins = counts
                ? chosen.map((p, i) => pin(p.id, counts[i]!))
                : [];
            const geometry: RouteGeometry = {
                v: 1,
                from: [from[0], from[1]],
                to: [to[0], to[1]],
                points,
            };
            return { geometry, t: timing(...pins), c, group };
        });

    it("bit for bit at every 1/16 beat, group and own lanes", () => {
        fc.assert(
            fc.property(routeArb, ({ geometry, t, c, group }) => {
                expectAllAgree(
                    group
                        ? groupShow(geometry, t, null, c)
                        : ownShow(geometry, t, c),
                    c,
                );
            }),
            { numRuns: 80 },
        );
    });

    it("an arc leg keeps its circle with a pin either side", () => {
        const arc: RouteGeometry = {
            v: 1,
            from: [0, 0],
            to: [100, 0],
            points: [
                { id: "a", at: [40, 0] },
                { id: "b", at: [60, 20], bulge: 0.2 },
            ],
        };
        expectAllAgree(ownShow(arc, timing(pin("a", 3), pin("b", 9))));
        expectAllAgree(groupShow(arc, timing(pin("b", 5))));
    });
});

describe("QA-PIN-5: T-6 drops what can't be a knot", () => {
    const bad = timing(
        pin("q1", 0),
        pin("q1", 16),
        pin("q1", -1),
        pin("q1", Number.NaN),
        pin("gone", 5),
        pin("q2", 4),
        pin("q1", 6), // out of order after q2's
    );
    it("drops them, raises D-PIN once, and stays finite and continuous", () => {
        const host = groupShow(BLOCK, bad);
        const r = createResolver(host);
        const d = r.diagnostics().filter((x) => x.code === "D-PIN");
        expect(d).toHaveLength(1);
        expect(d[0]!.message).toContain("6 unusable");
        // q1 (index 0) at 6 sorts first and is kept; q2 at 4 isn't after it, so it goes
        expect(r.positionAt(1, 6)).toEqual([50, -5]);
        for (const b of BEATS())
            for (const m of [1, 2])
                expect(r.positionAt(m, b).every(Number.isFinite)).toBe(true);
        expectAllAgree(host);
    });

    it("two pins on one point make the second a stop there", () => {
        const host = ownShow(L_PATH, timing(pin("p1", 4), pin("p1", 8)));
        const r = createResolver(host);
        expect(r.positionAt(1, 6)).toEqual([30, 0]);
        expectAllAgree(host);
    });
});

describe("QA-PIN-6: no pins is the walk without timing, bit for bit", () => {
    const cases: [string, RouteTiming | null][] = [
        ["no timing", null],
        ["an empty list", timing()],
        ["every pin dropped", timing(pin("gone", 4), pin("q1", 99))],
    ];
    for (const [name, t] of cases)
        it(name, () => {
            const plain = createResolver(groupShow(BLOCK, null));
            const timed = createResolver(groupShow(BLOCK, t));
            const ownPlain = createResolver(ownShow(BLOCK, null));
            const ownTimed = createResolver(ownShow(BLOCK, t));
            for (const b of BEATS()) {
                for (const m of [1, 2])
                    expect(timed.positionAt(m, b)).toEqual(
                        plain.positionAt(m, b),
                    );
                expect(ownTimed.positionAt(1, b)).toEqual(
                    ownPlain.positionAt(1, b),
                );
            }
        });
});

describe("QA-PIN-7: the cached resolver follows pin edits", () => {
    it("pin, move the pin, remove it: cached equals fresh, closure holds", () => {
        const host = groupShow(BLOCK, null);
        const r = createResolver(host);
        r.positionAt(1, 6);
        const steps: (RouteTiming | null)[] = [
            timing(pin("q2", 6)),
            timing(pin("q2", 9)),
            timing(pin("q1", 3), pin("q2", 9)),
            null,
        ];
        let before = { id: 1, geometry: BLOCK } as Record<string, unknown>;
        for (const t of steps) {
            host.routes![1] = { geometry: BLOCK, ...(t ? { timing: t } : {}) };
            const after = { id: 1, geometry: BLOCK, timing: t };
            r.notify({
                changes: [{ table: "routes", rowId: 1, before, after }],
            });
            before = after;
            const fresh = createResolver(host);
            for (const b of BEATS())
                for (const m of [1, 2])
                    expect(r.positionAt(m, b)).toEqual(fresh.positionAt(m, b));
            expect(r.checkCacheClosure()).toBe(true);
        }
    });
});

describe("the clock and M-COUNTS", () => {
    const W = groupSchedule(BLOCK).W;
    it("clockPlace and clockBeatAt invert each other", () => {
        const clock = routeClock(
            W,
            BLOCK.points,
            timing(pin("q1", 4), pin("q2", 8)),
            16,
        )!;
        expect(clock.active).toBe(true);
        expect(clockPlace(clock, 4)).toBe(W.D[1]);
        expect(clockBeatAt(clock, W.D[2]!)).toBe(8);
        for (const u of [1, 3.5, 6, 11, 15])
            expect(clockBeatAt(clock, clockPlace(clock, u))).toBeCloseTo(u, 9);
    });

    it("places on whole counts, trading when two round to one count", () => {
        expect(placeOnCounts([4, 8, 12], 16)).toEqual([4, 8, 12]);
        expect(placeOnCounts([3.2, 3.4], 8)).toEqual([3, 4]);
        expect(placeOnCounts([3.6, 3.7], 8)).toEqual([3, 4]);
        expect(placeOnCounts([0.2, 0.3], 8)).toEqual([1, 2]);
        expect(placeOnCounts([7.9, 7.95], 8)).toEqual([6, 7]);
        expect(placeOnCounts([1, 2, 3], 3)).toBeNull();
        expect(placeOnCounts([], 4)).toEqual([]);
        // ties: the earliest
        expect(placeOnCounts([2.5], 8)).toEqual([2]);
    });
});

describe("QA-PIN-8: the drawn walked path with pins (R-20)", () => {
    const cases: [string, TimelineSnapshot][] = [
        ["own path", ownShow(L_PATH, timing(pin("p1", 4)))],
        [
            "group path",
            groupShow(BLOCK, timing(pin("q1", 2), pin("q2", 10)), {
                v: 1,
                keys: [{ a: "q1", b: "q2", f: 0.5, d: [0, 10] }],
            }),
        ],
        [
            "curved own path",
            ownShow(
                {
                    v: 1,
                    from: [0, 0],
                    to: [120, 40],
                    points: [
                        { id: "a", at: [40, -20], tension: 1 },
                        { id: "b", at: [80, 30] },
                    ],
                },
                timing(pin("a", 3), pin("b", 12)),
            ),
        ],
    ];
    // Stops (S3): two coincident points pinned at 4 and 8; a pin on a point at the path's start
    cases.push(
        [
            "own path with a stop at a corner",
            ownShow(
                {
                    ...L_PATH,
                    points: [
                        { id: "p1", at: [30, 0] },
                        { id: "p2", at: [30, 0] },
                    ],
                },
                timing(pin("p1", 4), pin("p2", 8)),
            ),
        ],
        [
            "own path with a stop at its start",
            ownShow(
                {
                    ...L_PATH,
                    points: [
                        { id: "s", at: [0, 0] },
                        { id: "p1", at: [30, 0] },
                    ],
                },
                timing(pin("s", 4), pin("p1", 10)),
            ),
        ],
    );
    for (const [name, host] of cases)
        it(`${name}: matches positionAt, whole and cut at a page flag`, () => {
            const r = createResolver(host);
            for (const [from, to] of [
                [0, 16],
                [0, 6],
                [6, 16],
                [2, 6],
                [5, 9],
            ] as const) {
                for (const { id } of host.marchers) {
                    const path = walkedPath(host, r, id, from, to);
                    for (let b = from; b <= to; b += 1 / 16) {
                        const drawn = walkedPathPointAt(path, b);
                        if (!drawn) continue;
                        const at = r.positionAt(id, b);
                        expect(
                            Math.hypot(drawn[0] - at[0], drawn[1] - at[1]),
                            `M${id}@${b} in [${from}, ${to}]`,
                        ).toBeLessThan(WALKED_SAMPLE_TOLERANCE);
                    }
                }
            }
        });
});
