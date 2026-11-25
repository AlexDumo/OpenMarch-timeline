import { describe, expect, it } from "vitest";
import { rotatePositions, scalePositions } from "@/field/editor/groupTransform";
import { applySimilarity } from "../../frame/similarity";
import { liveSimilarity } from "../PlacedBoxesOverlay";

/**
 * A figure turned or scaled showed its marchers turning while the shapes' outlines and joints
 * stayed where they were until the release, and all the while a rotation typed in the inspector
 * was open (#1236). The outlines now go with the marchers drawn elsewhere.
 */

const members = [
    { marcherId: 1, x: 0, y: 0 },
    { marcherId: 2, x: 12, y: 0 },
    { marcherId: 3, x: 24, y: 6 },
];
const starts = members.map((m) => ({ id: m.marcherId, x: m.x, y: m.y }));
const drawn = (positions: readonly { id: number; x: number; y: number }[]) =>
    new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }] as const));

describe("a placed shape's outline while its marchers are drawn elsewhere", () => {
    it("goes with them through a turn or an even scale", () => {
        for (const positions of [
            rotatePositions(starts, { x: 5, y: 5 }, 37),
            scalePositions(starts, { anchor: { x: 0, y: 0 }, x: 2, y: 2 }),
        ]) {
            const sim = liveSimilarity(members, drawn(positions))!;
            expect(sim).toBeTruthy();
            members.forEach((m, i) => {
                const at = applySimilarity(sim, m);
                expect(at.x).toBeCloseTo(positions[i]!.x, 2);
                expect(at.y).toBeCloseTo(positions[i]!.y, 2);
            });
        }
    });

    it("goes with a lone marcher moved", () => {
        const sim = liveSimilarity(
            [members[0]!],
            drawn([{ id: 1, x: 3, y: 4 }]),
        )!;
        expect(applySimilarity(sim, { x: 10, y: 10 })).toEqual({
            x: 13,
            y: 14,
        });
    });

    it("stays put when none or only some of them are drawn elsewhere", () => {
        expect(liveSimilarity(members, null)).toBeUndefined();
        expect(
            liveSimilarity(members, drawn([{ id: 9, x: 0, y: 0 }])),
        ).toBeUndefined();
        expect(
            liveSimilarity(members, drawn([{ id: 1, x: 50, y: 50 }])),
        ).toBeUndefined();
    });

    it("is hidden while they're scaled unevenly, which the shape won't keep", () => {
        const uneven = scalePositions(starts, {
            anchor: { x: 0, y: 0 },
            x: 2,
            y: 1,
        });
        expect(liveSimilarity(members, drawn(uneven))).toBeNull();
    });
});
