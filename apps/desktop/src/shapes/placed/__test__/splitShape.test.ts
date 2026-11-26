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
import { performRedo, performUndo } from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
} from "@/db-functions/shapeRecipes";
import { arcShape } from "../../arc/arcShape";
import { isArcParams } from "../../arc/arcGeometry";
import { lineShape } from "../../line/lineShape";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { writePlacement } from "../../tool/shapePlacement";
import type { XY } from "../../types";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import { scissorsAt, splitCheck, splitPlacement } from "../splitShape";

/**
 * Split here (#1336): where a right-click splits a placed line, what the split saves, and that
 * saving it is one undo step leaving two shapes where there was one, nobody moving.
 */

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
        { ...from, tension: 0, bend: 120 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});

/** A recipe of `kind` with members `ids` on its spots in order, in move `timelineId` */
function recipe(
    id: number,
    kind: { id: string; version: number },
    params: LineParams,
    ids: readonly number[],
    timelineId: number | null = 5,
): PlacedRecipe {
    const spots = lineSpots(params, ids.length);
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

const LINE = recipe(
    1,
    lineShape,
    straight({ x: 0, y: 0 }, { x: 100, y: 0 }),
    [11, 12, 13, 14, 15],
);

describe("splitCheck", () => {
    const [line] = placed(LINE);
    unitIt("splits in the gap the right-click is in", () => {
        const check = splitCheck(line!, { x: 30, y: 1 });
        expect(check).toMatchObject({ ok: true, cut: { kind: "line", k: 2 } });
    });
    unitIt("is greyed past the last marcher, with why", () => {
        const check = splitCheck(line!, { x: 130, y: 0 });
        expect(check?.ok).toBe(false);
    });
    unitIt("is greyed on a closed line and a line with rows", () => {
        const closed = recipe(
            2,
            lineShape,
            {
                ...straight({ x: 0, y: 0 }, { x: 100, y: 0 }),
                points: [
                    { x: 0, y: 0, tension: 0 },
                    { x: 100, y: 0, tension: 0 },
                    { x: 50, y: 50, tension: 0 },
                ],
                closed: true,
            },
            [1, 2, 3, 4, 5, 6],
        );
        expect(splitCheck(placed(closed)[0]!, { x: 30, y: 0 })?.ok).toBe(false);
        const rows = recipe(
            3,
            lineShape,
            {
                ...straight({ x: 0, y: 0 }, { x: 100, y: 0 }),
                rows: { list: [{}, {}], drawn: 0, apart: 10 },
            },
            [1, 2, 3, 4],
        );
        const [withRows] = placed(rows);
        if (withRows)
            expect(splitCheck(withRows, { x: 30, y: 0 })?.ok).toBe(false);
    });
});

describe("scissorsAt", () => {
    const [line] = placed(LINE);
    const env = { stepPx: 12, hitRadius: 3 };
    unitIt("shows over a gap, two reaches off the line toward the back", () => {
        // Spots 25 apart: the gap from 25 to 50
        const s = scissorsAt(line!, { x: 33, y: 0.5 }, env);
        expect(s?.check.cut).toEqual({ kind: "line", k: 2 });
        expect(s?.at.x).toBeCloseTo(37.5);
        expect(s?.at.y).toBeCloseTo(-6);
    });
    unitIt("not on a marcher, nor off the line", () => {
        expect(scissorsAt(line!, { x: 25, y: 1 }, env)).toBeNull();
        expect(scissorsAt(line!, { x: 33, y: 40 }, env)).toBeNull();
    });
    unitIt(
        "on a gap shorter than three reaches, in its middle third: the rest is the marchers'",
        () => {
            // A finger's reach, 9 here, against a gap of 25
            const finger = { stepPx: 12, hitRadius: 9 };
            const s = scissorsAt(line!, { x: 37.5, y: 0 }, finger);
            expect(s?.check.cut).toEqual({ kind: "line", k: 2 });
            // Two reaches off the line, clear of the dots either side
            expect(s?.at.y).toBeCloseTo(-18);
            expect(scissorsAt(line!, { x: 32, y: 0 }, finger)).toBeNull();
            expect(scissorsAt(line!, { x: 43, y: 0 }, finger)).toBeNull();
        },
    );
});

describe("splitPlacement", () => {
    unitIt(
        "puts each marcher in the piece on its side, where it stands",
        () => {
            const [line] = placed(LINE);
            const { first, alongside } = splitPlacement(
                line as PlacedBox<LineParams>,
                { kind: "line", k: 2 },
            )!;
            expect(first.recipe.kind).toBe("line");
            expect(first.members.map((m) => m.marcherId)).toEqual([11, 12]);
            expect(alongside).toHaveLength(1);
            expect(alongside[0]!.members.map((m) => m.marcherId)).toEqual([
                13, 14, 15,
            ]);
            // Nobody moves
            for (const m of [...first.members, ...alongside[0]!.members]) {
                const was = LINE.members.find(
                    (w) => w.marcherId === m.marcherId,
                )!;
                expect(m.x).toBeCloseTo(was.x, 9);
                expect(m.y).toBeCloseTo(was.y, 9);
            }
            // Each piece lays its spots out where its members stand
            for (const piece of [first, ...alongside]) {
                const p = piece.recipe.params as LineParams & { spots: number };
                const spots = lineSpots(p, p.spots);
                for (const m of piece.members) {
                    expect(spots[m.slot]!.x).toBeCloseTo(m.x, 6);
                    expect(spots[m.slot]!.y).toBeCloseTo(m.y, 6);
                }
            }
        },
    );

    unitIt("leaves a lone end marcher in no shape", () => {
        const [line] = placed(LINE);
        const { first, alongside } = splitPlacement(
            line as PlacedBox<LineParams>,
            { kind: "line", k: 4 },
        )!;
        expect(first.members).toHaveLength(4);
        expect(alongside).toHaveLength(1);
        expect(alongside[0]!.recipe.kind).toBe("ungrouped");
        expect(alongside[0]!.members.map((m) => m.marcherId)).toEqual([15]);
    });

    unitIt("splits an arc into two arcs", () => {
        const [a] = placed(
            recipe(
                4,
                arcShape,
                arc({ x: 0, y: 0 }, { x: 100, y: 0 }),
                [1, 2, 3, 4, 5, 6, 7],
            ),
        );
        const { first, alongside } = splitPlacement(
            a as PlacedBox<LineParams>,
            { kind: "line", k: 3 },
        )!;
        expect(first.recipe.kind).toBe("arc");
        const bare = ({ spots: _s, ...p }: LineParams & { spots?: number }) =>
            p;
        expect(isArcParams(bare(first.recipe.params as LineParams))).toBe(true);
        expect(
            isArcParams(bare(alongside[0]!.recipe.params as LineParams)),
        ).toBe(true);
    });
});

afterEach(() => stopTimelineResolver());

const PAGE2 = { start: 9, end: 17 };
const PAGE2_PLAN: CanvasEditPlan = {
    ok: true,
    target: { kind: "range", ...PAGE2 },
    beat: PAGE2.end,
};
const resolver = () => useTimelineResolverStore.getState().resolver!;

/** A line placed on page 2 on the first `count` marchers */
async function placeLine(
    db: DbConnection,
    shape: (ids: readonly number[]) => PlacedRecipe,
    count: number,
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
    const ids = resolver().marcherIds().slice(0, count);
    const r = shape(ids);
    let saved: PlacedRecipe = r;
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: r.members.map(({ marcherId, x, y }) => ({ marcherId, x, y })),
        afterWrite: async (tx, timelineId) => {
            const id = await saveShapeRecipeInTransaction({
                tx,
                timelineId,
                recipe: r,
                members: r.members,
            });
            saved = { ...r, id, timelineId };
        },
    });
    await timelineResolverSettled();
    const [box] = placed(saved);
    return { ids, box: box as PlacedBox<LineParams> };
}

describeDbTests("splitting a placed line", (it) => {
    it("leaves two lines, nobody moving, as one undo step that undo takes back and redo brings back", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { ids, box } = await placeLine(
            db,
            (ids) =>
                recipe(
                    0,
                    lineShape,
                    straight({ x: 100, y: 100 }, { x: 196, y: 100 }),
                    ids,
                ),
            5,
        );
        const undoSteps = async () =>
            new Set(
                (await db.select().from(schema.history_undo).all()).map(
                    (r) => r.history_group,
                ),
            ).size;
        const steps = await undoSteps();
        const { first, alongside } = splitPlacement(box, {
            kind: "line",
            k: 2,
        })!;
        expect(
            await writePlacement(
                {
                    ...first,
                    alongside,
                    replaces: box.recipe,
                    setAll: false,
                },
                new QueryClient(),
                "Couldn't split the shape",
                PAGE2_PLAN,
            ),
        ).toBe(true);
        await timelineResolverSettled();

        const after = await readAllShapeRecipes(db);
        expect(after).toHaveLength(2);
        expect(after.map((r) => r.kind)).toEqual(["line", "line"]);
        expect(after.find((r) => r.id === box.recipe.id)).toBeDefined();
        expect(
            after.map((r) => r.members.map((m) => m.marcherId).sort()),
        ).toEqual([ids.slice(0, 2), ids.slice(2)].map((g) => [...g].sort()));
        expect(await undoSteps()).toBe(steps + 1);
        // Read back as two shapes, every member on its spot
        expect(placed(...after)).toHaveLength(2);

        await performUndo(db);
        await timelineResolverSettled();
        const undone = await readAllShapeRecipes(db);
        expect(undone).toHaveLength(1);
        expect(undone[0]!.members).toHaveLength(5);

        await performRedo(db);
        await timelineResolverSettled();
        const redone = await readAllShapeRecipes(db);
        expect(redone).toHaveLength(2);
        expect(placed(...redone)).toHaveLength(2);
    });
});
