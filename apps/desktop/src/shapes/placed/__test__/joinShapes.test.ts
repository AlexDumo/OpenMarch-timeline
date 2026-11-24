import { afterEach, describe, expect, it as unitIt } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { type DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import {
    performHistoryAction,
    performRedo,
    performUndo,
} from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { boxShape } from "../../box/boxShape";
import { drawBox } from "../../box/boxGeometry";
import { lineShape } from "../../line/lineShape";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { arcShape } from "../../arc/arcShape";
import { writePlacement } from "../../tool/shapePlacement";
import type { ToolEnv } from "../../tool/toolKind";
import type { ShapeContext, XY } from "../../types";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import { joinCheck, joinedPlacement, type JoinCheck } from "../joinShapes";

/**
 * Join into one line (#1220): which selections can join and why not, what the join saves, and
 * that saving it is one undo step that leaves one Line where there were two shapes.
 */

const STEP = 12;
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const FIT = { mode: "fit" } as const;

const straight = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});
const arc = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0, bend: 90 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});

/** A recipe of `kind` with members `ids` on its spots in order, in move `timelineId` */
function recipe(
    id: number,
    kind: { id: string; version: number },
    params: object,
    ids: readonly number[],
    timelineId: number | null = 5,
    spots: readonly XY[] = lineSpots(params as LineParams, ids.length),
): PlacedRecipe {
    return {
        id,
        timelineId,
        kind: kind.id,
        kindVersion: kind.version,
        params: { ...params, spots: ids.length },
        orderMode: "nearest",
        reverse: false,
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: spots[slot]!.x,
            y: spots[slot]!.y,
        })),
    };
}

/** The recipes as placed shapes, each member standing on its spot */
function placed(...recipes: PlacedRecipe[]): PlacedBox[] {
    const at = new Map(
        recipes.flatMap((r) =>
            r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    });
}

const env: ToolEnv = {
    stepPx: STEP,
    snap: false,
    constrain: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};
const box = (id: number, ids: readonly number[]) => {
    const params = drawBox(
        { x: 0, y: 100 },
        { x: 48, y: 148 },
        ids.length,
        env,
    )!;
    return recipe(
        id,
        boxShape,
        params,
        ids,
        5,
        boxShape.generate(params, ids.length, ctx),
    );
};

const LINE_A = recipe(
    1,
    lineShape,
    straight({ x: 0, y: 0 }, { x: 48, y: 0 }),
    [11, 12, 13],
);
const ARC_B = recipe(
    2,
    arcShape,
    arc({ x: 48, y: 0 }, { x: 88, y: 0 }),
    [21, 22, 23],
);
const both = new Set([11, 12, 13, 21, 22, 23]);

describe("joinCheck", () => {
    unitIt("takes two lines, curves or arcs on the same move", () => {
        const check = joinCheck(both, placed(ARC_B, LINE_A));
        expect(check.ok).toBe(true);
        // The one placed first is the first line
        if (check.ok) expect(check.a.recipe.id).toBe(1);
    });

    unitIt("wants exactly two shapes selected whole, and nothing else", () => {
        const only = joinCheck(new Set([11, 12, 13]), placed(LINE_A, ARC_B));
        expect(only).toMatchObject({ ok: false, onShapes: true });
        if (!only.ok) expect(only.reason).toMatch(/two shapes/);
        // A marcher outside the shapes: not a selection of shapes, so the menu leaves Join out
        expect(
            joinCheck(new Set([...both, 99]), placed(LINE_A, ARC_B)),
        ).toMatchObject({ ok: false, onShapes: false });
        // Part of a shape
        expect(
            joinCheck(new Set([11, 12, 13, 21]), placed(LINE_A, ARC_B)),
        ).toMatchObject({ ok: false, onShapes: false });
        // Three shapes
        const third = recipe(
            3,
            lineShape,
            straight({ x: 0, y: 40 }, { x: 48, y: 40 }),
            [31, 32],
        );
        expect(
            joinCheck(new Set([...both, 31, 32]), placed(LINE_A, ARC_B, third)),
        ).toMatchObject({ ok: false, onShapes: true });
        expect(joinCheck(new Set(), placed(LINE_A, ARC_B))).toMatchObject({
            ok: false,
            onShapes: false,
        });
    });

    unitIt("refuses a Box, saying which shapes can be joined", () => {
        const check = joinCheck(
            new Set([11, 12, 13, 41, 42, 43, 44]),
            placed(LINE_A, box(4, [41, 42, 43, 44])),
        );
        expect(check).toMatchObject({ ok: false, onShapes: true });
        if (!check.ok) expect(check.reason).toMatch(/lines, curves and arcs/);
    });

    unitIt("refuses a closed line", () => {
        const closed = recipe(
            5,
            lineShape,
            {
                ...straight({ x: 0, y: 40 }, { x: 48, y: 40 }),
                points: [
                    { x: 0, y: 40, tension: 0 },
                    { x: 48, y: 40, tension: 0 },
                    { x: 24, y: 80, tension: 0 },
                ],
                closed: true,
            },
            [51, 52, 53],
        );
        const check = joinCheck(
            new Set([11, 12, 13, 51, 52, 53]),
            placed(LINE_A, closed),
        );
        expect(check).toMatchObject({ ok: false, onShapes: true });
        if (!check.ok) expect(check.reason).toMatch(/closed/);
    });

    unitIt("refuses shapes placed on different moves", () => {
        const check = joinCheck(
            both,
            placed(LINE_A, { ...ARC_B, timelineId: 6 }),
        );
        expect(check).toMatchObject({ ok: false, onShapes: true });
        if (!check.ok) expect(check.reason).toMatch(/different moves/);
    });
});

describe("joinedPlacement", () => {
    unitIt(
        "saves one Line with both shapes' members spread along it, one on the joint",
        () => {
            const check = joinCheck(both, placed(LINE_A, ARC_B));
            if (!check.ok) throw new Error(check.reason);
            const { recipe: saved, members } = joinedPlacement(
                check.a,
                check.b,
                ctx,
            );
            expect(saved.kind).toBe("line");
            expect(saved.kindVersion).toBe(2);
            expect(saved.orderMode).toBe("nearest");
            expect((saved.params as { spots: number }).spots).toBe(6);
            // In order along the line: the line's marchers, then the arc's
            const bySlot = [...members].sort((x, y) => x.slot - y.slot);
            expect(bySlot.map((m) => m.marcherId)).toEqual([
                11, 12, 13, 21, 22, 23,
            ]);
            const onJoint = members.filter(
                (m) => Math.hypot(m.x - 48, m.y) < 1e-6,
            );
            expect(onJoint).toHaveLength(1);
            expect(bySlot[0]).toMatchObject({ x: 0, y: 0 });
            expect(bySlot.at(-1)!.x).toBeCloseTo(88, 6);
        },
    );

    unitIt(
        "keeps each shape's order when one runs the other way in the joined line",
        () => {
            // The arc drawn toward the line: its last spot is the joint end
            const b = recipe(
                2,
                arcShape,
                arc({ x: 88, y: 0 }, { x: 48, y: 0 }),
                [21, 22, 23],
            );
            const check = joinCheck(both, placed(LINE_A, b));
            if (!check.ok) throw new Error(check.reason);
            const { members } = joinedPlacement(check.a, check.b, ctx);
            const bySlot = [...members].sort((x, y) => x.slot - y.slot);
            expect(bySlot.map((m) => m.marcherId)).toEqual([
                11, 12, 13, 23, 22, 21,
            ]);
        },
    );
});

afterEach(() => stopTimelineResolver());

const PAGE2 = { start: 9, end: 17 };
const PAGE2_PLAN: CanvasEditPlan = {
    ok: true,
    target: { kind: "range", ...PAGE2 },
    beat: PAGE2.end,
};
const resolver = () => useTimelineResolverStore.getState().resolver!;

/** Two shapes placed on page 2 in one move, `first` on the first three marchers, `second` on the next three */
async function placeTwo(
    db: DbConnection,
    shapes: (ids: readonly number[]) => readonly [PlacedRecipe, PlacedRecipe],
) {
    const pages = [...(await readShowTiming(db)).pages].sort(
        (a, b) => a.order - b.order,
    );
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 2; i++) await createLastPage({ db, newPageCounts: 8 });
    await startTimelineResolver(db);
    const ids = resolver().marcherIds().slice(0, 6);
    const saved: PlacedRecipe[] = [];
    const both = shapes(ids);
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: both.flatMap((r) =>
            r.members.map(({ marcherId, x, y }) => ({ marcherId, x, y })),
        ),
        afterWrite: async (tx, timelineId) => {
            for (const r of both) {
                const record: ShapeRecipeRecord = r;
                const id = await saveShapeRecipeInTransaction({
                    tx,
                    timelineId,
                    recipe: record,
                    members: r.members,
                });
                saved.push({ ...r, id, timelineId });
            }
        },
    });
    await timelineResolverSettled();
    expect(await readAllShapeRecipes(db)).toHaveLength(2);
    const check = joinCheck(new Set(ids), placed(...saved));
    if (!check.ok) throw new Error(check.reason);
    return { ids, check };
}

/** What `joinShapes` writes once the queue reaches it */
const writeJoin = (check: Extract<JoinCheck, { ok: true }>) =>
    writePlacement(
        {
            ...joinedPlacement(check.a, check.b, ctx),
            replaces: check.a.recipe,
            setAll: false,
        },
        new QueryClient(),
        "Couldn't join the shapes",
        PAGE2_PLAN,
    );

const sorted = (ids: Iterable<number>) => [...ids].sort((x, y) => x - y);

const bySlot = (r: PlacedRecipe) =>
    [...r.members]
        .sort((x, y) => x.slot - y.slot)
        .map(({ marcherId, slot, x, y }) => ({ marcherId, slot, x, y }));

describeDbTests("joining two placed lines", (it) => {
    it("leaves one Line with every member, as one undo step that undo takes back and redo brings back", async ({
        db,
        marchersAndPages: _,
    }) => {
        // A line and an arc placed on page 2, in the same move
        const { ids, check } = await placeTwo(db, (ids) => [
            recipe(
                0,
                lineShape,
                straight({ x: 100, y: 100 }, { x: 148, y: 100 }),
                ids.slice(0, 3),
            ),
            recipe(
                0,
                arcShape,
                arc({ x: 148, y: 100 }, { x: 188, y: 100 }),
                ids.slice(3),
            ),
        ]);
        const undoSteps = async () =>
            new Set(
                (await db.select().from(schema.history_undo).all()).map(
                    (r) => r.history_group,
                ),
            ).size;
        const steps = await undoSteps();

        expect(await writeJoin(check)).toBe(true);
        await timelineResolverSettled();

        const after = await readAllShapeRecipes(db);
        expect(after).toHaveLength(1);
        expect(after[0]!.id).toBe(check.a.recipe.id);
        expect(after[0]!.kind).toBe("line");
        expect(after[0]!.members.map((m) => m.marcherId).sort()).toEqual(
            [...ids].sort(),
        );
        expect((after[0]!.params as LineParams).points).toHaveLength(3);
        expect(await undoSteps()).toBe(steps + 1);

        await performUndo(db);
        await timelineResolverSettled();
        const undone = await readAllShapeRecipes(db);
        expect(undone.map((r) => r.kind).sort()).toEqual(["arc", "line"]);
        expect(undone.map((r) => r.members.length)).toEqual([3, 3]);

        // Redo brings back the joined line as saved: the same recipe, params and members
        await performRedo(db);
        await timelineResolverSettled();
        const redone = await readAllShapeRecipes(db);
        expect(redone).toHaveLength(1);
        expect(redone[0]!.id).toBe(after[0]!.id);
        expect(redone[0]!.kind).toBe("line");
        expect(redone[0]!.params).toEqual(after[0]!.params);
        expect(bySlot(redone[0]!)).toEqual(bySlot(after[0]!));
        // And read back as the joined line, every member on its spot
        const shown = placed(redone[0]!);
        expect(shown).toHaveLength(1);
        expect(shown[0]!.kind.shape.id).toBe("line");
        expect(shown[0]!.recipe.members).toHaveLength(6);
        expect((shown[0]!.params as LineParams).points).toHaveLength(3);
    });

    it("undo selects the shape it brings back whole, and redo the joined line, though some of their marchers never moved", async ({
        db,
        marchersAndPages: _,
    }) => {
        // Spaced so the joined line keeps the first line's marchers where they stand: 25 apart,
        // the joined line's interval. The second line's last marcher stays put too.
        const { ids, check } = await placeTwo(db, (ids) => [
            recipe(
                0,
                lineShape,
                straight({ x: 100, y: 100 }, { x: 150, y: 100 }),
                ids.slice(0, 3),
            ),
            recipe(
                0,
                lineShape,
                straight({ x: 150, y: 100 }, { x: 225, y: 100 }),
                ids.slice(3),
            ),
        ]);
        expect(await writeJoin(check)).toBe(true);
        await timelineResolverSettled();
        const [joined] = await readAllShapeRecipes(db);
        // Only two of the six moved
        const unmoved = check.a.recipe.members
            .concat(check.b.recipe.members)
            .filter((m) =>
                joined!.members.some(
                    (j) =>
                        j.marcherId === m.marcherId &&
                        Math.hypot(j.x - m.x, j.y - m.y) < 1e-6,
                ),
            );
        expect(unmoved).toHaveLength(4);

        const undo = await performHistoryAction("undo", db);
        await timelineResolverSettled();
        expect(sorted(undo.marcherIdsToSelect ?? [])).toEqual(
            sorted(ids.slice(3)),
        );

        const redo = await performHistoryAction("redo", db);
        await timelineResolverSettled();
        expect(sorted(redo.marcherIdsToSelect ?? [])).toEqual(sorted(ids));
    });
});
