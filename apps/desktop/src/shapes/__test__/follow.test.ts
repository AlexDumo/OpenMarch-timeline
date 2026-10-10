import { describe, expect, it } from "vitest";
import { dist, xy } from "../geometry/vec";
import type { ArcParams } from "../kinds/arc";
import type { BlockParams } from "../kinds/block";
import type { LineParams } from "../kinds/line";
import { arcSegment } from "../kinds/arc";
import { blockKind } from "../kinds/block";
import {
    changeMeasure,
    changeParams,
    dragHandle,
    previewSession,
    startSession,
    type ShapeSession,
} from "../session";
import { shapeKind } from "../registry";
import type { ShapeContext, Spacing } from "../types";

const STEP = 10;
const arcRadius = (p: ArcParams) => {
    const segment = arcSegment(p);
    return segment.type === "arc" ? segment.r : Infinity;
};
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const close = (a: number, b: number, eps = 1e-6) =>
    expect(Math.abs(a - b)).toBeLessThan(eps);

const row = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        at: xy(i * 30, 0),
        drillRank: i,
    }));

const keepTwo = (
    anchor: "start" | "center" | "end" = "start",
    size: "follow" | "keep" = "follow",
): Spacing => ({
    mode: "interval",
    runs: [{ steps: 2, count: 0 }],
    anchor,
    size,
});

function locked(kindId: string, n: number, spacing = keepTwo()): ShapeSession {
    const session = startSession({ kindId, marchers: row(n), ctx });
    return changeParams(
        session,
        { ...(session.params as object), spacing },
        ctx,
    );
}

const pathLength = (session: ShapeSession) =>
    shapeKind(session.kindId)!.path!(session.params).length;

/** Every neighbor `steps` apart in a straight line */
function expectGaps(session: ShapeSession, steps: number) {
    const slots = previewSession(session, ctx).slots;
    slots
        .slice(1)
        .forEach((slot, i) => close(dist(slot, slots[i]!), steps * STEP, 1e-6));
    return slots;
}

describe("keeping a locked interval", () => {
    it("resizes a line to the run when the interval is typed", () => {
        // 5 marchers at 2 steps: 4 gaps, 8 steps
        const session = locked("line", 5);
        close(pathLength(session), 8 * STEP);
        const xs = previewSession(session, ctx).slots.map((s) => s.x);
        xs.slice(1).forEach((x, i) => close(x - xs[i]!, 2 * STEP));
    });

    it("keeps the anchor point when the length changes", () => {
        const before = startSession({ kindId: "line", marchers: row(5), ctx });
        const p = before.params as LineParams;
        const middle = (p.a.x + p.b.x) / 2;
        const centered = changeParams(
            before,
            { ...p, spacing: keepTwo("center") },
            ctx,
        );
        const q = centered.params as LineParams;
        close((q.a.x + q.b.x) / 2, middle);
    });

    it("aims a dragged line end: the other end stays, the length stays", () => {
        const session = locked("line", 5);
        const p = session.params as LineParams;
        const dragged = dragHandle(session, p, "b", xy(0, 300), false, ctx);
        const q = dragged.params as LineParams;
        expect(q.a).toEqual(p.a);
        close(dist(q.a, q.b), 8 * STEP);
        // On the ray toward the cursor
        close(q.b.x, p.a.x, 1e-6);
        expect(q.b.y).toBeGreaterThan(0);
    });

    it("keeps the drawn line when the size is locked too", () => {
        const fit = startSession({ kindId: "line", marchers: row(5), ctx });
        const drawn = pathLength(fit);
        const kept = changeParams(
            fit,
            {
                ...(fit.params as object),
                spacing: keepTwo("start", "keep"),
            },
            ctx,
        );
        close(pathLength(kept), drawn);
    });

    it("typing the size while it follows locks it", () => {
        const session = locked("line", 5);
        const typed = changeMeasure(session, "length", 20 * STEP, ctx);
        const spacing = (typed.params as LineParams).spacing;
        expect(spacing.mode === "interval" && spacing.size).toBe("keep");
        close(pathLength(typed), 20 * STEP);
    });

    it("gives a circle the radius its n gaps need, keeping its center", () => {
        const fit = startSession({ kindId: "circle", marchers: row(16), ctx });
        const center = (fit.params as { center: { x: number; y: number } })
            .center;
        const session = changeParams(
            fit,
            { ...(fit.params as object), spacing: keepTwo() },
            ctx,
        );
        const p = session.params as { r: number; center: typeof center };
        // 16 chords of 2 steps close the circle
        close(p.r, (2 * STEP) / (2 * Math.sin(Math.PI / 16)), 1e-6);
        expect(p.center).toEqual(center);
        const slots = expectGaps(session, 2);
        // Even all the way round: the gap that closes the circle is 2 steps too
        close(dist(slots[0]!, slots[15]!), 2 * STEP, 1e-6);
    });

    it("only turns a circle's start when its rim is dragged", () => {
        const session = locked("circle", 8);
        const p = session.params as {
            r: number;
            center: { x: number; y: number };
            start: number;
        };
        const far = xy(p.center.x, p.center.y + 1000);
        const dragged = dragHandle(session, p, "radius", far, false, ctx)
            .params as typeof p;
        close(dragged.r, p.r);
        close(dragged.start, Math.PI / 2);
    });

    it("keeps an arc's interval when its radius is typed", () => {
        const session = locked("arc", 6);
        const typed = changeMeasure(session, "radius", 12 * STEP, ctx);
        const slots = expectGaps(typed, 2);
        const p = typed.params as ArcParams;
        // The run reaches exactly from end to end
        close(dist(slots.at(-1)!, p.b), 0, 1e-6);
        close(arcRadius(p), 12 * STEP, 1e-6);
    });

    it("keeps an arc's interval when its bulge is dragged", () => {
        const session = locked("arc", 6);
        const p = session.params as ArcParams;
        const dragged = dragHandle(
            session,
            p,
            "bulge",
            xy((p.a.x + p.b.x) / 2, p.a.y + 200),
            false,
            ctx,
        );
        const slots = expectGaps(dragged, 2);
        close(dist(slots.at(-1)!, (dragged.params as ArcParams).b), 0, 1e-6);
    });

    it("bends a locked arc so a dragged end lands under the cursor", () => {
        const session = locked("arc", 6);
        const p = session.params as ArcParams;
        // 5 gaps of 2 steps reach 10 steps straight; aim at 7 steps from the fixed end
        const target = xy(p.a.x + 7 * STEP, p.a.y);
        const dragged = dragHandle(session, p, "b", target, false, ctx);
        const q = dragged.params as ArcParams;
        expect(q.a).toEqual(p.a);
        close(dist(q.b, target), 0, 1e-6);
        expect(Math.abs(q.bulge)).toBeGreaterThan(0);
        const slots = expectGaps(dragged, 2);
        close(dist(slots.at(-1)!, target), 0, 1e-6);
    });

    it("straightens a locked arc when its end is pulled past the run", () => {
        const session = locked("arc", 6);
        const p = session.params as ArcParams;
        const dragged = dragHandle(
            session,
            p,
            "b",
            xy(p.a.x + 50 * STEP, p.a.y),
            false,
            ctx,
        );
        const q = dragged.params as ArcParams;
        expect(q.bulge).toBe(0);
        close(dist(q.a, q.b), 10 * STEP, 1e-6);
    });

    it("keeps a curve's drawn path and lays the locked interval along it", () => {
        const fit = startSession({ kindId: "curve", marchers: row(7), ctx });
        const drawn = pathLength(fit);
        const session = locked("curve", 7);
        close(pathLength(session), drawn, 1e-6);
        const spacing = (session.params as { spacing: Spacing }).spacing;
        expect(spacing.mode === "interval" && spacing.size).toBe("keep");
        expectGaps(session, 2);
    });

    it("adds and removes curve points by double-click", () => {
        const session = startSession({
            kindId: "curve",
            marchers: row(7),
            ctx,
        });
        const kind = shapeKind("curve")!;
        const p = session.params as { points: { x: number; y: number }[] };
        const added = kind.insertPoint!(p, xy(45, 0)) as typeof p;
        expect(added.points).toHaveLength(p.points.length + 1);
        const removed = kind.removePoint!(added, "p1") as typeof p;
        expect(removed.points).toHaveLength(p.points.length);
        expect(
            kind.removePoint!({ ...p, points: p.points.slice(0, 2) }, "p0"),
        ).toBeUndefined();
    });
});

describe("block intervals", () => {
    const base: BlockParams = {
        center: xy(0, 0),
        rotation: 0,
        files: 4,
        across: 2 * STEP,
        deep: 2 * STEP,
        pattern: "grid",
        shortRank: "start",
        keepIntervals: true,
    };

    it("changes the files one at a time, the other side staying put", () => {
        // 4 files 2 steps apart: the left file at -3 steps. To +7 steps is 5 intervals: 6 files
        const next = blockKind.drag(
            base,
            "across",
            xy(7 * STEP, 0),
            { shift: false },
            12,
            ctx,
        );
        expect(next.across).toBe(base.across);
        expect(next.files).toBe(6);
        const left = (b: BlockParams) =>
            Math.min(...blockKind.generate(b, 12, ctx).map((s) => s.x));
        close(left(next), left(base));
        expect(
            blockKind.handles(base, 12, ctx).some((h) => h.key === "deep"),
        ).toBe(false);
    });

    it("stretches the interval when the intervals aren't kept", () => {
        const free = { ...base, keepIntervals: false };
        const next = blockKind.drag(
            free,
            "across",
            xy(6 * STEP, 0),
            { shift: false },
            12,
            ctx,
        );
        expect(next.files).toBe(4);
        close(next.across, 4 * STEP);
    });

    it("never makes more files than marchers", () => {
        const next = blockKind.drag(
            base,
            "across",
            xy(500 * STEP, 0),
            { shift: false },
            5,
            ctx,
        );
        expect(next.files).toBe(5);
    });
});

describe("a closed size lock in Fit", () => {
    it("keeps a circle's radius when its rim is dragged, only turning it", () => {
        const fit = startSession({ kindId: "circle", marchers: row(8), ctx });
        const session = changeParams(
            fit,
            {
                ...(fit.params as object),
                spacing: { mode: "fit", sizeLocked: true },
            },
            ctx,
        );
        const p = session.params as {
            r: number;
            center: { x: number; y: number };
        };
        const dragged = dragHandle(
            session,
            p,
            "radius",
            xy(p.center.x, p.center.y + 1000),
            false,
            ctx,
        ).params as typeof p;
        close(dragged.r, p.r, 1e-6);
        expect(dragged.center).toEqual(p.center);
    });

    it("keeps a line's length about its middle when Length is typed", () => {
        const session = startSession({ kindId: "line", marchers: row(5), ctx });
        const p = session.params as LineParams;
        const middle = (p.a.x + p.b.x) / 2;
        const typed = changeMeasure(session, "length", 20 * STEP, ctx);
        const q = typed.params as LineParams;
        close((q.a.x + q.b.x) / 2, middle, 1e-6);
        close(dist(q.a, q.b), 20 * STEP, 1e-6);
        const spacing = q.spacing;
        expect(spacing.mode === "fit" && spacing.sizeLocked).toBe(true);
    });
});

describe("circle fit", () => {
    it("centers on the marchers when they cover less than half a circle", () => {
        const arcMarchers = [0, 1, 2, 3, 4].map((i) => {
            const angle = Math.PI / 2 - 0.3 + i * 0.15;
            return {
                id: i + 1,
                at: xy(100 * Math.cos(angle), 100 * Math.sin(angle)),
                drillRank: i,
            };
        });
        const session = startSession({
            kindId: "circle",
            marchers: arcMarchers,
            ctx,
        });
        const center = (session.params as { center: { x: number; y: number } })
            .center;
        // The group's middle, near y = 98, not the arc's own center at the origin
        expect(center.y).toBeGreaterThan(90);
    });
});
