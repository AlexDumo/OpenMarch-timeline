import { beforeEach, describe, expect, it } from "vitest";
import { xy } from "../geometry/vec";
import type { LineParams } from "../kinds/line";
import {
    changeKind,
    changeOrder,
    changeParams,
    dragHandle,
    openRecipe,
    previewSession,
    startSession,
} from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import type { ShapeContext } from "../types";

const ctx: ShapeContext = { stepPx: 10, snapPoint: (p) => p };
const row = [0, 1, 2, 3].map((i) => ({
    id: i + 1,
    at: xy(i * 20 + (i % 2), 3 * (i % 2)),
    drillRank: 3 - i,
}));

describe("shape sessions", () => {
    it("fits the marchers and sends each one to a spot", () => {
        const session = startSession({ kindId: "line", marchers: row, ctx });
        const preview = previewSession(session, ctx);
        expect(preview.targets.map((t) => t.id)).toEqual([1, 2, 3, 4]);
        expect(new Set(session.assignment).size).toBe(4);
        expect(preview.canApply).toBe(true);
    });

    it("keeps who goes where while a handle is dragged", () => {
        const session = startSession({ kindId: "line", marchers: row, ctx });
        const params = session.params as LineParams;
        // Drag the start past the end: the line flips, but nobody swaps spots
        const dragged = dragHandle(
            session,
            params,
            "a",
            xy(200, 0),
            false,
            ctx,
        );
        expect(dragged.assignment).toEqual(session.assignment);
        expect((dragged.params as LineParams).a).toEqual(xy(200, 0));
    });

    it("snaps handle drags through the context", () => {
        const snapping: ShapeContext = {
            ...ctx,
            snapPoint: (p) =>
                xy(Math.round(p.x / 10) * 10, Math.round(p.y / 10) * 10),
        };
        const session = startSession({
            kindId: "line",
            marchers: row,
            ctx: snapping,
        });
        const dragged = dragHandle(
            session,
            session.params,
            "b",
            xy(87, 4),
            false,
            snapping,
        );
        expect((dragged.params as LineParams).b).toEqual(xy(90, 0));
    });

    it("carries the chosen order, not the spacing, to another kind", () => {
        let session = startSession({ kindId: "line", marchers: row, ctx });
        session = {
            ...session,
            params: {
                ...(session.params as LineParams),
                spacing: {
                    mode: "interval",
                    runs: [{ steps: 2, count: 0 }],
                    anchor: "start",
                },
            },
        };
        session = changeOrder(session, "drill", true, ctx);
        const arc = changeKind(session, "arc", ctx);
        expect(arc.kindId).toBe("arc");
        // A new shape starts in Fit, through where the marchers stand
        expect((arc.params as { spacing: unknown }).spacing).toEqual({
            mode: "fit",
        });
        expect(arc.order).toBe("drill");
        expect(arc.reverse).toBe(true);
    });

    it("orders by drill number when asked", () => {
        const session = changeOrder(
            startSession({ kindId: "line", marchers: row, ctx }),
            "drill",
            false,
            ctx,
        );
        // drillRank runs 3..0, so the last marcher takes the first spot along the line
        const preview = previewSession(session, ctx);
        const xs = preview.targets.map((t) => t.to.x);
        expect(xs).toEqual([...xs].sort((a, b) => b - a));
    });
});

describe("shape tool store", () => {
    beforeEach(() => {
        useShapeToolStore.setState({
            session: null,
            last: null,
            dragging: null,
        });
    });

    it("undoes and redoes its own edits, a whole drag as one step", () => {
        useShapeToolStore.setState({ past: [], future: [] });
        const store = useShapeToolStore.getState();
        store.open("line", row, ctx);
        const opened = useShapeToolStore.getState().session!.params;
        store.startDrag("b");
        store.drag(xy(300, 0), false, ctx);
        store.drag(xy(400, 0), false, ctx);
        store.endDrag();
        const dragged = useShapeToolStore.getState().session!.params;
        store.setOrder("drill", false, ctx);
        store.undo();
        expect(useShapeToolStore.getState().session!.order).toBe("keep");
        store.undo();
        expect(useShapeToolStore.getState().session!.params).toEqual(opened);
        store.undo(); // nothing earlier: stays
        expect(useShapeToolStore.getState().session!.params).toEqual(opened);
        store.redo();
        expect(useShapeToolStore.getState().session!.params).toEqual(dragged);
    });

    it("puts a drag back on Escape and stays open", () => {
        const store = useShapeToolStore.getState();
        store.open("line", row, ctx);
        const before = useShapeToolStore.getState().session!.params;
        store.startDrag("b");
        store.drag(xy(500, 500), false, ctx);
        expect(useShapeToolStore.getState().session!.params).not.toEqual(
            before,
        );
        store.cancelDrag();
        const state = useShapeToolStore.getState();
        expect(state.session!.params).toEqual(before);
        expect(state.dragging).toBeNull();
        // Moves after the cancel (the mouse is still down) change nothing
        store.drag(xy(900, 900), false, ctx);
        expect(useShapeToolStore.getState().session!.params).toEqual(before);
    });

    it("remembers the last session's settings for the next one", () => {
        const store = useShapeToolStore.getState();
        store.open("line", row, ctx);
        store.setOrder("nearest", false, ctx);
        store.close();
        expect(useShapeToolStore.getState().session).toBeNull();
        store.open("arc", row, ctx);
        expect(useShapeToolStore.getState().session!.order).toBe("nearest");
    });
});

describe("reopening a placed shape", () => {
    const placedRow = [0, 1, 2, 3].map((i) => ({
        id: i + 1,
        at: xy(i * 20, 0),
        drillRank: i,
    }));
    const recipe = {
        id: 7,
        kind: "line",
        params: {
            a: xy(0, 0),
            b: xy(60, 0),
            spacing: { mode: "fit" },
        } as LineParams,
        orderMode: "drill",
        reverse: false,
        // Stored in reverse slot order, to check the slots win over the list order
        members: [3, 2, 1, 0].map((i) => ({
            marcherId: i + 1,
            slot: i,
            x: i * 20,
            y: 0,
        })),
    };

    it("opens as stored, without refitting, and moves no one", () => {
        const session = openRecipe(recipe, placedRow)!;
        expect(session.recipeId).toBe(7);
        expect(session.kindId).toBe("line");
        expect(session.order).toBe("drill");
        expect(session.overrides).toEqual({});
        const preview = previewSession(session, ctx);
        for (const t of preview.targets) {
            const from = placedRow.find((m) => m.id === t.id)!.at;
            expect(t.to.x).toBeCloseTo(from.x, 9);
            expect(t.to.y).toBeCloseTo(from.y, 9);
        }
    });

    it("keeps a marcher moved by hand at its offset, unless reset", () => {
        const moved = placedRow.map((m) =>
            m.id === 2 ? { ...m, at: xy(m.at.x, m.at.y + 5) } : m,
        );
        const session = openRecipe(recipe, moved)!;
        expect(session.overrides).toEqual({ 2: xy(0, 5) });
        // Stretch the line: marcher 2 follows its new spot, still 5 above it
        const stretched = changeParams(
            session,
            { ...(session.params as LineParams), b: xy(120, 0) },
            ctx,
        );
        const target = (s: typeof session) =>
            previewSession(s, ctx).targets.find((t) => t.id === 2)!;
        expect(target(stretched).to.x).toBeCloseTo(40, 9);
        expect(target(stretched).to.y).toBeCloseTo(5, 9);
        const reset = { ...stretched, keepOverrides: false };
        expect(target(reset).to.y).toBeCloseTo(0, 9);
    });

    it("isn't offered for a kind this app doesn't know", () => {
        expect(
            openRecipe({ ...recipe, kind: "spiral3000" }, placedRow),
        ).toBeNull();
    });
});
