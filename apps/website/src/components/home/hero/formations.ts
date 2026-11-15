/**
 * Prototype (#968): the hero's formations, made by the desktop app's own shape engine.
 *
 * The engine is `apps/desktop/src/shapes` (not `packages/core`, which only has the Hungarian
 * solver). Its geometry is pure, so it is imported here straight from the desktop sources; the
 * one impure import, the translation singleton, is swapped for a stub in `astro.config.mjs`.
 *
 * Every formation is in steps, around (0, 0), +y toward the audience (down the page).
 */
import { boxSpots } from "../../../../../desktop/src/shapes/box/boxShape";
import type { BoxParams } from "../../../../../desktop/src/shapes/box/boxGeometry";
import {
    circleSpots,
    type CircleParams,
} from "../../../../../desktop/src/shapes/circle/circleGeometry";
import {
    lineSpots,
    type LineParams,
} from "../../../../../desktop/src/shapes/line/lineGeometry";
import { withBend } from "../../../../../desktop/src/shapes/arc/arcGeometry";
import {
    DEFAULT_ODD_GAP,
    NO_STAGGER,
    spreadDistribution,
    type Distribution,
    type LayoutFamily,
} from "../../../../../desktop/src/shapes/distribute/distribution";
import { leastTravel } from "../../../../../desktop/src/shapes/leastTravel";

export interface XY {
    x: number;
    y: number;
}

const ORIGIN = { x: 0, y: 0 };
const OUTLINE: Distribution = { mode: "outline", oddGap: DEFAULT_ODD_GAP };

const grid = (files: number, family: LayoutFamily): Distribution => ({
    mode: "files",
    layout: { family, files, byFile: false },
    stagger: NO_STAGGER,
});

/** A box of `n`, `files` across, at `interval` steps both ways */
export function box(
    n: number,
    files: number,
    interval: number,
    fill: LayoutFamily | "outline" | "spread" = "full",
): XY[] {
    const p: BoxParams = {
        center: ORIGIN,
        rotation: 0,
        files,
        across: interval,
        deep: interval,
        distribution:
            fill === "outline"
                ? OUTLINE
                : fill === "spread"
                  ? spreadDistribution(3, n)
                  : grid(files, fill),
        ...(fill === "spread" && { spreadAspect: 1.6 }),
    };
    return boxSpots(p, n).map(({ x, y }) => ({ x, y }));
}

/** A circle of `n`, neighbors `interval` steps apart; filled when `spread` */
export function circle(n: number, interval: number, spread = false): XY[] {
    const p: CircleParams = {
        center: ORIGIN,
        interval,
        rotation: 0,
        distribution: spread ? spreadDistribution(2, n) : OUTLINE,
    };
    return circleSpots(p, n).map(({ x, y }) => ({ x, y }));
}

const point = (x: number, y: number) => ({ x, y, tension: 0 });

/** A straight line of `n` from `a` to `b` */
export function line(n: number, a: XY, b: XY): XY[] {
    const p: LineParams = {
        points: [point(a.x, a.y), point(b.x, b.y)],
        spacing: { mode: "fit" },
    };
    return lineSpots(p, n).map(({ x, y }) => ({ x, y }));
}

/** An arc of `n`, `width` steps from end to end, turning through `bend` degrees */
export function arc(n: number, width: number, bend: number): XY[] {
    const straight: LineParams = {
        points: [point(-width / 2, 0), point(width / 2, 0)],
        spacing: { mode: "fit" },
    };
    return centered(
        lineSpots(withBend(straight, bend), n).map(({ x, y }) => ({ x, y })),
    );
}

/** A line of `n` through `corners`, a marcher on each; closed when `closed` */
export function polyline(n: number, corners: XY[], closed = false): XY[] {
    const p: LineParams = {
        points: corners.map((c) => point(c.x, c.y)),
        spacing: { mode: "fit" },
        ...(closed && { closed: true }),
    };
    return lineSpots(p, n).map(({ x, y }) => ({ x, y }));
}

/** The spots moved so their bounding box is centered on (0, 0) */
export function centered(spots: XY[]): XY[] {
    if (spots.length === 0) return spots;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const s of spots) {
        x0 = Math.min(x0, s.x);
        x1 = Math.max(x1, s.x);
        y0 = Math.min(y0, s.y);
        y1 = Math.max(y1, s.y);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return spots.map((s) => ({ x: s.x - cx, y: s.y - cy }));
}

/** Several shapes side by side as one formation: each moved by its offset */
export const together = (...parts: [XY[], XY][]): XY[] =>
    parts.flatMap(([spots, by]) =>
        spots.map((s) => ({ x: s.x + by.x, y: s.y + by.y })),
    );

/**
 * Who goes to which spot, as the app's shape tool decides it ("nearest": least squared travel,
 * crossing walks swapped apart). Returns the spot index for each marcher.
 */
export const whoGoesWhere = (from: readonly XY[], spots: readonly XY[]) =>
    leastTravel(from, spots);

/** A formation worked out the first time it's asked for, then kept */
export type Formation = () => XY[];
export function once(make: () => XY[]): Formation {
    let made: XY[] | undefined;
    return () => (made ??= make());
}

/** Work a formation out ahead of need, when the page has nothing else to do */
export function warm(formation: Formation): void {
    const idle =
        window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 60));
    idle(() => formation());
}
