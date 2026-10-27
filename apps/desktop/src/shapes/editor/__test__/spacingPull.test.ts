import { describe, expect, it } from "vitest";
import { boxFrame, type BoxParams } from "../../box/boxGeometry";
import { BOX_PARAMS } from "../../box/boxParams";
import { boxTool } from "../../box/boxTool";
import type { ToolEnv } from "../../tool/toolKind";
import type { XY } from "../../types";
import { scrubSpacing, withSpacing } from "../boxEdits";

/**
 * Guides while dragging a spacing (#452): grown from its pivot, a box's corner or center that
 * comes near one of the field's lines lands on it, the spacing becoming whatever that takes.
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
const N = 12;
/** 4 files by 3 ranks, 2 steps apart, turned `degrees` around the default pivot */
const turned = (
    degrees: number,
    center: XY = { x: 40, y: -150 },
): BoxParams => ({
    center,
    rotation: (degrees * Math.PI) / 180,
    files: 4,
    across: 2 * STEP,
    deep: 2 * STEP,
});
const points = (p: BoxParams) => boxTool.snapPoints!(p, N);
const onLine = (p: XY) =>
    LINES.x.some((x) => Math.abs(p.x - x) < 1e-9) ||
    LINES.y.some((y) => Math.abs(p.y - y) < 1e-9);
const onHalves = (v: number) =>
    Math.abs(v / half - Math.round(v / half)) < 1e-9;
/** The across spacing dragged `px` for more */
const drag = (p: BoxParams, px: number, over: Partial<ToolEnv> = {}) =>
    scrubSpacing(p, "across", px, N, env(over));
/** Where the box would be with the spacing exactly where a drag of `px` has it, unrounded */
const freeAt = (p: BoxParams, px: number) =>
    withSpacing(
        p,
        "across",
        p.across / STEP + (px / 8) * 0.5,
        N,
        env({ snap: false }),
        true,
    );

describe("dragging a spacing onto a line", () => {
    it("a 45° box's across drag lands a corner exactly on a yard line, the spacing what that takes", () => {
        const p = turned(45);
        let landed: BoxParams | null = null;
        for (let px = 0; px <= 160 && !landed; px += 0.5) {
            const out = drag(p, px);
            if (!onHalves(out.across)) landed = out;
        }
        expect(landed).not.toBeNull();
        const corners = points(landed!).slice(0, 4);
        expect(
            corners.some((c) =>
                LINES.x.some((x) => Math.abs(c.x - x) < 1e-9),
            ) ||
                corners.some((c) =>
                    LINES.y.some((y) => Math.abs(c.y - y) < 1e-9),
                ),
        ).toBe(true);
        // Still turned 45°, the same count
        expect(landed!.rotation).toBe(p.rotation);
        expect(landed!.files).toBe(4);
    });

    it("gives only half steps or a point exactly on a line, and keeps every half step reachable", () => {
        const p = turned(45);
        const seen = new Set<string>();
        for (let px = 0; px <= 160; px += 0.25) {
            const out = drag(p, px);
            expect(onHalves(out.across) || points(out).some(onLine)).toBe(true);
            seen.add(out.across.toFixed(6));
        }
        // 2 steps up to 7: every half step on the way
        for (let steps = 2; steps <= 7; steps += 0.5)
            expect(seen.has((steps * STEP).toFixed(6)), `${steps}`).toBe(true);
    });

    for (const degrees of [15, 5, 1])
        it(`at ${degrees}°, a point travels no farther than the radius to catch a line`, () => {
            const p = turned(degrees, { x: 40, y: -275 });
            for (let px = 0; px <= 160; px += 0.25) {
                const out = drag(p, px);
                if (onHalves(out.across)) continue;
                // Pulled: some point is on a line, and no point moved more than 6 from the drag's
                const free = points(freeAt(p, px));
                const travel = Math.max(
                    ...points(out).map((q, k) =>
                        Math.hypot(q.x - free[k]!.x, q.y - free[k]!.y),
                    ),
                );
                expect(travel).toBeLessThanOrEqual(6 + 1e-3);
            }
        });

    it("doesn't pull far from lines", () => {
        const p = turned(45);
        const far = { fieldLines: { x: [5000], y: [5000] } };
        for (let px = 0; px <= 80; px += 1)
            expect(onHalves(drag(p, px, far).across)).toBe(true);
    });

    it("doesn't pull with Alt: hundredths", () => {
        const p = turned(45);
        for (let px = 0; px <= 80; px += 1) {
            const out = drag(p, px, { snap: false });
            const hundredths = out.across / (STEP / 100);
            expect(Math.abs(hundredths - Math.round(hundredths))).toBeLessThan(
                1e-6,
            );
        }
    });

    it("never goes under half a step", () => {
        const p = turned(45);
        for (let px = -200; px <= 0; px += 1)
            expect(drag(p, px).across).toBeGreaterThanOrEqual(half - 1e-9);
    });

    it("keeps a typed spacing exact and the steppers on half steps, near a line or not", () => {
        const across = BOX_PARAMS.find((q) => q.key === "across")!;
        // 3 gaps 2 steps apart from x 15 to 75, growing from its west side: 2.15 steps
        // would put its right edge 1.5 short of the 80
        const p = turned(0, { x: 45, y: -150 });
        const west = { pivot: "w" as const };
        const typed = across.type!(p, N, "2.15", env(west)) as BoxParams;
        expect(typed.across).toBeCloseTo(21.5, 9);
        const wider = across.widen!(p, N, 0.5, env(west)) as BoxParams;
        expect(wider.across).toBe(25);
        // A drag to about the same spacing lands the right edge on the 80 instead: 2⅙ steps
        const dragged = drag(p, 2.4, west);
        const right = Math.max(
            ...points(dragged)
                .slice(0, 4)
                .map((c) => c.x),
        );
        expect(Math.abs(right - 80)).toBeLessThan(1e-9);
        expect(dragged.across).toBeCloseTo(65 / 3, 9);
        expect(boxFrame(dragged, N).rotation).toBe(0);
    });
});
