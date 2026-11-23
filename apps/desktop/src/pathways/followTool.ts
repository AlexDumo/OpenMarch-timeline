/**
 * Opening the Follow tool (pathways step 4b, DL-4): the window between the start flag and the
 * end flag, the selected line's shape at the start flag (DL-6), refusals said before anything is
 * drawn, and the session whose ends pulse until one is pressed.
 */
import { loopSnap, nearestOnLoop, type Resolver } from "@openmarch/core";
import { db } from "@/global/database/db";
import {
    followOrderAt,
    followSource,
    tailFirstOf,
    trailDragRefusalFor,
    trailDragRefusal,
    type TrailWindow,
} from "@/db-functions/timelineTrailDrag";
import {
    endSpotsInMove,
    readTrails,
    type MoveTrail,
} from "@/db-functions/timelineTrails";
import {
    aroundTrailOver,
    followShapeRefusal,
    goRoundRefusalFor,
    outlineMiss,
    outlineOf,
} from "@/db-functions/timelineTrailAround";
import { placedBoxesAt } from "@/shapes/placed/placedBoxStore";
import { rippleFormAt } from "@/db-functions/timelineTrailRipple";
import {
    rippleFormProblem,
    rippleRefusal,
} from "@/db-functions/timelineTrailRipplePlan";
import type { DbConnection } from "@/db-functions/types";
import { isBasicMode } from "@/stores/EditorModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { basicPageBox } from "@/timeline/timelineCoordinateWrites";
import { translateTimelineText } from "@/timeline/translateTimelineText";
import type { TimelineText } from "@/timeline/timelineText";
import { currentShapeField } from "@/shapes/field/shapeField";
import type { XY } from "@/shapes/types";
import { groupMoveAt, type PathTarget } from "./pathTarget";
import { usePathPenStore } from "./pathPenStore";
import type { FollowDrag, FollowKeep } from "./followDrag";
import {
    aroundPlanOf,
    aroundTarget,
    loopAround,
    type FollowAround,
} from "./followAround";
import type { RippleForm } from "@/db-functions/timelineTrailRipplePlan";

/**
 * The window a trail is dragged in now (DL-2): the edit window `[start flag, playhead)`, in Basic
 * the page box at the playhead (past the last page, the window after the last flag). Null at home.
 */
export function followWindowNow(): TrailWindow | null {
    const state = useTimelineSelectionStore.getState();
    const { selection } = state;
    if (selection.kind !== "range") return null;
    if (isBasicMode()) {
        const box = basicPageBox(state, selection.end);
        if (box) return box;
    }
    return { start: selection.start, end: selection.end };
}

/**
 * Whether `ids` are exactly the line of a trail in their one move at `beat`: every member of it
 * and nobody else. Follow (Shift+L) then draws that trail again (step 4, AP-T1 and AP-T2's
 * "Again") instead of opening the Follow tool's drag.
 */
export async function isTrailLineAt(
    database: DbConnection,
    ids: readonly number[],
    beat: number,
): Promise<boolean> {
    const move = await groupMoveAt(database, ids, beat);
    if (move.kind !== "move") return false;
    const chosen = new Set(ids);
    // A line going round an outline (step 10) opens the Follow tool's Go round again instead
    return (await readTrails(database, move.timelineId)).some(
        (t) =>
            !t.around &&
            t.marcherIds.length === chosen.size &&
            t.marcherIds.every((m) => chosen.has(m)),
    );
}

/**
 * Keep end spots (AP-T9) by step 4's target rule: the one move every one of `ids` is in at `beat`
 * (the playhead), with each member's end spot there (its slot's stored destination). Null when there's none.
 */
export async function followKeepAt(
    database: DbConnection,
    resolver: Pick<Resolver, "positionAt">,
    ids: readonly number[],
    beat: number,
): Promise<FollowKeep | null> {
    const move = await groupMoveAt(database, ids, beat);
    if (move.kind !== "move") return null;
    // The line where that move starts, which is where the trail into its spots starts (step 9
    // review): its starts, and its order there (remembered, or else guessed), tail first
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const at = sorted.map((m): [number, number] => {
        const [x, y] = resolver.positionAt(m, move.start);
        return [x, y];
    });
    const along = await followOrderAt(
        database,
        sorted,
        move.start,
        at,
        move.end,
    );
    // Each end spot from its slot's stored destination, as Ripple in's write reads it (step 9)
    const stored = await database.transaction((tx) =>
        endSpotsInMove(tx, move.timelineId, sorted),
    );
    return {
        timelineId: move.timelineId,
        start: move.start,
        end: move.end,
        spots: new Map(
            ids.map((m): [number, XY] => {
                const p = stored?.get(m) ?? resolver.positionAt(m, move.end);
                return [m, { x: p[0], y: p[1] }];
            }),
        ),
        ...(along
            ? {
                  line: {
                      starts: new Map(
                          sorted.map((m, i) => [
                              m,
                              { x: at[i]![0], y: at[i]![1] },
                          ]),
                      ),
                      order: tailFirstOf(along).map((i) => sorted[i]!),
                  },
              }
            : {}),
    };
}

/**
 * Ripple in's next form (RP-2): `keep`'s end spots of `ids` in the form's own order, or null with
 * the reason (translated) when there's none, it closes or folds, or it lies on the line itself
 */
async function followFormOf(
    ids: readonly number[],
    keep: FollowKeep | null,
): Promise<{ form: RippleForm | null; formWhy: string | null }> {
    if (!keep) return { form: null, formWhy: null };
    const form = await rippleFormAt(
        db,
        ids,
        keep.end,
        new Map(
            [...keep.spots].map(([m, p]): [number, [number, number]] => [
                m,
                [p.x, p.y],
            ]),
        ),
    );
    if (!form)
        return {
            form: null,
            formWhy: translateTimelineText(rippleRefusal.notAForm()),
        };
    const line = keep.line;
    const problem = rippleFormProblem(
        form.spots,
        line
            ? line.order.map((m) => [
                  line.starts.get(m)!.x,
                  line.starts.get(m)!.y,
              ])
            : [],
    );
    return problem
        ? { form: null, formWhy: translateTimelineText(problem) }
        : { form, formWhy: null };
}

/**
 * Opens the Follow tool on the selected marchers `ids`: their ends pulse, ready to drag a trail
 * out of one. `beat` is the playhead, whose move Keep end spots follows into. Resolves to why not
 * (translated), or null when it opened.
 *
 * The march order says who follows whom (owner, 2026-11-22): the order set by hand when there is
 * one (`followOrderAt`, read up to the window's end, where Set order is made), always over a
 * guess. When it runs round the closed outline they stand on, the trail closes the loop
 * (`loopAround`); otherwise each follows the trail through the ones ahead of them in it. Round a
 * closed outline with no order set, it says to set one: the way round is the designer's.
 */
export async function openFollowTool(
    resolver: Pick<Resolver, "positionAt">,
    ids: readonly number[],
    drills: ReadonlyMap<number, string>,
    beat: number,
): Promise<string | null> {
    const window = followWindowNow();
    if (!window) return translateTimelineText(trailDragRefusal.noWindow());
    const field = currentShapeField();
    if (!field) return null;
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const starts = sorted.map((m): [number, number] => {
        const [x, y] = resolver.positionAt(m, window.start);
        return [x, y];
    });
    // The order set by hand (up to the window's end), or else the one their positions suggest
    const along = await followOrderAt(
        db,
        sorted,
        window.start,
        starts,
        window.end,
    );
    const tailFirst = along ? tailFirstOf(along).map((i) => sorted[i]!) : null;
    const set = along?.leaderFirst ? tailFirst : null;
    const at = new Map<number, XY>(
        sorted.map((m, i) => [m, { x: starts[i]![0], y: starts[i]![1] }]),
    );
    const step = field.fieldProperties.pixelsPerStep;
    const base = { ids: sorted, starts: at, step, window };
    const how = await howItFollows(resolver, base, starts, tailFirst, set);
    if ("refusal" in how) return translateTimelineText(how.refusal);
    const { around } = how;
    const keep = await followKeepAt(db, resolver, sorted, beat);
    // Ripple in (step 9, RP-2): the form those end spots make, in its own order, and why not
    const { form, formWhy } = await followFormOf(sorted, keep);
    // Tail first, so the leader offered before an end is grabbed is the real one (the last)
    const order = tailFirst!;
    const follow: FollowDrag = {
        window,
        ids: sorted,
        order,
        starts: at,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep,
        form,
        formWhy,
        step,
        around,
    };
    const dragging = lineTarget(order, at, window, drills);
    const target = around ? aroundTarget(dragging, follow, drills) : dragging;
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill: `${sorted.length}`,
            points: [],
            pointer: null,
            selected: null,
            dragging: null,
            object: false,
            byRoute: false,
            follow,
        },
    });
    return null;
}

/**
 * How the Follow tool opens on the line `base` standing at `starts`, whose order is `tailFirst`
 * (`set` when it was set by hand): round the closed outline they stand on, the trail closing the
 * loop, when the set order runs round it (`around`); else dragging a trail out (`around` null).
 * All the way round a closed outline with no order set, it says to set one (the way round isn't
 * guessed). Refusals are said before drawing starts, so no drawing is lost.
 */
async function howItFollows(
    resolver: Pick<Resolver, "positionAt">,
    base: Pick<FollowDrag, "ids" | "starts" | "step" | "window">,
    starts: readonly [number, number][],
    tailFirst: readonly number[] | null,
    set: readonly number[] | null,
): Promise<{ around: FollowAround | null } | { refusal: TimelineText }> {
    const { ids, step, window } = base;
    const outline = outlineOf(starts, step);
    const closed = outline?.full ? outline : null;
    if (closed && !set) return { refusal: followShapeRefusal.setOrder() };
    const loop = closed && set ? loopAround(base, closed, set) : null;
    if (loop) {
        const refusal = await db.transaction((tx) =>
            goRoundRefusalFor(tx, window, ids, step),
        );
        if (refusal) return { refusal };
        const again = await aroundTrailOver(db, window, ids);
        return {
            around: again ? againAround(loop, again, resolver, base) : loop,
        };
    }
    // AP-T8's refusals; with no line, why, when it can be told (owner, 2026-11-22)
    const why = tailFirst
        ? null
        : await whyNoShape(resolver, ids, window, starts, step);
    const refusal = why ?? (await dragRefusalOf(window, ids, tailFirst));
    return refusal ? { refusal } : { around: null };
}

/**
 * Why the selection stands in no line, curve, arc or outline at the window's start flag, when it
 * can be told (owner, 2026-11-22), in this order: they stand in one only at the move's end (the
 * playhead is a page early); they are only part of a placed shape; a circle or box with a gap too
 * wide or spacing too uneven; some stand too far off the shape the rest make. Null otherwise.
 */
async function whyNoShape(
    resolver: Pick<Resolver, "positionAt">,
    ids: readonly number[],
    window: TrailWindow,
    starts: readonly [number, number][],
    step: number,
): Promise<TimelineText | null> {
    const ends = ids.map((m): [number, number] => {
        const [x, y] = resolver.positionAt(m, window.end);
        return [x, y];
    });
    const moved = ends.some(
        (p, i) => Math.hypot(p[0] - starts[i]![0], p[1] - starts[i]![1]) > 1e-6,
    );
    if (moved && (followSource(ends) || outlineOf(ends, step)))
        return followShapeRefusal.later();
    const chosen = new Set(ids);
    for (const shape of placedBoxesAt(window.start)) {
        const members = shape.recipe.members.map((m) => m.marcherId);
        const inIt = members.filter((m) => chosen.has(m)).length;
        if (inIt === chosen.size && members.length > inIt)
            return followShapeRefusal.part(inIt, members.length);
    }
    const miss = outlineMiss(starts, step);
    return miss ? followShapeRefusal[miss]() : null;
}

/** Why a trail can't be dragged out of the line `tailFirst` (none: not a line), or null */
async function dragRefusalOf(
    window: TrailWindow,
    ids: readonly number[],
    tailFirst: readonly number[] | null,
): Promise<TimelineText | null> {
    if (!tailFirst) return trailDragRefusal.notFitted();
    return await db.transaction((tx) =>
        trailDragRefusalFor(tx, window, ids, tailFirst.at(-1)!, "trail"),
    );
}

/** The Follow tool's target as it opens: the line, each where it stands, its last leading */
function lineTarget(
    order: readonly number[],
    at: ReadonlyMap<number, XY>,
    window: TrailWindow,
    drills: ReadonlyMap<number, string>,
): PathTarget {
    const members = order.map((m) => ({
        marcherId: m,
        drill: drills.get(m) ?? `${m}`,
        from: at.get(m)!,
        to: at.get(m)!,
    }));
    const leader = members.at(-1)!;
    return {
        timelineId: -1,
        transitionId: -1,
        marcherId: leader.marcherId,
        start: window.start,
        end: window.end,
        from: leader.from,
        to: leader.from,
        routeId: null,
        points: [],
        ends: null,
        group: null,
        trail: { members, leaderId: leader.marcherId, reverse: false },
    };
}

/**
 * The loop's choices for following round again (step 10): the line's own move round the outline
 * over the window, read back. How far it goes (in the outline's spots when that's whole, else
 * steps). Its way round and leader must be the march order's (`loop`): when the order has changed
 * since, the order wins, and the move is replaced from nobody moved.
 */
function againAround(
    around: FollowAround,
    again: MoveTrail,
    resolver: Pick<Resolver, "positionAt">,
    base: Pick<FollowDrag, "ids" | "starts" | "step" | "window">,
): FollowAround {
    const g = again.geometry;
    const corners = [g.from, ...g.points.map((p) => p.at)];
    let area = 0;
    corners.forEach((p, i) => {
        const q = corners[(i + 1) % corners.length]!;
        area += p[0] * q[1] - q[0] * p[1];
    });
    // A circle's quarter points turn the way its arcs do; a box's corners the way it runs
    const reversed = area < 0;
    const leader = again.reverse
        ? again.marcherIds[0]!
        : again.marcherIds.at(-1)!;
    if (reversed !== around.reversed || leader !== around.leader)
        return { ...around, again: true };
    const probe = {
        ...base,
        grabbed: null,
        around: { ...around, reversed, leader, amount: 1, unit: "spots" },
    } as unknown as FollowDrag;
    const plan = aroundPlanOf(probe)!;
    const q = plan.line.indexOf(base.ids.indexOf(leader));
    const id = base.ids[plan.line[q]!]!;
    const [tx, ty] = resolver.positionAt(id, base.window.end);
    // How far the leader goes: the outline's places from its own to its spot's, plus the stored
    // times round; a spot on no place is steps
    const L = plan.loop.L;
    const S = plan.ring.length;
    const u = nearestOnLoop(plan.loop, [tx, ty]);
    const near = (x: number) => Math.min(Math.abs(x - u), L - Math.abs(x - u));
    const k = plan.ring.findIndex((x) => near(x) < 1e-6 * Math.max(1, L));
    const whole = k >= 0;
    const spots = whole
        ? ((k - plan.memberSpot[q]! + S) % S) + again.laps * S
        : 0;
    let gone = u - plan.startDist[q]!;
    if (gone < 0) gone += L;
    if (gone > L - loopSnap(L)) gone = 0;
    gone += again.laps * L;
    const unit = whole ? "spots" : "steps";
    const amount = Math.max(1, Math.round(whole ? spots : gone / base.step));
    return {
        ...around,
        reversed,
        leader,
        unit,
        amount,
        again: true,
        // Finish with nothing changed writes nothing (owner, 2026-11-22)
        stored: { amount, unit, reversed },
    };
}
