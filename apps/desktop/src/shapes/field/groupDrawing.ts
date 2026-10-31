import type { XY } from "../types";
import type { AnyToolKind } from "../tool/toolKind";
import type { GroupMenuState } from "./shapePointer";

/**
 * The colors of a Line's interval groups (#526 follow-up), in the group menu's dots and on the
 * field. Hues from a well-known color-blind-safe palette: told apart by people with any common
 * color blindness, mid-tone so they read on the light and the dark field, and none of them the
 * shape's purple or the next path's green. More groups than colors take them round again.
 */
export const GROUP_COLORS = [
    "#E69F00", // orange
    "#56B4E9", // sky blue
    "#D55E00", // vermilion
    "#0072B2", // blue
    "#CC79A7", // pink
] as const;

/** Group `index`'s color */
export const groupColor = (index: number): string =>
    GROUP_COLORS[
        ((index % GROUP_COLORS.length) + GROUP_COLORS.length) %
            GROUP_COLORS.length
    ]!;

/**
 * How a spot's group shows: `faint` while the menu is open and no group is lit, `lit` for the
 * group pointed at, `dim` for the others then
 */
export type GroupMarkShade = "faint" | "lit" | "dim";

/** A spot ringed in its group's color */
export interface GroupMark {
    readonly at: XY;
    readonly color: string;
    readonly shade: GroupMarkShade;
    readonly group: number;
}

/** A gap of the lit group labeled with its interval, at its middle: "3", "↔ 2½" */
export interface GroupGapLabel {
    readonly at: XY;
    readonly text: string;
    readonly color: string;
}

/**
 * What the field draws of a shape's interval groups while the editor's group menu is open: each
 * spot ringed in its group's color, and with a group lit, every gap in it labeled with its
 * interval (and the axis, on a Measured line). Nothing with the menu closed or a shape without
 * groups. `spots` are the shape's spots in order along it, as its kind lays them out. Pure: a
 * drawing only, nothing is edited.
 */
export function groupDrawing(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    spots: readonly XY[],
    menu: GroupMenuState | null,
    stepPx: number,
): { groupMarks?: GroupMark[]; groupLabels?: GroupGapLabel[] } {
    if (!menu || !kind.groups) return {};
    const shown = kind.groups.shown(params, n, stepPx);
    if (!shown || shown.length < 2) return {};
    const marks: GroupMark[] = [];
    const labels: GroupGapLabel[] = [];
    const axis = kind.groups.axis?.(params) ?? null;
    const prefix = axis === "x" ? "↔ " : axis === "y" ? "↕ " : "";
    let at = 0;
    // Each group's count as laid out: a dropped group's is 0
    shown.forEach((g, group) => {
        const count = Number(g.count);
        const color = groupColor(group);
        const shade: GroupMarkShade =
            menu.lit === null ? "faint" : menu.lit === group ? "lit" : "dim";
        for (let k = 0; k < count && at + k < spots.length; k++)
            marks.push({ at: spots[at + k]!, color, shade, group });
        if (menu.lit === group)
            for (let k = 1; k < count && at + k < spots.length; k++) {
                const a = spots[at + k - 1]!;
                const b = spots[at + k]!;
                labels.push({
                    at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                    text: prefix + g.interval,
                    color,
                });
            }
        at += count;
    });
    return { groupMarks: marks, groupLabels: labels };
}
