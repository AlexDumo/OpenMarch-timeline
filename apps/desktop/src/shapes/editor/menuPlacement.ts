import type { XY } from "../types";
import type { Rect } from "@/components/canvas/fieldLayers";

/**
 * Where an editor menu opens so it doesn't cover the shape being edited (Rows menu, owner): under
 * the editor as before when that's clear, else above it, else beside it, kept inside the field;
 * else further out past the shape (one wider than the editor). With nowhere clear, the spot that
 * covers the least of it. Pure; screen px throughout.
 */

/** The menus' gap from the editor, px */
export const MENU_GAP_PX = 6;
/** Room kept around the shape's points, so a spot's dot isn't half under the menu */
const POINT_CLEAR_PX = 10;
/** The longest stretch of the shape's outline between two points tested, px */
const SAMPLE_PX = 8;

/** Under the editor, above it, or to its right or left */
export type MenuWhere = "below" | "above" | "right" | "left";

/** In the order tried: under the editor first, where the menus always opened */
export const MENU_WHERE: readonly MenuWhere[] = [
    "below",
    "above",
    "right",
    "left",
];

export interface MenuPlacementInput {
    /** The menu's size */
    readonly width: number;
    readonly height: number;
    /** The button that opens it */
    readonly trigger: Rect;
    /** The whole floating editor (bar and pill) */
    readonly editor: Rect;
    /** The field: the menu stays inside it */
    readonly field: Rect;
    /** The shape's lines: its outline and its rows (each stretch along one is tested too) */
    readonly shape: readonly (readonly XY[])[];
    /** Where it is now: kept while it's still clear, so it doesn't hop as the shape changes */
    readonly current?: MenuWhere | null;
}

const clamp = (v: number, lo: number, hi: number) =>
    hi < lo ? lo : Math.min(hi, Math.max(lo, v));

/** The menu's box for `where`, slid along the editor's edge to stay inside the field */
export function menuRect(input: MenuPlacementInput, where: MenuWhere): Rect {
    const { width, height, trigger, editor, field } = input;
    const fieldRight = field.left + field.width;
    const fieldBottom = field.top + field.height;
    if (where === "below" || where === "above")
        return {
            left: clamp(trigger.left, field.left, fieldRight - width),
            top:
                where === "below"
                    ? editor.top + editor.height + MENU_GAP_PX
                    : editor.top - MENU_GAP_PX - height,
            width,
            height,
        };
    return {
        left:
            where === "right"
                ? editor.left + editor.width + MENU_GAP_PX
                : editor.left - MENU_GAP_PX - width,
        top: clamp(
            trigger.top + trigger.height / 2 - height / 2,
            field.top,
            fieldBottom - height,
        ),
        width,
        height,
    };
}

/** Whether `r` is wholly inside `bounds` */
const inside = (r: Rect, bounds: Rect) =>
    r.left >= bounds.left - 0.5 &&
    r.top >= bounds.top - 0.5 &&
    r.left + r.width <= bounds.left + bounds.width + 0.5 &&
    r.top + r.height <= bounds.top + bounds.height + 0.5;

/** The shape's lines' points, with the long stretches between them filled in every `SAMPLE_PX` */
export function shapeSamples(lines: readonly (readonly XY[])[]): XY[] {
    return lines.flatMap(lineSamples);
}

function lineSamples(points: readonly XY[]): XY[] {
    const out: XY[] = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        out.push(p);
        const q = points[i + 1];
        if (!q) continue;
        const steps = Math.floor(Math.hypot(q.x - p.x, q.y - p.y) / SAMPLE_PX);
        for (let k = 1; k < steps; k++)
            out.push({
                x: p.x + ((q.x - p.x) * k) / steps,
                y: p.y + ((q.y - p.y) * k) / steps,
            });
    }
    return out;
}

/** How many of `samples` the box covers, with room kept round each (a point just that far off is clear) */
export function covered(r: Rect, samples: readonly XY[]): number {
    let n = 0;
    for (const p of samples)
        if (
            p.x > r.left - POINT_CLEAR_PX &&
            p.x < r.left + r.width + POINT_CLEAR_PX &&
            p.y > r.top - POINT_CLEAR_PX &&
            p.y < r.top + r.height + POINT_CLEAR_PX
        )
            n++;
    return n;
}

/** A spot for the menu: next to the editor's edge, or `away` px further out to clear the shape */
export interface MenuSpot {
    readonly where: MenuWhere;
    readonly away: number;
}

/** The menu's box for `spot` */
export function spotRect(input: MenuPlacementInput, spot: MenuSpot): Rect {
    const r = menuRect(input, spot.where);
    switch (spot.where) {
        case "below":
            return { ...r, top: r.top + spot.away };
        case "above":
            return { ...r, top: r.top - spot.away };
        case "right":
            return { ...r, left: r.left + spot.away };
        case "left":
            return { ...r, left: r.left - spot.away };
    }
}

/**
 * `where`, moved out past the shape's points it covers (a shape wider than the editor runs on
 * past it): a few tries, as moving out can meet more of the shape
 */
function slidOut(
    input: MenuPlacementInput,
    where: MenuWhere,
    samples: readonly XY[],
): MenuSpot {
    let spot: MenuSpot = { where, away: 0 };
    for (let i = 0; i < 4; i++) {
        const r = spotRect(input, spot);
        const hit = samples.filter((p) => covered(r, [p]) > 0);
        if (hit.length === 0) break;
        const xs = hit.map((p) => p.x);
        const ys = hit.map((p) => p.y);
        const out =
            where === "below"
                ? Math.max(...ys) + POINT_CLEAR_PX - r.top
                : where === "above"
                  ? r.top + r.height - (Math.min(...ys) - POINT_CLEAR_PX)
                  : where === "right"
                    ? Math.max(...xs) + POINT_CLEAR_PX - r.left
                    : r.left + r.width - (Math.min(...xs) - POINT_CLEAR_PX);
        spot = { where, away: spot.away + Math.max(1, Math.ceil(out)) };
    }
    return spot;
}

/**
 * Where the menu opens: the current spot while it's inside the field and covers none of the
 * shape; else the nearest clear spot inside the field, against the editor (in `MENU_WHERE` order)
 * or slid out past the shape; else the spot inside the field covering the least of it
 */
export function menuPlacement(input: MenuPlacementInput): MenuSpot {
    const samples = shapeSamples(input.shape);
    const score = (spot: MenuSpot) => {
        const r = spotRect(input, spot);
        return { fits: inside(r, input.field), covers: covered(r, samples) };
    };
    if (input.current) {
        const now = score({ where: input.current, away: 0 });
        if (now.fits && now.covers === 0)
            return { where: input.current, away: 0 };
    }
    const spots = [
        ...MENU_WHERE.map((where) => ({ where, away: 0 })),
        ...MENU_WHERE.map((where) => slidOut(input, where, samples)).filter(
            (s) => s.away > 0,
        ),
    ];
    let best: MenuSpot = spots[0]!;
    let bestScore = { fits: false, covers: Infinity, away: Infinity };
    for (const spot of spots) {
        const s = { ...score(spot), away: spot.away };
        const better =
            s.fits !== bestScore.fits
                ? s.fits
                : s.covers !== bestScore.covers
                  ? s.covers < bestScore.covers
                  : s.away < bestScore.away;
        if (better) {
            best = spot;
            bestScore = s;
        }
    }
    return best;
}

/**
 * The popover's side and offsets from its button for `where`: Radix places it against the button,
 * so the editor's own edge is reached by the offset
 */
export function menuSideProps(
    { where, away }: MenuSpot,
    trigger: Rect,
    editor: Rect,
): {
    side: "bottom" | "top" | "right" | "left";
    align: "start" | "center";
    sideOffset: number;
} {
    const props = againstEditor(where, trigger, editor);
    return { ...props, sideOffset: props.sideOffset + away };
}

function againstEditor(where: MenuWhere, trigger: Rect, editor: Rect) {
    switch (where) {
        case "below":
            return {
                side: "bottom" as const,
                align: "start" as const,
                sideOffset:
                    editor.top +
                    editor.height -
                    (trigger.top + trigger.height) +
                    MENU_GAP_PX,
            };
        case "above":
            return {
                side: "top" as const,
                align: "start" as const,
                sideOffset: trigger.top - editor.top + MENU_GAP_PX,
            };
        case "right":
            return {
                side: "right" as const,
                align: "center" as const,
                sideOffset:
                    editor.left +
                    editor.width -
                    (trigger.left + trigger.width) +
                    MENU_GAP_PX,
            };
        case "left":
            return {
                side: "left" as const,
                align: "center" as const,
                sideOffset: trigger.left - editor.left + MENU_GAP_PX,
            };
    }
}
