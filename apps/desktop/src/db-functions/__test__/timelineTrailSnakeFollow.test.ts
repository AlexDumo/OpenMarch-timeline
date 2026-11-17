import { describe, expect, it as test } from "vitest";
import { createResolver, type Resolver, type XY } from "@openmarch/core";
import { refusalText } from "@/test/refusalText";
import { DbConnection, describeDbTests } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import { convertPagesToTimeline } from "@/test/convertPages";
import { readTimelineTables } from "@/timeline/timelineRows";
import { performUndo } from "../history";
import { TimelineWriteError } from "../timelineErrors";
import { moveMarchersInTarget } from "../timelineMoves";
import { setMarcherOrder } from "../marcherOrder";
import { dragTrail, followOrderAt } from "../timelineTrailDrag";
import { rippleFormAt, rippleTrail } from "../timelineTrailRipple";
import {
    planRipple,
    rippleFormProblem,
    type RippleForm,
} from "../timelineTrailRipplePlan";
import { boxCellsOf, snakeFrom } from "../timelineTrailSnake";

keepFixturesInPageMode("its tests convert the show themselves");

/**
 * Snaking through a box, pathways step 11 (spec Appendix L.12, SN-1 to SN-6, QA-SN-5 to QA-SN-12),
 * on the converted `marchersAndPages` show: page 2's box is `[9, 17)`. Marchers 1 to 8 are put in
 * a 2 × 4 box at its start flag, two steps apart: M1 to M4 the top row, M5 to M8 the bottom row,
 * left to right.
 */

const WINDOW = { start: 9, end: 17 };
const IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const resolverOf = async (db: DbConnection): Promise<Resolver> =>
    createResolver((await readTimelineTables(db)).snapshot);
const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
    Math.abs(a[0]! - b[0]!) <= eps && Math.abs(a[1]! - b[1]!) <= eps;

/** The show converted, marchers 1 to 8 in the 2 × 4 box at page 2's start flag */
async function boxOfEight(db: DbConnection) {
    await convertPagesToTimeline(db);
    const r = await resolverOf(db);
    const [x0, y0] = r.positionAt(1, 9) as XY;
    const step = ((r.positionAt(2, 9) as XY)[0] - x0) / 2;
    // In steps from M5's spot (the bottom left): M1 to M4 two steps above
    const at = (x: number, y: number): XY => [x0 + x * step, y0 + y * step];
    const spot = new Map<number, XY>(
        IDS.map((m, i) => [m, at(2 * (i % 4), i < 4 ? -2 : 0)]),
    );
    await moveMarchersInTarget({
        db,
        target: { kind: "range", start: 1, end: 9 },
        moves: IDS.map((marcherId) => ({
            marcherId,
            x: spot.get(marcherId)![0],
            y: spot.get(marcherId)![1],
        })),
    });
    return { step, at, spot };
}

const expectRefused = async (
    write: () => Promise<unknown>,
    message: RegExp,
) => {
    const error = await write().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimelineWriteError);
    expect(refusalText(error)).toMatch(message);
};

describeDbTests("Snake through a box: the Follow drag (SN-2, SN-3)", (it) => {
    it("QA-SN-5: a box with no order snakes row by row from the corner dragged out of; a short drag leaves the tail in the box and the spots it left empty", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at, spot } = await boxOfEight(db);
        const starts = IDS.map((m) => spot.get(m)!);
        // The default snake from the top left: the top row, then back along the bottom
        const found = (await followOrderAt(db, IDS, 9, starts, {
            leader: 0,
        }))!;
        expect(found.box).toBeDefined();
        expect(found.order.map((i) => IDS[i])).toEqual([
            1, 2, 3, 4, 8, 7, 6, 5,
        ]);
        // Out of M1's corner, two spots' worth to the left
        const result = await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 1, points: [{ at: at(-4, -2) }], spacing: { kind: "keep" }, step, ends: "trail" }); // prettier-ignore
        expect(result.marcherIds).toEqual([5, 6, 7, 8, 4, 3, 2, 1]);
        const r = await resolverOf(db);
        const end = (m: number) => r.positionAt(m, 17) as XY;
        // Everyone the drawn length on along the snake, row ends cut straight across
        expect(near(end(1), at(-4, -2))).toBe(true);
        expect(near(end(2), at(-2, -2))).toBe(true);
        expect(near(end(3), spot.get(1)!)).toBe(true);
        expect(near(end(4), spot.get(2)!)).toBe(true);
        expect(near(end(8), spot.get(3)!)).toBe(true);
        expect(near(end(7), spot.get(4)!)).toBe(true);
        expect(near(end(6), spot.get(8)!)).toBe(true);
        expect(near(end(5), spot.get(7)!)).toBe(true);
        // The tail's spots stay empty
        for (const empty of [spot.get(5)!, spot.get(6)!])
            expect(IDS.some((m) => near(end(m), empty))).toBe(false);
    });

    it("QA-SN-6: a long drag takes everyone out, each keeping its gap along the box's snake", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await boxOfEight(db);
        await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 1, points: [{ at: at(-20, -2) }], spacing: { kind: "keep" }, step, ends: "trail" }); // prettier-ignore
        const r = await resolverOf(db);
        // Leader first along the trail, two steps apart, every one left of the box
        [1, 2, 3, 4, 8, 7, 6, 5].forEach((m, k) =>
            expect(near(r.positionAt(m, 17), at(-20 + 2 * k, -2))).toBe(true),
        );
    });

    it("QA-SN-7: column by column out of another corner; a middle marcher or an edge isn't a corner", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at } = await boxOfEight(db);
        await expectRefused(
            () => dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 2, points: [{ at: at(-6, -2) }], spacing: { kind: "keep" }, step, ends: "trail" }), // prettier-ignore
            /end/i,
        );
        // Out of M8's corner (the bottom right), up its column first
        const result = await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [{ at: at(26, 0) }], spacing: { kind: "keep" }, step, ends: "trail", snake: "columns" }); // prettier-ignore
        const snake = [8, 4, 3, 7, 6, 2, 1, 5];
        expect(result.marcherIds).toEqual([...snake].reverse());
        const r = await resolverOf(db);
        snake.forEach((m, k) =>
            expect(near(r.positionAt(m, 17), at(26 - 2 * k, 0))).toBe(true),
        );
    });

    it("QA-SN-8: a hand-set order wins over the default snake", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { step, at, spot } = await boxOfEight(db);
        // Row by row the same way each time, leader M1 (a raster, not a snake)
        await setMarcherOrder(db, { beat: 9, order: IDS });
        const found = (await followOrderAt(
            db,
            IDS,
            9,
            IDS.map((m) => spot.get(m)!),
        ))!;
        expect(found.box).toBeUndefined();
        expect(found.order.map((i) => IDS[i])).toEqual(IDS);
        // M5 is a corner of the box but not an end of that order
        await expectRefused(
            () => dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 5, points: [{ at: at(-6, 0) }], spacing: { kind: "keep" }, step, ends: "trail" }), // prettier-ignore
            /end/i,
        );
        const result = await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [{ at: at(26, 0) }], spacing: { kind: "keep" }, step, ends: "trail" }); // prettier-ignore
        expect(result.marcherIds).toEqual(IDS);
        await performUndo(db);
        // Set order's own choice holds for the Rows/Columns switch too
        const columns = await dragTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [{ at: at(26, 0) }], spacing: { kind: "keep" }, step, ends: "trail", snake: "columns" }); // prettier-ignore
        expect(columns.marcherIds).toEqual(IDS);
    });
});

describeDbTests("Snake through a box: Ripple in (SN-4, SN-5)", (it) => {
    /**
     * The line of 1 to 8 at page 2's start flag (level, two steps apart, M8 on the right) and
     * their end spots on page 2 a 2 × 4 box up and to the right: columns 20 to 26 steps right of
     * M1, rows 12 (top) and 10 steps up. `corner` names its four corners' spots.
     */
    async function lineIntoBox(db: DbConnection) {
        await convertPagesToTimeline(db);
        const r = await resolverOf(db);
        const [x0, y0] = r.positionAt(1, 9) as XY;
        const step = ((r.positionAt(2, 9) as XY)[0] - x0) / 2;
        const at = (x: number, y: number): XY => [x0 + x * step, y0 + y * step];
        const box = IDS.map((_, i) => at(20 + 2 * (i % 4), i < 4 ? -12 : -10));
        // Dealt any old way: M8 on the first spot, M1 on the last
        await moveMarchersInTarget({
            db,
            target: { kind: "range", ...WINDOW },
            moves: IDS.map((marcherId, i) => ({
                marcherId,
                x: box[7 - i]![0],
                y: box[7 - i]![1],
            })),
        });
        return {
            step,
            at,
            corner: { tl: box[0]!, tr: box[3]!, bl: box[4]!, br: box[7]! },
        };
    }

    it("QA-SN-9: the tail takes the corner nearest where the connector arrives; the leader ends at the snake's far end", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { at, corner } = await lineIntoBox(db);
        const r0 = await resolverOf(db);
        const spots = new Map(IDS.map((m) => [m, r0.positionAt(m, 17) as XY]));
        const form = (await rippleFormAt(db, IDS, 17, spots))!;
        expect(form.snake).toBeDefined();
        expect(rippleFormProblem(form.spots, IDS.map((m) => r0.positionAt(m, 9) as XY))).toBeNull(); // prettier-ignore
        // Straight in from M8's start: the bottom left is nearest
        await rippleTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [] }); // prettier-ignore
        let r = await resolverOf(db);
        expect(near(r.positionAt(1, 17), corner.bl)).toBe(true);
        // Row by row from there: along the bottom, back along the top, the leader at the top left
        expect(near(r.positionAt(4, 17), corner.br)).toBe(true);
        expect(near(r.positionAt(5, 17), corner.tr)).toBe(true);
        expect(near(r.positionAt(8, 17), corner.tl)).toBe(true);
        await performUndo(db);
        // Arriving past the top right: the tail takes the top right
        await rippleTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [{ at: at(30, -16) }] }); // prettier-ignore
        r = await resolverOf(db);
        // Back along the top row, then along the bottom: the leader at the bottom right
        expect(near(r.positionAt(1, 17), corner.tr)).toBe(true);
        expect(near(r.positionAt(4, 17), corner.tl)).toBe(true);
        expect(near(r.positionAt(8, 17), corner.br)).toBe(true);
        await performUndo(db);
        // Column by column from the top right: down its column first
        await rippleTrail({ db, window: WINDOW, marcherIds: IDS, leaderId: 8, points: [{ at: at(30, -16) }], snake: "columns" }); // prettier-ignore
        r = await resolverOf(db);
        expect(near(r.positionAt(1, 17), corner.tr)).toBe(true);
        expect(near(r.positionAt(2, 17), corner.br)).toBe(true);
        expect(near(r.positionAt(8, 17), corner.tl)).toBe(true);
    });
});

describe("Snake through a box: the deal (SN-4, SN-5)", () => {
    // A 2 × 4 box at 2 apart, rows 0 (top) and 2; a line of 8 below it, its leader last
    const box: XY[] = Array.from({ length: 8 }, (_, i) => [
        2 * (i % 4),
        i < 4 ? 0 : 2,
    ]);
    const line: XY[] = Array.from({ length: 8 }, (_, i) => [-20 + 2 * i, 20]);
    const formOf = (spots: XY[], by: "rows" | "columns" = "rows") => {
        const cells = boxCellsOf(spots)!;
        return {
            ids: spots.map((_, i) => 100 + i),
            spots,
            snake: { box: cells, by },
        } satisfies RippleForm;
    };

    test("QA-SN-10: from each side the tail takes the corner nearest the arrival, row by row or column by column", () => {
        const cases: [XY, number, "rows" | "columns", number[]][] = [
            // Arrival, the corner's spot index, the way, the snake (spot indexes)
            [[-3, -3], 0, "rows", [0, 1, 2, 3, 7, 6, 5, 4]],
            [[9, -3], 3, "rows", [3, 2, 1, 0, 4, 5, 6, 7]],
            [[-3, 5], 4, "rows", [4, 5, 6, 7, 3, 2, 1, 0]],
            [[9, 5], 7, "rows", [7, 6, 5, 4, 0, 1, 2, 3]],
            [[-3, -3], 0, "columns", [0, 4, 5, 1, 2, 6, 7, 3]],
            [[9, 5], 7, "columns", [7, 3, 2, 6, 5, 1, 0, 4]],
        ];
        for (const [arrive, corner, by, snake] of cases) {
            const form = formOf(box, by);
            const plan = planRipple(line, form, [{ at: arrive }]);
            expect(plan.entrance).toBe(100 + corner);
            // The tail (first) on the entrance, the leader (last) at the far end
            expect(plan.spots).toEqual(snake.map((i) => box[i]));
            expect(plan.takes).toEqual(snake.map((i) => 100 + i));
        }
    });

    test("QA-SN-11: a finish on a corner's spot enters there; a middle spot isn't an entrance", () => {
        const form = formOf(box);
        expect(planRipple(line, form, [], 103).entrance).toBe(103);
        // M101 (top row, second) isn't a corner: the nearest corner to the leader wins
        expect(planRipple(line, form, [], 101).entrance).toBe(104);
    });

    test("QA-SN-12: the snake passes through a hole in the end shape, and nobody stops there", () => {
        // The top row's second spot is a hole; seven marchers
        const holed = box.filter((_, i) => i !== 1);
        const hole: XY = [2, 0];
        const form = formOf(holed);
        expect(rippleFormProblem(holed, line.slice(1))).toBeNull();
        const plan = planRipple(line.slice(1), form, [{ at: [-3, -3] }]);
        expect(plan.spots[0]).toEqual([0, 0]);
        expect(plan.spots[1]).toEqual([4, 0]);
        expect(plan.spots.some((p) => near(p, hole))).toBe(false);
        // The way into the box runs straight through the hole, between the two spots around it
        const mid = (plan.endDist[0]! + plan.endDist[1]!) / 2;
        expect(near(plan.trail.at(mid), hole, 1e-9)).toBe(true);
        // Everyone dealt along the snake: the tail first, the leader last
        expect(plan.spots).toEqual(
            snakeFrom(boxCellsOf(holed)!, "rows", 0)!.map((i) => holed[i]),
        );
    });
});
