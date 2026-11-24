import { describe, expect, it } from "vitest";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { lineShape } from "../../line/lineShape";
import { arcShape } from "../../arc/arcShape";
import { boxesAt, type PlacedRecipe } from "../placedBox";
import { detachLabel } from "../detachLinks";
import { linkDragTip } from "../linkTip";
import { liveLinks } from "../shapeLinks";

/**
 * What linked shapes say (#1235, #1249's sims): Detach names the shape it comes apart from, so it
 * doesn't read as a marcher leaving a shape, and the drag's readout says where to drop an end and
 * when letting go links it.
 */

function recipe(
    id: number,
    kind: { id: string; version: number },
    params: LineParams,
    ids: readonly number[],
): PlacedRecipe {
    const spots = lineSpots(params, ids.length);
    return {
        id,
        timelineId: 5,
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

const pts = (a: [number, number], b: [number, number], bend?: number) => ({
    points: [
        { x: a[0], y: a[1], tension: 0, ...(bend ? { bend } : {}) },
        { x: b[0], y: b[1], tension: 0 },
    ],
    spacing: { mode: "fit" } as const,
});

const J = () => {
    const recipes = [
        recipe(1, lineShape, pts([0, 0], [0, 60]), [11, 12, 13]),
        recipe(
            2,
            arcShape,
            {
                ...pts([0, 60], [-40, 60], 180),
                attach: { start: { recipe: 1, end: "end" } },
            },
            [21, 22],
        ),
    ];
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
};

describe("detachLabel", () => {
    it("names the shape on the other side of the joint", () => {
        const boxes = J();
        const links = liveLinks(boxes, 0);
        expect(links).toHaveLength(1);
        const [line, arc] = [boxes[0]!, boxes[1]!];
        expect(detachLabel(links, arc)).toBe("Detach from Line");
        expect(detachLabel(links, line)).toBe("Detach from Arc");
        // The joint's marcher selected alone: it's the line's, so from the line
        expect(detachLabel(links, null)).toBe("Detach from Arc");
    });

    it("counts several links, and falls back to the action's own name", () => {
        const boxes = J();
        const [link] = liveLinks(boxes, 0);
        expect(detachLabel([link!, link!])).toBe("Detach 2 linked shapes");
        expect(detachLabel([])).toBe("Detach linked shape");
    });
});

describe("linkDragTip", () => {
    const at = { x: 3, y: 4 };
    it("says where to drop an end after the readout's numbers", () => {
        expect(
            linkDragTip({ tip: { at, text: "8 steps" } }, at, { kind: "drop" })
                .tip?.text,
        ).toBe("8 steps · Drop on another shape's end to link");
    });
    it("in reach, says only that letting go links them", () => {
        expect(
            linkDragTip({ tip: { at, text: "8 steps" } }, at, {
                kind: "release",
                shape: "Line",
            }).tip,
        ).toEqual({ at, text: "Release to link to Line" });
        // A move's readout may be missing: the tip shows at the pointer
        expect(
            linkDragTip({}, at, { kind: "release", shape: "Arc" }).tip,
        ).toEqual({ at, text: "Release to link to Arc" });
    });
    it("leaves the readout alone with nothing to say", () => {
        const drawing = { tip: { at, text: "15°" } };
        expect(linkDragTip(drawing, at, null)).toBe(drawing);
    });
});
