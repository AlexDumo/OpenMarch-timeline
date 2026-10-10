import { describe, expect, it } from "vitest";
import { assignSlots } from "../assign";
import { fitCircle, principalExtremes } from "../geometry/fit";
import { makePath } from "../geometry/path";
import { dist, polar, xy } from "../geometry/vec";
import { arcKind, arcMiddle, arcSegment, type ArcParams } from "../kinds/arc";
import { lineKind, type LineParams } from "../kinds/line";
import { SHAPE_KINDS } from "../registry";
import {
    describeGaps,
    formatIntervals,
    gapsInSteps,
    parseIntervals,
    sampleAlong,
} from "../spacing";
import type { ShapeContext, Spacing } from "../types";
import { validateSlots } from "../validate";

const STEP = 10;
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const close = (a: number, b: number, eps = 1e-6) =>
    expect(Math.abs(a - b)).toBeLessThan(eps);

describe("parseIntervals", () => {
    it("reads a single interval as repeating", () => {
        expect(parseIntervals("2")).toEqual({
            ok: true,
            runs: [{ steps: 2, count: 0 }],
        });
        expect(parseIntervals(" 1.5 ")).toEqual({
            ok: true,
            runs: [{ steps: 1.5, count: 0 }],
        });
    });

    it("reads mixed runs as steps x count", () => {
        expect(parseIntervals("5x3, 2x4")).toEqual({
            ok: true,
            runs: [
                { steps: 5, count: 3 },
                { steps: 2, count: 4 },
            ],
        });
        expect(parseIntervals("4×2")).toEqual({
            ok: true,
            runs: [{ steps: 4, count: 2 }],
        });
    });

    it("refuses what it can't read, with a reason", () => {
        for (const text of ["", "x3", "2x", "0", "2x0", "abc", "4,,x"]) {
            const parsed = parseIntervals(text);
            expect(parsed.ok, text).toBe(false);
            if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0);
        }
    });

    it("reads a list as one gap each, mixed with runs", () => {
        expect(parseIntervals("4,4,2")).toEqual({
            ok: true,
            runs: [
                { steps: 4, count: 1 },
                { steps: 4, count: 1 },
                { steps: 2, count: 1 },
            ],
        });
        const mixed = parseIntervals("4x3,2,2");
        if (!mixed.ok) throw new Error(mixed.message);
        expect(gapsInSteps(mixed.runs, 5)).toEqual([4, 4, 4, 2, 2]);
    });

    it("says when a list repeats or runs over", () => {
        const runs = [
            { steps: 5, count: 2 },
            { steps: 2, count: 4 },
        ];
        expect(describeGaps(runs, 8)).toBe(
            "7 gaps needed, 6 typed: repeating from the first",
        );
        expect(describeGaps(runs, 7)).toBeUndefined();
        expect(describeGaps(runs, 5)).toBe(
            "4 gaps needed, 6 typed: the last 2 unused",
        );
        expect(describeGaps([{ steps: 2, count: 0 }], 8)).toBeUndefined();
    });

    it("round-trips through formatIntervals", () => {
        for (const text of ["2", "5x3,2x4", "1.5x2,4", "4,4,2", "4x3,2"]) {
            const parsed = parseIntervals(text);
            if (!parsed.ok) throw new Error(parsed.message);
            expect(formatIntervals(parsed.runs)).toBe(text);
        }
    });
});

describe("gapsInSteps", () => {
    it("expands runs and repeats them when there are more gaps", () => {
        const runs = [
            { steps: 5, count: 2 },
            { steps: 2, count: 1 },
        ];
        expect(gapsInSteps(runs, 3)).toEqual([5, 5, 2]);
        expect(gapsInSteps(runs, 5)).toEqual([5, 5, 2, 5, 5]);
        expect(gapsInSteps(runs, 2)).toEqual([5, 5]);
        expect(gapsInSteps([{ steps: 3, count: 0 }], 4)).toEqual([3, 3, 3, 3]);
    });
});

describe("paths", () => {
    it("measures and walks a line, continuing past its ends", () => {
        const path = makePath([{ type: "line", a: xy(0, 0), b: xy(30, 40) }]);
        close(path.length, 50);
        expect(path.at(25)).toEqual(xy(15, 20));
        expect(path.at(100)).toEqual(xy(60, 80));
        close(path.project(xy(15 + 4, 20 - 3)), 25);
    });

    it("walks an arc around its circle", () => {
        const path = makePath([
            {
                type: "arc",
                center: xy(0, 0),
                r: 10,
                start: 0,
                sweep: Math.PI / 2,
            },
        ]);
        close(path.length, 5 * Math.PI);
        const quarter = path.at(5 * Math.PI);
        close(quarter.x, 0);
        close(quarter.y, 10);
    });

    it("measures a straight cubic like a line", () => {
        const path = makePath([
            {
                type: "cubic",
                a: xy(0, 0),
                c1: xy(10, 0),
                c2: xy(20, 0),
                b: xy(30, 0),
            },
        ]);
        close(path.length, 30, 1e-3);
        close(path.at(15).x, 15, 1e-2);
    });

    it("wraps a closed path", () => {
        const path = makePath(
            [
                {
                    type: "arc",
                    center: xy(0, 0),
                    r: 10,
                    start: 0,
                    sweep: 2 * Math.PI,
                },
            ],
            true,
        );
        const p = path.at(path.length + 1);
        const q = path.at(1);
        close(p.x, q.x);
        close(p.y, q.y);
    });
});

describe("sampleAlong", () => {
    const path = makePath([{ type: "line", a: xy(0, 0), b: xy(100, 0) }]);

    it("fits marchers evenly over the path", () => {
        const slots = sampleAlong(path, { mode: "fit" }, 5, STEP);
        expect(slots.map((s) => s.x)).toEqual([0, 25, 50, 75, 100]);
    });

    it("lays fixed intervals from the anchor", () => {
        const runs = [{ steps: 2, count: 0 }];
        const fromStart = sampleAlong(
            path,
            { mode: "interval", runs, anchor: "start" },
            3,
            STEP,
        );
        fromStart.forEach((s, i) => close(s.x, [0, 20, 40][i]!, 1e-6));
        const fromEnd = sampleAlong(
            path,
            { mode: "interval", runs, anchor: "end" },
            3,
            STEP,
        );
        fromEnd.forEach((s, i) => close(s.x, [60, 80, 100][i]!, 1e-6));
        const centered = sampleAlong(
            path,
            { mode: "interval", runs, anchor: "center" },
            3,
            STEP,
        );
        centered.forEach((s, i) => close(s.x, [30, 50, 70][i]!, 1e-6));
    });

    it("lays mixed intervals in order and runs past a short path", () => {
        const spacing: Spacing = {
            mode: "interval",
            runs: [
                { steps: 5, count: 1 },
                { steps: 8, count: 2 },
            ],
            anchor: "start",
        };
        const slots = sampleAlong(path, spacing, 4, STEP);
        slots.forEach((s, i) => close(s.x, [0, 50, 130, 210][i]!, 1e-6));
    });

    it("measures intervals straight between neighbors on a curve", () => {
        const arc = makePath([
            { type: "arc", center: xy(0, 0), r: 30, start: 0, sweep: Math.PI },
        ]);
        const slots = sampleAlong(
            arc,
            {
                mode: "interval",
                runs: [{ steps: 2, count: 0 }],
                anchor: "start",
            },
            4,
            STEP,
        );
        slots
            .slice(1)
            .forEach((slot, i) => close(dist(slot, slots[i]!), 20, 1e-6));
        // Each gap reaches a little farther along the arc than its 20-unit chord
        expect(slots[1]!.s!).toBeGreaterThan(20);
    });

    it("puts one marcher in the middle when fitting", () => {
        expect(sampleAlong(path, { mode: "fit" }, 1, STEP)[0]!.x).toBe(50);
    });
});

describe("fitting", () => {
    it("finds the ends of a rough row, left to right", () => {
        const ends = principalExtremes([
            xy(50, 1),
            xy(0, 0),
            xy(100, -1),
            xy(25, 0.5),
        ]);
        expect(ends).toBeDefined();
        const [a, b] = ends!;
        expect(a.x).toBeLessThan(b.x);
        close(a.x, 0, 0.1);
        close(b.x, 100, 0.1);
    });

    it("fits a circle through points on one", () => {
        const points = [0, 1, 2, 3, 4].map((i) =>
            polar(xy(5, -3), 20, i * 0.4),
        );
        const circle = fitCircle(points)!;
        close(circle.center.x, 5);
        close(circle.center.y, -3);
        close(circle.r, 20);
    });

    it("gives no circle for points on a line", () => {
        expect(fitCircle([xy(0, 0), xy(1, 1), xy(2, 2)])).toBeUndefined();
    });
});

describe("line kind", () => {
    it("fits a messy row and tidies it in place", () => {
        const current = [xy(0, 0), xy(31, 2), xy(58, -1), xy(90, 0)];
        const params = lineKind.fit({ current }, ctx);
        const slots = lineKind.generate(params, current.length, ctx);
        expect(slots).toHaveLength(4);
        for (let i = 0; i < 4; i++) close(slots[i]!.x, current[i]!.x, 6);
        close(dist(slots[0]!, slots[1]!), dist(slots[2]!, slots[3]!));
    });

    it("drags an end with Shift to a 45° direction", () => {
        const params: LineParams = {
            a: xy(0, 0),
            b: xy(10, 0),
            spacing: { mode: "fit" },
        };
        const next = lineKind.drag(
            params,
            "b",
            xy(10, 9),
            { shift: true },
            2,
            ctx,
        );
        close(next.b.x, next.b.y);
    });

    it("moves the whole line with the move handle", () => {
        const params: LineParams = {
            a: xy(0, 0),
            b: xy(10, 0),
            spacing: { mode: "fit" },
        };
        const next = lineKind.drag(
            params,
            "move",
            xy(5, 10),
            { shift: false },
            2,
            ctx,
        );
        expect(next.a).toEqual(xy(0, 10));
        expect(next.b).toEqual(xy(10, 10));
    });

    it("reports the run, not the shape, when the run is laid on it", () => {
        const params: LineParams = {
            a: xy(0, 0),
            b: xy(10, 0),
            spacing: {
                mode: "interval",
                runs: [{ steps: 2, count: 0 }],
                anchor: "start",
            },
        };
        expect(lineKind.readouts!(params, 6, ctx)).toEqual([
            { label: "Run", value: "10 steps" },
        ]);
    });
});

describe("arc kind", () => {
    const params: ArcParams = {
        a: xy(-10, 0),
        b: xy(10, 0),
        bulge: 10,
        spacing: { mode: "fit" },
    };

    it("is a half circle when the bulge is half the chord", () => {
        const segment = arcSegment(params);
        expect(segment.type).toBe("arc");
        if (segment.type !== "arc") return;
        close(segment.r, 10);
        close(segment.center.x, 0);
        close(segment.center.y, 0);
        close(Math.abs(segment.sweep), Math.PI);
    });

    it("goes through its bulge handle", () => {
        const slots = arcKind.generate(params, 3, ctx);
        const middle = arcMiddle(params);
        close(slots[1]!.x, middle.x);
        close(slots[1]!.y, middle.y);
        close(slots[0]!.x, -10);
        close(slots[2]!.x, 10);
    });

    it("bends the other way with a negative bulge", () => {
        const flipped = { ...params, bulge: -10 };
        const up = arcKind.generate(params, 3, ctx)[1]!;
        const down = arcKind.generate(flipped, 3, ctx)[1]!;
        close(up.y, -down.y);
    });

    it("is a line when flat, and says so", () => {
        const flat = { ...params, bulge: 0 };
        expect(arcSegment(flat).type).toBe("line");
        expect(arcKind.validate!(flat, [], ctx)[0]?.level).toBe("info");
    });

    it("fits marchers standing on an arc", () => {
        const current = [0.3, 0.6, 0.9, 1.2, 1.5].map((t) =>
            polar(xy(0, 0), 50, t),
        );
        const fitted = arcKind.fit({ current }, ctx);
        const slots = arcKind.generate(fitted, current.length, ctx);
        const ends = [slots[0]!, slots.at(-1)!];
        const firstMatch = Math.min(...ends.map((s) => dist(s, current[0]!)));
        const lastMatch = Math.min(
            ...ends.map((s) => dist(s, current.at(-1)!)),
        );
        expect(firstMatch).toBeLessThan(1e-6);
        expect(lastMatch).toBeLessThan(1e-6);
        for (const s of slots) close(dist(s, xy(0, 0)), 50, 1e-6);
    });

    it("keeps its proportions when an end is dragged", () => {
        const next = arcKind.drag(
            params,
            "b",
            xy(30, 0),
            { shift: false },
            3,
            ctx,
        );
        close(
            next.bulge / dist(next.a, next.b),
            params.bulge / dist(params.a, params.b),
        );
    });
});

describe("assignSlots", () => {
    const slots = sampleAlong(
        makePath([{ type: "line", a: xy(0, 0), b: xy(30, 0) }]),
        { mode: "fit" },
        4,
        STEP,
    );
    const params: LineParams = {
        a: xy(0, 0),
        b: xy(30, 0),
        spacing: { mode: "fit" },
    };
    const marchers = [
        { id: 1, at: xy(31, 5), drillRank: 0 },
        { id: 2, at: xy(1, 5), drillRank: 1 },
        { id: 3, at: xy(19, 5), drillRank: 2 },
        { id: 4, at: xy(11, 5), drillRank: 3 },
    ];

    it("nearest sends each marcher to the spot closest overall", () => {
        expect(
            assignSlots({
                kind: lineKind,
                params,
                slots,
                marchers,
                mode: "nearest",
                ctx,
            }),
        ).toEqual([3, 0, 2, 1]);
    });

    it("keep order follows the marchers' order along the shape", () => {
        expect(
            assignSlots({
                kind: lineKind,
                params,
                slots,
                marchers,
                mode: "keep",
                ctx,
            }),
        ).toEqual([3, 0, 2, 1]);
        expect(
            assignSlots({
                kind: lineKind,
                params,
                slots,
                marchers,
                mode: "keep",
                reverse: true,
                ctx,
            }),
        ).toEqual([0, 3, 1, 2]);
    });

    it("drill order fills the shape by drill number", () => {
        expect(
            assignSlots({
                kind: lineKind,
                params,
                slots,
                marchers,
                mode: "drill",
                ctx,
            }),
        ).toEqual([0, 1, 2, 3]);
    });
});

describe("validateSlots", () => {
    it("flags marchers on the same spot and too close", () => {
        const issues = validateSlots(
            [xy(0, 0), xy(0, 0), xy(5, 0), xy(100, 0)],
            ctx,
        );
        expect(issues.map((i) => i.level)).toEqual(["error", "warning"]);
        expect([...issues[0]!.slots!].sort()).toEqual([0, 1]);
    });

    it("is quiet for well-spaced marchers", () => {
        expect(validateSlots([xy(0, 0), xy(20, 0), xy(40, 0)], ctx)).toEqual(
            [],
        );
    });
});

describe("registry", () => {
    it("has unique kind ids, and every kind round-trips fit → generate", () => {
        const ids = SHAPE_KINDS.map((k) => k.id);
        expect(new Set(ids).size).toBe(ids.length);
        const current = [xy(0, 0), xy(20, 5), xy(40, 0), xy(60, -5), xy(80, 0)];
        for (const kind of SHAPE_KINDS) {
            const params = kind.fit({ current }, ctx);
            const slots = kind.generate(params, current.length, ctx);
            expect(slots, kind.id).toHaveLength(current.length);
            expect(
                kind.handles(params, current.length, ctx).length,
                kind.id,
            ).toBeGreaterThan(0);
            expect(
                kind.outline(params, current.length, ctx).length,
                kind.id,
            ).toBeGreaterThan(0);
        }
    });
});
