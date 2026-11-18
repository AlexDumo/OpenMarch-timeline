import { describe, expect, it as test } from "vitest";
import type { XY } from "@openmarch/core";
import {
    boxCellsOf,
    mapCells,
    nearestSnakeEnd,
    snakeEnds,
    snakeFrom,
    snakeOrders,
} from "../timelineTrailSnake";

/**
 * Snaking through a box, pathways step 11 (spec Appendix L.12, SN-1 to SN-3, QA-SN-1 to QA-SN-4):
 * reading a box from where marchers stand, and its default snake from each corner.
 */

/** A box of `rows` × `cols` at `gap` apart from `origin`, row by row, minus the `holes` cells */
function box(
    rows: number,
    cols: number,
    {
        gap = 2,
        rowGap = gap,
        origin = [0, 0] as XY,
        turn = 0,
        holes = [] as [number, number][],
    } = {},
): { points: XY[]; at: (r: number, c: number) => number } {
    const points: XY[] = [];
    const index = new Map<string, number>();
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            if (holes.some(([hr, hc]) => hr === r && hc === c)) continue;
            const x = c * gap;
            const y = r * rowGap;
            index.set(`${r},${c}`, points.length);
            points.push([
                origin[0] + x * cos - y * sin,
                origin[1] + x * sin + y * cos,
            ]);
        }
    return { points, at: (r, c) => index.get(`${r},${c}`)! };
}

describe("boxCellsOf (SN-1)", () => {
    test("QA-SN-1: a 3 × 4 box reads as three rows of four, top to bottom, left to right", () => {
        const { points, at } = box(3, 4);
        const cells = boxCellsOf(points)!;
        expect(cells.length).toBe(3);
        expect(cells[0]).toEqual([at(0, 0), at(0, 1), at(0, 2), at(0, 3)]);
        expect(cells[2]![3]).toBe(at(2, 3));
    });

    test("listed in any order, a box reads the same", () => {
        const { points, at } = box(3, 3);
        const shuffled = [4, 8, 0, 2, 6, 1, 3, 7, 5];
        const cells = boxCellsOf(shuffled.map((i) => points[i]!))!;
        expect(mapCells(cells, (i) => shuffled[i]!)).toEqual([
            [at(0, 0), at(0, 1), at(0, 2)],
            [at(1, 0), at(1, 1), at(1, 2)],
            [at(2, 0), at(2, 1), at(2, 2)],
        ]);
    });

    test("rows and columns may be spaced differently; a turned box keeps its rows", () => {
        expect(
            boxCellsOf(box(3, 4, { gap: 2, rowGap: 4 }).points),
        ).not.toBeNull();
        const turned = box(2, 5, { turn: (20 * Math.PI) / 180 });
        const cells = boxCellsOf(turned.points)!;
        expect(cells.length).toBe(2);
        expect(cells[0]!.length).toBe(5);
    });

    test("QA-SN-4: a hole reads as an empty cell", () => {
        const { points, at } = box(3, 3, { holes: [[1, 1]] });
        const cells = boxCellsOf(points)!;
        expect(cells[1]).toEqual([at(1, 0), null, at(1, 2)]);
    });

    test("a line, an arc, a scatter or a box with too many holes isn't a box", () => {
        expect(boxCellsOf(box(1, 6).points)).toBeNull();
        const arc: XY[] = Array.from({ length: 7 }, (_, i) => [
            10 * Math.cos((i * Math.PI) / 8),
            10 * Math.sin((i * Math.PI) / 8),
        ]);
        expect(boxCellsOf(arc)).toBeNull();
        expect(
            boxCellsOf([
                [0, 0],
                [3, 1],
                [7, 5],
                [2, 9],
                [11, 4],
            ]),
        ).toBeNull();
        expect(
            boxCellsOf(
                box(3, 3, {
                    holes: [
                        [0, 0],
                        [1, 1],
                        [2, 2],
                    ],
                }).points,
            ),
        ).toBeNull();
        // Uneven columns: two lines of three, a wide gap in the middle
        expect(
            boxCellsOf([
                [0, 0],
                [2, 0],
                [10, 0],
                [0, 2],
                [2, 2],
                [10, 2],
            ]),
        ).toBeNull();
    });
});

describe("the default snake (SN-2, SN-3)", () => {
    const { points, at } = box(3, 3);
    const cells = boxCellsOf(points)!;

    test("QA-SN-2: row by row from each corner, back the other way each row", () => {
        expect(snakeFrom(cells, "rows", at(0, 0))).toEqual(
            [
                [0, 0],
                [0, 1],
                [0, 2],
                [1, 2],
                [1, 1],
                [1, 0],
                [2, 0],
                [2, 1],
                [2, 2],
            ].map(([r, c]) => at(r!, c!)),
        );
        expect(snakeFrom(cells, "rows", at(0, 2))!.slice(0, 4)).toEqual([
            at(0, 2),
            at(0, 1),
            at(0, 0),
            at(1, 0),
        ]);
        expect(snakeFrom(cells, "rows", at(2, 0))!.slice(0, 4)).toEqual([
            at(2, 0),
            at(2, 1),
            at(2, 2),
            at(1, 2),
        ]);
        expect(snakeFrom(cells, "rows", at(2, 2))!.at(-1)).toBe(at(0, 0));
    });

    test("QA-SN-3: column by column from each corner", () => {
        expect(snakeFrom(cells, "columns", at(0, 0))!.slice(0, 4)).toEqual([
            at(0, 0),
            at(1, 0),
            at(2, 0),
            at(2, 1),
        ]);
        expect(snakeFrom(cells, "columns", at(2, 2))!.slice(0, 4)).toEqual([
            at(2, 2),
            at(1, 2),
            at(0, 2),
            at(0, 1),
        ]);
        expect(snakeFrom(cells, "columns", at(0, 2))!.slice(0, 4)).toEqual([
            at(0, 2),
            at(1, 2),
            at(2, 2),
            at(2, 1),
        ]);
        expect(snakeFrom(cells, "columns", at(2, 0))!.slice(0, 4)).toEqual([
            at(2, 0),
            at(1, 0),
            at(0, 0),
            at(0, 1),
        ]);
    });

    test("every snake takes everyone once; only the corners start one", () => {
        for (const by of ["rows", "columns"] as const) {
            expect(snakeOrders(cells, by)).toHaveLength(4);
            for (const order of snakeOrders(cells, by))
                expect([...order].sort((a, b) => a - b)).toEqual(
                    points.map((_, i) => i),
                );
            expect(snakeEnds(cells, by).sort()).toEqual(
                [at(0, 0), at(0, 2), at(2, 0), at(2, 2)].sort(),
            );
        }
        expect(snakeFrom(cells, "rows", at(1, 1))).toBeNull();
        expect(snakeFrom(cells, "rows", at(0, 1))).toBeNull();
    });

    test("QA-SN-4: the snake passes a hole by; a hole on a corner starts at the next member", () => {
        const holed = box(3, 3, { holes: [[1, 1]] });
        const c = boxCellsOf(holed.points)!;
        expect(snakeFrom(c, "rows", holed.at(0, 0))).toEqual(
            [
                [0, 0],
                [0, 1],
                [0, 2],
                [1, 2],
                [1, 0],
                [2, 0],
                [2, 1],
                [2, 2],
            ].map(([r, col]) => holed.at(r!, col!)),
        );
        const corner = box(3, 4, { holes: [[0, 0]] });
        const cc = boxCellsOf(corner.points)!;
        expect(snakeEnds(cc, "rows")).toContain(corner.at(0, 1));
        expect(snakeFrom(cc, "rows", corner.at(0, 1))!.slice(0, 3)).toEqual([
            corner.at(0, 1),
            corner.at(0, 2),
            corner.at(0, 3),
        ]);
    });

    test("nearestSnakeEnd: the corner nearest where a connector arrives", () => {
        const spot = (i: number) => points[i]!;
        expect(nearestSnakeEnd(cells, "rows", spot, [-5, -5])).toBe(at(0, 0));
        expect(nearestSnakeEnd(cells, "rows", spot, [9, 5])).toBe(at(2, 2));
        expect(nearestSnakeEnd(cells, "rows", spot, [9, -1])).toBe(at(0, 2));
        expect(nearestSnakeEnd(cells, "rows", spot, [-1, 4.5])).toBe(at(2, 0));
    });
});
