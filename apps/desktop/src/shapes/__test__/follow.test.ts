import { describe, expect, it } from "vitest";
import { dist, xy } from "../geometry/vec";
import type { ArcParams } from "../kinds/arc";
import type { BlockParams } from "../kinds/block";
import type { LineParams } from "../kinds/line";
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
        close(p.r, (16 * 2 * STEP) / (2 * Math.PI));
        expect(p.center).toEqual(center);
        // Even all the way round: the gap that closes the circle is 2 steps too
        const slots = previewSession(session, ctx).slots;
        close(dist(slots[0]!, slots[15]!), dist(slots[0]!, slots[1]!), 1e-6);
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

    it("keeps an arc's length when its radius is typed", () => {
        const session = locked("arc", 6);
        const before = pathLength(session);
        const typed = changeMeasure(session, "radius", 12 * STEP, ctx);
        close(pathLength(typed), before, 1e-6);
        const segment = (typed.params as ArcParams).bulge;
        expect(segment).not.toBe(0);
    });

    it("keeps an arc's length when its bulge is dragged", () => {
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
        close(pathLength(dragged), 10 * STEP, 1e-6);
    });

    it("scales a curve to the run", () => {
        const session = locked("curve", 7);
        close(pathLength(session), 12 * STEP, 1e-6);
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

    it("changes the files, not the interval, when the side is dragged", () => {
        const next = blockKind.drag(
            base,
            "across",
            xy(5 * STEP, 0),
            { shift: false },
            12,
            ctx,
        );
        expect(next.across).toBe(base.across);
        expect(next.files).toBe(6);
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
