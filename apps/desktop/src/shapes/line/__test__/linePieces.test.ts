import { describe, expect, it } from "vitest";
import { makePath } from "../../geometry/path";
import {
    lineSegments,
    lineSpots,
    type LineParams,
    type LinePoint,
} from "../lineGeometry";
import {
    bendPieceThrough,
    bendThrough,
    pieceType,
    PIECE_BEND,
    setPieceType,
    splitPiece,
    startingBend,
} from "../linePieces";

/**
 * A Line built from pieces (#1218): a stretch switched between straight, curved and arc, an arc's
 * middle dragged, and an arc split in two.
 */

const corner = (x: number, y: number): LinePoint => ({ x, y, tension: 0 });
const line = (...points: LinePoint[]): LineParams => ({
    points,
    spacing: { mode: "fit" },
});

/** Where segment `index` is halfway along */
const middle = (p: LineParams, index: number) => {
    const path = makePath([lineSegments(p)[index]!]);
    return path.at(path.length / 2);
};

describe("piece types", () => {
    it("reads straight, curved and arc stretches", () => {
        const p = line(corner(0, 0), corner(10, 0), corner(20, 10));
        expect(pieceType(p, 0)).toBe("straight");
        expect(pieceType(setPieceType(p, 0, "arc"), 0)).toBe("arc");
        expect(pieceType(setPieceType(p, 1, "curved"), 1)).toBe("curved");
    });

    it("an arc made straight or curved loses its bend", () => {
        const arc = setPieceType(line(corner(0, 0), corner(10, 0)), 0, "arc");
        const straight = setPieceType(arc, 0, "straight");
        expect(straight.points[0]!.bend).toBeUndefined();
        expect(pieceType(straight, 0)).toBe("straight");
        const curved = setPieceType(
            setPieceType(
                line(corner(0, 0), corner(10, 0), corner(20, 10)),
                0,
                "arc",
            ),
            0,
            "curved",
        );
        expect(curved.points[0]!.bend).toBeUndefined();
    });

    it("switching to the type it already is changes nothing", () => {
        const p = line(corner(0, 0), corner(10, 0));
        expect(setPieceType(p, 0, "straight")).toBe(p);
    });

    it("changes only the stretch picked", () => {
        const p = line(corner(0, 0), corner(10, 0), corner(20, 0));
        const next = setPieceType(p, 1, "arc");
        expect(pieceType(next, 0)).toBe("straight");
        expect(pieceType(next, 1)).toBe("arc");
    });
});

describe("an arc's starting bend", () => {
    it("is a quarter turn with nothing to carry on from", () => {
        expect(startingBend(line(corner(0, 0), corner(10, 0)), 0)).toBe(
            PIECE_BEND,
        );
    });

    it("carries on from the stretch before it, a J's hook a half turn", () => {
        // A stem down the field (+y), then the hook to its left at the same height: a tangent
        // arc there turns 180°, leaving the stem without a kink
        const j = line(corner(10, 0), corner(10, 20), corner(0, 20));
        const bend = startingBend(j, 1);
        expect(Math.abs(bend)).toBeCloseTo(180, 6);
        const hook = setPieceType(j, 1, "arc");
        // Bulging below the stem's foot, as a J's does
        expect(middle(hook, 1).y).toBeGreaterThan(20);
    });

    it("carries on into the stretch after it when it's the first", () => {
        const p = line(corner(0, 0), corner(10, 0), corner(10, 10));
        const arc = setPieceType(p, 0, "arc");
        // Leaving the arc heading straight down the field, into the next stretch
        const path = makePath([lineSegments(arc)[0]!]);
        const end = path.at(path.length);
        const before = path.at(path.length - 0.01);
        expect(end.x - before.x).toBeCloseTo(0, 2);
        expect(end.y - before.y).toBeGreaterThan(0);
    });
});

describe("dragging an arc's middle", () => {
    it("bends it through the pointer, either side, ends kept", () => {
        const p = setPieceType(line(corner(0, 0), corner(10, 0)), 0, "arc");
        for (const to of [
            { x: 5, y: -3 },
            { x: 5, y: 4 },
            { x: 3, y: -8 },
        ]) {
            const next = bendPieceThrough(p, 0, to);
            expect(next.points[0]).toMatchObject({ x: 0, y: 0 });
            expect(next.points[1]).toMatchObject({ x: 10, y: 0 });
            const path = makePath([lineSegments(next)[0]!]);
            expect(Math.hypot(...pointGap(path, to))).toBeLessThan(1e-3);
        }
    });

    it("a half circle's sweep from its top", () => {
        expect(
            Math.abs(
                bendThrough({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }),
            ),
        ).toBeCloseTo(180, 6);
    });

    it("dragged flat stays an arc", () => {
        const p = setPieceType(line(corner(0, 0), corner(10, 0)), 0, "arc");
        expect(pieceType(bendPieceThrough(p, 0, { x: 5, y: 0 }), 0)).toBe(
            "arc",
        );
    });
});

describe("splitting an arc", () => {
    it("gives two half arcs that look the same", () => {
        const p = setPieceType(line(corner(0, 0), corner(10, 0)), 0, "arc");
        const split = splitPiece(p, 0);
        expect(split.points).toHaveLength(3);
        expect(split.points[0]!.bend).toBeCloseTo(p.points[0]!.bend! / 2);
        expect(split.points[1]!.bend).toBeCloseTo(p.points[0]!.bend! / 2);
        const before = makePath([lineSegments(p)[0]!]);
        const after = makePath(lineSegments(split));
        expect(after.length).toBeCloseTo(before.length, 6);
        for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            const a = before.at(before.length * s);
            const b = after.at(after.length * s);
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
        }
    });

    it("moves no marcher", () => {
        const p = setPieceType(line(corner(0, 0), corner(40, 0)), 0, "arc");
        for (const n of [4, 5]) {
            const before = lineSpots(p, n);
            const after = lineSpots(splitPiece(p, 0, n), n);
            expect(after).toHaveLength(before.length);
            after.forEach((spot, i) => {
                expect(spot.x).toBeCloseTo(before[i]!.x, 6);
                expect(spot.y).toBeCloseTo(before[i]!.y, 6);
            });
        }
    });

    it("a straight stretch still splits as before", () => {
        const p = line(corner(0, 0), corner(10, 0));
        expect(splitPiece(p, 0).points[1]).toMatchObject({ x: 5, y: 0 });
    });
});

/** How far `to` is from the nearest point of `path` */
function pointGap(
    path: ReturnType<typeof makePath>,
    to: { x: number; y: number },
): [number, number] {
    const at = path.at(path.project(to));
    return [at.x - to.x, at.y - to.y];
}
