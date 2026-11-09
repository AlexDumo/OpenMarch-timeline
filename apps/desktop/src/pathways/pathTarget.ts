import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import type { Resolver, RoutePoint } from "@openmarch/core";
import { schema } from "@/global/database/db";
import type { DbConnection } from "@/db-functions/types";
import { readRoutes, type MoveRoute } from "@/db-functions/timelineRoutes";
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
    /**
     * A path read by its route (`targetOfRoute`): from the earliest start to the latest end of
     * the transitions its lanes are on. A group path's members can be in several transitions of
     * one move (AP-R8), so a selected path stays selected while the playhead is anywhere in them
     * (AP-O4). Absent otherwise: then `start` and `end` are the move's.
     */
    span?: { start: number; end: number };
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

/**
 * The path `routeId` as a target, read by the path and not by who is selected (spec I.10, AP-O1):
 * a group path with every walker of its lanes as members, or an own path with the marcher on its
 * lane. A selected or open path object is read again this way after each edit, so after spots
 * change hands it still shows the same path, walked by whoever holds its spots now. Null when the
 * route is gone (deleted, or undone) or nobody walks it.
 */
export async function findRouteTarget(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    routeId: number,
    drills: ReadonlyMap<number, string>,
): Promise<PathTarget | null> {
    const entries = (await readRoutes(db)).filter((r) => r.routeId === routeId);
    return targetOfRoute(entries, resolver, drills);
}

/** A route's lanes and walkers (`readRoutes`, one route) as the target the pen shows */
export function targetOfRoute(
    entries: readonly MoveRoute[],
    resolver: Pick<Resolver, "explain" | "positionAt">,
    drills: ReadonlyMap<number, string>,
): PathTarget | null {
    const first = entries[0];
    if (!first) return null;
    const g = first.geometry;
    const span = {
        start: Math.min(...entries.map((r) => r.start)),
        end: Math.max(...entries.map((r) => r.end)),
    };
    const byMarcher = [...entries].sort(
        (a, b) => a.marcherId - b.marcherId || a.start - b.start,
    );
    if (entries.every((r) => r.offset === null)) {
        const r = byMarcher[0]!;
        return {
            timelineId: r.timelineId,
            transitionId: r.transitionId,
            marcherId: r.marcherId,
            start: r.start,
            end: r.end,
            from: xy(resolver.explain(r.marcherId, r.start).origin),
            to: xy(resolver.positionAt(r.marcherId, r.end)),
            routeId: r.routeId,
            points: g.points,
            ends: { from: xy(g.from), to: xy(g.to) },
            group: null,
            span,
        };
    }
    const members: GroupMember[] = [];
    const seen = new Set<number>();
    for (const r of byMarcher) {
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
    return {
        timelineId: first.timelineId,
        transitionId: members[0]!.transitionId,
        marcherId: members[0]!.marcherId,
        start: first.start,
        end: first.end,
        from: xy(g.from),
        to: xy(g.to),
        routeId: first.routeId,
        points: g.points,
        ends: { from: xy(g.from), to: xy(g.to) },
        group: { members, outside: [] },
        span,
    };
}

/**
 * Whether a lane's transition `[start, end]` is the walker's move at `beat`, by the rule a
 * selected marcher's path is found by (`findPathTarget`): the move holding the beat, or arriving
 * on it when the beat is its end. `arrives` says whether the walker has another row arriving on
 * `beat` (its end is `beat`), which wins over one leaving from it.
 */
export function moveIsAt(
    span: { start: number; end: number },
    beat: number,
    arrives: boolean,
): boolean {
    if (span.start < beat && beat <= span.end) return true;
    return span.start === beat && beat < span.end && !arrives;
}

/**
 * Every route's lanes and walkers, and each walker's rows, read once per timeline version so a
 * playhead step only filters them (`pathObjectsAt`). Targets are built the first time a route is
 * at the playhead and kept, so the same route gives the same target (and drawing) until the next
 * version.
 */
export interface PathObjectIndex {
    /** Each route's entries (`readRoutes`), by route id in id order */
    readonly routes: ReadonlyMap<number, readonly MoveRoute[]>;
    /** Every row of each marcher that walks a route, for "a row arriving on the beat" */
    readonly rows: ReadonlyMap<
        number,
        readonly { start: number; end: number }[]
    >;
    /** Targets built so far, for `drills` */
    targets: Map<number, PathTarget | null>;
    drills: ReadonlyMap<number, string> | null;
}

/** How many marcher ids go in one `IN (...)`, under SQLite's bound-parameter limit */
const IDS_PER_QUERY = 500;

/** Reads the routes and their walkers' rows for `pathObjectsAt` (spec I.10, AP-O2). */
export async function readPathObjectIndex(
    db: DbConnection,
): Promise<PathObjectIndex> {
    const all = await readRoutes(db);
    const routes = new Map<number, MoveRoute[]>();
    for (const r of all) {
        const list = routes.get(r.routeId) ?? [];
        list.push(r);
        routes.set(r.routeId, list);
    }
    const A = schema.timeline_assignments;
    const walkers = [...new Set(all.map((r) => r.marcherId))];
    const rows = new Map<number, { start: number; end: number }[]>();
    for (let i = 0; i < walkers.length; i += IDS_PER_QUERY) {
        const found = await db
            .select({
                marcherId: A.marcher_id,
                start: A.start_beat,
                end: A.end_beat,
            })
            .from(A)
            .where(inArray(A.marcher_id, walkers.slice(i, i + IDS_PER_QUERY)))
            .all();
        for (const r of found) {
            const list = rows.get(r.marcherId) ?? [];
            list.push({ start: r.start, end: r.end });
            rows.set(r.marcherId, list);
        }
    }
    return { routes, rows, targets: new Map(), drills: null };
}

/**
 * Every path in a move at `beat` (spec I.10, AP-O2), from `index`: the paths Paths **All** draws
 * and lets a click select with nothing selected. A route is at the beat when one of its walkers'
 * rows on its lanes is that walker's move there (`moveIsAt`). By route id. No database read: the
 * same route gives the same target while `index` and `drills` are the same.
 */
export function pathObjectsAt(
    index: PathObjectIndex,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    beat: number,
    drills: ReadonlyMap<number, string>,
): PathTarget[] {
    if (index.drills !== drills) {
        index.targets = new Map();
        index.drills = drills;
    }
    // A row arriving on the beat wins over one leaving from it
    const arrives = (marcherId: number) =>
        (index.rows.get(marcherId) ?? []).some(
            (r) => r.start <= beat - 1e-9 && r.end > beat - 1e-9,
        );
    const out: PathTarget[] = [];
    for (const [routeId, entries] of index.routes) {
        const at = entries.some((r) =>
            moveIsAt(r, beat, r.start === beat && arrives(r.marcherId)),
        );
        if (!at) continue;
        let target = index.targets.get(routeId);
        if (target === undefined) {
            target = targetOfRoute(entries, resolver, drills);
            index.targets.set(routeId, target);
        }
        if (target) out.push(target);
    }
    return out;
}

/** `pathObjectsAt` with the index read now: every path in a move at `beat` (AP-O2) */
export async function findPathObjects(
    db: DbConnection,
    resolver: Pick<Resolver, "explain" | "positionAt">,
    beat: number,
    drills: ReadonlyMap<number, string>,
): Promise<PathTarget[]> {
    return pathObjectsAt(await readPathObjectIndex(db), resolver, beat, drills);
}
