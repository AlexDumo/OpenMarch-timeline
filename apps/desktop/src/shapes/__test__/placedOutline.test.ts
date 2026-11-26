import { describe, expect, it } from "vitest";
import { boxTool } from "../box/boxTool";
import { frameCorners } from "../frame/frame";
import { shapeOutline } from "../frame/gestures";
import { arcTool } from "../arc/arcTool";
import { curveTool, lineTool } from "../line/lineTool";
import type { LineParams } from "../line/lineGeometry";
import type { PlacedBox, PlacedRecipe } from "../placed/placedBox";
import { placedOutline } from "../placed/PlacedBoxesOverlay";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * Placed shapes that aren't being edited are outlined as the selected one is drawn: a Line,
 * Curve or Arc along its path (never the box round its chord), a closed line as its own outline,
 * each of its rows as a line; a box half a step out round its frame.
 */

const STEP = 10;
const PAD = STEP / 2;
const env: ToolEnv = {
    stepPx: STEP,
    snap: false,
    pull: false,
    constrain: false,
    gridSnap: (p) => p,
    hitRadius: 3,
    pullRadius: 2,
};

const placed = (kind: AnyToolKind, params: unknown, spots: number) =>
    ({
        recipe: {} as PlacedRecipe,
        kind,
        params,
        spots,
        endBeat: 0,
    }) satisfies PlacedBox;

/** How far `p` is from the straight line through `a` and `b` */
const offChord = (p: XY, a: XY, b: XY) =>
    Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) /
    Math.hypot(b.x - a.x, b.y - a.y);

describe("placedOutline", () => {
    const from = { x: 100, y: 300 };
    const to = { x: 300, y: 300 };

    it.each([
        ["curve", curveTool],
        ["arc", arcTool],
    ])("draws a %s open, along its path", (_name, kind) => {
        const params = kind.draw!(from, to, 8, env) as LineParams;
        const out = placedOutline(placed(kind, params, 8), PAD, STEP);
        expect(out.open).toBe(true);
        expect(out.corners).toEqual(shapeOutline(kind, params, 8));
        // It bends away from its chord, as the shape does: not a thin box from end to end
        const bow = Math.max(...out.corners.map((p) => offChord(p, from, to)));
        expect(bow).toBeGreaterThan(2 * STEP);
        expect(out.rows).toEqual([]);
    });

    it("draws a closed line closed, as its own outline", () => {
        const params = lineTool.clickPoints!.close!(
            [from, { x: 200, y: 150 }, to],
            9,
            env,
        ) as LineParams;
        expect(params.closed).toBe(true);
        const out = placedOutline(placed(lineTool, params, 9), PAD, STEP);
        expect(out.open).toBe(false);
        expect(out.corners).toEqual(shapeOutline(lineTool, params, 9));
    });

    it("draws each of a line's other rows", () => {
        const line = lineTool.clickPoints!.draw(
            [from, { x: 200, y: 250 }, to],
            8,
            env,
        ) as LineParams;
        const params = lineTool.rows!.pick(line, 8, 4, env);
        const out = placedOutline(placed(lineTool, params, 8), PAD, STEP);
        expect(out.open).toBe(true);
        expect(out.rows).toHaveLength(1);
        expect(out.rows).toEqual(lineTool.rowOutlines!(params, 8, STEP));
    });

    it("keeps a box half a step out round its frame", () => {
        const params = boxTool.draw!(from, { x: 200, y: 360 }, 8, env);
        const out = placedOutline(placed(boxTool, params, 8), PAD, STEP);
        const frame = boxTool.frameOf(params, 8);
        expect(out.open).toBe(false);
        expect(out.rows).toEqual([]);
        expect(out.corners).toEqual(
            frameCorners({
                ...frame,
                halfWidth: frame.halfWidth + PAD,
                halfDepth: frame.halfDepth + PAD,
            }),
        );
    });
});
