import { describe, expect, it } from "vitest";
import {
    focusUnder,
    followPointer,
    lensSize,
    needsLens,
    PITCH,
    sameColumn,
    span,
    spotAt,
    spotUnder,
    STRIP_PAD,
    warp,
    type LensRow,
} from "../rowLens";

const WIDTH = 200;
const rowsOf = (...lengths: number[]): LensRow[] =>
    lengths.map((length) => ({ length, shift: 0 }));

/** The lens opened under `px` and settled, as a pointer resting there leaves it */
function settled(rows: LensRow[], px: number): number {
    return focusUnder(rows, WIDTH, px, 1);
}

describe("rowLens", () => {
    it("keeps short rows at full size, no lens", () => {
        const rows = rowsOf(10, 10);
        expect(needsLens(rows, WIDTH)).toBe(false);
        const X = warp(rows, WIDTH, 0, 1);
        const pitch = X(spotAt(rows[0]!, 1)) - X(spotAt(rows[0]!, 0));
        expect(pitch).toBeGreaterThanOrEqual(PITCH);
    });

    it.each([25, 50, 250, 1000])(
        "draws both ends of %i spots inside the strip, lens open or closed",
        (n) => {
            const rows = rowsOf(n, n - 1);
            for (const [focus, open] of [
                [0, 0],
                [0, 1],
                [span(rows).lo, 1],
                [span(rows).hi, 1],
            ] as const) {
                const X = warp(rows, WIDTH, focus, open);
                for (const row of rows) {
                    expect(X(spotAt(row, 0))).toBeGreaterThanOrEqual(0);
                    expect(X(spotAt(row, row.length - 1))).toBeLessThanOrEqual(
                        WIDTH,
                    );
                }
            }
        },
    );

    it("lines the rows up: a half-spot shift lands halfway between the next row's spots", () => {
        const rows: LensRow[] = [
            { length: 50, shift: 1 },
            { length: 50, shift: 0 },
        ];
        const focus = settled(rows, WIDTH / 2);
        const X = warp(rows, WIDTH, focus, 1);
        const j = Math.round(focus + 24.5);
        const a = X(spotAt(rows[1]!, j));
        const b = X(spotAt(rows[1]!, j + 1));
        expect(X(spotAt(rows[0]!, j))).toBeCloseTo((a + b) / 2, 0);
    });

    it("opens the lens at full size around the pointer", () => {
        const rows = rowsOf(250);
        const focus = settled(rows, WIDTH / 2);
        const X = warp(rows, WIDTH, focus, 1);
        expect(X(focus + 1) - X(focus)).toBeCloseTo(PITCH, 1);
        expect(X(focus)).toBeCloseTo(WIDTH / 2, 1);
    });

    it.each([50, 100, 250, 600])(
        "holds still inside the open lens, so each of its %i-row spots is a fixed target",
        (n) => {
            const rows = rowsOf(n);
            const focus = settled(rows, WIDTH / 2);
            const X = warp(rows, WIDTH, focus, 1);
            const met = new Set<number>();
            const { flat } = lensSize(rows, WIDTH);
            for (let dx = -flat * PITCH; dx <= flat * PITCH; dx++) {
                const px = WIDTH / 2 + dx;
                expect(followPointer(rows, WIDTH, focus, 1, px)).toBe(focus);
                met.add(spotUnder(rows, rows[0]!, WIDTH, focus, 1, px));
            }
            // Every spot the lens covers, one after another
            const list = [...met].sort((a, b) => a - b);
            expect(list.length).toBeGreaterThanOrEqual(2 * flat);
            list.forEach((spot, i) => i && expect(spot - list[i - 1]!).toBe(1));
            expect(X(focus)).toBeCloseTo(WIDTH / 2, 1);
        },
    );

    it("drags the lens by its edge, so a steady sweep reaches the end of the row", () => {
        const rows = rowsOf(250);
        let focus = settled(rows, WIDTH / 2);
        let last = 0;
        for (let px = WIDTH / 2; px <= WIDTH - STRIP_PAD; px++) {
            focus = followPointer(rows, WIDTH, focus, 1, px);
            const spot = spotUnder(rows, rows[0]!, WIDTH, focus, 1, px);
            expect(spot).toBeGreaterThanOrEqual(last);
            last = spot;
        }
        expect(last).toBe(249);
    });

    it.each([
        [90, 51],
        [90, 100],
        [150, 100],
        [150, 250],
    ])(
        "in a %i px strip, a sweep along %i spots never skips more than the lens holds",
        (width, n) => {
            const rows = rowsOf(n);
            const { flat } = lensSize(rows, width);
            let focus = focusUnder(rows, width, STRIP_PAD, 1);
            let last = 0;
            let most = 0;
            for (let px = STRIP_PAD; px <= width - STRIP_PAD; px++) {
                focus = followPointer(rows, width, focus, 1, px);
                const spot = spotUnder(rows, rows[0]!, width, focus, 1, px);
                most = Math.max(most, spot - last);
                last = spot;
            }
            expect(last).toBe(n - 1);
            // A skipped spot is still in the lens, a step back inside it
            expect(most).toBeLessThanOrEqual(2 * flat);
        },
    );

    it("opens the lens where the pointer jumps to, not on the old lens's edge", () => {
        const rows = rowsOf(50);
        const width = 150;
        const atEnd = focusUnder(rows, width, width - STRIP_PAD - 2, 1);
        const middle = followPointer(rows, width, atEnd, 1, width / 2);
        expect(
            Math.abs(
                spotUnder(rows, rows[0]!, width, middle, 1, width / 2) - 24.5,
            ),
        ).toBeLessThanOrEqual(3);
    });

    it("finds the same column in a shorter or shifted row", () => {
        const long = { length: 34, shift: 0 };
        const short = { length: 33, shift: 0 };
        // A short row centered sits half a spot in: its first spot is between the long row's first two
        expect(sameColumn(long, 0, short)).toBe(0);
        expect(sameColumn(long, 33, short)).toBe(32);
        expect(sameColumn(short, 10, { length: 33, shift: 2 })).toBe(9);
    });
});
