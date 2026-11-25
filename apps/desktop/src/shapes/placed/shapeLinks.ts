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
import type { AnyToolKind } from "../tool/toolKind";
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

/**
 * How far from another shape's end the pointer dragging an end (or a moved shape's end) attaches
 * it, in handle reaches: 16 px for a mouse, further for a pen or finger, at any zoom. The same for
 * a placed shape's drag and a new shape drawn with the shape tool.
 */
export const ATTACH_REACH = 1.6;

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

/** Whether `kind` is a Line, a Curve (a Line preset) or an Arc: the kinds whose ends link */
export const linksKind = (kind: AnyToolKind): boolean =>
    kind.shape.id === lineTool.shape.id || kind.shape.id === arcTool.shape.id;

/** Whether `box` is an open Line, Curve or Arc, whose ends can be linked */
export const isLinkable = (box: PlacedBox): box is PlacedBox<LineParams> =>
    linksKind(box.kind) && hasEnds(box.params as LineParams);

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
export interface FreeEnd {
    readonly owner: PlacedBox<LineParams>;
    readonly ownerEnd: LineEnd;
    readonly at: XY;
}

/**
 * Every end, not linked or attached, of an open Line, Curve or Arc shown on its own page at
 * `beat`, among `boxes` that `among` lets in
 */
function openEnds(
    boxes: readonly PlacedBox[],
    links: readonly ShapeLink[],
    beat: number,
    among: (owner: PlacedBox<LineParams>) => boolean,
): FreeEnd[] {
    const out: FreeEnd[] = [];
    for (const owner of boxes) {
        if (!isLinkable(owner) || !onOwnPage(owner, beat) || !among(owner))
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
    return openEnds(
        boxes,
        links,
        beat,
        (owner) =>
            owner.recipe.id !== box.recipe.id &&
            owner.recipe.timelineId === box.recipe.timelineId,
    );
}

/**
 * The ends a shape being drawn with the shape tool can attach to (#1235): each end, not linked or
 * attached, of an open Line, Curve or Arc shown on its own page at `beat`. The new shape has no
 * move yet: placing it at `beat` puts it in the move there, and a link to a shape on another move
 * is dead (ADR 0006, linked shapes rule 3).
 */
export const drawnFreeEnds = (
    boxes: readonly PlacedBox[],
    beat: number,
): FreeEnd[] => openEnds(boxes, liveLinks(boxes, beat), beat, () => true);

/**
 * Which end of a Line, Curve or Arc of `kind` (as `base`, `spots` spots) its handle `key` is, if
 * one is: the handle standing on it. Null for any other handle (a Line's middle point, an Arc's
 * middle), a closed line, or a kind that can't link.
 */
export function handleEndOf(
    kind: AnyToolKind,
    base: unknown,
    spots: number,
    key: string,
): LineEnd | null {
    if (!linksKind(kind)) return null;
    const p = base as LineParams;
    if (!hasEnds(p)) return null;
    const handle = kind.handles(p as never, spots).find((h) => h.key === key);
    if (!handle) return null;
    return (
        LINE_ENDS.find((end) => near(handle.at, endPoint(p, end), 1e-6)) ?? null
    );
}

/**
 * Which end of `box` (as `base`) its handle `key` is, if one is: the handle standing on it. Null
 * for any other handle (a Line's middle point, an Arc's middle), or a shape that can't link.
 */
export const handleEnd = (
    box: PlacedBox,
    base: unknown,
    key: string,
): LineEnd | null =>
    isLinkable(box) ? handleEndOf(box.kind, base, box.spots, key) : null;

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
    return snapEnds({
        params: p,
        was: box.params,
        targets: freeEnds(box, boxes, links, beat),
        radius,
        dragged,
        held: (end) => linkedEnd(box, end, links) || !!p.attach?.[end],
    });
}

/**
 * {@link attachSnap} among `targets`, for a shape as it was (`was`) and is now (`params`): the
 * shape tool's open shape (#1235) and a placed one alike. An end `held` (in a link already) never
 * snaps; without `dragged`, only an end that moved from `was` does.
 */
export function snapEnds({
    params: p,
    was,
    targets,
    radius,
    dragged,
    held = () => false,
}: {
    params: LineParams;
    was: LineParams;
    targets: readonly FreeEnd[];
    radius: number;
    dragged?: { end: LineEnd; pointer: XY; base: unknown };
    held?: (end: LineEnd) => boolean;
}): AttachSnap | null {
    if (targets.length === 0 || !hasEnds(p)) return null;
    let best: (AttachSnap & { d: number }) | null = null;
    for (const end of dragged ? [dragged.end] : LINE_ENDS) {
        if (held(end)) continue;
        const from = dragged ? dragged.pointer : endPoint(p, end);
        // Only an end the drag moved
        if (!dragged && near(endPoint(was, end), from, 1e-9)) continue;
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

/** The free end among `targets` nearest `at`, within `radius`; null with none */
export function nearestEnd(
    targets: readonly FreeEnd[],
    at: XY,
    radius: number,
): FreeEnd | null {
    let best: { target: FreeEnd; d: number } | null = null;
    for (const target of targets) {
        const d = Math.hypot(target.at.x - at.x, target.at.y - at.y);
        if (d <= radius && (!best || d < best.d)) best = { target, d };
    }
    return best?.target ?? null;
}

/**
 * A new Line, Curve or Arc being drawn by a drag (#1235), `params` from the press at `pressed` to
 * the pointer at `pointer`: each end whose pointer is within `radius` of a free end among
 * `targets` lands exactly on it and is attached to it, its first point by where the press was and
 * its last by where the pointer is. Both can't attach to the same end. `snapped`: the ends that
 * did, the pointer's last.
 */
export function drawnAttach({
    params,
    pressed,
    pointer,
    targets,
    radius,
}: {
    params: LineParams;
    pressed: XY;
    pointer: XY;
    targets: readonly FreeEnd[];
    radius: number;
}): { params: LineParams; snapped: FreeEnd[] } {
    let p = params.attach
        ? withAttach(withAttach(params, "start", undefined), "end", undefined)
        : params;
    if (!hasEnds(p)) return { params: p, snapped: [] };
    const start = nearestEnd(targets, pressed, radius);
    const end = nearestEnd(
        start ? targets.filter((t) => t !== start) : targets,
        pointer,
        radius,
    );
    if (!start && !end) return { params: p, snapped: [] };
    p = stretchEnds(p, {
        ...(start ? { start: start.at } : {}),
        ...(end ? { end: end.at } : {}),
    });
    for (const [which, t] of [
        ["start", start],
        ["end", end],
    ] as const)
        if (t)
            p = withAttach(p, which, {
                recipe: t.owner.recipe.id,
                end: t.ownerEnd,
            });
    return { params: p, snapped: [start, end].filter((t) => t !== null) };
}

/**
 * A shape being drawn (`params`, #1235) with only the attachments that will link once it's placed
 * at `beat` among the placed shapes there (`boxes`): each names a free end of an open Line, Curve
 * or Arc on its own page ({@link drawnFreeEnds}) that this end is still on, and no two ends name
 * the same one. An end moved off its joint (a key, a number, a turn) holds its marcher again. The
 * same params when nothing changes.
 */
export function keepDrawnAttach(
    params: LineParams,
    boxes: readonly PlacedBox[],
    beat: number,
): LineParams {
    if (!params.attach) return params;
    if (!hasEnds(params)) {
        const { attach: _attach, ...rest } = params;
        return rest;
    }
    const targets = drawnFreeEnds(boxes, beat);
    const taken = new Set<FreeEnd>();
    let p = params;
    for (const end of LINE_ENDS) {
        const ref = params.attach[end];
        if (!ref) continue;
        const target = targets.find(
            (t) =>
                !taken.has(t) &&
                t.owner.recipe.id === ref.recipe &&
                t.ownerEnd === ref.end &&
                near(t.at, endPoint(params, end), JOINT_TOLERANCE),
        );
        if (target) taken.add(target);
        else p = withAttach(p, end, undefined);
    }
    return p;
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

/**
 * The connected figure `box` is in (#1236): `box` and every shape linked to it, following the
 * links through each shape in turn (a J with a tail is three shapes), each once, in recipe id
 * order. Only live links count (`links`, from {@link liveLinks}), so a dead attachment (a shape
 * on another move, a later page, an end off its joint) joins nothing. Just `box` when it's in no
 * link.
 */
export function linkedFigure(
    box: PlacedBox,
    links: readonly ShapeLink[],
): PlacedBox[] {
    const found = new Map<number, PlacedBox>([[box.recipe.id, box]]);
    const queue: PlacedBox[] = [box];
    for (let next = queue.pop(); next; next = queue.pop()) {
        for (const link of linksOf(next, links)) {
            const { other } = sideOf(next, link);
            if (found.has(other.recipe.id)) continue;
            found.set(other.recipe.id, other);
            queue.push(other);
        }
    }
    return [...found.values()].sort((a, b) => a.recipe.id - b.recipe.id);
}
