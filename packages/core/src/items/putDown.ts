/**
 * Put-down (ADR 0002 D-9, props-spec section 4 "Put down"): a released item lands where its
 * holder is. Nothing is stored for it. The position is derived from Placement and the holder's
 * drill, on top of the timeline resolver:
 *
 * - On a held → placed change at beat B (a put-down), the item is at its holder's position at B
 *   (the midpoint of its holders' for several), and stays there.
 * - It stays there until the item's own next move: the first of its timeline moves that ends
 *   after B. Over that move it blends from the put-down spot into the move's own path, so the
 *   move starts where the item was put down and ends where the designer put it.
 * - When one of the item's own moves ends exactly on B, the designer placed it there: that move
 *   wins, nothing is derived, and the notes list says so if it isn't at the holder (Snap to holder
 *   rewrites that move's end).
 *
 * So a put-down can't outlive its release: delete or change the held change, put it Off field,
 * delete the holder, re-time it, and the item is simply where its own drill puts it. It isn't a
 * move: it is no clip on the timeline, has no step size and can't be edited as one.
 */
import type { Resolver, SpanInfo, XY } from "../timeline/types";
import {
    putDowns,
    putDownSpot,
    type PlacementChange,
    type PutDown,
} from "./placement";

/** An item's `marchers` row (which the resolver positions) and its Placement changes. */
export interface PutDownItem {
    marcherId: number;
    /** Beats as the resolver counts them (ordinals) */
    changes: readonly PlacementChange[];
}

/** One of the item's own timeline moves, as beats. */
export interface OwnMove {
    start: number;
    end: number;
}

export type PutDownAnchor =
    /** Derived: the item is at `spot` from the put-down on, until `fade` (its own next move) */
    | (PutDown & { kind: "derived"; spot: XY; fade: OwnMove | null })
    /** The item's own move ends on the put-down: the designer placed it, nothing is derived */
    | (PutDown & { kind: "own_move"; spot: XY | null; move: OwnMove });

/** What the put-down reads from the resolver. */
export type PutDownReads = Pick<
    Resolver,
    "positionAt" | "spanInfos" | "marcherIds"
>;

const ownMoves = (spans: readonly SpanInfo[]): OwnMove[] =>
    spans
        .filter((s) => s.kind !== "hold")
        .map((s) => ({ start: s.start, end: s.end }))
        .sort((a, b) => a.start - b.start || a.end - b.end);

/**
 * Each put-down of an item with how its position is decided, in beat order. Holders the resolver
 * doesn't have are left out of the spot; a put-down with no holder positioned derives nothing.
 */
export function putDownAnchors(
    base: PutDownReads,
    item: PutDownItem,
    known: ReadonlySet<number> = new Set(base.marcherIds()),
): PutDownAnchor[] {
    if (!known.has(item.marcherId)) return [];
    const list = putDowns(item.changes);
    if (list.length === 0) return [];
    const moves = ownMoves(base.spanInfos(item.marcherId));
    const out: PutDownAnchor[] = [];
    for (const putDown of list) {
        const positions = new Map<number, XY>();
        for (const h of putDown.holders)
            if (known.has(h.marcherId))
                positions.set(
                    h.marcherId,
                    base.positionAt(h.marcherId, putDown.beat),
                );
        const spot = putDownSpot(putDown.holders, positions);
        const own = moves.find((m) => m.end === putDown.beat);
        if (own) {
            out.push({ ...putDown, kind: "own_move", spot, move: own });
            continue;
        }
        if (!spot) continue;
        const next = moves.find((m) => m.end > putDown.beat);
        out.push({
            ...putDown,
            kind: "derived",
            spot,
            fade: next
                ? { start: Math.max(next.start, putDown.beat), end: next.end }
                : null,
        });
    }
    return out;
}

/**
 * Where an item is at `beat` with its put-downs: the latest derived put-down at or before the
 * beat decides it; before any, the resolver does.
 */
export function putDownPositionAt(
    base: Pick<Resolver, "positionAt">,
    marcherId: number,
    anchors: readonly PutDownAnchor[],
    beat: number,
): XY {
    let anchor: Extract<PutDownAnchor, { kind: "derived" }> | null = null;
    for (const a of anchors) {
        if (a.beat > beat) break;
        if (a.kind === "derived") anchor = a;
    }
    if (!anchor) return base.positionAt(marcherId, beat);
    const { spot, fade } = anchor;
    if (!fade || beat < fade.start) return spot;
    const own = base.positionAt(marcherId, beat);
    if (beat >= fade.end || fade.end <= fade.start) return own;
    // Over the next move: the move's own path, offset by where the put-down left the item, the
    // offset fading to nothing at the move's end
    const from = base.positionAt(marcherId, fade.start);
    const w = 1 - (beat - fade.start) / (fade.end - fade.start);
    return [own[0] + (spot[0] - from[0]) * w, own[1] + (spot[1] - from[1]) * w];
}

/** A put-down whose item isn't at its holder, because the item's own move ends there elsewhere. */
export interface PutDownDrift extends PutDown {
    /** Where the holder (or the holders' midpoint) is at the put-down */
    spot: XY;
    /** Where the item's own move puts it */
    at: XY;
    distance: number;
    /** The item's own move that ends on the put-down: Snap to holder rewrites its end */
    move: OwnMove;
}

/**
 * The put-downs where the item's own move, not the put-down, places it, away from its holder by
 * more than `tolerance` (canvas units). A derived put-down is always at its holder.
 */
export function putDownDrifts(
    base: Pick<Resolver, "positionAt">,
    marcherId: number,
    anchors: readonly PutDownAnchor[],
    tolerance = 1e-3,
): PutDownDrift[] {
    const out: PutDownDrift[] = [];
    for (const a of anchors) {
        if (a.kind !== "own_move" || !a.spot) continue;
        const at = base.positionAt(marcherId, a.beat);
        const distance = Math.hypot(at[0] - a.spot[0], at[1] - a.spot[1]);
        if (distance > tolerance)
            out.push({
                changeId: a.changeId,
                beat: a.beat,
                holders: a.holders,
                spot: a.spot,
                at,
                distance,
                move: a.move,
            });
    }
    return out;
}

/** A resolver whose items are put down where their holders release them. */
export interface PutDownResolver extends Resolver {
    /** The resolver it reads, without put-downs */
    readonly base: Resolver;
    /** Replaces the items and their Placement; the next reads use them. */
    setPutDownItems(items: readonly PutDownItem[]): void;
    /** An item's put-downs, as `putDownAnchors` decides them now; empty for anything else. */
    putDownAnchors(marcherId: number): readonly PutDownAnchor[];
}

/**
 * Wraps `base` so `positionAt` and `positionsAt` put items down (see the file comment).
 * Everything else is the base resolver's. The put-downs are worked out lazily and again after
 * every `notify` (the holders' drill may have changed) and `setPutDownItems`.
 */
export function withPutDowns(
    base: Resolver,
    items: readonly PutDownItem[] = [],
): PutDownResolver {
    let current = items;
    let anchors: Map<number, PutDownAnchor[]> | null = null;
    let ids: readonly number[] | null = null;
    let indexOf = new Map<number, number>();

    const anchorsNow = () => {
        if (anchors) return anchors;
        const known = new Set(base.marcherIds());
        anchors = new Map();
        for (const item of current) {
            const list = putDownAnchors(base, item, known);
            if (list.length > 0) anchors.set(item.marcherId, list);
        }
        return anchors;
    };
    const derivedOf = (marcherId: number) => {
        const list = anchorsNow().get(marcherId);
        return list && list.some((a) => a.kind === "derived") ? list : null;
    };
    const indexNow = () => {
        const now = base.marcherIds();
        if (now !== ids) {
            ids = now;
            indexOf = new Map(now.map((id, i) => [id, i]));
        }
        return indexOf;
    };

    const wrapped: PutDownResolver = {
        base,
        setPutDownItems(next) {
            current = next;
            anchors = null;
        },
        putDownAnchors: (marcherId) => anchorsNow().get(marcherId) ?? [],
        positionAt(marcherId, beat) {
            const list = derivedOf(marcherId);
            return list
                ? putDownPositionAt(base, marcherId, list, beat)
                : base.positionAt(marcherId, beat);
        },
        positionsAt(beat, out) {
            base.positionsAt(beat, out);
            const index = indexNow();
            for (const [marcherId, list] of anchorsNow()) {
                if (!list.some((a) => a.kind === "derived")) continue;
                const i = index.get(marcherId);
                if (i === undefined) continue;
                const [x, y] = putDownPositionAt(base, marcherId, list, beat);
                out[2 * i] = x;
                out[2 * i + 1] = y;
            }
        },
        marcherIds: () => base.marcherIds(),
        explain: (marcherId, beat) => base.explain(marcherId, beat),
        spanInfos: (marcherId) => base.spanInfos(marcherId),
        ftlEntry: (transitionId) => base.ftlEntry(transitionId),
        notify(batch) {
            anchors = null;
            return base.notify(batch);
        },
        warmAll: () => base.warmAll(),
        counters: () => base.counters(),
        resetCounters: () => base.resetCounters(),
        diagnostics: () => base.diagnostics(),
        checkCacheClosure: () => base.checkCacheClosure(),
    };
    return wrapped;
}
