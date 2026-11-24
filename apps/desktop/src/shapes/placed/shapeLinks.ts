import { arcTool } from "../arc/arcTool";
import { LINE_ENDS, type LineEnd, type LineParams } from "../line/lineGeometry";
import {
    endPoint,
    hasEnds,
    shiftLine,
    stretchEnds,
    withAttach,
} from "../line/lineLinks";
import { lineTool } from "../line/lineTool";
import type { XY } from "../types";
import type { PlacedBox } from "./placedBox";

/**
 * Linked shapes (#1235, epic #1216, ADR 0006's linked-shapes amendment): placed Lines, Curves and
 * Arcs whose ends are attached, each still its own shape with its own marchers and interval. The
 * shape that attached (dragged its end onto another's) stores the link on that end
 * (`LineParams.attach`) and holds no marcher there; the shape it attached to holds the one marcher
 * on the joint. Moving or editing either moves the other's end at the joint, which stretches, its
 * far end staying put. Everything here is pure.
 */

/** How close two ends must be to count as one joint, in field units (as a marcher on its spot) */
export const JOINT_TOLERANCE = 0.01;

/** A link between two placed shapes' ends, live where both are shown */
export interface ShapeLink {
    /** The shape that attached: its end holds no marcher */
    readonly attacher: PlacedBox<LineParams>;
    readonly attacherEnd: LineEnd;
    /** The shape attached to: its end holds the joint's marcher */
    readonly owner: PlacedBox<LineParams>;
    readonly ownerEnd: LineEnd;
    /** The joint, in field units */
    readonly at: XY;
}

/** Whether `box` is an open Line, Curve or Arc, whose ends can be linked */
export const isLinkable = (box: PlacedBox): box is PlacedBox<LineParams> =>
    (box.kind === lineTool || box.kind === arcTool) &&
    hasEnds(box.params as LineParams);

const near = (a: XY, b: XY, within: number) =>
    Math.hypot(a.x - b.x, a.y - b.y) <= within;

/**
 * Whether `box` is on its own page at `beat`: the end of the move it was placed in. On a later
 * page it's only carried onto, a linked shape is a shape of its own: no link shows or acts there,
 * and an edit there gives that page an unlinked copy.
 */
const onOwnPage = (box: PlacedBox, beat: number) => box.endBeat >= beat - 1e-9;

/**
 * The links live among the shapes shown at `beat` (`boxes`): a stored attachment counts only
 * while the shape it names is shown, on the same move, an open Line, Curve or Arc, with that end
 * on the joint, and both are on their own page. An end is in one link at most: an owner's end
 * attached to twice keeps the attachment of the lowest recipe id. Any other attachment is dead:
 * it links nothing, and the shape's next save drops it ({@link withoutDeadLinks}).
 */
export function liveLinks(
    boxes: readonly PlacedBox[],
    beat: number,
): ShapeLink[] {
    const byId = new Map(boxes.map((b) => [b.recipe.id, b]));
    const links: ShapeLink[] = [];
    const taken = new Set<string>();
    const sorted = [...boxes].sort((a, b) => a.recipe.id - b.recipe.id);
    for (const attacher of sorted) {
        if (!isLinkable(attacher) || !onOwnPage(attacher, beat)) continue;
        for (const attacherEnd of LINE_ENDS) {
            const ref = attacher.params.attach?.[attacherEnd];
            if (!ref) continue;
            const owner = byId.get(ref.recipe);
            if (
                !owner ||
                owner === attacher ||
                !isLinkable(owner) ||
                owner.recipe.timelineId !== attacher.recipe.timelineId ||
                !onOwnPage(owner, beat) ||
                // The owner's end holds the marcher: it's no attached end itself
                owner.params.attach?.[ref.end]
            )
                continue;
            const at = endPoint(owner.params, ref.end);
            if (
                !near(
                    at,
                    endPoint(attacher.params, attacherEnd),
                    JOINT_TOLERANCE,
                )
            )
                continue;
            const key = `${owner.recipe.id}:${ref.end}`;
            if (taken.has(key)) continue;
            taken.add(key);
            links.push({ attacher, attacherEnd, owner, ownerEnd: ref.end, at });
        }
    }
    return links;
}

/** The links `box` is in, either way round */
export const linksOf = (
    box: PlacedBox,
    links: readonly ShapeLink[],
): ShapeLink[] =>
    links.filter(
        (l) =>
            l.attacher.recipe.id === box.recipe.id ||
            l.owner.recipe.id === box.recipe.id,
    );

/** `box`'s side of `link`: its end at the joint, and the shape and end on the other side */
export function sideOf(
    box: PlacedBox,
    link: ShapeLink,
): { end: LineEnd; other: PlacedBox<LineParams>; otherEnd: LineEnd } {
    return link.attacher.recipe.id === box.recipe.id
        ? { end: link.attacherEnd, other: link.owner, otherEnd: link.ownerEnd }
        : {
              end: link.ownerEnd,
              other: link.attacher,
              otherEnd: link.attacherEnd,
          };
}

/** Whether end `end` of `box` is in one of `links` */
export const linkedEnd = (
    box: PlacedBox,
    end: LineEnd,
    links: readonly ShapeLink[],
): boolean => linksOf(box, links).some((l) => sideOf(box, l).end === end);

/** Where a dragged end will attach (`attachSnap`) */
export interface AttachSnap {
    /** The dragged shape's end that attaches */
    readonly end: LineEnd;
    /** The shape it attaches to, which holds the joint's marcher */
    readonly owner: PlacedBox<LineParams>;
    readonly ownerEnd: LineEnd;
    /** The joint: the owner's end */
    readonly at: XY;
    /**
     * The shape to stretch onto the joint instead of the one dragged, when the kind's own rule for
     * a dragged end left that end out of reach though the pointer is in it (an Arc's end slides
     * along its chord): the shape as it was at the press, turned and scaled about its far end
     */
    readonly from?: LineParams;
}

/** An end of an open Line, Curve or Arc shown on its own page that a dragged end can attach to */
interface FreeEnd {
    readonly owner: PlacedBox<LineParams>;
    readonly ownerEnd: LineEnd;
    readonly at: XY;
}

/**
 * The ends `box` can attach to: each end, not linked or attached, of another open Line, Curve or
 * Arc shown on its own page at `beat`, on the same move. None when `box` itself can't link.
 */
export function freeEnds(
    box: PlacedBox,
    boxes: readonly PlacedBox[],
    links: readonly ShapeLink[],
    beat: number,
): FreeEnd[] {
    if (!isLinkable(box) || !onOwnPage(box, beat)) return [];
    const out: FreeEnd[] = [];
    for (const owner of boxes) {
        if (
            owner.recipe.id === box.recipe.id ||
            !isLinkable(owner) ||
            owner.recipe.timelineId !== box.recipe.timelineId ||
            !onOwnPage(owner, beat)
        )
            continue;
        for (const ownerEnd of LINE_ENDS) {
            if (
                owner.params.attach?.[ownerEnd] ||
                linkedEnd(owner, ownerEnd, links)
            )
                continue;
            out.push({ owner, ownerEnd, at: endPoint(owner.params, ownerEnd) });
        }
    }
    return out;
}

/**
 * Which end of `box` (as `base`) its handle `key` is, if one is: the handle standing on it. Null
 * for any other handle (a Line's middle point, an Arc's middle), or a shape that can't link.
 */
export function handleEnd(
    box: PlacedBox,
    base: unknown,
    key: string,
): LineEnd | null {
    if (!isLinkable(box)) return null;
    const p = base as LineParams;
    if (!hasEnds(p)) return null;
    const handle = box.kind
        .handles(p as never, box.spots)
        .find((h) => h.key === key);
    if (!handle) return null;
    return (
        LINE_ENDS.find((end) => near(handle.at, endPoint(p, end), 1e-6)) ?? null
    );
}

/**
 * Where `box`, drawn now with `params` (mid-drag), would attach on release: an end of it that the
 * drag moved and isn't linked, within `radius` of a free end of another open Line, Curve or Arc
 * shown on its own page, on the same move ({@link freeEnds}). The nearest pair wins. Null when
 * there's none, when `box` itself can't link, or for anything but a move or an end's drag.
 *
 * An end's drag (`dragged`: which end, the pointer, and the shape at the press) is measured from
 * the pointer, whatever the kind's own rule for that end did with it: an Arc's end slides along
 * its chord, so it may stand well off the pointer, yet the pointer on another shape's end attaches
 * it there (`from`: the press's shape is stretched onto the joint, its form kept).
 */
export function attachSnap({
    box,
    params,
    boxes,
    links,
    radius,
    beat,
    dragged,
}: {
    box: PlacedBox;
    params: unknown;
    boxes: readonly PlacedBox[];
    links: readonly ShapeLink[];
    radius: number;
    beat: number;
    dragged?: { end: LineEnd; pointer: XY; base: unknown };
}): AttachSnap | null {
    if (!isLinkable(box)) return null;
    const p = params as LineParams;
    if (!hasEnds(p)) return null;
    const targets = freeEnds(box, boxes, links, beat);
    if (targets.length === 0) return null;
    let best: (AttachSnap & { d: number }) | null = null;
    for (const end of dragged ? [dragged.end] : LINE_ENDS) {
        if (linkedEnd(box, end, links) || p.attach?.[end]) continue;
        const was = endPoint(box.params, end);
        const from = dragged ? dragged.pointer : endPoint(p, end);
        // Only an end the drag moved
        if (!dragged && near(was, from, 1e-9)) continue;
        for (const target of targets) {
            const d = Math.hypot(target.at.x - from.x, target.at.y - from.y);
            if (d <= radius && (!best || d < best.d))
                best = { end, ...target, d };
        }
    }
    if (!best) return null;
    const { d: _d, ...snap } = best;
    // The kind's end out of reach though the pointer's in it: stretch the press's shape instead
    if (
        dragged &&
        !near(endPoint(p, snap.end), snap.at, radius) &&
        hasEnds(dragged.base as LineParams)
    )
        return { ...snap, from: dragged.base as LineParams };
    return snap;
}

/**
 * `params` attached as `snap` says: the end lands exactly on the joint (the whole line moved
 * there when `whole`, its other end staying put otherwise, stretched from `snap.from` when it
 * says) and stores the link, so it holds no marcher there
 */
export function attachedParams(
    params: LineParams,
    snap: AttachSnap,
    whole: boolean,
): LineParams {
    const from = endPoint(params, snap.end);
    const landed = whole
        ? shiftLine(params, { x: snap.at.x - from.x, y: snap.at.y - from.y })
        : stretchEnds(snap.from ?? params, { [snap.end]: snap.at });
    return withAttach(landed, snap.end, {
        recipe: snap.owner.recipe.id,
        end: snap.ownerEnd,
    });
}

/**
 * What editing `box` into `params` does to the shapes linked to it: each one whose end at a joint
 * with `box` is no longer where `box`'s end is now gets that end moved there, stretching, its
 * other end staying (both ends move when both are linked to `box`). Shapes whose joints didn't
 * move are left out.
 */
export function followersOf(
    box: PlacedBox,
    params: unknown,
    links: readonly ShapeLink[],
): { box: PlacedBox<LineParams>; params: LineParams }[] {
    if (!isLinkable(box)) return [];
    const p = params as LineParams;
    if (!hasEnds(p)) return [];
    const moves = new Map<
        number,
        { box: PlacedBox<LineParams>; to: Partial<Record<LineEnd, XY>> }
    >();
    for (const link of linksOf(box, links)) {
        const { end, other, otherEnd } = sideOf(box, link);
        const joint = endPoint(p, end);
        if (near(joint, endPoint(other.params, otherEnd), 1e-9)) continue;
        const entry = moves.get(other.recipe.id) ?? { box: other, to: {} };
        entry.to[otherEnd] = joint;
        moves.set(other.recipe.id, entry);
    }
    return [...moves.values()].map(({ box: other, to }) => ({
        box: other,
        params: stretchEnds(other.params, to),
    }));
}

/**
 * `params` (an edit of `box`) with only the attachments that will link once it's saved: each names
 * a shape shown at `beat` (`boxes`) on the same move, an open Line, Curve or Arc on its own page,
 * whose end, as it will be (`after`: the params it's saved with beside this edit, else its own),
 * is free and on this end. An end attached to a shape that's gone, ungrouped, on another move, or
 * moved off the joint by an edit elsewhere holds its marcher again.
 */
export function withoutDeadLinks(
    box: PlacedBox,
    params: unknown,
    boxes: readonly PlacedBox[],
    beat: number,
    after: (box: PlacedBox<LineParams>) => LineParams = (b) => b.params,
): unknown {
    if (!isLinkable(box)) return params;
    let p = params as LineParams;
    if (!p.attach) return params;
    for (const end of LINE_ENDS) {
        const ref = p.attach?.[end];
        if (!ref) continue;
        const owner = boxes.find((b) => b.recipe.id === ref.recipe);
        const ownerNow = owner && isLinkable(owner) ? after(owner) : null;
        const live =
            !!owner &&
            !!ownerNow &&
            owner.recipe.id !== box.recipe.id &&
            hasEnds(ownerNow) &&
            owner.recipe.timelineId === box.recipe.timelineId &&
            onOwnPage(owner, beat) &&
            onOwnPage(box, beat) &&
            !ownerNow.attach?.[ref.end] &&
            near(
                endPoint(ownerNow, ref.end),
                endPoint(p, end),
                JOINT_TOLERANCE,
            );
        if (!live) p = withAttach(p, end, undefined);
    }
    return p;
}

/** The link's attacher detached: its end holds its own marcher again */
export const detachedParams = (link: ShapeLink): LineParams =>
    withAttach(link.attacher.params, link.attacherEnd, undefined);

/** The live link whose joint is within `radius` of `at`, among `box`'s, nearest first */
export function linkAt(
    box: PlacedBox,
    at: XY,
    links: readonly ShapeLink[],
    radius: number,
): ShapeLink | null {
    let best: { link: ShapeLink; d: number } | null = null;
    for (const link of linksOf(box, links)) {
        const d = Math.hypot(link.at.x - at.x, link.at.y - at.y);
        if (d <= radius && (!best || d < best.d)) best = { link, d };
    }
    return best?.link ?? null;
}
