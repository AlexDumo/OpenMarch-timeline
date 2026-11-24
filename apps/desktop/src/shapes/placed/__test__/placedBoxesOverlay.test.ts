import { describe, expect, it } from "vitest";
import { arcTool } from "../../arc/arcTool";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { lineTool } from "../../line/lineTool";
import type { AnyToolKind } from "../../tool/toolKind";
import type { PlacedBox } from "../placedBox";
import { placedBoxDrawing } from "../PlacedBoxesOverlay";

/**
 * How the field outlines a placed shape that isn't the one selected whole (several selected, part
 * of one selected): an open Line, Curve or Arc along its path, not as a flat frame between its ends
 */

const STEP = 12;

function placedLine(kind: AnyToolKind, params: LineParams, n: number) {
    const spots = lineSpots(params, n);
    const box: PlacedBox<LineParams> = {
        recipe: {
            id: 1,
            timelineId: 5,
            kind: kind.shape.id,
            kindVersion: kind.shape.version,
            params: { ...params, spots: n },
            orderMode: "nearest",
            reverse: false,
            members: spots.map((p, slot) => ({
                marcherId: slot + 1,
                slot,
                ...p,
            })),
        },
        kind,
        params,
        spots: n,
        endBeat: 0,
    };
    return { box: box as PlacedBox, spots };
}

/** How far `p` is from the x axis */
const offAxis = (p: { y: number }) => Math.abs(p.y);

describe("placedBoxDrawing", () => {
    it("draws an open Arc along its curve, through its marchers", () => {
        const { box, spots } = placedLine(
            arcTool,
            {
                points: [
                    { x: 0, y: 0, tension: 0, bend: 90 },
                    { x: 88, y: 0, tension: 0 },
                ],
                spacing: { mode: "fit" },
            },
            5,
        );
        const drawing = placedBoxDrawing(box, STEP);
        expect(drawing.open).toBe(true);
        // The middle marcher stands off the chord, and the outline reaches it
        const middle = spots[2]!;
        expect(offAxis(middle)).toBeGreaterThan(STEP);
        const nearest = Math.min(
            ...drawing.corners.map((c) =>
                Math.hypot(c.x - middle.x, c.y - middle.y),
            ),
        );
        expect(nearest).toBeLessThan(STEP / 2);
    });

    it("draws a joined line through its joint, not straight from end to end", () => {
        const { box } = placedLine(
            lineTool,
            {
                points: [
                    { x: 0, y: -60, tension: 0 },
                    { x: 0, y: 0, tension: 0, marcher: true },
                    { x: 60, y: 0, tension: 0 },
                ],
                spacing: { mode: "fit" },
            },
            7,
        );
        const drawing = placedBoxDrawing(box, STEP);
        expect(drawing.open).toBe(true);
        expect(drawing.corners.some((c) => Math.hypot(c.x, c.y) < 1e-6)).toBe(
            true,
        );
    });
});
