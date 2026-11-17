import {
    adjustAt,
    arcPoint,
    cubicPoint,
    groupMemberWalk,
    groupSchedule,
    laneSamples,
    limitRouteEdit,
    resolveAdjust,
    routePoint,
    ROUTE_CUBIC_SAMPLES,
    type AdjustProfile,
    type GroupLeg,
    type GroupMemberWalk,
    type LaneSample,
    type GroupSchedule,
    type RouteGeometry,
    ROUTE_ARC_SAMPLES,
    S_MIN,
    laneRigidPart,
} from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import type { ToolHandleMenu, ToolMenuSection } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import { PEN_MENU, vertexOf, type PathShape } from "@/shapes/pen/penPath";

/**
 * A group path's lanes and Adjust (pathways step 15, spec R-14 "Group schedule") on top of the
 * pen's path (`shapes/pen/penPath.ts`, a drawn line's points, handles and menus), and the path's
 * right-click menu with Adjust's entries added.
 */

const tuple = (p: XY): [number, number] => [p.x, p.y];
const xy = (p: readonly [number, number]): XY => ({ x: p[0], y: p[1] });

/** The menu of an Adjust key, or of an adjusted lane elsewhere on its line */
function adjustMenu(onKey: boolean): ToolMenuSection[] {
    return [
        {
            items: [
                ...(onKey
                    ? [
                          {
                              value: "removeKey",
                              label: tolgee.t(
                                  "actions.path.adjustRemoveKey",
                                  "Remove bend point",
                              ),
                          },
                      ]
                    : []),
                {
                    value: "resetSpot",
                    label: tolgee.t(
                        "actions.path.adjustResetSpot",
                        "Match group",
                    ),
                    icon: "trash" as const,
                    destructive: true,
                },
            ],
        },
    ];
}

/**
 * A path's right-click menus: the pen's point and leg menus (`PEN_MENU`, a Line's, #569), and a
 * group path's Adjust keys and lanes. The pen's: a point's Corner |
 * Smooth, its Roundness (which selects it, showing its tangent bar) and Delete point; a leg's Add
 * point here and Straight | Curved. A path has no marchers on its points and no ends to close.
 * Deleting the last point removes the path (one undo step: the app's pick does it), so no path
 * with no point is left behind.
 */
export const PATH_MENU: ToolHandleMenu<PathShape> = {
    sections(shape, n, key) {
        const adjustKey = adjustKeyOf(key);
        if (adjustKey) return adjustMenu(true);
        if (laneOfKey(key) !== null) return adjustMenu(false);
        return PEN_MENU.sections(shape, n, key);
    },
    pick(shape, n, key, value, env) {
        // Adjust's entries are the app's to run (`PathPenMode.openMenu`)
        if (adjustKeyOf(key) || laneOfKey(key) !== null) return null;
        return PEN_MENU.pick(shape, n, key, value, env);
    },
};

// ---------------------------------------------------------------------------
// Group paths (pathways step 15, spec R-14 "Group schedule")
// ---------------------------------------------------------------------------

/** The route a group path's shape describes: its reference line from F to G, as R-14 reads it */
export function scheduleOf(shape: PathShape): GroupSchedule {
    const from = tuple(shape.ends?.from ?? shape.from);
    const to = tuple(shape.ends?.to ?? shape.to);
    return groupSchedule({
        from,
        to,
        points: shape.points.map(vertexOf),
        ...(shape.toBulge ? { toBulge: shape.toBulge } : {}),
    });
}

/** One member's walk on the group path `shape`: its own legs onto and off its lane, with its Adjust */
export const memberWalkOf = (
    schedule: GroupSchedule,
    member: {
        from: XY;
        to: XY;
        offset: XY;
        adjust?: AdjustProfile | null;
    },
    points: readonly { id?: string }[] = [],
): GroupMemberWalk =>
    groupMemberWalk(
        schedule,
        tuple(member.from),
        tuple(member.to),
        tuple(member.offset),
        member.adjust ? resolveAdjust(schedule, points, member.adjust) : null,
    );

/** An Adjust key's handle key: `a<marcher>:<index in the stored profile>` */
export const adjustKey = (marcherId: number, index: number) =>
    `a${marcherId}:${index}`;
const ADJUST_KEY = /^a(\d+):(\d+)$/;
export function adjustKeyOf(
    key: string | null,
): { marcherId: number; index: number } | null {
    const m = key ? ADJUST_KEY.exec(key) : null;
    return m ? { marcherId: Number(m[1]), index: Number(m[2]) } : null;
}
/** A lane's menu key: `l<marcher>` */
export const laneKey = (marcherId: number) => `l${marcherId}`;
export function laneOfKey(key: string | null): number | null {
    const m = key ? /^l(\d+)$/.exec(key) : null;
    return m ? Number(m[1]) : null;
}

/** A lane's Adjust keys as handles, in place order: its stored index, place and where it's drawn */
export function adjustHandlesOf(
    walk: GroupMemberWalk,
): { index: number; x: number; at: XY }[] {
    const { adjust, schedule, offset } = walk;
    if (!adjust) return [];
    return adjust.xs.map((x, i) => {
        const q = routePoint(schedule.W, x / schedule.W.L);
        const d = adjust.ds[i]!;
        return {
            index: adjust.sources[i]!,
            x,
            at: { x: q[0] + offset[0] + d[0], y: q[1] + offset[1] + d[1] },
        };
    });
}

/**
 * What a line being edited offers to grab besides its bend points (interaction round 3), so even a
 * line with no bends has something to drag, as Edit path's points and midpoints are: each of the
 * group path's points on the line, and the middle of each stretch between those and the bend
 * points. All lie on the part that bends, between the group path's first and last points: the legs
 * onto and off it take none. None within a step of a bend point, where a press takes that point.
 */
export function laneBendSpotsOf(walk: GroupMemberWalk): XY[] {
    const part = laneRigidPart(walk.schedule);
    if (!part || part.to - part.from < 2 * S_MIN) return [];
    const { W } = walk.schedule;
    const corners = W.D.slice(1, W.V.length - 1);
    const keys = walk.adjust?.xs ?? [];
    const anchors = [...new Set([...corners, ...keys])].sort((a, b) => a - b);
    const middles = anchors.slice(1).flatMap((x, i) => {
        const before = anchors[i]!;
        return x - before >= 2 * S_MIN ? [(before + x) / 2] : [];
    });
    return [...corners, ...middles]
        .filter((x) => keys.every((k) => Math.abs(k - x) >= S_MIN))
        .sort((a, b) => a - b)
        .map((x) => {
            const plain = lanePlain(walk, x);
            const d = laneDelta(walk, x);
            return { x: plain.x + d.x, y: plain.y + d.y };
        });
}

/** The lane's reference place at `x`, before its Adjust: `walk(x) + o` */
export function lanePlain(walk: GroupMemberWalk, x: number): XY {
    const q = routePoint(walk.schedule.W, x / walk.schedule.W.L);
    return { x: q[0] + walk.offset[0], y: q[1] + walk.offset[1] };
}

/** The lane's displacement at `x` now */
export function laneDelta(walk: GroupMemberWalk, x: number): XY {
    if (!walk.adjust) return { x: 0, y: 0 };
    const d = adjustAt(walk.adjust, x);
    return { x: d[0], y: d[1] };
}

/** Where a press landed on a lane: its rigid part at place `x`, or a leg (`x` null). */
export interface LaneHit {
    x: number | null;
    at: XY;
    distance: number;
}

/**
 * The point of `walk`'s lane nearest `at` within `radius`, or null (decision C): on its rigid part
 * the place there, measured along the reference walk, and on a leg no place. The rigid part wins
 * within reach: at the corner where a leg leaves it, the leg was a hair nearer and a drag on the
 * handle drawn there was refused (sim round 3).
 */
export function laneHitOf(
    walk: GroupMemberWalk,
    at: XY,
    radius: number,
): LaneHit | null {
    let best: LaneHit | null = null;
    const consider = (a: XY, b: XY, x0: number | null, x1: number | null) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t =
            l2 === 0
                ? 0
                : Math.max(
                      0,
                      Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / l2),
                  );
        const point = { x: a.x + dx * t, y: a.y + dy * t };
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance > radius || (best && distance >= best.distance)) return;
        best = {
            x: x0 === null || x1 === null ? null : x0 + (x1 - x0) * t,
            at: point,
            distance,
        };
    };
    const samples = samplesOf(walk);
    for (let i = 1; i < samples.length; i++)
        consider(
            xy(samples[i - 1]!.at),
            xy(samples[i]!.at),
            samples[i - 1]!.x,
            samples[i]!.x,
        );
    if (best) return best;
    for (const leg of [walk.first, walk.last]) {
        if (!leg) continue;
        const line = legLine(leg);
        for (let i = 1; i < line.length; i++)
            consider(line[i - 1]!, line[i]!, null, null);
    }
    return best;
}

const laneSampleCache = new WeakMap<GroupMemberWalk, LaneSample[]>();

/** A lane's samples, once per walk: a hover tests every lane on each pointer move */
function samplesOf(walk: GroupMemberWalk): LaneSample[] {
    let samples = laneSampleCache.get(walk);
    if (!samples) {
        samples = laneSamples(walk);
        laneSampleCache.set(walk, samples);
    }
    return samples;
}

/** The route `shape` would store, for the rules that read point ids */
const geometryOf = (shape: PathShape): RouteGeometry => ({
    v: 1,
    from: tuple(shape.ends?.from ?? shape.from),
    to: tuple(shape.ends?.to ?? shape.to),
    ...(shape.toBulge ? { toBulge: shape.toBulge } : {}),
    points: shape.points.map((p) => ({ id: p.id ?? "", ...vertexOf(p) })),
});

/**
 * AP-R11's point drag on the field: `points` dragged from `base` go only as far as keeps every
 * profile's keys at least a step apart, the same rule the save applies.
 */
export function limitDrag(
    base: PathShape,
    next: PathShape,
    profiles: readonly AdjustProfile[],
): PathShape {
    if (profiles.length === 0) return next;
    const { geometry, stopped } = limitRouteEdit(
        geometryOf(base),
        geometryOf(next),
        profiles,
    );
    if (!stopped) return next;
    const { toBulge: _was, ...rest } = next;
    return {
        ...rest,
        ...(geometry.toBulge === undefined
            ? {}
            : { toBulge: geometry.toBulge }),
        points: next.points.map((p, i) => {
            const q = geometry.points[i]!;
            const { tension: _t, bulge: _b, ...kept } = p;
            return {
                ...kept,
                at: xy(q.at),
                ...(q.tension === undefined ? {} : { tension: q.tension }),
                ...(q.bulge === undefined ? {} : { bulge: q.bulge }),
            };
        }),
    };
}

const legLine = (leg: GroupLeg): XY[] => {
    const [S, E] = [leg.path.V[0]!, leg.path.V[1]!];
    const piece = leg.path.pieces[0]!;
    if (piece.kind === "arc")
        return Array.from({ length: ROUTE_ARC_SAMPLES + 1 }, (_, i) =>
            xy(arcPoint(S, E, piece.k, i / ROUTE_ARC_SAMPLES)),
        );
    if (piece.kind === "line" || leg.length < 1e-9) return [xy(S), xy(E)];
    return Array.from({ length: ROUTE_CUBIC_SAMPLES + 1 }, (_, i) =>
        xy(
            i === ROUTE_CUBIC_SAMPLES
                ? E
                : cubicPoint(S, piece.c1, piece.c2, E, i / ROUTE_CUBIC_SAMPLES),
        ),
    );
};

/**
 * The line a member walks on a group path, to draw as its lane: its first leg, its copy of the
 * reference walk between its first and last points, and its last leg (R-14 group schedule)
 */
export function laneOutline(walk: GroupMemberWalk): XY[] {
    const { first, last } = walk;
    if (!first || !last) return [xy(walk.A), xy(walk.B)];
    const middle = laneSamples(walk)
        .slice(1)
        .map((s) => xy(s.at));
    return [...legLine(first), ...middle, ...legLine(last).slice(1)];
}

/**
 * Each leg of each member as Big steps judges it (spec Appendix I.8): the first leg's distance
 * per move as `ℓ_first · L^W / D^W_1`, the middle as `L^W` (once), the last leg's as
 * `ℓ_last · L^W / (L^W − D^W_m)`, Infinity when that difference rounds to 0. A leg under
 * `EPS_GEOM` is never big, so it's left out. Each is the distance a steady walker would cover
 * over the whole move at that leg's speed, to test against the move's counts.
 */
/** A leg of a group path: onto it, along it, off it, or straight to the spot when it has no point */
export type LegWhere = "onto" | "along" | "off" | "straight" | "adjusted";

/** One stretch of a walked leg (`x0`, `x1` set only for an adjusted stretch, J.6) */
export interface LegDistance {
    where: LegWhere;
    marcherId: number | null;
    distance: number;
    x0?: number;
    x1?: number;
}

export function groupLegDistances(
    schedule: GroupSchedule,
    walks: readonly { marcherId: number; walk: GroupMemberWalk }[],
): LegDistance[] {
    const W = schedule.W;
    const m = W.V.length - 2;
    const out: LegDistance[] = [];
    // No point on the path: each member walks straight to its spot, no path to be along
    if (m < 1) {
        for (const { marcherId, walk } of walks) {
            const d = Math.hypot(walk.B[0] - walk.A[0], walk.B[1] - walk.A[1]);
            if (d >= 1e-9)
                out.push({ where: "straight", marcherId, distance: d });
        }
        return out;
    }
    const L = W.L;
    if (m > 1) out.push({ where: "along", marcherId: null, distance: L });
    for (const { marcherId, walk } of walks) {
        const first = walk.first!.length;
        const last = walk.last!.length;
        if (first >= 1e-9)
            out.push({
                where: "onto",
                marcherId,
                distance: (first * L) / W.D[1]!,
            });
        if (last >= 1e-9) {
            const rest = L - W.D[m]!;
            out.push({
                where: "off",
                marcherId,
                distance: rest > 0 ? (last * L) / rest : Infinity,
            });
        }
        out.push(...adjustedStretches(marcherId, walk));
    }
    return out;
}

/**
 * Big steps on an adjusted lane (spec J.6): the rigid part split at every kept point and key place.
 * A stretch whose displacement changes is walked at its own speed, so it is judged by its own
 * travel, expressed as the distance a steady walker would cover over the whole move at that speed.
 * The rest walk at the reference's speed, which "along" already judges.
 */
function adjustedStretches(
    marcherId: number,
    walk: GroupMemberWalk,
): LegDistance[] {
    const { adjust, schedule } = walk;
    if (!adjust || adjust.xs.length === 0) return [];
    const { W } = schedule;
    const m = W.V.length - 2;
    const breaks = [...new Set([...W.D.slice(1, m + 1), ...adjust.xs])].sort(
        (a, b) => a - b,
    );
    const samples = laneSamples(walk);
    const out: LegDistance[] = [];
    for (let i = 1; i < breaks.length; i++) {
        const x0 = breaks[i - 1]!;
        const x1 = breaks[i]!;
        const a = adjustAt(adjust, x0);
        const b = adjustAt(adjust, x1);
        if (a[0] === b[0] && a[1] === b[1]) continue;
        let travel = 0;
        for (let k = 1; k < samples.length; k++) {
            const s0 = samples[k - 1]!;
            const s1 = samples[k]!;
            if (s0.x >= x0 && s1.x <= x1)
                travel += Math.hypot(s1.at[0] - s0.at[0], s1.at[1] - s0.at[1]);
        }
        out.push({
            where: "adjusted",
            marcherId,
            distance: (travel * W.L) / (x1 - x0),
            x0,
            x1,
        });
    }
    return out;
}
