import { describe, expect, it } from "vitest";
import {
    BADGE_HEIGHT,
    badgeWidth,
    classifyOrder,
    laneDarts,
    laneHalfWidth,
    laneTip,
    neighborHalfWidths,
    placeNumbers,
    thinnedPositions,
    threadDarts,
    type Box,
    type PlacedBadge,
} from "../orderLane";
import type { XY } from "../orderSweep";

/** The order lane's drawing rules (pathways step 4h, design E) */

/** The dot's radius on screen at 100% */
const R = 3.26;
/** `count` marchers in a row, `gap` apart, left to right */
const row = (count: number, gap: number, y = 0): XY[] =>
    Array.from({ length: count }, (_, i) => ({ x: i * gap, y }));
/** A 4 × 4 box, 30 px apart: [rank][file], front rank first */
const BOX = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, f) => ({ x: f * 30, y: r * 30 })),
);

const tipOf = (points: string): XY => {
    const [, tip] = points.split(" ").map((p) => {
        const [x, y] = p.split(",").map(Number);
        return { x: x!, y: y! };
    });
    return tip!;
};

const boxOf = (b: PlacedBadge): Box => {
    const w = badgeWidth(b.text);
    return {
        minX: b.at.x - w / 2,
        minY: b.at.y - BADGE_HEIGHT / 2,
        maxX: b.at.x + w / 2,
        maxY: b.at.y + BADGE_HEIGHT / 2,
    };
};
const anyOverlap = (badges: readonly PlacedBadge[]) =>
    badges.some((a, i) =>
        badges.some((b, k) => {
            if (k <= i) return false;
            const p = boxOf(a);
            const q = boxOf(b);
            return (
                p.minX < q.maxX &&
                q.minX < p.maxX &&
                p.minY < q.maxY &&
                q.minY < p.maxY
            );
        }),
    );

describe("laneHalfWidth", () => {
    it("holds the dot, grows with it, and stops growing so it never becomes a slab", () => {
        expect(laneHalfWidth(1, 3, false)).toBe(4.2);
        expect(laneHalfWidth(R, 6, false)).toBeCloseTo(R + 5);
        expect(laneHalfWidth(20, 24, false)).toBe(11);
    });

    it("widens round the selection ring when the line is selected", () => {
        expect(laneHalfWidth(R, 7, true)).toBe(10);
        expect(laneHalfWidth(R, 7, true)).toBeGreaterThan(
            laneHalfWidth(R, 7, false),
        );
    });
});

describe("classifyOrder", () => {
    const r = row(6, 30);

    it("draws a row in order, either way, as a plain lane", () => {
        expect(classifyOrder(r, R)).toBe("lane");
        expect(classifyOrder([...r].reverse(), R)).toBe("lane");
    });

    it("an order that runs back over its own marchers is folded", () => {
        // Split: the back three first, then the front three
        expect(
            classifyOrder(
                [3, 4, 5, 0, 1, 2].map((i) => r[i]!),
                R,
            ),
        ).toBe("folded");
        // From the middle outward
        expect(
            classifyOrder(
                [2, 3, 1, 4, 0, 5].map((i) => r[i]!),
                R,
            ),
        ).toBe("folded");
    });

    it("a box in a snake, a reading order or a spiral is a plain lane", () => {
        const [a, b, c, d] = BOX;
        const snake = [
            ...a!,
            ...[...b!].reverse(),
            ...c!,
            ...[...d!].reverse(),
        ];
        const reading = [...a!, ...b!, ...c!, ...d!];
        const spiral = [
            ...a!,
            b![3]!,
            c![3]!,
            d![3]!,
            d![2]!,
            d![1]!,
            d![0]!,
            c![0]!,
            b![0]!,
            b![1]!,
            b![2]!,
            c![2]!,
            c![1]!,
        ];
        expect(classifyOrder(snake, R)).toBe("lane");
        expect(classifyOrder(reading, R)).toBe("lane");
        expect(classifyOrder(spiral, R)).toBe("lane");
    });

    it("an order whose legs cross is crossed", () => {
        const [a, b] = BOX;
        // Front left, back right, front right, back left: an X
        expect(classifyOrder([a![0]!, b![3]!, a![3]!, b![0]!], R)).toBe(
            "crossed",
        );
    });
});

describe("laneTip", () => {
    it("points past the leader, continuing the first leg outward", () => {
        const tip = laneTip(row(3, 30), 8)!;
        const point = tipOf(tip.points);
        expect(point.x).toBeLessThan(-8);
        expect(point.y).toBeCloseTo(0);
        expect(tip.box.maxX).toBeLessThan(0);
    });

    it("needs two marchers", () => {
        expect(laneTip([{ x: 0, y: 0 }], 8)).toBeNull();
    });
});

describe("darts", () => {
    it("a short lane has none; a long one has one about every 110 px, pointing toward the leader", () => {
        expect(laneDarts(row(6, 30), R)).toEqual([]);
        const darts = laneDarts(row(20, 22), R);
        expect(darts.length).toBeGreaterThanOrEqual(3);
        expect(darts.length).toBeLessThanOrEqual(4);
        for (const d of darts) {
            const xs = d.split(" ").map((p) => Number(p.split(",")[0]));
            // The point (the middle corner) is the leftmost: toward the leader at x = 0
            expect(xs[1]).toBeLessThan(Math.min(xs[0]!, xs[2]!));
        }
    });

    it("a thread has one per leg long enough to hold it", () => {
        expect(
            threadDarts([
                { x: 0, y: 0 },
                { x: 20, y: 0 },
            ]),
        ).toEqual([]);
        expect(
            threadDarts([
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 0, y: 50 },
            ]),
        ).toHaveLength(2);
    });
});

describe("thinnedPositions", () => {
    it("numbers every marcher when they fit", () => {
        expect(thinnedPositions(6, 30)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("thins like ruler labels, always keeping the leader and the tail", () => {
        const shown = thinnedPositions(20, 22);
        expect(shown[0]).toBe(0);
        expect(shown.at(-1)).toBe(19);
        expect(shown).toContain(3);
        expect(shown).not.toContain(2);
    });
});

describe("placeNumbers", () => {
    const base = { halfWidth: 8, dotRadius: R, busy: [] as Box[] };

    it("a plain lane's numbers sit on one rail below a line that runs across", () => {
        const points = row(6, 30);
        const { badges, crowded } = placeNumbers({
            ...base,
            points,
            kind: "lane",
            dots: points,
        });
        expect(crowded).toBe(false);
        expect(badges.map((b) => b.text)).toEqual([
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
        ]);
        expect(new Set(badges.map((b) => b.at.y)).size).toBe(1);
        expect(badges[0]!.at.y).toBeGreaterThan(0);
        expect(badges.map((b) => b.role)).toEqual([
            "leader",
            "middle",
            "middle",
            "middle",
            "middle",
            "tail",
        ]);
    });

    it("an order that doubles back numbers every marcher, staggering into a second row when one row is too tight", () => {
        const line = row(10, 14);
        const points = [9, 7, 5, 3, 1, 0, 2, 4, 6, 8].map((i) => line[i]!);
        const { badges, crowded } = placeNumbers({
            ...base,
            points,
            kind: "folded",
            dots: line,
        });
        expect(crowded).toBe(false);
        expect(badges).toHaveLength(10);
        expect(new Set(badges.map((b) => b.at.y)).size).toBeGreaterThan(1);
        expect(anyOverlap(badges)).toBe(false);
    });

    it("when even two rows can't fit, only the leader's and the tail's show and it says so", () => {
        const line = row(20, 7.33);
        const points = [...line].reverse().filter((_, i) => i % 2 === 0);
        const rest = [...line].reverse().filter((_, i) => i % 2 === 1);
        const { badges, crowded } = placeNumbers({
            ...base,
            // The names above the dots, as the field draws them
            busy: [{ minX: -20, minY: -30, maxX: 160, maxY: -6 }],
            points: [...points, ...rest.reverse()],
            kind: "folded",
            dots: line,
        });
        expect(crowded).toBe(true);
        expect(badges.map((b) => b.role)).toEqual(["leader", "tail"]);
    });

    it("keeps clear of labels and every other dot", () => {
        const points = row(3, 40);
        const label: Box = { minX: -10, minY: 6, maxX: 10, maxY: 30 };
        const stranger = { x: 40, y: 18 };
        const { badges } = placeNumbers({
            ...base,
            busy: [label],
            points,
            kind: "crossed",
            dots: [...points, stranger],
        });
        expect(badges).toHaveLength(3);
        const [first, second] = badges.map(boxOf);
        expect(
            first!.minX < label.maxX &&
                label.minX < first!.maxX &&
                first!.minY < label.maxY &&
                label.minY < first!.maxY,
        ).toBe(false);
        expect(
            Math.hypot(
                (second!.minX + second!.maxX) / 2 - stranger.x,
                (second!.minY + second!.maxY) / 2 - stranger.y,
            ),
        ).toBeGreaterThan(R + BADGE_HEIGHT / 2);
    });
});

describe("neighborHalfWidths", () => {
    it("narrows lanes of lines one row apart so they never touch, but never thinner than the dots", () => {
        const a = row(5, 22, 0);
        const b = row(5, 22, 14);
        const [ha, hb] = neighborHalfWidths([a, b], [8, 8], R);
        expect(ha! + hb!).toBeLessThan(14);
        expect(ha).toBeGreaterThan(R);
    });

    it("ignores a spot two lines share where they cross", () => {
        const across = row(5, 30);
        const down = [0, 1, 2, 3, 4].map((i) => ({ x: 60, y: (i - 2) * 30 }));
        const [h] = neighborHalfWidths([across, down], [8, 8], R);
        expect(h).toBe(8);
    });
});
