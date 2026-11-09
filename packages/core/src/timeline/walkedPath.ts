/**
 * Drawable walked paths (spec R-15, pathways step 18): the path a marcher actually walks over a
 * beat range, as exact drawable segments (lines, circular arcs and cubic Bézier curves) for exports and
 * other apps. It reads a resolver and the snapshot the resolver was built from; it never changes
 * a position, and `walkedPathPointAt` agrees with `positionAt` within
 * {@link WALKED_SAMPLE_TOLERANCE}.
 */
import {
    EPS_GEOM,
    ROUTE_CUBIC_SAMPLES,
    adjustAt,
    cubicPoint,
    cumOf,
    destinationsOf,
    dist,
    groupMemberWalk,
    groupSchedule,
    lerp,
    placed,
    resolveAdjust,
    routePath,
    routePiecePoint,
    type GroupLeg,
    type GroupMemberWalk,
    type RoutePath,
    type RouteWalk,
} from "./geom";
import type {
    Beat,
    LaneRow,
    Resolver,
    ShapeRow,
    SpanInfo,
    TimelineSnapshot,
    TransitionRow,
    XY,
} from "./types";

/**
 * R-15 item 7: how far `walkedPathPointAt` may be from `positionAt` at the same beat, and how far
 * a `polyline` segment may be from the walk it stands for, in field units (the resolver's
 * coordinates). 0.05 is under half a percent of an 8-to-5 step on the default field (11.25).
 */
export const WALKED_SAMPLE_TOLERANCE = 0.05;

/** R-15 item 3: an arc style whose bulge is smaller than this draws as a line. */
export const WALKED_MIN_BULGE = 1e-7;

interface WalkedSegmentBase {
    /** The beat the marcher is at `from` */
    start: Beat;
    /** The beat the marcher is at `to`; later than `start` */
    end: Beat;
    from: XY;
    to: XY;
    /** The move (transition) being walked */
    transitionId: number;
}

/** A straight line, walked at constant speed. */
export interface WalkedLine extends WalkedSegmentBase {
    kind: "line";
}

/**
 * A circular arc, walked at constant speed: the point at fraction `f` of its beats is
 * `center + radius * (cos(a), sin(a))` with `a = startAngle + sweep * f`. `sweep` is signed and at
 * most half a turn in size; longer arcs come as several segments.
 */
export interface WalkedArc extends WalkedSegmentBase {
    kind: "arc";
    center: XY;
    radius: number;
    /** Radians */
    startAngle: number;
    /** Radians, signed, `|sweep| <= PI` */
    sweep: number;
}

/** A cubic Bézier from `from` to `to` with controls `c1` and `c2`, walked at constant speed along its length. */
export interface WalkedCubic extends WalkedSegmentBase {
    kind: "cubic";
    c1: XY;
    c2: XY;
}

/**
 * A walk with no exact line, arc or cubic form (R-15 item 5: a curved piece of a group path
 * under a changing Adjust), as points within {@link WALKED_SAMPLE_TOLERANCE} of it. `beats[i]` is
 * when the marcher is at `points[i]`; it moves in a straight line between them.
 */
export interface WalkedPolyline extends WalkedSegmentBase {
    kind: "polyline";
    points: XY[];
    beats: Beat[];
}

export type WalkedSegment =
    | WalkedLine
    | WalkedArc
    | WalkedCubic
    | WalkedPolyline;

/** One marcher's walked path over `[from, to]`: its segments in beat order (R-15). */
export interface WalkedPath {
    marcherId: number;
    from: Beat;
    to: Beat;
    /** Empty when the marcher stands still for the whole range */
    segments: WalkedSegment[];
}

/** A segment's shape before it gets its beats */
type Shape =
    | { kind: "line"; from: XY; to: XY }
    | {
          kind: "arc";
          from: XY;
          to: XY;
          center: XY;
          radius: number;
          startAngle: number;
          sweep: number;
      }
    | { kind: "cubic"; from: XY; to: XY; c1: XY; c2: XY }
    /** `us` are the points' fractions of the piece's progress range */
    | { kind: "polyline"; from: XY; to: XY; points: XY[]; us: number[] };

/**
 * A stretch of a span's walk over progress `[pa, pb]`, walked at a constant rate; `cut(u0, u1)`
 * is the part between fractions `u0` and `u1` of it.
 */
interface Piece {
    pa: number;
    pb: number;
    cut(u0: number, u1: number): Shape;
}

const linePiece = (pa: number, pb: number, A: XY, B: XY): Piece => ({
    pa,
    pb,
    cut: (u0, u1) => ({
        kind: "line",
        from: u0 <= 0 ? A : lerp(A, B, u0),
        to: u1 >= 1 ? B : lerp(A, B, u1),
    }),
});

const onCircle = (center: XY, radius: number, a: number): XY => [
    center[0] + radius * Math.cos(a),
    center[1] + radius * Math.sin(a),
];

/** Arc pieces of at most half a turn each; `A` and `B` are the exact ends when known. */
function arcPieces(
    pa: number,
    pb: number,
    center: XY,
    radius: number,
    startAngle: number,
    sweep: number,
    A?: XY,
    B?: XY,
): Piece[] {
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI - 1e-12));
    const out: Piece[] = [];
    for (let i = 0; i < n; i++) {
        const a0 = startAngle + (sweep * i) / n;
        const part = sweep / n;
        const first = i === 0;
        const last = i === n - 1;
        out.push({
            pa: pa + ((pb - pa) * i) / n,
            pb: last ? pb : pa + ((pb - pa) * (i + 1)) / n,
            cut: (u0, u1) => ({
                kind: "arc",
                from:
                    first && A && u0 <= 0
                        ? A
                        : onCircle(center, radius, a0 + part * u0),
                to:
                    last && B && u1 >= 1
                        ? B
                        : onCircle(center, radius, a0 + part * u1),
                center,
                radius,
                startAngle: a0 + part * u0,
                sweep: part * (u1 - u0),
            }),
        });
    }
    return out;
}

/** The cubic parameter at distance `x` along a measured cubic, as `routePiecePoint` finds it (R-14). */
function cubicParamAt(e: readonly number[], x: number): number {
    const K = e.length - 1;
    if (x <= 0) return 0;
    let lo = 1;
    let hi = K + 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (x < e[mid]!) hi = mid;
        else lo = mid + 1;
    }
    if (lo > K) return 1;
    return (lo - 1 + (x - e[lo - 1]!) / (e[lo]! - e[lo - 1]!)) / K;
}

/** The part of a cubic between parameters `t0` and `t1`. */
function subCubic(
    p0: XY,
    c1: XY,
    c2: XY,
    p3: XY,
    t0: number,
    t1: number,
): { from: XY; c1: XY; c2: XY; to: XY } {
    if (t0 <= 0 && t1 >= 1) return { from: p0, c1, c2, to: p3 };
    // left part [0, t1]
    let a: [XY, XY, XY, XY] = [p0, c1, c2, p3];
    if (t1 < 1) {
        const q0 = lerp(p0, c1, t1);
        const q1 = lerp(c1, c2, t1);
        const q2 = lerp(c2, p3, t1);
        const r0 = lerp(q0, q1, t1);
        const r1 = lerp(q1, q2, t1);
        a = [p0, q0, r0, lerp(r0, r1, t1)];
    }
    if (t0 <= 0) return { from: a[0], c1: a[1], c2: a[2], to: a[3] };
    // right part of it, from t0 / t1
    const s = t1 > 0 ? t0 / t1 : 0;
    const q0 = lerp(a[0], a[1], s);
    const q1 = lerp(a[1], a[2], s);
    const q2 = lerp(a[2], a[3], s);
    const r0 = lerp(q0, q1, s);
    const r1 = lerp(q1, q2, s);
    return { from: lerp(r0, r1, s), c1: r1, c2: q2, to: a[3] };
}

/**
 * A measured cubic (R-14), from distance `xa` to `xb` along it, moved by `shift`. The whole
 * cubic keeps its own controls.
 */
function cubicPiece(
    pa: number,
    pb: number,
    P0: XY,
    c1: XY,
    c2: XY,
    P3: XY,
    e: readonly number[],
    xa = 0,
    xb = e[e.length - 1]!,
    shift: (q: XY) => XY = (q) => q,
): Piece {
    const total = e[e.length - 1]!;
    return {
        pa,
        pb,
        cut: (u0, u1) => {
            const x0 = xa + (xb - xa) * u0;
            const x1 = xa + (xb - xa) * u1;
            const part = subCubic(
                P0,
                c1,
                c2,
                P3,
                x0 <= 0 ? 0 : cubicParamAt(e, x0),
                x1 >= total ? 1 : cubicParamAt(e, x1),
            );
            return {
                kind: "cubic",
                from: shift(part.from),
                c1: shift(part.c1),
                c2: shift(part.c2),
                to: shift(part.to),
            };
        },
    };
}

/** A walk known only point by point: sampled until it is within the tolerance (R-15 item 5). */
function sampledPiece(pa: number, pb: number, at: (u: number) => XY): Piece {
    return {
        pa,
        pb,
        cut: (u0, u1) => {
            const points: XY[] = [];
            const us: number[] = [];
            const limit = WALKED_SAMPLE_TOLERANCE / 4;
            const refine = (
                ua: number,
                A: XY,
                ub: number,
                B: XY,
                depth: number,
            ) => {
                const um = (ua + ub) / 2;
                const M = at(um);
                if (depth < 12 && dist(M, lerp(A, B, 0.5)) > limit) {
                    refine(ua, A, um, M, depth + 1);
                    refine(um, M, ub, B, depth + 1);
                    return;
                }
                points.push(B);
                us.push((ub - u0) / (u1 - u0));
            };
            const first = at(u0);
            points.push(first);
            us.push(0);
            // a few even parts first, so a symmetric bend can't pass the midpoint test
            const PARTS = 8;
            let prev = first;
            for (let i = 1; i <= PARTS; i++) {
                const ua = u0 + ((u1 - u0) * (i - 1)) / PARTS;
                const ub = i === PARTS ? u1 : u0 + ((u1 - u0) * i) / PARTS;
                const B = at(ub);
                refine(ua, prev, ub, B, 0);
                prev = B;
            }
            us[us.length - 1] = 1;
            return {
                kind: "polyline",
                from: first,
                to: prev,
                points,
                us,
            };
        },
    };
}

/** R-8's arc from `A` to `B` with bulge `k`, as pieces over progress [0, 1] (R-15 item 3). */
function bulgePieces(A: XY, B: XY, k: number): Piece[] {
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const c = Math.hypot(dx, dy);
    if (c < EPS_GEOM || Math.abs(k) < WALKED_MIN_BULGE)
        return [linePiece(0, 1, A, B)];
    const h = c / 2;
    const s = k * c; // signed sagitta, toward the +90 degree side
    const radius = (h * h + s * s) / (2 * Math.abs(s));
    const nx = -dy / c;
    const ny = dx / c;
    const off = s - Math.sign(s) * radius;
    const center: XY = [
        (A[0] + B[0]) / 2 + nx * off,
        (A[1] + B[1]) / 2 + ny * off,
    ];
    const startAngle = Math.atan2(A[1] - center[1], A[0] - center[0]);
    // the turn from A toward the apex gives the direction; the size is R-8's 2 * phi
    const ax = A[0] - center[0];
    const ay = A[1] - center[1];
    const px = (A[0] + B[0]) / 2 + nx * s - center[0];
    const py = (A[1] + B[1]) / 2 + ny * s - center[1];
    const dir = ax * py - ay * px >= 0 ? 1 : -1;
    const sweep = dir * 4 * Math.atan(2 * Math.abs(k));
    return arcPieces(0, 1, center, radius, startAngle, sweep, A, B);
}

/** A group member's leg (R-14 group schedule item 5) over progress `[pa, pb]`. */
function legPiece(pa: number, pb: number, leg: GroupLeg): Piece {
    const { path } = leg;
    const piece = path.pieces[0]!;
    const S = path.V[0]!;
    const E = path.V[1]!;
    if (leg.length < EPS_GEOM || piece.kind === "line")
        return linePiece(pa, pb, S, E);
    return cubicPiece(pa, pb, S, piece.c1, piece.c2, E, piece.e);
}

/** A group lane's walk (R-14 group schedule, R-14′ Adjust) as pieces (R-15 items 4 and 5). */
function groupPieces(walk: GroupMemberWalk): Piece[] {
    const { schedule, A, B, offset, first, last, adjust } = walk;
    if (!first || !last) return [linePiece(0, 1, A, B)];
    const { W, uFirst, uLast } = schedule;
    const m = W.V.length - 2;
    const out: Piece[] = [legPiece(0, uFirst, first)];
    const keys = adjust && adjust.xs.length > 0 ? adjust : null;
    for (let j = 1; j < m; j++) {
        const xLo = W.D[j]!;
        const xHi = W.D[j + 1]!;
        const piece = W.pieces[j]!;
        // the piece's parts between Adjust keys: the displacement is linear on each
        const breaks = [xLo];
        if (keys)
            for (const x of keys.xs) if (x > xLo && x < xHi) breaks.push(x);
        breaks.push(xHi);
        for (let i = 0; i + 1 < breaks.length; i++) {
            const xa = breaks[i]!;
            const xb = breaks[i + 1]!;
            const da: XY = keys ? adjustAt(keys, xa) : [0, 0];
            const db: XY = keys ? adjustAt(keys, xb) : [0, 0];
            const place = (q: XY, d: XY): XY => {
                const p = placed(q, offset);
                return keys ? placed(p, d) : p;
            };
            const pa = xa / W.L;
            const pb = xb / W.L;
            const pointAt = (x: number): XY =>
                x <= xLo
                    ? W.V[j]!
                    : x >= xHi
                      ? W.V[j + 1]!
                      : routePiecePoint(W, j, x - xLo);
            if (piece.kind === "line") {
                // a line plus a linear displacement is a line
                out.push(
                    linePiece(
                        pa,
                        pb,
                        place(pointAt(xa), da),
                        place(pointAt(xb), db),
                    ),
                );
            } else if (da[0] === db[0] && da[1] === db[1]) {
                out.push(
                    cubicPiece(
                        pa,
                        pb,
                        W.V[j]!,
                        piece.c1,
                        piece.c2,
                        W.V[j + 1]!,
                        piece.e,
                        xa - xLo,
                        xb - xLo,
                        (q) => place(q, da),
                    ),
                );
            } else {
                out.push(
                    sampledPiece(pa, pb, (u) => {
                        const x = xa + (xb - xa) * u;
                        return place(pointAt(x), adjustAt(keys!, x));
                    }),
                );
            }
        }
    }
    out.push(legPiece(uLast, 1, last));
    return out;
}

/** A marcher's own path (R-14) as pieces. */
function routePieces(path: RoutePath): Piece[] {
    const { V, D, L } = path;
    if (V.length === 2 || L < EPS_GEOM)
        return [linePiece(0, 1, V[0]!, V[V.length - 1]!)];
    return path.pieces.map((piece, j) =>
        piece.kind === "line"
            ? linePiece(D[j]! / L, D[j + 1]! / L, V[j]!, V[j + 1]!)
            : cubicPiece(
                  D[j]! / L,
                  D[j + 1]! / L,
                  V[j]!,
                  piece.c1,
                  piece.c2,
                  V[j + 1]!,
                  piece.e,
              ),
    );
}

/** The corners of a polyline destination path (R-13), or null for a circle. */
function destCorners(shape: ShapeRow): XY[] | null {
    if (shape.kind === "line" || shape.kind === "freehand")
        return shape.geometry.points;
    if (shape.kind === "box") {
        const g = shape.geometry;
        const [x, y] = g.origin;
        return [
            [x, y],
            [x + g.width, y],
            [x + g.width, y + g.height],
            [x, y + g.height],
            [x, y],
        ];
    }
    return null;
}

/** The stretch `[d0, d1]` of a polyline with cumulative lengths `cum`, mapped onto `[pa, pb]`. */
function polylinePieces(
    pts: readonly XY[],
    cum: readonly number[],
    d0: number,
    d1: number,
    progressOf: (d: number) => number,
): Piece[] {
    const out: Piece[] = [];
    for (let i = 1; i < pts.length; i++) {
        const lo = Math.max(d0, cum[i - 1]!);
        const hi = Math.min(d1, cum[i]!);
        const len = cum[i]! - cum[i - 1]!;
        if (hi <= lo || len <= 0) continue;
        const at = (d: number): XY =>
            d <= cum[i - 1]!
                ? pts[i - 1]!
                : d >= cum[i]!
                  ? pts[i]!
                  : lerp(pts[i - 1]!, pts[i]!, (d - cum[i - 1]!) / len);
        out.push(linePiece(progressOf(lo), progressOf(hi), at(lo), at(hi)));
    }
    return out;
}

const lanesBySlot = new WeakMap<object, Map<string, LaneRow>>();
function laneOf(
    host: TimelineSnapshot,
    transition: number,
    slot: number,
): LaneRow | undefined {
    if (!host.lanes) return undefined;
    let index = lanesBySlot.get(host.lanes);
    if (!index) {
        index = new Map(
            Object.values(host.lanes).map((lane) => [
                `${lane.transition}:${lane.slot}`,
                lane,
            ]),
        );
        lanesBySlot.set(host.lanes, index);
    }
    return index.get(`${transition}:${slot}`);
}

type WalkResolver = Pick<Resolver, "spanInfos" | "explain">;

/** A founding follow-the-leader span (R-10): the marcher's stretch of the trail. */
function ftlPieces(
    host: TimelineSnapshot,
    resolver: WalkResolver,
    t: TransitionRow,
    ftl: NonNullable<ReturnType<Resolver["explain"]>["ftl"]>,
): Piece[] {
    const q = ftl.q!;
    const { entry } = ftl;
    const d0 = entry.startDist[q]!;
    const d1 = entry.endDist[q]!;
    if (!(d1 - d0 >= EPS_GEOM)) return [];
    const shape = t.dest == null ? undefined : host.shapes[t.dest];
    if (!shape)
        throw new Error(
            `follow-the-leader transition ${t.id} has no destination path`,
        );
    const corners = destCorners(shape);
    const pathStart: XY = corners
        ? corners[0]!
        : shape.kind === "circle"
          ? onCircle(
                shape.geometry.center,
                shape.geometry.radius,
                shape.geometry.start_angle,
            )
          : [0, 0];
    // R-9's trail: the members' origins (tail first), the waypoints, then the destination path
    const pre: XY[] = [
        ...entry.members.map((id) => resolver.explain(id, t.start).origin),
        ...(t.params?.waypoints ?? []),
        pathStart,
    ];
    const cum = cumOf(pre);
    const destOffset = cum[cum.length - 1]!;
    const progressOf = (d: number) => (d - d0) / (d1 - d0);
    const out = polylinePieces(
        pre,
        cum,
        d0,
        Math.min(d1, destOffset),
        progressOf,
    );
    if (d1 <= destOffset) return out;
    const s0 = Math.max(0, d0 - destOffset);
    const s1 = d1 - destOffset;
    if (corners) {
        out.push(
            ...polylinePieces(corners, cumOf(corners), s0, s1, (s) =>
                progressOf(s + destOffset),
            ),
        );
    } else if (shape.kind === "circle") {
        const g = shape.geometry;
        const dir = g.clockwise ? -1 : 1;
        out.push(
            ...arcPieces(
                progressOf(s0 + destOffset),
                1,
                g.center,
                g.radius,
                g.start_angle + dir * (s0 / g.radius),
                dir * ((s1 - s0) / g.radius),
            ),
        );
    }
    return out;
}

/** The pieces of one span's walk over progress [0, 1] (the resolver's `evalSpan`, R-15 item 2). */
function spanPieces(
    host: TimelineSnapshot,
    resolver: WalkResolver,
    span: SpanInfo,
    t: TransitionRow,
): Piece[] {
    const explained = resolver.explain(span.marcherId, span.start);
    const A = explained.origin;
    const founding = span.kind === "founding";
    if (t.style === "follow_the_leader") {
        const ftl = explained.ftl;
        if (!ftl) return [];
        if (founding && ftl.q !== null)
            return ftlPieces(host, resolver, t, ftl);
        // R-11: a join or resume walks straight to its target
        const target = ftl.entry.targets.find(
            ([id]) => id === span.marcherId,
        )?.[1];
        return target ? [linePiece(0, 1, A, target)] : [];
    }
    const B = destinationsOf(t, host.shapes)[span.slot!]!;
    const lane = laneOf(host, t.id, span.slot!);
    if (lane) {
        if (!founding) return [linePiece(0, 1, A, B)];
        const geometry = host.routes?.[lane.route]?.geometry;
        if (!geometry)
            throw new Error(
                `lane on ${t.id}:${lane.slot} has no route ${lane.route} (I-D3)`,
            );
        const route: RouteWalk = geometry;
        if (lane.offset) {
            const schedule = groupSchedule(route);
            return groupPieces(
                groupMemberWalk(
                    schedule,
                    A,
                    B,
                    lane.offset,
                    lane.adjust
                        ? resolveAdjust(schedule, route.points, lane.adjust)
                        : null,
                ),
            );
        }
        if (route.points.length === 0) return [linePiece(0, 1, A, B)];
        return routePieces(routePath(A, route.points, B, route));
    }
    if (t.style === "arc") return bulgePieces(A, B, t.params?.bulge ?? 0);
    return [linePiece(0, 1, A, B)];
}

function collect(
    host: TimelineSnapshot,
    resolver: WalkResolver,
    marcherId: number,
    from: Beat,
    to: Beat,
    onlyTransition: number | null,
): WalkedPath {
    const segments: WalkedSegment[] = [];
    for (const span of resolver.spanInfos(marcherId)) {
        if (span.transitionId === null || span.kind === "hold") continue;
        if (onlyTransition !== null && span.transitionId !== onlyTransition)
            continue;
        const b0 = Math.max(from, span.start);
        const b1 = Math.min(to, span.end);
        if (!(b1 > b0)) continue;
        const t = host.transitions[span.transitionId];
        if (!t) continue;
        // R-5: progress runs from the span's start to its transition's end
        const length = t.end - span.start;
        if (!(length > 0)) continue;
        const p0 = (b0 - span.start) / length;
        const p1 = Math.min(1, (b1 - span.start) / length);
        const beatOf = (p: number) => span.start + p * length;
        for (const piece of spanPieces(host, resolver, span, t)) {
            const lo = Math.max(p0, piece.pa);
            const hi = Math.min(p1, piece.pb);
            if (!(hi > lo) || !(piece.pb > piece.pa)) continue;
            const width = piece.pb - piece.pa;
            const shape = piece.cut(
                lo <= piece.pa ? 0 : (lo - piece.pa) / width,
                hi >= piece.pb ? 1 : (hi - piece.pa) / width,
            );
            // R-15 item 6: standing still draws nothing
            if (shape.kind === "line" && dist(shape.from, shape.to) < EPS_GEOM)
                continue;
            const base = {
                start: beatOf(lo),
                end: beatOf(hi),
                transitionId: t.id,
            };
            if (shape.kind === "polyline") {
                const { us, ...rest } = shape;
                segments.push({
                    ...base,
                    ...rest,
                    beats: us.map(
                        (u) => base.start + u * (base.end - base.start),
                    ),
                });
            } else segments.push({ ...base, ...shape });
        }
    }
    return { marcherId, from, to, segments };
}

/**
 * R-15: the path `marcherId` walks from beat `from` to beat `to`, as drawable segments in beat
 * order. `host` is the snapshot `resolver` was built from (or is kept in step with).
 *
 * Times a marcher stands still (holds, and moves that go nowhere) have no segment, so the path
 * is empty when it never moves in the range. Consecutive segments join end to start.
 */
export function walkedPath(
    host: TimelineSnapshot,
    resolver: WalkResolver,
    marcherId: number,
    from: Beat,
    to: Beat,
): WalkedPath {
    return collect(host, resolver, marcherId, from, to, null);
}

/**
 * R-15: the path `marcherId` walks in one move (transition), over all the beats it is in it.
 * Empty when the marcher is not in the move.
 */
export function walkedPathOfMove(
    host: TimelineSnapshot,
    resolver: WalkResolver,
    marcherId: number,
    transitionId: number,
): WalkedPath {
    const t = host.transitions[transitionId];
    if (!t) return { marcherId, from: 0, to: 0, segments: [] };
    return collect(host, resolver, marcherId, t.start, t.end, transitionId);
}

const cubicTables = new WeakMap<WalkedCubic, number[]>();
function cubicTable(seg: WalkedCubic): number[] {
    let e = cubicTables.get(seg);
    if (!e) {
        const K = ROUTE_CUBIC_SAMPLES;
        e = [0];
        let prev = seg.from;
        let total = 0;
        for (let i = 1; i <= K; i++) {
            const s =
                i === K
                    ? seg.to
                    : cubicPoint(seg.from, seg.c1, seg.c2, seg.to, i / K);
            total += dist(prev, s);
            e.push(total);
            prev = s;
        }
        cubicTables.set(seg, e);
    }
    return e;
}

/** Where a segment's marcher is at fraction `f` of the segment's beats. */
function segmentPoint(seg: WalkedSegment, f: number): XY {
    if (f <= 0) return seg.from;
    if (f >= 1) return seg.to;
    switch (seg.kind) {
        case "line":
            return lerp(seg.from, seg.to, f);
        case "arc":
            return onCircle(
                seg.center,
                seg.radius,
                seg.startAngle + seg.sweep * f,
            );
        case "cubic": {
            const e = cubicTable(seg);
            const t = cubicParamAt(e, f * e[e.length - 1]!);
            return cubicPoint(seg.from, seg.c1, seg.c2, seg.to, t);
        }
        case "polyline": {
            const beat = seg.start + f * (seg.end - seg.start);
            const { points, beats } = seg;
            let i = 1;
            while (i < beats.length - 1 && beats[i]! < beat) i++;
            const span = beats[i]! - beats[i - 1]!;
            return span > 0
                ? lerp(
                      points[i - 1]!,
                      points[i]!,
                      (beat - beats[i - 1]!) / span,
                  )
                : points[i]!;
        }
    }
}

/**
 * R-15 item 7: where the path's marcher is at `beat`, within {@link WALKED_SAMPLE_TOLERANCE} of
 * the resolver's `positionAt` for beats in `[path.from, path.to]`. Between segments the marcher
 * stands where the last one ended (before the first, where it starts). null for an empty path:
 * the marcher stands still, and the path doesn't say where.
 */
export function walkedPathPointAt(path: WalkedPath, beat: Beat): XY | null {
    const { segments } = path;
    if (segments.length === 0) return null;
    if (beat <= segments[0]!.start) return segments[0]!.from;
    // the last segment that has started
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segments[mid]!.start <= beat) lo = mid;
        else hi = mid - 1;
    }
    const seg = segments[lo]!;
    if (beat >= seg.end) return seg.to;
    return segmentPoint(seg, (beat - seg.start) / (seg.end - seg.start));
}

export interface WalkedSvgOptions {
    /** Decimal places kept; 3 by default */
    precision?: number;
}

/**
 * R-15 item 8: the path as an SVG path `d` string, in the resolver's coordinates (x right, y
 * down, as SVG's): `M` to the start, then `L`, `A` or `C` per segment (a polyline segment is a
 * run of `L`). A new `M` starts wherever a segment doesn't begin where the last ended. Empty for
 * an empty path.
 */
export function walkedPathToSvg(
    path: WalkedPath,
    options: WalkedSvgOptions = {},
): string {
    const scale = 10 ** (options.precision ?? 3);
    const n = (v: number) => String(Math.round(v * scale) / scale || 0);
    const pt = (p: XY) => `${n(p[0])} ${n(p[1])}`;
    const out: string[] = [];
    let at: XY | null = null;
    for (const seg of path.segments) {
        if (!at || dist(at, seg.from) > 1e-6) out.push(`M ${pt(seg.from)}`);
        switch (seg.kind) {
            case "line":
                out.push(`L ${pt(seg.to)}`);
                break;
            case "arc":
                // y points down, so a growing angle turns clockwise on screen: sweep flag 1
                out.push(
                    `A ${n(seg.radius)} ${n(seg.radius)} 0 0 ${seg.sweep > 0 ? 1 : 0} ${pt(seg.to)}`,
                );
                break;
            case "cubic":
                out.push(`C ${pt(seg.c1)} ${pt(seg.c2)} ${pt(seg.to)}`);
                break;
            case "polyline":
                for (let i = 1; i < seg.points.length; i++)
                    out.push(`L ${pt(seg.points[i]!)}`);
                break;
        }
        at = seg.to;
    }
    return out.join(" ");
}

/**
 * R-15 item 9: the path as polylines, for apps that draw no curves: every point is on the walked
 * path (or on a polyline segment's own points), and the lines between them stay within
 * `tolerance` of it. One polyline per connected run; usually one.
 */
export function walkedPathToPolylines(
    path: WalkedPath,
    tolerance: number = WALKED_SAMPLE_TOLERANCE,
): XY[][] {
    const tol = Math.max(tolerance, 1e-6);
    const out: XY[][] = [];
    let run: XY[] | null = null;
    for (const seg of path.segments) {
        if (!run || dist(run[run.length - 1]!, seg.from) > 1e-6) {
            run = [seg.from];
            out.push(run);
        }
        switch (seg.kind) {
            case "line":
                break;
            case "arc": {
                // sagitta of a chord over angle a: r * (1 - cos(a / 2))
                const step =
                    tol >= seg.radius
                        ? Math.PI
                        : 2 * Math.acos(1 - tol / seg.radius);
                const parts = Math.max(
                    1,
                    Math.ceil(Math.abs(seg.sweep) / step),
                );
                for (let i = 1; i < parts; i++)
                    run.push(
                        onCircle(
                            seg.center,
                            seg.radius,
                            seg.startAngle + (seg.sweep * i) / parts,
                        ),
                    );
                break;
            }
            case "cubic": {
                // Wang's bound from the control polygon's second differences
                const second = (a: XY, b: XY, c: XY) =>
                    Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);
                const bend = Math.max(
                    second(seg.from, seg.c1, seg.c2),
                    second(seg.c1, seg.c2, seg.to),
                );
                const parts = Math.max(
                    1,
                    Math.ceil(Math.sqrt((0.75 * bend) / tol)),
                );
                for (let i = 1; i < parts; i++)
                    run.push(
                        cubicPoint(seg.from, seg.c1, seg.c2, seg.to, i / parts),
                    );
                break;
            }
            case "polyline":
                for (let i = 1; i < seg.points.length - 1; i++)
                    run.push(seg.points[i]!);
                break;
        }
        run.push(seg.to);
    }
    return out;
}
