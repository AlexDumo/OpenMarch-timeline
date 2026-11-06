import { and, desc, eq, gt, lte } from "drizzle-orm";
import type { Resolver, RoutePoint } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection } from "@/db-functions/types";
import { readRoutes } from "@/db-functions/timelineRoutes";
import { meanOf, readGroupPaths } from "@/db-functions/timelineGroupRoutes";
import { laneOn } from "@/db-functions/timelineLanes";
import type { XY } from "@/shapes/types";

/**
 * Who a path is drawn for and between which spots (pathways step 1, spec v0.9 R-14): one marcher's
 * move at the playhead, from where it starts (`from`) to its end spot (`to`), and the route it
 * walks there now, if any.
 */
export interface PathTarget {
    timelineId: number;
    transitionId: number;
    marcherId: number;
    /** The move's counts, in beats */
    start: number;
    end: number;
    /** Where the marcher stands at the move's start (R-14's A) */
    from: XY;
    /** Its end spot (R-14's B) */
    to: XY;
    /** The route it walks now, or null for a straight (or arc) move */
    routeId: number | null;
    /** The route's points, in walking order, smooth ones with their tension (none without a route) */
    points: readonly RoutePoint[];
    /** The ends the route was drawn against (its `from` and `to`, R-14's F and G), or null */
    ends: { from: XY; to: XY } | null;
    /**
     * A group path (pathways step 15), or null for one marcher's own path. For a group the
     * target's `from` and `to` are the reference line's ends (F and G), `routeId` the group path
     * (null while a new one is drawn) and `points` its reference points; `marcherId` and
     * `transitionId` are its first member's.
     */
    group: GroupTarget | null;
}

/** A member of a group path: where it starts and ends, and its lane's offset from the reference */
export interface GroupMember {
    marcherId: number;
    transitionId: number;
    drill: string;
    /** Its lane's offset: its lane is the reference line moved by it */
    offset: XY;
    /** Its real start at the move's start (R-14's A) */
    from: XY;
    /** Its end spot (R-14's B) */
    to: XY;
}

/** Who walks a group path, and the selected marchers in the move who don't (step 15) */
export interface GroupTarget {
    members: readonly GroupMember[];
    /** Selected marchers in the move off the group path; `ownPath` when they walk one */
    outside: readonly {
        marcherId: number;
        drill: string;
        from: XY;
        ownPath: boolean;
    }[];
}

const xy = (p: readonly [number, number]): XY => ({ x: p[0], y: p[1] });

/** One marcher's move at `beat`, as `findPathTarget` picks it, or null */
async function moveAt(db: DbConnection, marcherId: number, beat: number) {
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const row = await db
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(
            and(
                eq(A.marcher_id, marcherId),
                lte(A.start_beat, beat),
                gt(A.end_beat, beat - 1e-9),
            ),
        )
        .orderBy(desc(A.layer), desc(A.start_beat))
        .all();
    return (
        row.find((r) => r.row.start_beat < beat && beat <= r.row.end_beat) ??
        row.find((r) => r.row.start_beat <= beat && beat < r.row.end_beat) ??
        null
    );
}

/** Why a group path can't be drawn or shown for a selection, or the move they share */
export type GroupMove =
    | { kind: "move"; timelineId: number; start: number; end: number }
    | { kind: "noMove"; marcherId: number }
    | { kind: "twoMoves" };

/** The one move at `beat` that every one of `marcherIds` is in, or why there's none. */
export async function groupMoveAt(
    db: DbConnection,
    marcherIds: readonly number[],
    beat: number,
): Promise<GroupMove> {
    let move: GroupMove | null = null;
    for (const id of marcherIds) {
        const at = await moveAt(db, id, beat);
        if (!at) return { kind: "noMove", marcherId: id };
        const t = at.transition;
        if (move === null)
            move = {
                kind: "move",
                timelineId: t.timeline_id,
                start: t.start_beat,
                end: t.end_beat,
            };
        else if (move.kind === "move" && move.timelineId !== t.timeline_id)
            return { kind: "twoMoves" };
    }
    return move ?? { kind: "twoMoves" };
}

/**
 * The group path to show for the selected `marcherIds` (two or more, or one on a group path) at
 * `beat` (spec Appendix I.8, "What shows"): when they are all in one move, at least one walks a
 * group path there, and every one on a group path walks the same one. Null otherwise.
 */
export async function findGroupTarget(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    marcherIds: readonly number[],
    drills: ReadonlyMap<number, string>,
    beat: number,
): Promise<PathTarget | null> {
    const move = await groupMoveAt(db, marcherIds, beat);
    if (move.kind !== "move") return null;
    const groups = await readGroupPaths(db, move.timelineId);
    const selected = new Set(marcherIds);
    const on = groups.filter((g) => g.marcherIds.some((m) => selected.has(m)));
    if (on.length !== 1) return null;
    const group = on[0]!;
    const route = (await readRoutes(db, move.timelineId)).filter(
        (r) => r.routeId === group.routeId,
    );
    if (route.length === 0) return null;
    const members: GroupMember[] = [];
    const seen = new Set<number>();
    for (const r of [...route].sort((a, b) => a.marcherId - b.marcherId)) {
        if (seen.has(r.marcherId)) continue;
        seen.add(r.marcherId);
        const o = r.offset ?? [0, 0];
        members.push({
            marcherId: r.marcherId,
            transitionId: r.transitionId,
            drill: drills.get(r.marcherId) ?? `${r.marcherId}`,
            offset: { x: o[0], y: o[1] },
            from: xy(resolver.explain(r.marcherId, r.start).origin),
            to: xy(resolver.positionAt(r.marcherId, r.end)),
        });
    }
    const outside: GroupTarget["outside"][number][] = [];
    for (const id of [...marcherIds].sort((a, b) => a - b)) {
        if (group.marcherIds.includes(id)) continue;
        const at = await moveAt(db, id, beat);
        const lane = at
            ? await laneOn(db, at.transition.id, at.row.slot_index)
            : undefined;
        outside.push({
            marcherId: id,
            drill: drills.get(id) ?? `${id}`,
            from: xy(resolver.explain(id, move.start).origin),
            ownPath: lane !== undefined && lane.offset_x === null,
        });
    }
    const g = route[0]!.geometry;
    return {
        timelineId: move.timelineId,
        transitionId: members[0]!.transitionId,
        marcherId: members[0]!.marcherId,
        start: move.start,
        end: move.end,
        from: xy(g.from),
        to: xy(g.to),
        routeId: group.routeId,
        points: g.points,
        ends: { from: xy(g.from), to: xy(g.to) },
        group: { members, outside },
    };
}

/**
 * What the pen draws a new group path for (AP-R8): `marcherIds` (two or more) in their one move
 * at `beat`, from the middle of their starts to the middle of their end spots, each member's
 * offset its start less that middle (the means as AP-R8 writes them, in ascending marcher id).
 * When they are exactly a group path's walkers, it is that path drawn again. Or why not.
 */
export async function findGroupDrawTarget(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    marcherIds: readonly number[],
    drills: ReadonlyMap<number, string>,
    beat: number,
): Promise<PathTarget | GroupMove> {
    const move = await groupMoveAt(db, marcherIds, beat);
    if (move.kind !== "move") return move;
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    const starts = ids.map(
        (m) => resolver.explain(m, move.start).origin as [number, number],
    );
    const ends = ids.map(
        (m) => resolver.positionAt(m, move.end) as [number, number],
    );
    const F = meanOf(starts);
    const G = meanOf(ends);
    const members: GroupMember[] = [];
    for (const [i, m] of ids.entries()) {
        const at = (await moveAt(db, m, beat))!;
        members.push({
            marcherId: m,
            transitionId: at.transition.id,
            drill: drills.get(m) ?? `${m}`,
            offset: { x: starts[i]![0] - F[0], y: starts[i]![1] - F[1] },
            from: xy(starts[i]!),
            to: xy(ends[i]!),
        });
    }
    const groups = await readGroupPaths(db, move.timelineId);
    const same = groups.find(
        (g) =>
            g.marcherIds.length === ids.length &&
            g.marcherIds.every((m, i) => m === ids[i]),
    );
    const existing = same
        ? (await readRoutes(db, move.timelineId)).find(
              (r) => r.routeId === same.routeId,
          )
        : undefined;
    return {
        timelineId: move.timelineId,
        transitionId: members[0]!.transitionId,
        marcherId: members[0]!.marcherId,
        start: move.start,
        end: move.end,
        from: xy(F),
        to: xy(G),
        routeId: existing?.routeId ?? null,
        points: existing?.geometry.points ?? [],
        ends: existing
            ? {
                  from: xy(existing.geometry.from),
                  to: xy(existing.geometry.to),
              }
            : null,
        group: { members, outside: [] },
    };
}

/**
 * The move of `marcherId` at `beat` that a path is drawn on: the row that holds the beat, the one
 * arriving there when the beat is on its end (a page flag shows where the page arrives), the top
 * layer when rows overlap. Null when the marcher has no move there.
 */
export async function findPathTarget(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    marcherId: number,
    beat: number,
): Promise<PathTarget | null> {
    const A = schema.timeline_assignments;
    const T = schema.timeline_transitions;
    const row = await db
        .select({ row: A, transition: T })
        .from(A)
        .innerJoin(T, eq(A.transition_id, T.id))
        .where(
            and(
                eq(A.marcher_id, marcherId),
                lte(A.start_beat, beat),
                gt(A.end_beat, beat - 1e-9),
            ),
        )
        .orderBy(desc(A.layer), desc(A.start_beat))
        .all();
    // On a row's end the arriving one wins; inside one, the one holding the beat
    const pick =
        row.find((r) => r.row.start_beat < beat && beat <= r.row.end_beat) ??
        row.find((r) => r.row.start_beat <= beat && beat < r.row.end_beat);
    if (!pick) return null;
    const { transition } = pick;
    // A member of a group path has no path of its own (step 15): drawing gives it one (AP-R1)
    const lane = await laneOn(db, transition.id, pick.row.slot_index);
    const ownRouteId =
        lane !== undefined && lane.offset_x === null ? lane.route_id : null;
    const route =
        ownRouteId === null
            ? undefined
            : (await readRoutes(db, transition.timeline_id)).find(
                  (r) => r.routeId === ownRouteId,
              );
    return {
        timelineId: transition.timeline_id,
        transitionId: transition.id,
        marcherId,
        start: transition.start_beat,
        end: transition.end_beat,
        from: xy(resolver.explain(marcherId, transition.start_beat).origin),
        to: xy(resolver.positionAt(marcherId, transition.end_beat)),
        routeId: ownRouteId,
        points: route?.geometry.points ?? [],
        ends: route
            ? { from: xy(route.geometry.from), to: xy(route.geometry.to) }
            : null,
        group: null,
    };
}
