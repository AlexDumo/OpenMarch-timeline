import { describe, expect, it } from "vitest";
import { fieldToFrame, frameToField } from "../../frame/frame";
import {
    boxCorners,
    boxFrame,
    boxHandlePoint,
    drawBox,
    stretchBox,
    type BoxHandleKey,
    type BoxParams,
} from "../boxGeometry";
import type { ToolEnv } from "../../tool/toolKind";
import type { XY } from "../../types";

/**
 * The edge pull (#425): while a box handle is dragged or a box is drawn, a moving edge that comes
 * within a few pixels of one of the field's lines lands on it, the interval becoming whatever
 * that takes. Away from lines the half-step ladder wins.
 */

const STEP = 10;
const half = STEP / 2;
const snapHalf = (v: number) => Math.round(v / half) * half;
/** Yard lines every 8 steps side to side; front sideline, front and back hash front to back */
const LINES = {
    x: [-160, -80, 0, 80, 160],
    y: [0, -280, -560],
};
const env = (over: Partial<ToolEnv> = {}): ToolEnv => ({
    stepPx: STEP,
    snap: true,
    shift: false,
    gridSnap: (p) => ({ x: snapHalf(p.x), y: snapHalf(p.y) }),
    hitRadius: 3,
    fieldLines: LINES,
    pullRadius: 6,
    ...over,
});
const exact = (a: number, b: number) =>
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
const onHalves = (v: number) =>
    expect(Math.abs(v / half - Math.round(v / half))).toBeLessThan(1e-9);

/** `files` files in one rank, 2 steps apart, its left edge on x = `left`, y = -100 */
function row(files: number, left = 0): BoxParams {
    return {
        center: { x: left + ((files - 1) * 2 * STEP) / 2, y: -100 },
        rotation: 0,
        files,
        across: 2 * STEP,
        deep: 2 * STEP,
    };
}
const edges = (p: BoxParams, n: number) => {
    const f = boxFrame(p, n);
    return {
        left: f.center.x - f.halfWidth,
        right: f.center.x + f.halfWidth,
        back: f.center.y - f.halfDepth,
        front: f.center.y + f.halfDepth,
    };
};
const stretch = (
    p: BoxParams,
    n: number,
    key: BoxHandleKey,
    to: XY,
    over: Partial<ToolEnv> = {},
) => stretchBox(p, n, key, to, env(over));

describe("stretching a box onto a line", () => {
    it("7 files from the 40, dragged near the 50, are exactly 2⅔ apart with the edge on it", () => {
        const p = stretch(row(7), 7, "e", { x: 162, y: -100 });
        exact(p.across, (8 / 3) * STEP);
        exact(edges(p, 7).right, 160);
        exact(edges(p, 7).left, 0);
    });

    it("11 files there are 1⅗ apart", () => {
        const p = stretch(row(11), 11, "e", { x: 157, y: -100 });
        exact(p.across, 1.6 * STEP);
        exact(edges(p, 11).right, 160);
    });

    it("keeps the fixed edge from the other side too", () => {
        // Right edge on 160, dragged left to near the 0 line
        const p = stretch(row(7, 40), 7, "w", { x: 3, y: -100 });
        exact(edges(p, 7).right, 160);
        exact(edges(p, 7).left, 0);
        exact(p.across, (8 / 3) * STEP);
    });

    it("5 ranks from the front sideline to the front hash are 7 apart", () => {
        const ranks: BoxParams = {
            center: { x: 0, y: -40 },
            rotation: 0,
            files: 1,
            across: 2 * STEP,
            deep: 2 * STEP,
        };
        const p = stretch(ranks, 5, "n", { x: 0, y: -284 });
        exact(p.deep, 7 * STEP);
        exact(edges(p, 5).back, -280);
        exact(edges(p, 5).front, 0);
    });

    it("steps by half steps away from lines", () => {
        for (const x of [100, 113, 127, 140]) {
            const p = stretch(row(7), 7, "e", { x, y: -100 });
            onHalves(p.across);
            exact(edges(p, 7).left, 0);
        }
    });

    it("pulls only within the radius, and no farther than a quarter of the edge's half-step detent", () => {
        // 7 pixels away is past the 6 px radius
        onHalves(stretch(row(7), 7, "e", { x: 167, y: -100 }).across);
        // 3 files: the detent at the edge is 2 × ½ step = 10, so the pull reaches 2.5
        const three = row(3);
        exact(stretch(three, 3, "e", { x: 82, y: -100 }).across, 40);
        exact(
            stretch(three, 3, "e", { x: 77.4, y: -100 }).across,
            40, // the ladder's own value lands on the line too
        );
        onHalves(stretch(three, 3, "e", { x: 83, y: -100 }).across);
    });

    it("doesn't pull with Alt or Shift, or a 45° box with no corner near a line", () => {
        const alt = stretch(
            row(7),
            7,
            "e",
            { x: 162, y: -100 },
            { snap: false },
        );
        expect(Math.abs(alt.across - (8 / 3) * STEP)).toBeGreaterThan(1e-3);
        onHalves(
            stretch(row(7), 7, "e", { x: 162, y: -100 }, { shift: true })
                .across,
        );
        const turned = { ...row(7), rotation: Math.PI / 4 };
        const to = boxHandlePoint(turned, 7, "e");
        const p = stretch(turned, 7, "e", { x: to.x + 1, y: to.y + 1 });
        onHalves(p.across);
    });

    it("with the ratio lock at 1, a pulled 2⅔ across makes deep exactly 2⅔", () => {
        const block: BoxParams = { ...row(7), files: 7 };
        const p = stretch(
            block,
            14,
            "e",
            { x: 162, y: -100 },
            { ratioLocked: true },
        );
        exact(p.across, (8 / 3) * STEP);
        exact(p.deep, (8 / 3) * STEP);
    });

    it("with the ratio lock, a pulled axis that doesn't lead leaves the other on half steps", () => {
        // 7 × 2, 2 across and 1½ deep (deep is ¾ of across), its left edge on the 0 line. The
        // corner goes 2 px from the 160 line, but deep grows more (to 2½), so deep leads: across
        // follows it on half steps, not as an exact value off both the line and the ladder
        const base: BoxParams = { ...row(7), deep: 1.5 * STEP };
        const top = base.center.y - (1.5 * STEP) / 2;
        const p = stretch(
            base,
            14,
            "se",
            { x: 162, y: top + 2.5 * STEP },
            { ratioLocked: true },
        );
        exact(p.deep, 2.5 * STEP);
        onHalves(p.across);
        exact(edges(p, 14).left, 0);
    });

    it("on a box turned a quarter, its own across follows the field's front-to-back lines", () => {
        const turned: BoxParams = { ...row(5), rotation: Math.PI / 2 };
        // Put the box's own west end on the front sideline (y = 0)
        const w = boxHandlePoint(turned, 5, "w");
        const placed = {
            ...turned,
            center: { x: turned.center.x, y: turned.center.y - w.y },
        };
        const w0 = boxHandlePoint(placed, 5, "w");
        const e0 = boxHandlePoint(placed, 5, "e");
        const dir = Math.sign(e0.y - w0.y);
        const lineY = dir < 0 ? -280 : 280;
        const lines = { x: LINES.x, y: [0, lineY] };
        const p = stretchBox(
            placed,
            5,
            "e",
            { x: e0.x, y: lineY - dir * 3 },
            env({ fieldLines: lines }),
        );
        exact(p.across, 7 * STEP);
        exact(boxHandlePoint(p, 5, "w").y, 0);
        exact(boxHandlePoint(p, 5, "e").y, lineY);
    });
});

describe("drawing a box onto a line", () => {
    it("lands the dragged edge on the line from a corner on the 40, whatever the count", () => {
        const p = drawBox({ x: 0, y: -100 }, { x: 162, y: -99 }, 7, env())!;
        exact(p.across, (8 / 3) * STEP);
        exact(edges(p, 7).left, 0);
        exact(edges(p, 7).right, 160);
        const eleven = drawBox(
            { x: 0, y: -100 },
            { x: 158, y: -99 },
            11,
            env(),
        )!;
        exact(edges(eleven, 11).right, 160);
        exact(edges(eleven, 11).left, 0);
    });

    it("drawn up and to the left, keeps the pressed corner and puts the far edge on the line", () => {
        const p = drawBox({ x: 160, y: -100 }, { x: 2, y: -101 }, 7, env())!;
        exact(edges(p, 7).right, 160);
        exact(edges(p, 7).left, 0);
    });

    it("doesn't pull with Shift or Alt", () => {
        const shift = drawBox(
            { x: 0, y: -100 },
            { x: 162, y: -99 },
            7,
            env({ shift: true }),
        )!;
        onHalves(shift.across);
        const alt = drawBox(
            { x: 0, y: -100 },
            { x: 162, y: -99 },
            7,
            env({ snap: false }),
        )!;
        expect(Math.abs(alt.across - (8 / 3) * STEP)).toBeGreaterThan(1e-3);
    });
});

describe("stretching a turned box onto a line (#446)", () => {
    const N = 12;
    /** 4 files by 3 ranks, 2 steps apart, turned `degrees`, own corner `own` at field `at` */
    const turned = (degrees: number, own: XY, at: XY): BoxParams => {
        const p: BoxParams = {
            center: { x: 0, y: 0 },
            rotation: (degrees * Math.PI) / 180,
            files: 4,
            across: 2 * STEP,
            deep: 2 * STEP,
        };
        const c = frameToField(boxFrame(p, N), own);
        return { ...p, center: { x: at.x - c.x, y: at.y - c.y } };
    };
    // Own half sizes: 3 gaps × 20 across, 2 × 20 deep
    const HW = 30;
    const HD = 20;
    /** Where own point `own` of `p` is on the field */
    const field = (p: BoxParams, own: XY) => frameToField(boxFrame(p, N), own);
    /** The own point of `p` a field point `at` is, worked out on its frame */
    const ownOf = (p: BoxParams, at: XY) => fieldToFrame(boxFrame(p, N), at);
    const hasCorner = (p: BoxParams, at: Partial<XY>) =>
        boxCorners(p, N).some(
            (c) =>
                (at.x === undefined || Math.abs(c.x - at.x) < 1e-9) &&
                (at.y === undefined || Math.abs(c.y - at.y) < 1e-9),
        );
    const sameCorner = (p: BoxParams, at: XY) =>
        expect(hasCorner(p, at)).toBe(true);

    it("a 15° box's east handle lands its corner on a yard line, the west side staying", () => {
        // Its back-east corner 4 short of the 50
        const p = turned(15, { x: HW, y: -HD }, { x: 76, y: -150 });
        const west = [
            field(p, { x: -HW, y: -HD }),
            field(p, { x: -HW, y: HD }),
        ];
        // The east edge where the corner is on the 50, then 1 short of it
        const u = field(p, { x: HW + 1, y: -HD }).x - 76;
        const onLine = HW + 4 / u;
        const to = field(p, { x: onLine - 1, y: 0 });
        const out = stretch(p, N, "e", to);
        expect(hasCorner(out, { x: 80 })).toBe(true);
        for (const w of west) sameCorner(out, w);
        exact(out.rotation, p.rotation);
        // Spacing is exactly what that takes
        exact(out.across, (onLine + HW) / 3);
    });

    it("a 30° box's back handle lands a corner on the back hash", () => {
        const p = turned(30, { x: HW, y: -HD }, { x: 40, y: -277 });
        const front = [field(p, { x: -HW, y: HD }), field(p, { x: HW, y: HD })];
        // Each unit the back edge moves back (own −y) moves that corner's y by dy
        const dy = field(p, { x: HW, y: -HD - 1 }).y - -277;
        const onLine = -HD - -3 / dy;
        const to = field(p, { x: 0, y: onLine + 1 });
        const out = stretch(p, N, "n", to);
        expect(hasCorner(out, { y: -280 })).toBe(true);
        for (const f of front) sameCorner(out, f);
        exact(out.deep, (HD - onLine) / 2);
    });

    it("a 15° box's corner handle lands its corner on a yard line and the back hash at once", () => {
        const p = turned(15, { x: HW, y: -HD }, { x: 77.5, y: -277.5 });
        const anchor = field(p, { x: -HW, y: HD });
        // The own spot the crossing is, then dragged a little short of it
        const cross = ownOf(p, { x: 80, y: -280 });
        const to = field(p, { x: cross.x - 0.6, y: cross.y + 0.6 });
        const out = stretch(p, N, "ne", to);
        sameCorner(out, { x: 80, y: -280 });
        sameCorner(out, anchor);
        exact(out.across, (cross.x + HW) / 3);
        exact(out.deep, (HD - cross.y) / 2);
    });

    it("steps by half steps away from lines, and Alt doesn't pull", () => {
        const p = turned(15, { x: HW, y: -HD }, { x: 50, y: -150 });
        const to = field(p, { x: HW + 9, y: 0 });
        onHalves(stretch(p, N, "e", to).across);
        const near = turned(15, { x: HW, y: -HD }, { x: 76, y: -150 });
        const u = field(near, { x: HW + 1, y: -HD }).x - 76;
        const t = field(near, { x: HW + 4 / u - 1, y: 0 });
        expect(
            hasCorner(stretch(near, N, "e", t, { snap: false }), { x: 80 }),
        ).toBe(false);
    });
});
