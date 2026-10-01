import { describe, expect, it } from "vitest";
import type { ShapeRow, TransitionRow, XY } from "@openmarch/core";
import {
    buildTransitionEditTarget,
    clampBulge,
    DEFAULT_BULGE,
    editableTransitionId,
    followTheLeaderBlocker,
    planTransitionEdit,
    resizePoints,
    shapeSlotPoints,
    transitionShapeOptions,
    type TransitionEditTarget,
} from "../timelineTransitionEditor";
import { golden, inspect } from "./inspectorFixtures";

/** P8.3: the transition editor's planning, without React or a database. */

const LINE: ShapeRow = {
    kind: "line",
    geometry: {
        points: [
            [0, 0],
            [10, 0],
        ],
    },
};
const BLOCK: ShapeRow = {
    kind: "block",
    geometry: { origin: [0, 0], rows: 2, cols: 2, spacing: [2, 3] },
};

const row = (over: Partial<TransitionRow> = {}): TransitionRow => ({
    id: 7,
    start: 0,
    end: 8,
    dest: 1,
    slots: 3,
    style: "direct",
    order: "inherit",
    params: null,
    ...over,
});

const targetOf = (
    over: Partial<TransitionRow> = {},
    slotsTaken: number[] = [],
): TransitionEditTarget =>
    buildTransitionEditTarget(7, {
        transitions: { 7: row(over) },
        shapes: { 1: LINE, 2: BLOCK },
        assignments: slotsTaken.map((slot, i) => ({
            id: i + 1,
            marcher: i + 1,
            transition: 7,
            slot,
            start: 0,
            end: 8,
            layer: 0,
        })),
    })!;

const near = (actual: readonly XY[], expected: readonly XY[]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(expected[i]![0], 9);
        expect(p[1]).toBeCloseTo(expected[i]![1], 9);
    });
};

describe("buildTransitionEditTarget", () => {
    it("reads style, params, destination and the smallest slot count that keeps every assigned slot", () => {
        const arc = targetOf({ style: "arc", params: { bulge: -0.3 } }, [0, 2]);
        expect(arc).toMatchObject({
            id: 7,
            style: "arc",
            bulge: -0.3,
            waypoints: [],
            slotCount: 3,
            minSlotCount: 3,
            destination: { kind: "shape", shapeId: 1, shape: LINE },
        });
        const ftl = targetOf({
            style: "follow_the_leader",
            params: { waypoints: [[1, 2]] },
        });
        expect(ftl.waypoints).toEqual([[1, 2]]);
        expect(ftl.bulge).toBeNull();
        expect(ftl.minSlotCount).toBe(1);
        const points = targetOf({
            dest: null,
            points: [
                [1, 1],
                [2, 2],
                [3, 3],
            ],
        });
        expect(points.destination).toEqual({
            kind: "individual",
            points: [
                [1, 1],
                [2, 2],
                [3, 3],
            ],
        });
    });

    it("is null for a transition the resolver doesn't have", () => {
        expect(
            buildTransitionEditTarget(99, {
                transitions: {},
                shapes: {},
                assignments: [],
            }),
        ).toBeNull();
    });
});

describe("editableTransitionId", () => {
    it("is the transition of the current span, or the one ending at the beat for a hold", () => {
        const show = golden("G1");
        expect(editableTransitionId(inspect(show, 1, 8))).toBe(1);
        // G1's transition 1 is [0, 16): at 16 the marcher holds where it ended
        expect(editableTransitionId(inspect(show, 1, 16))).toBe(1);
        // Later in the hold, nothing ends here
        expect(editableTransitionId(inspect(show, 1, 20))).toBeNull();
    });
});

describe("follow-the-leader blockers", () => {
    it("needs a shape (I-T5), and not a block (I-T3)", () => {
        expect(followTheLeaderBlocker(targetOf())).toBeNull();
        expect(
            followTheLeaderBlocker(targetOf({ dest: null, points: [] })),
        ).toBe("noShape");
        expect(followTheLeaderBlocker(targetOf({ dest: 2 }))).toBe("block");
    });
});

describe("clampBulge", () => {
    it("clamps to the minor arcs, |k| ≤ ½ (D-15), and rejects non-numbers", () => {
        expect(clampBulge(0.2)).toBe(0.2);
        expect(clampBulge(2)).toBe(0.5);
        expect(clampBulge(-0.9)).toBe(-0.5);
        expect(clampBulge(Number.NaN)).toBeNull();
        expect(clampBulge(Infinity)).toBeNull();
    });
});

describe("resizePoints", () => {
    it("keeps the first points and starts new slots at the last point", () => {
        const pts: XY[] = [
            [1, 1],
            [2, 2],
        ];
        expect(resizePoints(pts, 1)).toEqual([[1, 1]]);
        expect(resizePoints(pts, 4)).toEqual([
            [1, 1],
            [2, 2],
            [2, 2],
            [2, 2],
        ]);
        expect(resizePoints([], 2)).toEqual([
            [0, 0],
            [0, 0],
        ]);
    });
});

describe("shapeSlotPoints (R-13)", () => {
    it("samples a line evenly, end to end", () => {
        expect(shapeSlotPoints(LINE, 3)).toEqual([
            [0, 0],
            [5, 0],
            [10, 0],
        ]);
        expect(shapeSlotPoints(LINE, 1)).toEqual([[0, 0]]);
    });

    it("fills a block row by row", () => {
        expect(shapeSlotPoints(BLOCK, 3)).toEqual([
            [0, 0],
            [2, 0],
            [0, 3],
        ]);
    });

    it("spaces a circle's slots around it from the start angle", () => {
        near(
            shapeSlotPoints(
                {
                    kind: "circle",
                    geometry: {
                        center: [0, 0],
                        radius: 10,
                        start_angle: 0,
                        clockwise: false,
                    },
                },
                4,
            ),
            [
                [10, 0],
                [0, 10],
                [-10, 0],
                [0, -10],
            ],
        );
    });
});

describe("transitionShapeOptions", () => {
    it("lists every shape by id with its name and kind", () => {
        expect(
            transitionShapeOptions({ 2: BLOCK, 1: LINE }, [
                { id: 1, name: "Opener line" },
            ]),
        ).toEqual([
            { id: 1, name: "Opener line", kind: "line" },
            { id: 2, name: null, kind: "block" },
        ]);
    });
});

describe("planTransitionEdit", () => {
    it("skips every change that writes nothing", () => {
        const arc = targetOf({ style: "arc", params: { bulge: 0.2 } });
        expect(
            planTransitionEdit(arc, { kind: "pathStyle", style: "arc" }),
        ).toBeNull();
        expect(
            planTransitionEdit(arc, { kind: "bulge", bulge: 0.2 }),
        ).toBeNull();
        expect(
            planTransitionEdit(arc, { kind: "orderMode", order: "inherit" }),
        ).toBeNull();
        expect(
            planTransitionEdit(arc, { kind: "slotCount", slotCount: 3 }),
        ).toBeNull();
        expect(
            planTransitionEdit(arc, { kind: "destinationShape", shapeId: 1 }),
        ).toBeNull();
        const ftl = targetOf({
            style: "follow_the_leader",
            params: { waypoints: [[1, 2]] },
        });
        expect(
            planTransitionEdit(ftl, { kind: "waypoints", waypoints: [[1, 2]] }),
        ).toBeNull();
        const points = targetOf({
            dest: null,
            points: [
                [0, 0],
                [1, 1],
                [2, 2],
            ],
        });
        expect(
            planTransitionEdit(points, { kind: "destinationIndividual" }),
        ).toBeNull();
    });

    it("a style change carries the new style's parameters", () => {
        const direct = targetOf();
        expect(
            planTransitionEdit(direct, { kind: "pathStyle", style: "arc" }),
        ).toEqual({
            fn: "update",
            args: {
                id: 7,
                pathStyle: "arc",
                pathParams: { bulge: DEFAULT_BULGE },
            },
        });
        expect(
            planTransitionEdit(direct, {
                kind: "pathStyle",
                style: "follow_the_leader",
            }),
        ).toEqual({
            fn: "update",
            args: {
                id: 7,
                pathStyle: "follow_the_leader",
                pathParams: { waypoints: [] },
            },
        });
        expect(
            planTransitionEdit(
                targetOf({ style: "arc", params: { bulge: 0.1 } }),
                {
                    kind: "pathStyle",
                    style: "direct",
                },
            ),
        ).toEqual({
            fn: "update",
            args: { id: 7, pathStyle: "direct", pathParams: null },
        });
    });

    it("bulge, waypoints and order mode update only their own field", () => {
        expect(
            planTransitionEdit(
                targetOf({ style: "arc", params: { bulge: 0 } }),
                {
                    kind: "bulge",
                    bulge: -0.5,
                },
            ),
        ).toEqual({
            fn: "update",
            args: { id: 7, pathParams: { bulge: -0.5 } },
        });
        expect(
            planTransitionEdit(
                targetOf({
                    style: "follow_the_leader",
                    params: { waypoints: [] },
                }),
                { kind: "waypoints", waypoints: [[3, 4]] },
            ),
        ).toEqual({
            fn: "update",
            args: { id: 7, pathParams: { waypoints: [[3, 4]] } },
        });
        expect(
            planTransitionEdit(targetOf(), {
                kind: "orderMode",
                order: "slot",
            }),
        ).toEqual({ fn: "update", args: { id: 7, orderMode: "slot" } });
    });

    it("a slot count change carries resized points for a shapeless transition", () => {
        expect(
            planTransitionEdit(targetOf(), { kind: "slotCount", slotCount: 5 }),
        ).toEqual({ fn: "update", args: { id: 7, slotCount: 5 } });
        const points = targetOf({
            dest: null,
            points: [
                [0, 0],
                [1, 1],
                [2, 2],
            ],
        });
        expect(
            planTransitionEdit(points, { kind: "slotCount", slotCount: 4 }),
        ).toEqual({
            fn: "update",
            args: {
                id: 7,
                slotCount: 4,
                points: [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                    [2, 2],
                ],
            },
        });
        expect(
            planTransitionEdit(points, { kind: "slotCount", slotCount: 2 }),
        ).toEqual({
            fn: "update",
            args: {
                id: 7,
                slotCount: 2,
                points: [
                    [0, 0],
                    [1, 1],
                ],
            },
        });
    });

    it("switching to individual points copies the shape's samples (D-16), and back to a shape", () => {
        expect(
            planTransitionEdit(targetOf(), { kind: "destinationIndividual" }),
        ).toEqual({
            fn: "destination",
            args: {
                transitionId: 7,
                destination: {
                    kind: "individual",
                    points: [
                        [0, 0],
                        [5, 0],
                        [10, 0],
                    ],
                },
            },
        });
        expect(
            planTransitionEdit(targetOf({ dest: null, points: [] }), {
                kind: "destinationShape",
                shapeId: 2,
            }),
        ).toEqual({
            fn: "destination",
            args: {
                transitionId: 7,
                destination: { kind: "shape", shapeId: 2 },
            },
        });
    });
});
