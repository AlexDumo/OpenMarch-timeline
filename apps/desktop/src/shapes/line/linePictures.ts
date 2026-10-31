import type {
    ToolChoicePicture,
    ToolChoicePictureLine,
} from "../tool/toolKind";
import type { XY } from "../types";
import { lineOutline, type LineParams, type LinePoint } from "./lineGeometry";
import { lineFillSpots } from "./lineFill";

/**
 * The Line's menu pictures (#559): a small sample line laid out with each answer by the Line's own
 * geometry, so a picture shows what the answer does rather than an icon for it. Each menu's
 * pictures share one sample, so only the answer changes between them. Everything here is pure; the
 * pictures are worked out once.
 */

const corner = (x: number, y: number): LinePoint => ({ x, y, tension: 0 });

/**
 * The line drawn through `p`, light under its marchers as the Line lays them out, and any extra
 * lines. With no marchers the line is the picture, drawn full.
 */
function sketch(
    p: LineParams,
    n: number,
    extra: readonly ToolChoicePictureLine[] = [],
): ToolChoicePicture {
    return {
        lines: [
            {
                points: lineOutline(p),
                ...(p.closed ? { closed: true } : {}),
                ...(n > 0 ? { faint: true } : {}),
            },
            ...extra,
        ],
        dots: lineFillSpots(p, n).map(({ x, y }): XY => ({ x, y })),
    };
}

const once = <T>(make: () => T): (() => T) => {
    let made: T | undefined;
    return () => (made ??= make());
};

/** Open or closed: the same four points, joined back or not */
export const endsPictures = once(() => {
    const points = [corner(0, 12), corner(4, 0), corner(16, 0), corner(20, 12)];
    return {
        open: sketch({ points, spacing: { mode: "fit" } }, 6),
        closed: sketch({ points, closed: true, spacing: { mode: "fit" } }, 8),
    };
});

/** A short tick across a straight line along x at `x`: where the line ends */
const endTick = (x: number): ToolChoicePictureLine => ({
    points: [
        { x, y: -1.5 },
        { x, y: 1.5 },
    ],
});

/**
 * Spacing on one straight line: Fit spreads the marchers from end to end, Keep interval keeps
 * their spacing so the line grows (dashed) or shrinks with them, and Interval on the path lays
 * them at their interval from the start, the center or the end of a longer line.
 */
export const spacingPictures = once(() => {
    const LENGTH = 24;
    const straight = (to: number): LinePoint[] => [corner(0, 0), corner(to, 0)];
    const path = (anchor: "start" | "center" | "end") =>
        sketch(
            {
                points: straight(LENGTH),
                spacing: { mode: "path", groups: [{ interval: 3 }], anchor },
            },
            4,
            [endTick(0), endTick(LENGTH)],
        );
    return {
        fit: sketch({ points: straight(LENGTH), spacing: { mode: "fit" } }, 5, [
            endTick(0),
            endTick(LENGTH),
        ]),
        keep: sketch(
            {
                points: straight(16),
                spacing: { mode: "keep", groups: [{ interval: 4 }] },
            },
            5,
            [
                {
                    points: [
                        { x: 16, y: 0 },
                        { x: LENGTH, y: 0 },
                    ],
                    dashed: true,
                },
            ],
        ),
        "path-start": path("start"),
        "path-center": path("center"),
        "path-end": path("end"),
    };
});

/**
 * What the interval measures, on a line that bends from steep to shallow: the true distance puts
 * the marchers evenly along it; ↔ evens their side-to-side gaps (light lines up and down through
 * each), so they spread out on the steep part; ↕ evens their front-to-back gaps (light lines
 * across), so they spread out on the shallow part.
 */
export const measuredPictures = once(() => {
    const points = [corner(0, 0), corner(4, 10), corner(22, 14)];
    const n = 6;
    const guides = (p: LineParams, axis: "x" | "y"): ToolChoicePictureLine[] =>
        lineFillSpots(p, n).map(({ x, y }) => ({
            points:
                axis === "x"
                    ? [
                          { x, y: 0 },
                          { x, y: 14 },
                      ]
                    : [
                          { x: 0, y },
                          { x: 22, y },
                      ],
            faint: true,
        }));
    const measured = (axis?: "x" | "y") => {
        const p: LineParams = {
            points,
            spacing: { mode: "fit" },
            // The run goes round the bend, so only what's measured places it
            corners: false,
            ...(axis ? { measured: axis } : {}),
        };
        return sketch(p, n, axis ? guides(p, axis) : []);
    };
    return { true: measured(), x: measured("x"), y: measured("y") };
});

/** The corners switch on an L: a marcher on the corner, or the run going round it */
export const cornersPictures = once(() => {
    const points = [corner(0, 0), corner(0, 9), corner(15, 9)];
    const of = (corners: boolean) =>
        sketch(
            {
                points,
                spacing: { mode: "fit" },
                ...(corners ? {} : { corners: false }),
            },
            5,
        );
    return { on: of(true), off: of(false) };
});
