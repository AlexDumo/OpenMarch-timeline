import { create } from "zustand";
import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { drillNumbers } from "../field/fieldModeBase";
import type { XY } from "../types";
import { updateTool, useShapeToolStore } from "./shapeToolStore";
import { toolEnvFor } from "./toolEnv";
import {
    pinPairs,
    slotsOf,
    startsOf,
    swapMarchers,
    undo,
    type ToolState,
} from "./toolMachine";

/**
 * Picking who goes where by hand, and Swap, on the open shape (09-who-goes-where.md). Outside
 * React, like the shape tool's store; the open shape's field mode hands presses here while a
 * session is on.
 *
 * Picking: click or drag through marchers (their start ghosts) and spots in any back-and-forth
 * order; the 1st marcher picked takes the 1st spot picked, and each pair is laid on the shape as
 * soon as it's made (`pinPairs`, one undo step a press). One shape is in front, the one picked from
 * (`front`): the writer switches it (the bar's toggle or Tab), or a press on the other shape where
 * nothing in front is under it picks from that one and brings it forward. A drag picks from one
 * shape: the one it touches first.
 *
 * Swap: click two marchers, at their start ghosts or their spots, to trade spots.
 */

export type PickSide = "marchers" | "spots";

export interface PickSession {
    readonly kind: "pick" | "swap";
    /** The shape picked from, drawn in front */
    readonly front: PickSide;
    /** Marchers (by index into the tool's marchers) picked and waiting for a spot, in order */
    readonly marchers: readonly number[];
    /** Spots (slots) picked and waiting for a marcher, in order */
    readonly spots: readonly number[];
    /** Which was picked when, for Backspace: the waiting picks, last last */
    readonly log: readonly PickSide[];
    /** Swap: the first marcher clicked, waiting for the second */
    readonly first: number | null;
    /** Marchers placed by hand in this session, whose walks are drawn heavier */
    readonly placed: readonly number[];
    /** What a press at the pointer would pick */
    readonly hover: { side: PickSide; index: number } | null;
    /** A drag under way: the shape it picks from (once it touched one) and its trail */
    readonly drag: {
        readonly side: PickSide | null;
        readonly last: XY;
        readonly trail: readonly XY[];
    } | null;
}

export const usePickStore = create<{ session: PickSession | null }>(() => ({
    session: null,
}));

const set = (session: PickSession | null) => usePickStore.setState({ session });

const fresh = (kind: PickSession["kind"]): PickSession => ({
    kind,
    front: "marchers",
    marchers: [],
    spots: [],
    log: [],
    first: null,
    placed: [],
    hover: null,
    drag: null,
});

// The session is about the open shape: it ends when the shape closes, or is drawn again from
// nothing
useShapeToolStore.subscribe((state) => {
    if (!state.tool || state.tool.params === null) stopPicking();
});

/** Whether picking (or Swap) is on */
export const isPicking = (): boolean =>
    usePickStore.getState().session !== null;

/**
 * Picking by hand (`kind` pick) or Swap turned on, or off when it's already the one on. Only on a
 * drawn shape with nothing under way.
 */
export function togglePicking(kind: PickSession["kind"]): void {
    const now = usePickStore.getState().session;
    if (now?.kind === kind) {
        stopPicking();
        return;
    }
    const tool = useShapeToolStore.getState().tool;
    if (!tool || tool.params === null || tool.gesture) return;
    set(fresh(kind));
}

/** Done: picks still waiting for a partner are dropped; the pairs made stay */
export function stopPicking(): void {
    if (usePickStore.getState().session) set(null);
}

/** The bar's toggle and Tab: the other shape in front */
export function switchPickSide(side?: PickSide): void {
    const s = usePickStore.getState().session;
    if (!s || s.kind !== "pick") return;
    const front = side ?? (s.front === "marchers" ? "spots" : "marchers");
    if (front !== s.front) set({ ...s, front, hover: null });
}

/**
 * Backspace: the last pick waiting for a partner taken back, or, with none waiting, the last pair
 * (the shape's undo)
 */
export function undoPick(): void {
    const s = usePickStore.getState().session;
    if (!s) return;
    if (s.kind === "swap" && s.first !== null) {
        set({ ...s, first: null });
        return;
    }
    const side = s.log.at(-1);
    if (side) {
        set({
            ...s,
            log: s.log.slice(0, -1),
            ...(side === "marchers"
                ? { marchers: s.marchers.slice(0, -1) }
                : { spots: s.spots.slice(0, -1) }),
        });
        return;
    }
    updateTool(undo);
}

/** Where the marchers start (their ghosts) and the shape's spots, on the field */
function pointsOf(tool: ToolState): { marchers: XY[]; spots: XY[] } | null {
    const field = currentShapeField();
    if (!field || tool.params === null) return null;
    return {
        marchers: startsOf(tool),
        spots: slotsOf(tool, shapeContextFor(field)),
    };
}

/** How far from a ghost or spot a press still picks it, in field units */
function reach(): number {
    const field = currentShapeField();
    return field ? toolEnvFor(field).hitRadius : 0;
}

interface Candidate {
    side: PickSide;
    index: number;
    at: XY;
}

/** What can be picked now on `side`: not already waiting */
function candidates(
    s: PickSession,
    points: { marchers: XY[]; spots: XY[] },
    side: PickSide,
): Candidate[] {
    const waiting = new Set(side === "marchers" ? s.marchers : s.spots);
    return points[side].flatMap((at, index) =>
        waiting.has(index) ? [] : [{ side, index, at }],
    );
}

/** Distance from `p` to the segment a–b, and how far along it (0 to 1) the nearest point is */
function segment(p: XY, a: XY, b: XY): { d: number; t: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t =
        len > 0
            ? Math.max(
                  0,
                  Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len),
              )
            : 0;
    return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

/**
 * What a press at `at` picks: the nearest in reach on the shape in front, else the nearest in reach
 * on the other shape. Swap picks marchers only, at their ghosts or their spots.
 */
function pickAt(
    s: PickSession,
    tool: ToolState,
    at: XY,
): { side: PickSide; index: number } | null {
    const points = pointsOf(tool);
    if (!points) return null;
    const r = reach();
    if (s.kind === "swap") {
        const ghosts = points.marchers.map((p, index) => ({
            index,
            d: Math.hypot(p.x - at.x, p.y - at.y),
        }));
        const onSpots = (tool.assignment ?? []).map((slot, index) => {
            const p = points.spots[slot]!;
            return { index, d: Math.hypot(p.x - at.x, p.y - at.y) };
        });
        const best = [...ghosts, ...onSpots]
            .filter((h) => h.d <= r)
            .sort((a, b) => a.d - b.d)[0];
        return best ? { side: "marchers", index: best.index } : null;
    }
    const near = (side: PickSide) =>
        candidates(s, points, side)
            .map((c) => ({ c, d: Math.hypot(c.at.x - at.x, c.at.y - at.y) }))
            .filter((h) => h.d <= r)
            .sort((a, b) => a.d - b.d)[0]?.c;
    const other = s.front === "marchers" ? "spots" : "marchers";
    const hit = near(s.front) ?? near(other);
    return hit ? { side: hit.side, index: hit.index } : null;
}

/** Picks taken in order: each waits for a partner, and pairs are laid on the shape as made */
function take(
    s: PickSession,
    picks: readonly { side: PickSide; index: number }[],
): PickSession {
    if (picks.length === 0) return s;
    let marchers = [...s.marchers];
    let spots = [...s.spots];
    let log = [...s.log];
    for (const p of picks) {
        if (p.side === "marchers") {
            if (marchers.includes(p.index)) continue;
            marchers.push(p.index);
        } else {
            if (spots.includes(p.index)) continue;
            spots.push(p.index);
        }
        log.push(p.side);
    }
    const pairs: [number, number][] = [];
    while (marchers.length > 0 && spots.length > 0)
        pairs.push([marchers.shift()!, spots.shift()!]);
    if (pairs.length > 0) {
        // The pairs made leave the log: Backspace then takes back the pair through undo
        log = rebuildLog(marchers.length, spots.length);
        const field = currentShapeField();
        if (field)
            updateTool((t) => pinPairs(t, pairs, shapeContextFor(field)));
    }
    return {
        ...s,
        marchers,
        spots,
        log,
        front: picks.at(-1)!.side,
        placed: [...s.placed, ...pairs.map(([m]) => m)],
    };
}

/** The log of what's still waiting: once pairs are made, only one side waits */
const rebuildLog = (marchers: number, spots: number): PickSide[] => [
    ...Array.from({ length: marchers }, () => "marchers" as const),
    ...Array.from({ length: spots }, () => "spots" as const),
];

/** A press on the field while a session is on */
export function pressPick(at: XY): void {
    const s = usePickStore.getState().session;
    const tool = useShapeToolStore.getState().tool;
    if (!s || !tool) return;
    const hit = pickAt(s, tool, at);
    if (s.kind === "swap") {
        if (!hit) return;
        if (s.first === null) {
            set({ ...s, first: hit.index, hover: null });
            return;
        }
        if (s.first === hit.index) return;
        const field = currentShapeField();
        if (field)
            updateTool((t) =>
                swapMarchers(t, s.first!, hit.index, shapeContextFor(field)),
            );
        set({
            ...s,
            first: null,
            placed: [...s.placed, s.first, hit.index],
            hover: null,
        });
        return;
    }
    const started: PickSession = {
        ...s,
        hover: null,
        drag: { side: hit?.side ?? null, last: at, trail: [at] },
    };
    set(hit ? take(started, [hit]) : started);
}

/** The pointer moved with the button down: a drag picks everything it passes on its shape */
export function movePick(at: XY): void {
    const s = usePickStore.getState().session;
    const tool = useShapeToolStore.getState().tool;
    if (!s?.drag || s.kind !== "pick" || !tool) return;
    const points = pointsOf(tool);
    if (!points) return;
    const { last } = s.drag;
    if (Math.hypot(at.x - last.x, at.y - last.y) < 1e-6) return;
    const r = reach();
    const sides: PickSide[] = s.drag.side
        ? [s.drag.side]
        : [s.front, s.front === "marchers" ? "spots" : "marchers"];
    let hits = sides.flatMap((side) =>
        candidates(s, points, side)
            .map((c) => ({ c, ...segment(c.at, last, at) }))
            .filter((h) => h.d <= r),
    );
    let side = s.drag.side;
    if (!side && hits.length > 0) {
        // The first shape touched, the one in front when both are
        const first = [...hits].sort((a, b) => a.t - b.t)[0]!;
        side =
            hits.find((h) => h.c.side === s.front && h.t === first.t)?.c.side ??
            first.c.side;
    }
    hits = hits.filter((h) => h.c.side === side).sort((a, b) => a.t - b.t);
    const dragged: PickSession = {
        ...s,
        drag: { side, last: at, trail: [...s.drag.trail, at] },
    };
    set(
        take(
            dragged,
            hits.map((h) => ({ side: h.c.side, index: h.c.index })),
        ),
    );
}

/** The press ended */
export function releasePick(): void {
    const s = usePickStore.getState().session;
    if (s?.drag) set({ ...s, drag: null });
}

/** The pointer moved with no button down: what a press would pick */
export function hoverPick(at: XY | null): void {
    const s = usePickStore.getState().session;
    const tool = useShapeToolStore.getState().tool;
    if (!s || !tool) return;
    const hover = at ? pickAt(s, tool, at) : null;
    if (hover?.side !== s.hover?.side || hover?.index !== s.hover?.index)
        set({ ...s, hover });
}

/** What the session adds to the open shape's drawing */
export function pickDrawing(
    tool: ToolState,
): FieldModeDrawing["pick"] | undefined {
    const s = usePickStore.getState().session;
    const field = currentShapeField();
    if (!s || !field) return undefined;
    const points = pointsOf(tool);
    if (!points) return undefined;
    const names = drillNumbers(field);
    const nameOf = (index: number) =>
        names.get(tool.marchers[index]?.id ?? -1) ?? "";
    const marks = [
        ...s.marchers.map((m, i) => ({
            at: points.marchers[m]!,
            text: String(i + 1),
        })),
        ...s.spots.map((slot, i) => ({
            at: points.spots[slot]!,
            text: String(i + 1),
        })),
        ...(s.first !== null
            ? [{ at: points.marchers[s.first]!, text: "⇄" }]
            : []),
    ];
    const hover = s.hover
        ? {
              at:
                  s.hover.side === "marchers"
                      ? points.marchers[s.hover.index]!
                      : points.spots[s.hover.index]!,
              text:
                  s.kind === "swap" || s.hover.side === "marchers"
                      ? nameOf(s.hover.index)
                      : "",
          }
        : null;
    const assignment = tool.assignment ?? [];
    return {
        front: s.kind === "swap" ? "spots" : s.front,
        marks,
        hover,
        picked: [...new Set(s.placed)].flatMap((m) => {
            const slot = assignment[m];
            return slot === undefined
                ? []
                : [{ from: points.marchers[m]!, to: points.spots[slot]! }];
        }),
        trail: s.drag && s.drag.trail.length > 1 ? s.drag.trail : null,
    };
}
