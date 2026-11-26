// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boxShape } from "../../box/boxShape";
import type { BoxParams } from "../../box/boxGeometry";
import {
    DEFAULT_ODD_GAP,
    filesDistribution,
} from "../../distribute/distribution";
import type { XY } from "../../types";
import { boxCutAt, boxPieces, type BoxCut } from "../boxSplit";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import {
    scissorsAt,
    splitCheck,
    splitPlacement,
    type SplitAt,
} from "../splitShape";

/**
 * Split here on a box (#1337): a cut between two files or two ranks makes two boxes, each with the
 * box's fill and settings, nobody moving; offered only where both pieces lay out on the spots
 * their marchers stand on.
 */

const CTX = { stepPx: 10, snapPoint: (p: XY) => p };

const grid = (over: Partial<BoxParams> = {}): BoxParams => ({
    center: { x: 100, y: 100 },
    rotation: 0,
    files: 4,
    across: 20,
    deep: 20,
    distribution: filesDistribution(4),
    ...over,
});

/** A placed box of `params` with `n` marchers on its spots, ids from 1 */
function placed(params: BoxParams, n: number): PlacedBox<BoxParams> {
    const spots = boxShape.generate(params, n, CTX);
    const recipe: PlacedRecipe = {
        id: 1,
        timelineId: 3,
        kind: "block",
        kindVersion: 1,
        params: { ...params, spots: n },
        orderMode: "nearest",
        reverse: false,
        members: spots.map((s, slot) => ({
            marcherId: slot + 1,
            slot,
            x: s.x,
            y: s.y,
        })),
    };
    const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
    const [box] = boxesAt({
        recipes: [recipe],
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    });
    return box as PlacedBox<BoxParams>;
}

/** Every member of `box` where it stood, in a piece whose own spot it's on */
function expectNobodyMoved(
    box: PlacedBox<BoxParams>,
    cut: BoxCut,
): readonly BoxParams[] {
    const split = splitPlacement(box, cut);
    expect(split).not.toBeNull();
    const pieces = [split!.first, ...split!.alongside];
    const was = new Map(box.recipe.members.map((m) => [m.marcherId, m]));
    const seen = new Set<number>();
    for (const piece of pieces) {
        const params = piece.recipe.params as BoxParams & { spots: number };
        const spots = boxShape.generate(params, params.spots, CTX);
        for (const m of piece.members) {
            seen.add(m.marcherId);
            const before = was.get(m.marcherId)!;
            expect(m.x).toBeCloseTo(before.x, 6);
            expect(m.y).toBeCloseTo(before.y, 6);
            expect(spots[m.slot]!.x).toBeCloseTo(before.x, 6);
            expect(spots[m.slot]!.y).toBeCloseTo(before.y, 6);
        }
    }
    expect(seen.size).toBe(box.recipe.members.length);
    return pieces.map((p) => p.recipe.params as BoxParams);
}

describe("a box split between two files or ranks", () => {
    // 4 × 3 around (100, 100), 20 apart: files at 70, 90, 110, 130; ranks at 80, 100, 120
    const box = placed(grid(), 12);

    it("between files: two boxes the full depth, nobody moving", () => {
        const [a, b] = expectNobodyMoved(box, { kind: "box", way: "x", at: 0 });
        expect(a).toMatchObject({ files: 2, across: 20, deep: 20 });
        expect(a!.center).toEqual({ x: 80, y: 100 });
        expect(b!.center).toEqual({ x: 120, y: 100 });
        expect(a!.distribution).toMatchObject({
            mode: "files",
            layout: { files: 2 },
        });
    });

    it("between ranks: two boxes the full width", () => {
        const [a, b] = expectNobodyMoved(box, {
            kind: "box",
            way: "y",
            at: 10,
        });
        expect(a).toMatchObject({ files: 4 });
        expect(a!.center.y).toBeCloseTo(90);
        expect(b!.center.y).toBeCloseTo(120);
    });

    it("a single file cut off goes loose: a box of one spot is no box", () => {
        const one = placed(grid({ files: 2 }), 2);
        const split = splitPlacement(one, { kind: "box", way: "x", at: 0 })!;
        expect(split.first.recipe.kind).toBe("ungrouped");
        expect(split.alongside[0]!.recipe.kind).toBe("ungrouped");
    });

    it("works the same on a turned, flipped box", () => {
        const turned = placed(grid({ rotation: 0.6, flipX: true }), 12);
        const [a] = expectNobodyMoved(turned, {
            kind: "box",
            way: "x",
            at: 0,
        });
        expect(a).toMatchObject({ files: 2, rotation: 0.6, flipX: true });
    });

    it("splits a short back rank off, but not down through it where it would move", () => {
        // 4 across, 10: two full ranks and two at the back, centered
        const short = placed(grid(), 10);
        expectNobodyMoved(short, { kind: "box", way: "y", at: -10 });
        // Down the middle, each piece's back marcher would stand in its middle, not where it is
        expect(boxPieces(short, { kind: "box", way: "x", at: 0 })).toBeNull();
    });

    it("forgets what the whole box remembered across mode switches", () => {
        const remembering = placed(grid({ modes: { any: 1 } }), 12);
        const [a] = expectNobodyMoved(remembering, {
            kind: "box",
            way: "x",
            at: 0,
        });
        expect(a).not.toHaveProperty("modes");
    });
});

describe("where a box is cut", () => {
    const box = placed(grid(), 12);
    const reach = 4;

    it("over the gap between two marchers of a rank: between their files, across the box", () => {
        const found = boxCutAt(box, { x: 100, y: 101 }, reach, true)!;
        expect(found.cut).toEqual({ kind: "box", way: "x", at: 0 });
        expect(found.gap).toMatchObject({
            from: { x: 90, y: 100 },
            to: { x: 110, y: 100 },
        });
        // The mark runs front to back, its scissors' end up the screen
        expect(found.mark.to).toEqual({ x: 100, y: 80 });
        expect(found.mark.from.y).toBeGreaterThan(120);
    });

    it("over the gap between two marchers of a file: between their ranks, side to side", () => {
        const found = boxCutAt(box, { x: 71, y: 90 }, reach, true)!;
        expect(found.cut).toEqual({ kind: "box", way: "y", at: -10 });
        // Its scissors' end is the left one
        expect(found.mark.to).toEqual({ x: 70, y: 90 });
    });

    it("nothing on a marcher, in the middle of four, or off the box", () => {
        expect(boxCutAt(box, { x: 91, y: 100 }, reach, true)).toBeNull();
        expect(boxCutAt(box, { x: 100, y: 90 }, reach, true)).toBeNull();
        expect(boxCutAt(box, { x: 200, y: 100 }, reach, true)).toBeNull();
    });

    it("a menu opened between four marchers cuts the gap it's nearest", () => {
        // Nearer the rank below than the files either side: between those files
        expect(boxCutAt(box, { x: 100, y: 91 }, reach, false)!.cut.way).toBe(
            "x",
        );
        // Nearer the file to the left: between the ranks it runs through
        expect(boxCutAt(box, { x: 91, y: 95 }, reach, false)!.cut.way).toBe(
            "y",
        );
        // Not in the middle of four with the pointer
        expect(boxCutAt(box, { x: 100, y: 91 }, reach, true)).toBeNull();
    });

    it("shows the scissors past the back of the box, past the rotate knob on the middle cut, and refuses Outline and Spread", () => {
        const env = { stepPx: 10, hitRadius: reach };
        const side = scissorsAt(box, { x: 80, y: 100.5 }, env);
        expect(side?.check.cut).toEqual({ kind: "box", way: "x", at: -20 });
        expect(side?.at).toEqual({ x: 80, y: 80 - 2 * reach });
        // The knob stands 2.4 reaches above the back rank, up the middle
        const middle = scissorsAt(box, { x: 100, y: 100 }, env);
        expect(middle?.check.cut).toEqual({ kind: "box", way: "x", at: 0 });
        expect(middle?.at.x).toBeCloseTo(100);
        expect(middle?.at.y).toBeCloseTo(80 - 2.4 * reach - 2 * reach);
        const outline = placed(
            grid({
                distribution: { mode: "outline", oddGap: DEFAULT_ODD_GAP },
            }),
            12,
        );
        const check = splitCheck(outline, { x: 100, y: 100 }, reach);
        expect(check).toMatchObject({ ok: false });
        const ok = splitCheck(box, { x: 100, y: 100 }, reach) as SplitAt;
        expect(ok.ok).toBe(true);
    });
});
