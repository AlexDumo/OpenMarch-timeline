/**
 * Opening the Follow tool (pathways step 4b, DL-4): the window between the start flag and the
 * end flag, the selected line's shape at the start flag (DL-6), refusals said before anything is
 * drawn, and the session whose ends pulse until one is pressed.
 */
import { loopSnap, nearestOnLoop, type Resolver } from "@openmarch/core";
import { db } from "@/global/database/db";
import {
    followOrderAt,
    tailFirstOf,
    trailDragRefusalFor,
    trailDragRefusal,
    type TrailWindow,
} from "@/db-functions/timelineTrailDrag";
import { readTrails, type MoveTrail } from "@/db-functions/timelineTrails";
import {
    aroundTrailOver,
    fitOutline,
    goRoundRefusalFor,
} from "@/db-functions/timelineTrailAround";
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
    aroundLine,
    aroundPlanOf,
    aroundTarget,
    initialAround,
    type FollowAround,
} from "./followAround";

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
 * (the playhead), with each member's end spot there. Null when there's none.
 */
export async function followKeepAt(
    database: DbConnection,
    resolver: Pick<Resolver, "positionAt">,
    ids: readonly number[],
    beat: number,
): Promise<FollowKeep | null> {
    const move = await groupMoveAt(database, ids, beat);
    if (move.kind !== "move") return null;
    return {
        timelineId: move.timelineId,
        start: move.start,
        end: move.end,
        spots: new Map(
            ids.map((m): [number, XY] => {
                const [x, y] = resolver.positionAt(m, move.end);
                return [m, { x, y }];
            }),
        ),
    };
}

/**
 * Opens the Follow tool on the selected marchers `ids`: their ends pulse, ready to drag a trail
 * out of one. `beat` is the playhead, whose move Keep end spots follows into. Resolves to why not
 * (translated), or null when it opened.
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
    // The order the show remembers for them, or else the one their positions suggest (step 4f)
    const along = await followOrderAt(db, sorted, window.start, starts);
    const tailFirst = along ? tailFirstOf(along).map((i) => sorted[i]!) : null;
    // Said before drawing starts, so no drawing is lost (AP-T8's refusals)
    const dragRefusal = tailFirst
        ? await db.transaction((tx) =>
              trailDragRefusalFor(
                  tx,
                  window,
                  sorted,
                  tailFirst.at(-1)!,
                  "trail",
              ),
          )
        : trailDragRefusal.notFitted();
    const at = new Map<number, XY>(
        sorted.map((m, i) => [m, { x: starts[i]![0], y: starts[i]![1] }]),
    );
    const step = field.fieldProperties.pixelsPerStep;
    // On a closed outline (step 10, DO-1): Go round, refused only for its own reasons
    const remembered = along?.leaderFirst ? tailFirst : null;
    const canDrag = dragRefusal === null;
    const base = { ids: sorted, starts: at, step, window };
    const offer = await goRoundOffer(resolver, {
        ...base,
        remembered,
        canDrag,
    });
    if (!offer.around && dragRefusal)
        return translateTimelineText(offer.refusal ?? dragRefusal);
    const { around } = offer;
    const keep = await followKeepAt(db, resolver, sorted, beat);
    const follow: FollowDrag = {
        window,
        ids: sorted,
        // Tail first, so the leader offered before an end is grabbed is the real one (the last);
        // with no line to drag out of, the line round the outline
        order: tailFirst ?? [],
        starts: at,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keep,
        step,
        around,
    };
    const order = tailFirst ?? aroundLine(follow, aroundPlanOf(follow)!);
    if (!tailFirst) Object.assign(follow, { order });
    const dragging = lineTarget(order, at, window, drills);
    const target = around?.on
        ? aroundTarget(dragging, follow, drills)
        : dragging;
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
 * Go round when the selection stands on a closed outline at the window's start flag (step 10,
 * DO-1): its first choices (`initialAround`), or those of the line's own move round it over the
 * window when there is one ("again"). Null with the reason when it's refused, or with none when
 * they stand on no outline.
 */
async function goRoundOffer(
    resolver: Pick<Resolver, "positionAt">,
    f: Pick<FollowDrag, "ids" | "starts" | "step" | "window"> & {
        remembered: readonly number[] | null;
        canDrag: boolean;
    },
): Promise<{ around: FollowAround | null; refusal: TimelineText | null }> {
    const starts = f.ids.map((id): [number, number] => {
        const p = f.starts.get(id)!;
        return [p.x, p.y];
    });
    const outline = fitOutline(starts);
    if (!outline) return { around: null, refusal: null };
    const refusal = await db.transaction((tx) =>
        goRoundRefusalFor(tx, f.window, f.ids),
    );
    if (refusal) return { around: null, refusal };
    const around = initialAround(f, outline, f.remembered, f.canDrag);
    const again = await aroundTrailOver(db, f.window, f.ids);
    return {
        around: again ? againAround(around, again, resolver, f) : around,
        refusal: null,
    };
}

/**
 * Go round's choices for going round again (step 10): the line's own move round the outline over
 * the window, read back. How far it goes (in the outline's spots when that's whole, else steps),
 * which way round (the stored outline's own turn), and who leads.
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
    const probe = {
        ...base,
        grabbed: null,
        around: { ...around, reversed, leader, amount: 1, unit: "spots" },
    } as unknown as FollowDrag;
    const plan = aroundPlanOf(probe)!;
    const q = plan.line.indexOf(base.ids.indexOf(leader));
    const id = base.ids[plan.line[q]!]!;
    const [tx, ty] = resolver.positionAt(id, base.window.end);
    // How far the leader goes: its spot's place past its start, plus the stored times round
    const L = plan.loop.L;
    const u = nearestOnLoop(plan.loop, [tx, ty]);
    let gone = u - plan.startDist[q]!;
    if (gone < 0) gone += L;
    if (gone > L - loopSnap(L)) gone = 0;
    const laps = again.laps;
    gone += laps * L;
    const spots = gone / plan.spacing;
    const whole = Math.abs(spots - Math.round(spots)) < 1e-6;
    return {
        ...around,
        reversed,
        leader,
        unit: whole ? "spots" : "steps",
        amount: Math.max(1, Math.round(whole ? spots : gone / base.step)),
        again: true,
    };
}
