/**
 * Going round a closed outline, pathways step 10 (spec R-13‴, Appendix L.11): the resolver half of
 * QA-OL-1 to QA-OL-9, the validator, the cache, the walked path, and agreement with the spec's own
 * reference oracle in `docs/timeline/ref`.
 *
 * Expected positions are worked by hand (on a square, a polyline; on a circle, its angle), never
 * from `../geom`.
 */
import { describe, expect, it } from "vitest";
import { createOracle } from "../oracle";
import { createCachedResolver } from "../resolver";
import {
    walkedPath,
    walkedPathPointAt,
    WALKED_SAMPLE_TOLERANCE,
} from "../walkedPath";
import type {
    RouteGeometry,
    RowImage,
    TimelineSnapshot,
    TransitionRow,
    XY,
} from "../types";
import { validatePathParams, validateRouteGeometry } from "../validate";
import { mulberry32 } from "./showGenerators";
// @ts-expect-error: the spec's reference implementation is plain JavaScript
import { makeOracle } from "../../../../../docs/timeline/ref/oracle.mjs";

const refOracle = makeOracle as (db: TimelineSnapshot) => {
    positionAt(m: number, b: number): XY;
};

const clone = <T>(x: T): T => structuredClone(x);
const near = (a: XY, b: XY, eps = 1e-9) =>
    Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
const same = (a: XY, b: XY) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]);

/** The square (0,0) (8,0) (8,8) (0,8), clockwise on the field (y down), as a closed route */
const SQUARE: RouteGeometry = {
    v: 1,
    closed: true,
    from: [0, 0],
    to: [0, 0],
    points: [
        { id: "p1", at: [8, 0] },
        { id: "p2", at: [8, 8] },
        { id: "p3", at: [0, 8] },
    ],
};

/** A point `d` round SQUARE (perimeter 32), by hand */
function onSquare(d: number): XY {
    const x = ((d % 32) + 32) % 32;
    if (x <= 8) return [x, 0];
    if (x <= 16) return [8, x - 8];
    if (x <= 24) return [24 - x, 8];
    return [0, 32 - x];
}

/**
 * A quarter circle's bulge, sagitta over chord: r(1 − cos 45°) / (r√2) = tan(π/8) / 2 ≈ 0.2071;
 * its sign bows away from the centre (worked below)
 */
const QUARTER = Math.tan(Math.PI / 8) / 2;

/** A circle about `c` of radius `r`, from its top, clockwise on the field (y down): four quarter arcs */
function circleRoute(c: XY, r: number, k: number): RouteGeometry {
    const at = (a: number): XY => [
        c[0] + r * Math.cos(a),
        c[1] + r * Math.sin(a),
    ];
    const top = at(-Math.PI / 2);
    return {
        v: 1,
        closed: true,
        from: top,
        to: top,
        points: [
            { id: "p1", at: at(0), bulge: k },
            { id: "p2", at: at(Math.PI / 2), bulge: k },
            { id: "p3", at: at(Math.PI), bulge: k },
        ],
        toBulge: k,
    };
}

/**
 * `homes.length` marchers going round `geometry` over [0, `end`), slot order, each to `spots[i]`,
 * `laps` times round more
 */
function aroundShow(
    homes: XY[],
    geometry: RouteGeometry | null,
    spots: XY[],
    { end = 16, laps = 0 }: { end?: number; laps?: number } = {},
): TimelineSnapshot {
    return {
        marchers: homes.map((home, i) => ({ id: i + 1, home })),
        shapes: {},
        transitions: {
            1: {
                id: 1,
                start: 0,
                end,
                dest: null,
                points: spots,
                slots: homes.length,
                style: "follow_the_leader",
                order: "slot",
                params: {
                    waypoints: [],
                    ends: "around",
                    ...(laps ? { laps } : {}),
                },
                ...(geometry ? { route: 1 } : {}),
            },
        },
        routes: geometry ? { 1: { geometry } } : {},
        assignments: homes.map((_, i) => ({
            id: i + 1,
            marcher: i + 1,
            transition: 1,
            slot: i,
            start: 0,
            end,
            layer: 0,
        })),
    };
}

/** Every marcher at every 1/8 beat: the resolver, both oracles and `want` (when given) agree */
function agree(
    db: TimelineSnapshot,
    want?: (q: number, b: number) => XY,
    eps = 1e-9,
) {
    const res = createCachedResolver(clone(db));
    const oracle = createOracle(clone(db));
    const ref = refOracle(clone(db));
    const end = db.transitions[1]!.end;
    for (let b = 0; b <= end; b += 1 / 8)
        for (let q = 0; q < db.marchers.length; q++) {
            const x = res.positionAt(q + 1, b);
            expect(Number.isFinite(x[0]) && Number.isFinite(x[1])).toBe(true);
            if (want) {
                const w = want(q, b);
                expect(near(x, w, eps), `M${q + 1}@${b}: ${x} vs ${w}`).toBe(
                    true,
                );
            }
            expect(
                near(x, oracle.positionAt(q + 1, b)),
                `oracle M${q + 1}@${b}`,
            ).toBe(true);
            expect(
                near(x, ref.positionAt(q + 1, b)),
                `ref M${q + 1}@${b}`,
            ).toBe(true);
        }
    return res;
}

/** Each marcher's walked path is within the sample tolerance of where the resolver has it */
function walkedAgrees(db: TimelineSnapshot) {
    const res = createCachedResolver(clone(db));
    const end = db.transitions[1]!.end;
    for (let q = 0; q < db.marchers.length; q++) {
        // a marcher with no row holds where it is: nothing to walk
        if (!db.assignments.some((a) => a.marcher === q + 1)) continue;
        const path = walkedPath(db, res, q + 1, 0, end);
        for (let b = 0; b <= end; b += 1 / 32) {
            const at = walkedPathPointAt(path, b)!;
            const x = res.positionAt(q + 1, b);
            expect(
                Math.hypot(at[0] - x[0], at[1] - x[1]),
                `walked M${q + 1}@${b}`,
            ).toBeLessThan(WALKED_SAMPLE_TOLERANCE);
        }
    }
}

const EIGHT_ON_SQUARE: XY[] = [0, 4, 8, 12, 16, 20, 24, 28].map(onSquare);

describe("going round a closed outline (spec R-13‴, pathways step 10)", () => {
    it("QA-OL-1: eight on a square go round three spots, round its corners, every 1/8 beat", () => {
        // each 12 round over 12 beats: one unit a beat
        const spots = [0, 4, 8, 12, 16, 20, 24, 28].map((d) =>
            onSquare(d + 12),
        );
        const db = aroundShow(EIGHT_ON_SQUARE, SQUARE, spots, { end: 12 });
        const res = agree(db, (q, b) => onSquare(4 * q + Math.min(b, 12)));
        const e = res.ftlEntry(1);
        expect(e.startDist).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
        e.endDist.forEach((d, q) => expect(d).toBeCloseTo(4 * q + 12, 12));
        expect(e.around?.length).toBe(32);
        // M2 (4,0) turns the corner at (8,0) on beat 4; M8 (0,4) passes the seam at (0,0)
        expect(res.positionAt(2, 6)).toEqual([8, 2]);
        expect(res.positionAt(8, 4)).toEqual([0, 0]);
        expect(res.positionAt(8, 6)).toEqual([2, 0]);
        // the ends are the spots, bit for bit
        for (let q = 0; q < 8; q++)
            expect(same(res.positionAt(q + 1, 12), spots[q]!)).toBe(true);
        walkedAgrees(db);
    });

    it("QA-OL-2: a whole time round (laps 1) ends each on its own spot, never standing still", () => {
        const db = aroundShow(EIGHT_ON_SQUARE, SQUARE, EIGHT_ON_SQUARE, {
            end: 16,
            laps: 1,
        });
        const res = agree(db, (q, b) => onSquare(4 * q + 2 * Math.min(b, 16)));
        expect(res.positionAt(2, 8)).toEqual(onSquare(4 + 16));
        // spots a hair off where they started still count as none round, plus the lap
        const nudged = EIGHT_ON_SQUARE.map(([x, y]): XY => [x + 1e-12, y]);
        const db2 = aroundShow(EIGHT_ON_SQUARE, SQUARE, nudged, { laps: 1 });
        createCachedResolver(db2)
            .ftlEntry(1)
            .endDist.forEach((d, q) => expect(d).toBeCloseTo(4 * q + 32, 9));
        // one and a half times round: laps 1 plus four spots
        const half = [0, 4, 8, 12, 16, 20, 24, 28].map((d) => onSquare(d + 16));
        agree(
            aroundShow(EIGHT_ON_SQUARE, SQUARE, half, { end: 12, laps: 1 }),
            (q, b) => onSquare(4 * q + 4 * Math.min(b, 12)),
        );
        walkedAgrees(db);
    });

    it("QA-OL-3: eight on a circle go round a quarter, on the circle at every 1/8 beat", () => {
        // which way a quarter arc bows: the sign that puts the arc's middle on the circle
        const c: XY = [10, -6];
        const r = 8;
        const k = (() => {
            for (const s of [1, -1]) {
                const g = circleRoute(c, r, s * QUARTER);
                const d = aroundShow([g.from], g, [g.points[0]!.at]);
                const mid = createCachedResolver(d).positionAt(1, 8);
                if (
                    Math.abs(Math.hypot(mid[0] - c[0], mid[1] - c[1]) - r) <
                    1e-9
                )
                    return s * QUARTER;
            }
            throw new Error("neither sign bows onto the circle");
        })();
        const at = (a: number): XY => [
            c[0] + r * Math.cos(a),
            c[1] + r * Math.sin(a),
        ];
        const homes = Array.from({ length: 8 }, (_, i) =>
            at((i * Math.PI) / 4),
        );
        const spots = Array.from({ length: 8 }, (_, i) =>
            at(((i + 2) * Math.PI) / 4),
        );
        const db = aroundShow(homes, circleRoute(c, r, k), spots, { end: 8 });
        // each turns 90° over 8 beats, clockwise on the field (the angle grows with y down)
        agree(db, (q, b) =>
            at((q * Math.PI) / 4 + (Math.PI / 2) * (Math.min(b, 8) / 8)),
        );
        walkedAgrees(db);
    });

    it("QA-OL-4: a start and a spot off the outline: straight on, round, straight off, at one speed", () => {
        // (−2,4) enters at (0,4), 28 round; its spot (8,−2) leaves at (8,0), 8 round: 2 + 12 + 2
        const db = aroundShow([[-2, 4]], SQUARE, [[8, -2]]);
        const res = agree(db, (_q, b) => {
            if (b <= 2) return [-2 + b, 4];
            if (b <= 14) return onSquare(28 + (b - 2));
            return [8, -(b - 14)];
        });
        const e = res.ftlEntry(1);
        expect(e.around?.inStraight[0]).toBe(2);
        expect(e.around?.straight[0]).toBe(2);
        expect(e.startDist[0]).toBe(28);
        expect(e.endDist[0]).toBe(40);
        walkedAgrees(db);
    });

    it("QA-OL-5: the outline's own order is the way round; Reverse only changes who leads", () => {
        const back: RouteGeometry = {
            ...SQUARE,
            points: [
                { id: "p3", at: [0, 8] },
                { id: "p2", at: [8, 8] },
                { id: "p1", at: [8, 0] },
            ],
        };
        const spots = EIGHT_ON_SQUARE.map((_, q) => onSquare(4 * q - 8));
        const db = aroundShow(EIGHT_ON_SQUARE, back, spots, { end: 8 });
        agree(db, (q, b) => onSquare(4 * q - Math.min(b, 8)));
        const rev = clone(db);
        rev.transitions[1]!.params = {
            waypoints: [],
            ends: "around",
            reverse: true,
        };
        const a = createCachedResolver(clone(db));
        const r = createCachedResolver(rev);
        expect(r.ftlEntry(1).members).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
        for (let m = 1; m <= 8; m++)
            for (let b = 0; b <= 8; b += 0.25)
                expect(same(a.positionAt(m, b), r.positionAt(m, b))).toBe(true);
    });

    it("QA-OL-6: with no closed outline (none, open, or no length) each walks straight to its spot (T-17)", () => {
        const spots: XY[] = [[8, 8], [0, 8]]; // prettier-ignore
        const homes: XY[] = [[0, 0], [8, 0]]; // prettier-ignore
        const straight = (q: number, b: number): XY => [
            homes[q]![0] +
                ((spots[q]![0] - homes[q]![0]) * Math.min(b, 16)) / 16,
            homes[q]![1] +
                ((spots[q]![1] - homes[q]![1]) * Math.min(b, 16)) / 16,
        ];
        const open: RouteGeometry = { ...SQUARE, closed: undefined };
        delete open.closed;
        const dot: RouteGeometry = {
            v: 1,
            closed: true,
            from: [3, 3],
            to: [3, 3],
            points: [{ id: "p1", at: [3, 3] }],
        };
        for (const g of [null, open, dot]) {
            agree(aroundShow(homes, g, spots), straight);
            walkedAgrees(aroundShow(homes, g, spots));
        }
    });

    it("QA-OL-7: a member taken over or joining walks straight; a vacant slot leaves the others' ends alone", () => {
        const spots = [0, 4, 8, 12, 16, 20, 24, 28].map((d) => onSquare(d + 4));
        const db = aroundShow(EIGHT_ON_SQUARE, SQUARE, spots, { end: 8 });
        // M3 joins at beat 4
        db.assignments[2] = { ...db.assignments[2]!, start: 4 };
        db.assignments.push({ id: 99, marcher: 3, transition: 9, slot: 0, start: 0, end: 4, layer: 0 }); // prettier-ignore
        db.transitions[9] = { id: 9, start: 0, end: 4, dest: null, points: [[4, -4]], slots: 1, style: "direct", order: "inherit", params: null }; // prettier-ignore
        const res = agree(db);
        expect(res.ftlEntry(1).members).toEqual([1, 2, 4, 5, 6, 7, 8]);
        // the joiner walks straight from where it is at beat 4, (4,−4), to its own spot (8,4)
        expect(near(res.positionAt(3, 6), [6, 0])).toBe(true);
        // everyone else goes round as before
        expect(near(res.positionAt(2, 4), onSquare(6))).toBe(true);
        // M5's row gone: a gap, the others unmoved
        const gap = aroundShow(EIGHT_ON_SQUARE, SQUARE, spots, { end: 8 });
        gap.assignments = gap.assignments.filter((a) => a.marcher !== 5);
        gap.marchers = gap.marchers.filter((m) => m.id !== 5);
        const g = createCachedResolver(gap);
        expect(near(g.positionAt(6, 4), onSquare(22))).toBe(true);
    });

    it("QA-OL-8: the validator: ends, laps and closed routes", () => {
        const ok = (p: unknown) =>
            validatePathParams("follow_the_leader", p).ok;
        expect(ok({ waypoints: [], ends: "around" })).toBe(true);
        expect(ok({ waypoints: [], ends: "around", laps: 3 })).toBe(true);
        expect(ok({ waypoints: [], ends: "around", laps: 0 })).toBe(false);
        expect(ok({ waypoints: [], ends: "around", laps: 1.5 })).toBe(false);
        expect(ok({ waypoints: [], ends: "around", laps: 101 })).toBe(false);
        expect(ok({ waypoints: [], ends: "along", laps: 1 })).toBe(false);
        expect(ok({ waypoints: [], laps: 1 })).toBe(false);
        expect(ok({ waypoints: [], ends: "round" })).toBe(false);
        const route = (g: unknown) => validateRouteGeometry(g).ok;
        expect(route(SQUARE)).toBe(true);
        expect(route(circleRoute([0, 0], 5, QUARTER))).toBe(true);
        expect(route({ ...SQUARE, closed: false })).toBe(false);
        expect(route({ ...SQUARE, to: [0, 1] })).toBe(false);
        expect(route({ ...SQUARE, points: [] })).toBe(false);
        expect(
            route({
                ...SQUARE,
                points: [
                    { id: "p1", at: [8, 0], tension: 1 },
                    ...SQUARE.points.slice(1),
                ],
            }),
        ).toBe(false);
        // an open route is unchanged by step 10
        expect(route({ v: 1, from: [0, 0], to: [4, 4], points: [] })).toBe(
            true,
        );
    });

    it("QA-OL-9: cache: laps, the outline and a spot edited each dirty the entry once; cached = fresh bit for bit", () => {
        const spots = [0, 4, 8, 12, 16, 20, 24, 28].map((d) => onSquare(d + 8));
        const db = aroundShow(EIGHT_ON_SQUARE, SQUARE, spots);
        const res = createCachedResolver(db);
        res.warmAll();
        const image = (t: TransitionRow): RowImage => ({
            ...t,
            route: t.route ?? null,
        });
        const check = (label: string) => {
            const fresh = createCachedResolver(clone(db));
            for (let m = 1; m <= 8; m++)
                for (let b = -1; b <= 17; b += 0.5)
                    expect(
                        same(res.positionAt(m, b), fresh.positionAt(m, b)),
                        `${label} M${m}@${b} ${res.positionAt(m, b)} ${fresh.positionAt(m, b)}`,
                    ).toBe(true);
            expect(res.cacheClosureViolation(), label).toBeNull();
        };
        const edit = (label: string, change: (t: TransitionRow) => void) => {
            const before = image(db.transitions[1]!);
            change(db.transitions[1]!);
            const report = res.notify({
                changes: [
                    {
                        table: "transitions",
                        rowId: 1,
                        before,
                        after: image(db.transitions[1]!),
                    },
                ],
            });
            expect(report.ftlEntriesDirtied, label).toBe(1);
            check(label);
        };
        check("cold");
        edit(
            "laps 2",
            (t) => (t.params = { waypoints: [], ends: "around", laps: 2 }),
        );
        // a spot moved: logged under its transition (spec 10.2)
        db.transitions[1]!.points = [...db.transitions[1]!.points!];
        db.transitions[1]!.points[3] = [9, 9];
        expect(
            res.notify({
                changes: [
                    {
                        table: "slot_destinations",
                        rowId: 1,
                        before: { transition: 1 },
                        after: { transition: 1 },
                    },
                ],
            }).ftlEntriesDirtied,
            "a spot moved",
        ).toBe(1);
        check("a spot moved");
        edit("ends cleared", (t) => (t.params = { waypoints: [] }));
        edit(
            "around again",
            (t) => (t.params = { waypoints: [], ends: "around" }),
        );
        const before = { id: 1, geometry: db.routes![1]!.geometry };
        db.routes![1] = {
            geometry: {
                ...SQUARE,
                points: [{ id: "p1", at: [10, 0] }, ...SQUARE.points.slice(1)],
            },
        };
        expect(
            res.notify({
                changes: [
                    {
                        table: "routes",
                        rowId: 1,
                        before,
                        after: { id: 1, geometry: db.routes![1]!.geometry },
                    },
                ],
            }).ftlEntriesDirtied,
        ).toBe(1);
        check("outline edited");
    });

    it("QA-OL-10: random outlines (squares, boxes, circles, either way, off-outline starts and spots, laps, gaps): resolver, oracle and ref agree; walked paths agree; equal advances never pass", () => {
        for (let seed = 1; seed <= 80; seed++) {
            const R = mulberry32(9100 + seed);
            const kind = seed % 3;
            const c: XY = [R() * 40 - 20, R() * 40 - 20];
            let geometry: RouteGeometry;
            if (kind === 2) {
                const r = 3 + R() * 12;
                geometry = circleRoute(c, r, (R() < 0.5 ? 1 : -1) * QUARTER);
            } else {
                const w = 2 + R() * 16;
                const h = kind === 0 ? w : 2 + R() * 16;
                const a = R() * Math.PI;
                const corner = (x: number, y: number): XY => [
                    c[0] + x * Math.cos(a) - y * Math.sin(a),
                    c[1] + x * Math.sin(a) + y * Math.cos(a),
                ];
                const pts = [corner(w, 0), corner(w, h), corner(0, h)];
                if (R() < 0.5) pts.reverse();
                const from = corner(0, 0);
                geometry = {
                    v: 1,
                    closed: true,
                    from,
                    to: from,
                    points: pts.map((at, i) => ({ id: `p${i}`, at })),
                };
            }
            // members evenly round it, all advancing the same distance (or a few nudged off it)
            const n = 3 + Math.floor(R() * 8);
            const L = (() => {
                const probe = aroundShow(
                    [geometry.from],
                    geometry,
                    [geometry.from],
                    { laps: 1 },
                );
                return createCachedResolver(probe).ftlEntry(1).endDist[0]!;
            })();
            const loopAt = (d: number) => {
                const probe = aroundShow(
                    [geometry.from],
                    geometry,
                    [geometry.from],
                    { end: 1, laps: 1 },
                );
                return createCachedResolver(probe).positionAt(
                    1,
                    (((d % L) + L) % L) / L,
                );
            };
            const phase = R() * L;
            const advance = R() * L * 2.5;
            const laps = Math.floor((advance + 1e-9 * L) / L);
            const homes = Array.from({ length: n }, (_, i) =>
                loopAt(phase + (i * L) / n),
            );
            const spots = Array.from({ length: n }, (_, i) =>
                loopAt(phase + (i * L) / n + advance),
            );
            const off = R() < 0.3;
            if (off) {
                homes[0] = [homes[0]![0] + 1.5, homes[0]![1] - 0.5];
                spots[n - 1] = [spots[n - 1]![0] - 1, spots[n - 1]![1] + 2];
            }
            const db = aroundShow(homes, geometry, spots, { end: 8, laps });
            if (R() < 0.2) db.transitions[1]!.params!.reverse = true;
            if (R() < 0.2 && n > 3)
                db.assignments = db.assignments.filter((a) => a.marcher !== 2);
            const res = agree(db);
            walkedAgrees(db);
            if (
                !off &&
                !db.transitions[1]!.params!.reverse &&
                db.assignments.length === n
            ) {
                // equal advances: everyone keeps the same distance round to the one ahead
                const e = res.ftlEntry(1);
                e.endDist.forEach((d, q) =>
                    expect(
                        d - e.startDist[q]!,
                        `seed ${seed} M${q + 1}`,
                    ).toBeCloseTo(advance, 6),
                );
            }
        }
    });
});
