import { describe, expect } from "vitest";
import { it as plainIt } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import {
    createResolver,
    makeLoop,
    nearestOnLoop,
    type Resolver,
    type RouteGeometry,
    type XY,
} from "@openmarch/core";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performRedo, performUndo } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import { moveMarchersInTarget } from "../timelineMoves";
import {
    editTrailPoints,
    readTrails,
    removeTrail,
    reverseTrail,
} from "../timelineTrails";
import { dragTrail } from "../timelineTrailDrag";
import {
    boxOutline,
    circleOutline,
    outlineOf,
    defaultSpots,
    fitOutline,
    goRound,
    goRoundPreview,
    goRoundRefusalFor,
    lineRound,
    planGoRound,
    reverseOutline,
} from "../timelineTrailAround";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Go round an outline, pathways step 10 (spec Appendix L.11, AP-T13 to AP-T15), on the converted
 * `marchersAndPages` show: marchers 1 to 8 are put on a box outline or a circle on page 1 (its
 * box `[1, 9)`), and go round it over page 2's box `[9, 17)`. QA-AP-OL-1 to QA-AP-OL-8 and
 * QA-UNDO-OL: each is one undo step, redo restores the same ids, and a refusal writes nothing.
 */

const TABLES = [
    schema.pages,
    schema.utility,
    schema.timelines,
    schema.timeline_shapes,
    schema.timeline_transitions,
    schema.timeline_assignments,
    schema.timeline_slot_destinations,
    schema.timeline_routes,
    schema.timeline_lanes,
];
const dataOf = async (db: DbConnection) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TABLES)
        out[getTableName(table)] = await db.select().from(table).all();
    return out;
};
const snapshot = async (db: DbConnection) => ({
    data: await dataOf(db),
    undo: await db.select().from(schema.history_undo).all(),
    redo: await db.select().from(schema.history_redo).all(),
});
const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);
const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
    Math.abs(a[0]! - b[0]!) <= eps && Math.abs(a[1]! - b[1]!) <= eps;

const expectOneUndoStep = async (
    db: DbConnection,
    before: Awaited<ReturnType<typeof dataOf>>,
) => {
    const after = await dataOf(db);
    expect((await performUndo(db)).success).toBe(true);
    expect(await dataOf(db)).toEqual(before);
    expect((await performRedo(db)).success).toBe(true);
    expect(await dataOf(db)).toEqual(after);
};

const expectRefused = async (
    db: DbConnection,
    write: () => Promise<unknown>,
    message: RegExp,
) => {
    const before = await snapshot(db);
    const error = await write().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimelineWriteError);
    expect((error as TimelineWriteError).code).toBe("E-ARGS");
    expect(refusalText(error)).toMatch(message);
    expect(await snapshot(db)).toEqual(before);
};

const WINDOW = { start: 9, end: 17 };
const IDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** The square box outline of side `4·step` about `c`, eight places round it: corners and middles */
const boxPlaces = (c: XY, step: number): XY[] => {
    const h = 2 * step;
    return [
        [c[0] - h, c[1] - h],
        [c[0], c[1] - h],
        [c[0] + h, c[1] - h],
        [c[0] + h, c[1]],
        [c[0] + h, c[1] + h],
        [c[0], c[1] + h],
        [c[0] - h, c[1] + h],
        [c[0] - h, c[1]],
    ];
};

/** Eight places round a circle of radius `r` about `c`, from its top, clockwise on the field */
const circlePlaces = (c: XY, r: number): XY[] =>
    Array.from({ length: 8 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
    });

/** The show converted, marchers 1 to 8 put at `places` on page 1, so they stand there at beat 9 */
async function onOutline(
    db: DbConnection,
    places: (c: XY, step: number) => XY[],
) {
    await convertPagesToTimeline(db);
    const r = await resolverOf(db);
    const p1 = r.positionAt(1, 9);
    const step = (r.positionAt(2, 9)[0] - p1[0]) / 2;
    const c: XY = [p1[0] + 4 * step, p1[1] - 10 * step];
    const at = places(c, step);
    await moveMarchersInTarget({
        db,
        target: { kind: "range", start: 1, end: 9 },
        moves: IDS.map((m, i) => ({
            marcherId: m,
            x: at[i]![0],
            y: at[i]![1],
        })),
    });
    return { step, c, at };
}

const trailOf = async (db: DbConnection) => {
    const trails = await readTrails(db);
    expect(trails).toHaveLength(1);
    return trails[0]!;
};

/** The app's step in field units (8 to 5 at half a unit an inch) */
const STEP = 11.25;
/** A seeded random number from 0 to 1 (the test's own) */
const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
};
/** `n` evenly round an ellipse of semi-axes `a`, `b` about `c` */
const ellipse = (c: XY, a: number, b: number, n: number, turn = 0): XY[] =>
    Array.from({ length: n }, (_, i) => {
        const t = turn + (i * 2 * Math.PI) / n;
        return [c[0] + a * Math.cos(t), c[1] + b * Math.sin(t)];
    });
/** `k` evenly along each side of a regular polygon of `sides` sides and radius to its corners `r` */
const polygon = (sides: number, r: number, k: number): XY[] => {
    const out: XY[] = [];
    for (let s = 0; s < sides; s++) {
        const a = (s * 2 * Math.PI) / sides;
        const b = ((s + 1) * 2 * Math.PI) / sides;
        for (let j = 0; j < k; j++) {
            const f = j / k;
            out.push([
                r * ((1 - f) * Math.cos(a) + f * Math.cos(b)),
                r * ((1 - f) * Math.sin(a) + f * Math.sin(b)),
            ]);
        }
    }
    return out;
};

describe("the fit's review cases (step 10, QA-OL-12)", () => {
    plainIt(
        "eight round a circle are a circle, not the square they also stand on: exact, rounded to 1, 0.5 or 0.25 field units, and with ±0.01 noise",
        () => {
            for (const r of [40, 56, 67.5, 90, 120])
                for (const grid of [0, 1, 0.5, 0.25])
                    for (const turn of [0, 0.2, Math.PI / 8]) {
                        const pts = ellipse([300, 200], r, r, 8, turn).map(
                            ([x, y]): XY =>
                                grid
                                    ? [
                                          Math.round(x / grid) * grid,
                                          Math.round(y / grid) * grid,
                                      ]
                                    : [x, y],
                        );
                        expect(
                            fitOutline(pts, STEP)?.kind,
                            `r ${r} grid ${grid} turn ${turn}`,
                        ).toBe("circle");
                    }
            const R = seeded(12345);
            for (let trial = 0; trial < 60; trial++) {
                const r = 40 + R() * 80;
                const noisy = ellipse([100, 100], r, r, 8, R() * Math.PI).map(
                    ([x, y]): XY => [
                        x + (R() - 0.5) * 0.02,
                        y + (R() - 0.5) * 0.02,
                    ],
                );
                expect(
                    fitOutline(noisy, STEP)?.kind,
                    `noisy trial ${trial}`,
                ).toBe("circle");
            }
            // four on a square's corners still walk its sides
            expect(fitOutline([[0, 0], [40, 0], [40, 40], [0, 40]], STEP)?.kind).toBe("box"); // prettier-ignore
        },
    );

    plainIt(
        "the tolerance is at most half a step: a clear oval, a hexagon and an octagon are refused; a near circle fits, with who steps onto it counted",
        () => {
            // 12 × 8 steps (semi-axes 6 and 4) with 16 or 8 marchers: refused, not a circle or a box
            for (const n of [8, 12, 16, 24])
                expect(
                    fitOutline(ellipse([0, 0], 6 * STEP, 4 * STEP, n), STEP),
                    `oval of ${n}`,
                ).toBeNull();
            // a hexagon of radius 8 steps and an octagon of 16 with marchers along their sides (an
            // octagon of 8 is within half a step of its circle, so it fits, its marchers counted off it)
            expect(fitOutline(polygon(6, 8 * STEP, 3), STEP)).toBeNull();
            expect(fitOutline(polygon(8, 16 * STEP, 2), STEP)).toBeNull();
            const small = fitOutline(polygon(8, 8 * STEP, 2), STEP)!;
            expect(small.kind).toBe("circle");
            expect(
                planGoRound(polygon(8, 8 * STEP, 2), small, {
                    reversed: false,
                    amount: 1,
                    unit: "spots",
                    step: STEP,
                }).offOutline,
            ).toBeGreaterThan(0);
            // 10 × 9.6 steps: within half a step of a circle, so it fits, and the plan says who steps onto it
            const near = ellipse([0, 0], 5 * STEP, 4.8 * STEP, 16);
            const o = fitOutline(near, STEP);
            expect(o?.kind).toBe("circle");
            const plan = planGoRound(near, o!, {
                reversed: false,
                amount: 1,
                unit: "spots",
                step: STEP,
            });
            expect(plan.offOutline).toBeGreaterThan(0);
            // ▶ Preview walks them straight onto it first, as the resolver will (R-13‴)
            const q = plan.walk.inStraight.findIndex((x) => x > STEP / 20);
            const early = goRoundPreview(plan, 1e-3)[q]!;
            const start = plan.starts[q]!;
            const enter = plan.walk.enter[q]!;
            const toward =
                (early[0] - start[0]) * (enter[0] - start[0]) +
                (early[1] - start[1]) * (enter[1] - start[1]);
            expect(toward).toBeGreaterThan(0);
        },
    );

    plainIt(
        "only closed outlines: a 270° arc of nine, three sides of a box and two ranks far apart are not, though the arc can go around its circle",
        () => {
            const arc9 = Array.from({ length: 9 }, (_, i): XY => {
                const a = (i * 1.5 * Math.PI) / 8;
                return [8 * STEP * Math.cos(a), 8 * STEP * Math.sin(a)];
            });
            expect(fitOutline(arc9, STEP)).toBeNull();
            expect(outlineOf(arc9, STEP)?.full).toBe(false);
            // a box with one middle gone is still closed
            const box = boxPlaces([0, 0], STEP);
            expect(
                fitOutline(
                    box.filter((_, i) => i !== 5),
                    STEP,
                )?.kind,
            ).toBe("box");
            // a U: a 6 × 6-step box's top and two sides, 2 apart, its bottom side empty
            const u: XY[] = [];
            for (let x = 0; x <= 6; x += 2) u.push([x * STEP, 0]);
            for (let y = 2; y <= 6; y += 2)
                u.push([0, y * STEP], [6 * STEP, y * STEP]);
            expect(fitOutline(u, STEP)).toBeNull();
            const ranks: XY[] = [0, 1, 2, 3].flatMap((i): XY[] => [
                [2 * i * STEP, 0],
                [2 * i * STEP, 12 * STEP],
            ]);
            expect(fitOutline(ranks, STEP)).toBeNull();
        },
    );

    plainIt(
        "uneven spacing: a 12 × 4 box, long sides 2 apart and short sides 1 apart, goes on by places, landing on spots",
        () => {
            const pts: XY[] = [];
            for (let x = 0; x < 12; x += 2) pts.push([x * STEP, 0]);
            for (let y = 0; y < 4; y += 1) pts.push([12 * STEP, y * STEP]);
            for (let x = 12; x > 0; x -= 2) pts.push([x * STEP, 4 * STEP]);
            for (let y = 4; y > 0; y -= 1) pts.push([0, y * STEP]);
            const o = fitOutline(pts, STEP)!;
            expect(o.kind).toBe("box");
            const plan = planGoRound(pts, o, {
                reversed: false,
                amount: 3,
                unit: "spots",
                step: STEP,
            });
            expect(plan.ring.length).toBe(pts.length);
            // every spot written is one of the places they stand on
            for (const spot of plan.spots)
                expect(pts.some((p) => near(p, spot, 1e-6))).toBe(true);
            // nobody passes: the walking order is kept at the end
            const ends = plan.ends.map(
                (e) => e - Math.floor(e / plan.loop.L) * plan.loop.L,
            );
            const order = [...ends.keys()].sort((a, b) => ends[a]! - ends[b]!);
            const rot = order.indexOf(0);
            expect([...order.slice(rot), ...order.slice(0, rot)]).toEqual([
                ...ends.keys(),
            ]);
        },
    );
});

describe("the outline and the plan (step 10, pure)", () => {
    plainIt(
        "fitOutline: circles of 8, 12 and 16 are circles; box outlines (square, oblong, turned) are boxes; four on a square's corners walk its sides",
        () => {
            for (const n of [8, 12, 16]) {
                const pts = Array.from(
                    { length: n },
                    (_, i): XY => [
                        10 + 7 * Math.cos((i * 2 * Math.PI) / n),
                        -3 + 7 * Math.sin((i * 2 * Math.PI) / n),
                    ],
                );
                const o = fitOutline(pts, 1);
                expect(o?.kind, `circle of ${n}`).toBe("circle");
                expect(o!.loop.L).toBeCloseTo(2 * Math.PI * 7, 6);
            }
            const square = boxPlaces([0, 0], 2);
            expect(fitOutline(square, 1)?.kind).toBe("box");
            expect(fitOutline(square, 1)!.loop.L).toBeCloseTo(32, 9);
            // an oblong 12 × 4 with spots 2 apart, turned 30°
            const a = Math.PI / 6;
            const turn = ([x, y]: XY): XY => [
                x * Math.cos(a) - y * Math.sin(a),
                x * Math.sin(a) + y * Math.cos(a),
            ];
            const oblong: XY[] = [];
            for (let x = 0; x < 12; x += 2) oblong.push([x, 0]);
            for (let y = 0; y < 4; y += 2) oblong.push([12, y]);
            for (let x = 12; x > 0; x -= 2) oblong.push([x, 4]);
            for (let y = 4; y > 0; y -= 2) oblong.push([0, y]);
            const turned = fitOutline(oblong.map(turn), 1);
            expect(turned?.kind).toBe("box");
            expect(turned!.loop.L).toBeCloseTo(32, 9);
            expect(fitOutline([[0, 0], [4, 0], [4, 4], [0, 4]], 1)?.kind).toBe("box"); // prettier-ignore
        },
    );

    plainIt(
        "fitOutline: a line, a half circle, three on a circle, a filled block and a scatter are not outlines",
        () => {
            expect(
                fitOutline(
                    [0, 1, 2, 3, 4, 5].map((i): XY => [2 * i, 0]),
                    1,
                ),
            ).toBeNull();
            const half = Array.from(
                { length: 6 },
                (_, i): XY => [
                    8 * Math.cos((i * Math.PI) / 5),
                    8 * Math.sin((i * Math.PI) / 5),
                ],
            );
            expect(fitOutline(half, 1)).toBeNull();
            expect(fitOutline([[0, -5], [4.33, 2.5], [-4.33, 2.5]], 1)).toBeNull(); // prettier-ignore
            const block: XY[] = [];
            for (let x = 0; x < 3; x++)
                for (let y = 0; y < 3; y++) block.push([2 * x, 2 * y]);
            expect(fitOutline(block, 1)).toBeNull();
            expect(fitOutline([[0, 0], [9, 1], [3, 7], [11, 13], [-4, 6]], 1)).toBeNull(); // prettier-ignore
        },
    );

    plainIt(
        "outlineOf: a line on part of a circle (an arc) can go round the rest of it; a straight line and a scatter can't",
        () => {
            const arc = Array.from(
                { length: 5 },
                (_, i): XY => [
                    8 * Math.cos((i * Math.PI) / 8),
                    8 * Math.sin((i * Math.PI) / 8),
                ],
            );
            expect(fitOutline(arc, 1)).toBeNull();
            const o = outlineOf(arc, 1)!;
            expect(o.kind).toBe("circle");
            expect(o.full).toBe(false);
            expect(o.loop.L).toBeCloseTo(16 * Math.PI, 6);
            // the arc's spacing counts the spots all round: 16; the front of the arc leads
            const plan = planGoRound(arc, o, {
                reversed: false,
                amount: 2,
                unit: "spots",
                step: 1,
            });
            expect(plan.ring.length).toBe(16);
            expect(plan.line.at(-1)).toBe(4);
            plan.line.forEach((i, q) => {
                const want = [
                    8 * Math.cos(((i + 2) * Math.PI) / 8),
                    8 * Math.sin(((i + 2) * Math.PI) / 8),
                ];
                expect(near(plan.spots[q]!, want, 1e-9)).toBe(true);
            });
            expect(
                outlineOf(
                    [0, 1, 2, 3].map((i): XY => [2 * i, 0]),
                    1,
                ),
            ).toBeNull();
            expect(outlineOf(boxPlaces([0, 0], 2), 1)?.full).toBe(true);
        },
    );

    plainIt(
        "the stored outline runs clockwise on the field from its top; turned round it is the same points the other way",
        () => {
            const circle = circleOutline([0, 0], 5);
            expect(near(circle.from, [0, -5], 1e-12)).toBe(true);
            expect(near(circle.points[0]!.at, [5, 0], 1e-12)).toBe(true);
            const loop = makeLoop(circle)!;
            // a quarter round from the top is the right-hand side, the arcs bowing out
            expect(
                near(
                    createLoopPoint(circle, loop.L / 8),
                    [5 * Math.SQRT1_2, -5 * Math.SQRT1_2],
                    1e-9,
                ),
            ).toBe(true);
            const box = boxOutline([[0, 8], [8, 8], [8, 0], [0, 0]]); // prettier-ignore
            expect(box.from).toEqual([0, 0]);
            expect(box.points.map((p) => p.at)).toEqual([[8, 0], [8, 8], [0, 8]]); // prettier-ignore
            const back = reverseOutline(circle);
            const bl = makeLoop(back)!;
            expect(bl.L).toBeCloseTo(loop.L, 9);
            // walked back, a quarter round from the top is the left-hand side
            expect(
                near(
                    createLoopPoint(back, bl.L / 8),
                    [-5 * Math.SQRT1_2, -5 * Math.SQRT1_2],
                    1e-9,
                ),
            ).toBe(true);
            expect(reverseOutline(back)).toEqual(circle);
        },
    );

    plainIt(
        "planGoRound: the same distance for everyone, a spot being the usual gap; a gap in the outline counts as spots; laps",
        () => {
            const square = boxPlaces([0, 0], 2);
            const outline = fitOutline(square, 1)!;
            const plan = planGoRound(square, outline, {
                reversed: false,
                amount: 3,
                unit: "spots",
                step: 1,
            });
            expect(plan.ring.length).toBe(8);
            expect(plan.spacing).toBeCloseTo(4, 12);
            plan.distances.forEach((d) => expect(d).toBeCloseTo(12, 12));
            expect(plan.laps).toBe(0);
            // every member ends three places on, round the corners
            plan.line.forEach((i, q) =>
                expect(near(plan.spots[q]!, square[(i + 3) % 8]!, 1e-9)).toBe(
                    true,
                ),
            );
            // the leader is last; with no gap anywhere, the first round from the top corner leads
            expect(plan.line.at(-1)).toBe(0);
            // a whole time round, and a time and a half
            expect(
                planGoRound(square, outline, {
                    reversed: false,
                    amount: 8,
                    unit: "spots",
                    step: 1,
                }).laps,
            ).toBe(1);
            expect(
                planGoRound(square, outline, {
                    reversed: false,
                    amount: 12,
                    unit: "spots",
                    step: 1,
                }).laps,
            ).toBe(1);
            // two missing: six members, still eight spots, and the one behind the gap leads
            const six = [0, 1, 2, 3, 4, 5].map((i) => square[i]!);
            const p6 = planGoRound(six, fitOutline(six, 1) ?? outline, {
                reversed: false,
                amount: 1,
                unit: "spots",
                step: 1,
            });
            expect(p6.ring.length).toBe(8);
            expect(p6.line.at(-1)).toBe(5);
            // by steps
            expect(
                planGoRound(square, outline, {
                    reversed: false,
                    amount: 5,
                    unit: "steps",
                    step: 2,
                }).distances[0],
            ).toBe(10);
            expect(defaultSpots(4, 8, 1)).toBe(2);
            expect(defaultSpots(4, 1, 1)).toBe(1);
        },
    );

    plainIt(
        "lineRound: walking order, the leader last; reversed, the order turns round",
        () => {
            const square = boxPlaces([0, 0], 2);
            const outline = fitOutline(square, 1)!;
            expect(lineRound(outline.loop, square, 4)).toEqual([
                5, 6, 7, 0, 1, 2, 3, 4,
            ]);
            const back = makeLoop(reverseOutline(outline.geometry))!;
            expect(lineRound(back, square, 4)).toEqual([
                3, 2, 1, 0, 7, 6, 5, 4,
            ]);
        },
    );
});

/** The outline's point at `d` round it (the test's own: R-14 by the resolver of a one-marcher show) */
function createLoopPoint(geometry: RouteGeometry, d: number): XY {
    const loop = makeLoop(geometry)!;
    const show = {
        marchers: [{ id: 1, home: geometry.from }],
        shapes: {},
        routes: { 1: { geometry } },
        transitions: {
            1: { id: 1, start: 0, end: 1, dest: null, points: [geometry.from], slots: 1, style: "follow_the_leader" as const, order: "slot" as const, params: { waypoints: [], ends: "around" as const, laps: 1 }, route: 1 }, // prettier-ignore
        },
        assignments: [{ id: 1, marcher: 1, transition: 1, slot: 0, start: 0, end: 1, layer: 0 }], // prettier-ignore
    };
    return createResolver(show).positionAt(1, d / loop.L) as XY;
}

describeDbTests("Go round an outline (AP-T13 to AP-T15)", (it) => {
    it("QA-AP-OL-1: eight on a box outline go round three spots: the spots, the move as previewed at every quarter beat, file version 17, one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        const original = await dataOf(db);
        const before = await resolverOf(db);
        const result = await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 3, unit: "spots", step }); // prettier-ignore
        const r = await resolverOf(db);
        // everyone three places on, clockwise on the field, round the corners
        IDS.forEach((m, i) =>
            expect(near(r.positionAt(m, 17), at[(i + 3) % 8]!)).toBe(true),
        );
        // the move is the plan's preview at every quarter beat
        const plan = planGoRound(IDS.map((m) => before.positionAt(m, 9) as XY), fitOutline(at, step)!, { reversed: false, amount: 3, unit: "spots", step }); // prettier-ignore
        for (let b = 9; b <= 17; b += 0.25) {
            const want = goRoundPreview(plan, (b - 9) / 8);
            plan.line.forEach((i, q) =>
                expect(
                    near(r.positionAt(IDS[i]!, b), want[q]!, 1e-9),
                    `M${IDS[i]}@${b}`,
                ).toBe(true),
            );
        }
        // nobody moves before the window
        for (const m of IDS)
            for (let b = 0; b <= 9; b += 0.5)
                expect(r.positionAt(m, b)).toEqual(before.positionAt(m, b));
        const trail = await trailOf(db);
        expect(trail.around).toBe(true);
        expect(trail.geometry.closed).toBe(true);
        expect(trail.transitionId).toBe(result.transitionId);
        const t = (await db.select().from(schema.timeline_transitions).where(eq(schema.timeline_transitions.id, result.transitionId)).get())!; // prettier-ignore
        expect(JSON.parse(t.path_params!)).toEqual({
            waypoints: [],
            ends: "around",
        });
        expect(t.order_mode).toBe("slot");
        expect(t.dest_shape_id).toBeNull();
        const version = (
            await db
                .select({ version: sql<number>`user_version` })
                .from(sql`pragma_user_version`)
                .get()
        )?.version;
        expect(version).toBe(17);
        await expectOneUndoStep(db, original);
    });

    it("QA-AP-OL-2: a circle, once round (8 spots): each ends where it started, half way round at mid-move, still in the move", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at, c } = await onOutline(db, (cc, s) =>
            circlePlaces(cc, 6 * s),
        );
        await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 8, unit: "spots", step }); // prettier-ignore
        const r = await resolverOf(db);
        const t = await trailOf(db);
        expect(t.marcherIds).toHaveLength(8);
        const params = JSON.parse((await db.select().from(schema.timeline_transitions).where(eq(schema.timeline_transitions.id, t.transitionId)).get())!.path_params!); // prettier-ignore
        expect(params.laps).toBe(1);
        IDS.forEach((m, i) => {
            expect(near(r.positionAt(m, 17), at[i]!)).toBe(true);
            // half way round: the opposite place, on the circle
            expect(near(r.positionAt(m, 13), at[(i + 4) % 8]!, 1e-6)).toBe(
                true,
            );
            const mid = r.positionAt(m, 11);
            expect(Math.hypot(mid[0] - c[0], mid[1] - c[1])).toBeCloseTo(
                6 * step,
                6,
            );
        });
    });

    it("QA-AP-OL-3: the other way round: counterclockwise, and the old tail leads", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        const ahead = await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 1, unit: "spots", step }); // prettier-ignore
        expect((await performUndo(db)).success).toBe(true);
        const back = await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: ahead.marcherIds[0]!, reversed: true, amount: 1, unit: "spots", step }); // prettier-ignore
        expect(back.leaderId).toBe(ahead.marcherIds[0]);
        const r = await resolverOf(db);
        IDS.forEach((m, i) =>
            expect(near(r.positionAt(m, 17), at[(i + 7) % 8]!)).toBe(true),
        );
    });

    it("QA-AP-OL-4: going round again over the same window replaces the move (one transition), in one undo step", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 1, unit: "spots", step }); // prettier-ignore
        const first = await dataOf(db);
        expect(
            await db.transaction((tx) =>
                goRoundRefusalFor(tx, WINDOW, IDS, step),
            ),
        ).toBeNull();
        const again = await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 2, unit: "spots", step }); // prettier-ignore
        expect(again.replaced).toBe(true);
        expect(await readTrails(db)).toHaveLength(1);
        const r = await resolverOf(db);
        IDS.forEach((m, i) =>
            expect(near(r.positionAt(m, 17), at[(i + 2) % 8]!)).toBe(true),
        );
        await expectOneUndoStep(db, first);
    });

    it("QA-AP-OL-5 (AP-T14): Reverse leader on the stored move goes the other way round as far; twice is back", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 3, unit: "spots", step }); // prettier-ignore
        const t = await trailOf(db);
        const before = await dataOf(db);
        const out = await reverseTrail({ db, routeId: t.routeId });
        expect(out.reverse).toBe(true);
        const r = await resolverOf(db);
        IDS.forEach((m, i) =>
            expect(near(r.positionAt(m, 17), at[(i + 5) % 8]!)).toBe(true),
        );
        // walking counterclockwise: from the top-left corner, a quarter beat in it goes down the left side
        const tl = r.positionAt(1, 9.25);
        expect(tl[0]).toBeCloseTo(at[0]![0], 6);
        expect(tl[1]).toBeGreaterThan(at[0]![1]);
        await expectOneUndoStep(db, before);
        await reverseTrail({ db, routeId: t.routeId });
        const r2 = await resolverOf(db);
        IDS.forEach((m, i) =>
            expect(near(r2.positionAt(m, 17), at[(i + 3) % 8]!)).toBe(true),
        );
    });

    it("QA-AP-OL-5b (AP-T14): Reverse leader with a member taken over at the start rewrites every slot's spot, so no two end on one point", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 3, unit: "spots", step }); // prettier-ignore
        // M3 taken over for the window's first count: it joins the move after it
        const t = await trailOf(db);
        const A = schema.timeline_assignments;
        const row = (await db.select().from(A).where(eq(A.marcher_id, 3)).all()).find((r) => r.transition_id === t.transitionId)!; // prettier-ignore
        await db.update(A).set({ start_beat: 10 }).where(eq(A.id, row.id));
        await reverseTrail({ db, routeId: t.routeId });
        const r = await resolverOf(db);
        const ends = IDS.map((m) => r.positionAt(m, 17));
        for (let i = 0; i < ends.length; i++)
            for (let j = i + 1; j < ends.length; j++)
                expect(
                    near(ends[i]!, ends[j]!, 1e-6),
                    `M${IDS[i]} and M${IDS[j]}`,
                ).toBe(false);
        // the joiner's spot is turned back as far as everyone else's: five places on
        expect(near(ends[2]!, at[(2 + 5) % 8]!)).toBe(true);
        IDS.forEach((m, i) =>
            expect(near(ends[i]!, at[(i + 5) % 8]!), `M${m}`).toBe(true),
        );
    });

    it("QA-AP-OL-6: refusals with their reasons, nothing written; point edits refused (AP-T15); Remove trail walks straight to the same spots", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        const go = (ids: number[], amount = 1) => goRound({ db, window: WINDOW, marcherIds: ids, leaderId: null, reversed: false, amount, unit: "spots", step }); // prettier-ignore
        await expectRefused(db, () => go([1]), /two or more/);
        await expectRefused(db, () => go([1, 2, 3]), /circle or a box outline/);
        await expectRefused(db, () => go(IDS, 0), /at least one spot or step/);
        await expectRefused(db, () => go(IDS, 1e6), /at most 100 times/);
        expect(
            refusalText(
                new TimelineWriteError(
                    "E-ARGS",
                    (await db.transaction((tx) =>
                        goRoundRefusalFor(tx, WINDOW, [1, 2, 3], step),
                    ))!,
                ),
            ),
        ).toMatch(/circle or a box outline/);
        // a trail in the window already
        await dragTrail({ db, window: WINDOW, marcherIds: [1, 2, 3], leaderId: 3, points: [{ at: [at[2]![0] + 6 * step, at[2]![1]] }], spacing: { kind: "keep" }, step, ends: "trail" }); // prettier-ignore
        await expectRefused(db, () => go(IDS), /already follows a trail/);
        expect((await performUndo(db)).success).toBe(true);
        await go(IDS, 2);
        const t = await trailOf(db);
        await expectRefused(db, () => editTrailPoints({ db, routeId: t.routeId, points: [{ at: [0, 0] }] }), /has no points to edit/); // prettier-ignore
        const r0 = await resolverOf(db);
        const original = await dataOf(db);
        await removeTrail({ db, routeId: t.routeId });
        const r1 = await resolverOf(db);
        for (const m of IDS) {
            expect(r1.positionAt(m, 17)).toEqual(r0.positionAt(m, 17));
            // straight from the start to the same spot
            const a = r1.positionAt(m, 9);
            const b = r1.positionAt(m, 17);
            expect(
                near(r1.positionAt(m, 13), [
                    (a[0] + b[0]) / 2,
                    (a[1] + b[1]) / 2,
                ]),
            ).toBe(true);
        }
        await expectOneUndoStep(db, original);
        expect(
            await db.all(sql`SELECT * FROM timeline_route_violations`),
        ).toEqual([]);
    });

    it("QA-AP-OL-7: a window past the last page adds a page at the end flag, then the move", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step } = await onOutline(db, boxPlaces);
        const r0 = await resolverOf(db);
        const at49 = IDS.map((m) => r0.positionAt(m, 9) as XY);
        // the outline again at the last page's flag
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 41, end: 49 },
            moves: IDS.map((m, i) => ({
                marcherId: m,
                x: at49[i]![0],
                y: at49[i]![1],
            })),
        });
        const original = await dataOf(db);
        const result = await goRound({ db, window: { start: 49, end: 57 }, marcherIds: IDS, leaderId: null, reversed: false, amount: 2, unit: "spots", step }); // prettier-ignore
        expect(result.addedPage).toEqual({ startBeat: 49, endBeat: 57 });
        const r = await resolverOf(db);
        IDS.forEach((m, i) =>
            expect(near(r.positionAt(m, 57), at49[(i + 2) % 8]!)).toBe(true),
        );
        await expectOneUndoStep(db, original);
    });

    it("QA-AP-OL-8: the leader's spot moved off the outline after: it leaves the outline at the nearest point and walks straight to it; the others unmoved", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await onOutline(db, boxPlaces);
        await goRound({ db, window: WINDOW, marcherIds: IDS, leaderId: null, reversed: false, amount: 1, unit: "spots", step }); // prettier-ignore
        const r0 = await resolverOf(db);
        const t = await trailOf(db);
        const moved: XY = [at[2]![0], at[2]![1] - 3 * step];
        await moveMarchersInTarget({ db, target: { kind: "range", ...WINDOW }, moves: [{ marcherId: 2, x: moved[0], y: moved[1] }] }); // prettier-ignore
        const r1 = await resolverOf(db);
        expect(near(r1.positionAt(2, 17), moved)).toBe(true);
        for (const m of IDS.filter((x) => x !== 2))
            for (let b = 9; b <= 17; b += 0.5)
                expect(r1.positionAt(m, b)).toEqual(r0.positionAt(m, b));
        // still round the outline, then straight up off it
        const loop = makeLoop((await trailOf(db)).geometry)!;
        expect(t.around).toBe(true);
        const mid = r1.positionAt(2, 12);
        const onIt = loop.L > 0 && nearestOnLoop(loop, mid as XY) >= 0;
        expect(onIt).toBe(true);
    });
});
