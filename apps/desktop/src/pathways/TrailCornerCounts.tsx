import { useEffect, useState } from "react";
import clsx from "clsx";
import { create } from "zustand";
import * as Popover from "@radix-ui/react-popover";
import { FlagPennantIcon, WarningIcon } from "@phosphor-icons/react";
import type { CornerCount } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import { Tip } from "@/components/ui/Tip";
import {
    fieldToElement,
    useFieldViewStore,
    type FieldView,
} from "@/field/three/fieldView";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { DOT_RADIUS } from "@/field/editor/hitTest";
import { dotSizes } from "@/field/three/selectionRing";
import { isTouchLayout } from "@/components/timeline/touchTargets";
import { currentShapeField } from "@/shapes/field/shapeField";
import { drawingOf } from "./pathPenMode";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import { pathKey, usePathPenStore, type PathSession } from "./pathPenStore";
import {
    cornerRange,
    formatCount,
    trailCornersOf,
    type TrailCornersView,
} from "./trailCorners";

/**
 * How far a chip's nearest edge sits from its corner, in screen pixels, along the side it takes.
 * The chip is anchored by that edge (`chipAnchor`), so however wide its text is, it never covers
 * the corner's point or the dot standing there (owner, 2026-11-17: a warning sat on the point).
 */
const CHIP_GAP_PX = 18;
/** How much farther out a chip tries when every side at `CHIP_GAP_PX` is taken */
const CHIP_FAR_GAP_PX = 34;
/** Room kept around what a chip mustn't cover, in screen pixels */
const CHIP_CLEARANCE_PX = 2;
/** A chip's size as drawn, in screen pixels: text-sub digits, the warning icon, its padding */
const CHIP_HEIGHT_PX = 18;
const CHIP_HEIGHT_TOUCH_PX = 32;
const CHIP_CHAR_PX = 6.5;
const CHIP_PADDING_PX = 10;
const CHIP_PADDING_TOUCH_PX = 18;
const CHIP_ICON_PX = 14;

/** What a chip mustn't cover, in screen pixels: a point or dot (a circle), a label (a box) */
export type ChipObstacle =
    | { kind: "circle"; x: number; y: number; r: number }
    | { kind: "box"; x: number; y: number; w: number; h: number };

/** A chip's box on screen: its middle and size */
interface ChipBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A chip's size on screen for its text (`cornerRange`), estimated as the chip draws it */
export function chipSize(
    corner: CornerCount,
    touch = isTouchLayout(),
): { w: number; h: number } {
    const text = cornerRange(corner).length * CHIP_CHAR_PX;
    return {
        w:
            text +
            (touch ? CHIP_PADDING_TOUCH_PX : CHIP_PADDING_PX) +
            (corner.offCount ? CHIP_ICON_PX : 0),
        h: touch ? CHIP_HEIGHT_TOUCH_PX : CHIP_HEIGHT_PX,
    };
}

/**
 * How a chip on side `u` (a unit direction from its corner) hangs from its anchor, as fractions of
 * its size: the side scaled so its larger part is 1. The anchor is `gap` out along `u`, and the
 * chip's edge facing the corner sits on it: straight right of the corner its left edge, straight
 * above it its bottom edge, diagonally a corner of the chip. So the corner is at least
 * `gap·cos 45°` clear of the chip, whatever its size.
 */
export function chipAnchor(u: { x: number; y: number }): {
    sx: number;
    sy: number;
} {
    const m = Math.max(Math.abs(u.x), Math.abs(u.y)) || 1;
    return { sx: u.x / m, sy: u.y / m };
}

/** The chip's box on side `u` of `at`, `gap` out (`chipAnchor`) */
function boxOn(
    at: { x: number; y: number },
    u: { x: number; y: number },
    gap: number,
    size: { w: number; h: number },
): ChipBox {
    const { sx, sy } = chipAnchor(u);
    return {
        x: at.x + u.x * gap + (sx * size.w) / 2,
        y: at.y + u.y * gap + (sy * size.h) / 2,
        w: size.w,
        h: size.h,
    };
}

const covers = (box: ChipBox, o: ChipObstacle): boolean => {
    const c = CHIP_CLEARANCE_PX;
    if (o.kind === "box")
        return (
            Math.abs(box.x - o.x) < (box.w + o.w) / 2 + c &&
            Math.abs(box.y - o.y) < (box.h + o.h) / 2 + c
        );
    // The nearest point of the box to the circle's middle
    const nx = Math.max(box.x - box.w / 2, Math.min(o.x, box.x + box.w / 2));
    const ny = Math.max(box.y - box.h / 2, Math.min(o.y, box.y + box.h / 2));
    return Math.hypot(nx - o.x, ny - o.y) < o.r + c;
};

const overlaps = (a: ChipBox, b: ChipBox): boolean =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/**
 * The sides a corner's chip tries, in order: outside the turn, along the bisector of its two legs
 * (away from where the way bends to), then square to that either way, then inside the turn. A
 * corner that turns right round (no outside) starts square to the way in.
 */
function chipSides(corner: CornerCount): { x: number; y: number }[] {
    const ix = corner.dirOut[0] - corner.dirIn[0];
    const iy = corner.dirOut[1] - corner.dirIn[1];
    const il = Math.hypot(ix, iy);
    const u =
        il > 1e-9
            ? { x: -ix / il, y: -iy / il }
            : { x: -corner.dirIn[1], y: corner.dirIn[0] };
    return [u, { x: -u.y, y: u.x }, { x: u.y, y: -u.x }, { x: -u.x, y: -u.y }];
}

/**
 * Where each corner's chip goes, in screen pixels, in order along the way (TC-5; owner,
 * 2026-11-17). Its side is the first of `chipSides` where it covers nothing in `obstacles` (the
 * path's points and handles, the marchers' dots and their drill labels), at `CHIP_GAP_PX`, then
 * farther out; when every side is taken it keeps the first (outside the turn), which never covers
 * its own corner. A chip that would sit on one already placed (a dense block, or zoomed out) is
 * left out (TC-5): zoom in to see it. `left`/`top` is its anchor and `sx`/`sy` how it hangs from
 * it (`chipAnchor`). Exported for tests.
 */
export function chipPlaces(
    corners: readonly CornerCount[],
    toScreen: (x: number, y: number) => { x: number; y: number },
    obstacles: readonly ChipObstacle[] = [],
    sizeOf: (corner: CornerCount) => { w: number; h: number } = (c) =>
        chipSize(c),
): {
    corner: CornerCount;
    left: number;
    top: number;
    sx: number;
    sy: number;
}[] {
    const placed: {
        corner: CornerCount;
        left: number;
        top: number;
        sx: number;
        sy: number;
        box: ChipBox;
    }[] = [];
    for (const corner of corners) {
        const at = toScreen(corner.at[0], corner.at[1]);
        const size = sizeOf(corner);
        const sides = chipSides(corner);
        const tries = [CHIP_GAP_PX, CHIP_FAR_GAP_PX].flatMap((gap) =>
            sides.map((u) => ({ u, gap })),
        );
        const free =
            tries.find(
                ({ u, gap }) =>
                    !obstacles.some((o) => covers(boxOn(at, u, gap, size), o)),
            ) ?? tries[0]!;
        const box = boxOn(at, free.u, free.gap, size);
        if (placed.some((p) => overlaps(p.box, box))) continue;
        const { sx, sy } = chipAnchor(free.u);
        placed.push({
            corner,
            left: at.x + free.u.x * free.gap,
            top: at.y + free.u.y * free.gap,
            sx,
            sy,
            box,
        });
    }
    return placed.map(({ box: _box, ...p }) => p);
}

/** How far from a point's or handle's middle a chip keeps, in screen pixels */
const HANDLE_ROOM_PX = 8;
/** A drill label above a dot: its middle 2.2 dot radii up, 14 field units high (`LabelsLayer`) */
export const LABEL_LIFT_DOTS = 2.2;
export const LABEL_HEIGHT = 14;
/** A label's width per character, in em (Courier) */
const LABEL_EM_PER_CHAR = 0.62;

/**
 * What the chips keep off, on screen: the session's drawn points, handles, starts and spots, and
 * every marcher drawn on the field near the trail with its drill label above it
 */
export function chipObstaclesOf(
    session: PathSession,
    view: FieldView,
): ChipObstacle[] {
    const out: ChipObstacle[] = [];
    const toScreen = (p: { x: number; y: number }) =>
        fieldToElement(view, p.x, p.y);
    const zoom = view.zoom || 1;
    const dot = DOT_RADIUS * dotSizes(zoom).scale;
    const dotPx = dot * zoom + 4;
    const drawing = drawingOf(session);
    const handles = [
        ...session.points.map((p) => p.at),
        ...(drawing?.handles ?? []),
        ...(drawing?.addHandles ?? []),
        ...(drawing?.selectedHandles ?? []),
    ];
    for (const p of handles) {
        const s = toScreen(p);
        out.push({ kind: "circle", x: s.x, y: s.y, r: HANDLE_ROOM_PX });
    }
    for (const p of [...(drawing?.rings ?? []), ...(drawing?.spots ?? [])]) {
        const s = toScreen(p);
        out.push({ kind: "circle", x: s.x, y: s.y, r: dotPx });
    }
    // The marchers drawn now, the line's real ones while it's drawn (step 4c) too, with labels
    const field = currentShapeField();
    const marchers = field?.marchers() ?? [];
    const drills = new Map(marchers.map((m) => [m.id, m.drill_number]));
    const dots: { id: number; at: { x: number; y: number } }[] = [];
    if (field)
        for (const [id, at] of field.drawn(marchers.map((m) => m.id)))
            dots.push({ id, at: { x: at.x, y: at.y } });
    const real = drawing?.marchersAt;
    if (real)
        real.ids.forEach((id, i) => {
            const at = real.spots[i];
            if (at) dots.push({ id, at });
        });
    const scale = dotSizes(zoom).scale;
    for (const { id, at } of dots) {
        const s = toScreen(at);
        out.push({ kind: "circle", x: s.x, y: s.y, r: dotPx });
        const chars = (drills.get(id) ?? "").length || 3;
        out.push({
            kind: "box",
            x: s.x,
            y: s.y - LABEL_LIFT_DOTS * DOT_RADIUS * scale * zoom,
            w: chars * LABEL_EM_PER_CHAR * LABEL_HEIGHT * scale * zoom,
            h: LABEL_HEIGHT * scale * zoom,
        });
    }
    return out;
}

/**
 * Whether a selected trail's corner chips show (owner, 2026-11-18: "I don't want to see all of the
 * warnings appear unless I click on that turns between count warning"): pinned by a click on the
 * path bar's summary ("2 corners turn between counts") for that trail (its `pathKey`), and kept
 * while a corner's list is open. Nothing else shows them on a selected trail, a hover included
 */
export const useCornerChipsStore = create<{
    pinnedFor: string | null;
    listOpen: boolean;
}>(() => ({ pinnedFor: null, listOpen: false }));

/** Pins or unpins the chips of the trail `session` shows */
export function toggleCornerChips(session: PathSession): void {
    const key = pathKey(session.target);
    useCornerChipsStore.setState((s) => ({
        pinnedFor: s.pinnedFor === key ? null : key,
    }));
}

/** Hides the pinned chips (Escape, or the trail let go) */
export function hideCornerChips(): void {
    if (useCornerChipsStore.getState().pinnedFor !== null)
        useCornerChipsStore.setState({ pinnedFor: null });
}

// The pin is the trail's only while it stays shown: deselected, or another trail selected, the
// chips go, so the next selection starts without them
usePathPenStore.subscribe((s) => {
    const pinned = useCornerChipsStore.getState().pinnedFor;
    if (pinned !== null && (!s.session || pathKey(s.session.target) !== pinned))
        hideCornerChips();
});

/**
 * Corner counts on the field, pathways step 6 (spec L.9, TC-5 and TC-6): a chip just outside each
 * corner of the trail the session shows, with the first and last turning counts there, in the
 * warning color when a member turns between counts. A click or tap opens the corner's list: who
 * turns there, leader first, and on which count. While a trail is drawn the chips only show (a
 * click on the field places the next point), so the list opens once it's finished. A trail only
 * selected (closed) shows them once the path bar's summary pins them (owner, 2026-11-18); open
 * (Edit path) or drawn, always.
 */
export function TrailCornerCounts({ session }: { session: PathSession }) {
    const view = trailCornersOf(session);
    const field = useFieldViewStore();
    const quiet = session.phase === "closed";
    const pinned = useCornerChipsStore(
        (s) => s.pinnedFor === pathKey(session.target) || s.listOpen,
    );
    if (!view || view.corners.length === 0) return null;
    if (quiet && !pinned) return null;
    const drawing = session.phase === "drawing";
    return (
        <>
            {chipPlaces(
                view.corners,
                (x, y) => fieldToElement(field, x, y),
                chipObstaclesOf(session, field),
            ).map(({ corner, left, top, sx, sy }) => (
                <CornerChip
                    // by where it is along the way, so an open list stays on its corner when
                    // another corner comes or goes
                    key={corner.d.toFixed(3)}
                    view={view}
                    corner={corner}
                    left={left}
                    top={top}
                    sx={sx}
                    sy={sy}
                    inert={drawing}
                />
            ))}
        </>
    );
}

function CornerChip({
    view,
    corner,
    left,
    top,
    sx,
    sy,
    inert,
}: {
    view: TrailCornersView;
    corner: CornerCount;
    left: number;
    top: number;
    /** How it hangs from its anchor (`chipAnchor`): its edge facing the corner on the anchor */
    sx: number;
    sy: number;
    inert: boolean;
}) {
    const [open, setOpenState] = useState(false);
    // An open list keeps a selected trail's chips up when the pointer leaves the trail
    const setOpen = (next: boolean) => {
        setOpenState(next);
        useCornerChipsStore.setState({ listOpen: next });
    };
    useEffect(
        () => () => {
            if (open) useCornerChipsStore.setState({ listOpen: false });
        },
        [open],
    );
    const range = cornerRange(corner);
    const label = corner.offCount
        ? tolgee.t(
              "pathways.corners.chipOffLabel",
              "Turning counts {range} at this corner, some between counts. Show who turns when.",
              { range },
          )
        : tolgee.t(
              "pathways.corners.chipLabel",
              "Turning counts {range} at this corner. Show who turns when.",
              { range },
          );
    const chip = (
        <button
            type="button"
            className={clsx(
                "rounded-6 bg-modal text-sub shadow-modal absolute z-10 flex items-center gap-2 border px-4 leading-none whitespace-nowrap tabular-nums",
                "focus-visible:outline-accent py-2 focus-visible:outline-2",
                // a finger gets a target it can hit (touch layout), desktop stays compact
                "touch:min-h-32 touch:px-8",
                corner.offCount
                    ? "border-yellow text-yellow"
                    : "border-stroke text-text",
                inert && "pointer-events-none",
            )}
            style={{
                left,
                top,
                transform: `translate(${-50 + 50 * sx}%, ${-50 + 50 * sy}%)`,
            }}
            aria-label={label}
            tabIndex={inert ? -1 : undefined}
            data-testid="trail-corner-count"
            data-trail-corner=""
            // Space on a chip reached by keyboard opens its list rather than playing the show
            data-shape-ui=""
            data-off={corner.offCount ? "true" : undefined}
            data-counts={corner.turns
                .map((t) => formatCount(t.count))
                .join(",")}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            {corner.offCount && (
                <WarningIcon size={12} weight="bold" aria-hidden />
            )}
            {range}
        </button>
    );
    if (inert) return chip;
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="right"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    className={clsx(
                        POPOVER_CLASS,
                        "text-sub z-50 flex max-h-384 min-w-160 flex-col gap-4 overflow-y-auto p-8",
                    )}
                    data-testid="trail-corner-list"
                    data-trail-corner=""
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <CornerList view={view} corner={corner} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** TC-6: who turns at the corner, leader first, each with its count */
function CornerList({
    view,
    corner,
}: {
    view: TrailCornersView;
    corner: CornerCount;
}) {
    const leaderQ = view.drills.length - 1;
    return (
        <>
            <div className="text-text-subtitle px-4">
                {tolgee.t("pathways.corners.listTitle", "Turns at this corner")}
            </div>
            <ul className="flex flex-col">
                {corner.turns.map((t) => (
                    <li
                        key={t.q}
                        className={clsx(
                            "rounded-4 flex items-center justify-between gap-12 px-4 py-2 tabular-nums",
                            !t.onCount && "text-yellow",
                        )}
                        data-testid="trail-corner-turn"
                        data-on-count={t.onCount ? "true" : "false"}
                    >
                        <span className="flex items-center gap-4">
                            {view.drills[t.q]}
                            {t.q === leaderQ && (
                                <FlagPennantIcon
                                    size={10}
                                    weight="fill"
                                    className="text-accent"
                                    aria-label={tolgee.t(
                                        "pathways.corners.leader",
                                        "Leader",
                                    )}
                                />
                            )}
                        </span>
                        <span className="flex items-center gap-4">
                            {!t.onCount && (
                                <WarningIcon
                                    size={12}
                                    weight="bold"
                                    aria-hidden
                                />
                            )}
                            {t.onCount
                                ? tolgee.t(
                                      "pathways.corners.onCount",
                                      "count {count}",
                                      { count: formatCount(t.count) },
                                  )
                                : tolgee.t(
                                      "pathways.corners.betweenCounts",
                                      "{count} · between {before} and {after}",
                                      {
                                          count: formatCount(t.count),
                                          before: Math.floor(t.count),
                                          after: Math.ceil(t.count),
                                      },
                                  )}
                        </span>
                    </li>
                ))}
            </ul>
            {corner.stopBefore > 0 && (
                <div className="text-text-subtitle px-4">
                    {tolgee.t(
                        "pathways.corners.stopBefore",
                        "{count, plural, one {# stops or leaves the trail before turning here} other {# stop or leave the trail before turning here}}",
                        { count: corner.stopBefore },
                    )}
                </div>
            )}
        </>
    );
}

/** The turns-between-counts tooltip's name: how many turns, at how many corners */
const offCountTitle = (tally: { turns: number; corners: number }): string =>
    tolgee.t(
        "pathways.corners.offCountTitle",
        "{turns, plural, one {# turn falls} other {# turns fall}} between counts",
        { turns: tally.turns },
    );

/** Its one line of help: how to put every turn on a count */
const offCountHint = (): string =>
    tolgee.t(
        "pathways.corners.offCountHint",
        "Move a corner, or change the spacing or counts",
    );

/**
 * TC-7: the path bar's warning when turns fall between counts. Hovering shows a short tip; a click
 * or tap (a finger or pencil has no hover) opens the whole detail in a popover.
 */
export function OffCountWarning({
    tally,
}: {
    tally: { turns: number; corners: number };
}) {
    const detail = tolgee.t(
        "pathways.corners.offCountTip",
        "{turns, plural, one {# turn falls} other {# turns fall}} between counts, at {corners, plural, one {# corner} other {# corners}}. Each marcher reaches a corner at its own steady speed. Move the corner, change the spacing or the move's counts to put every turn on a count. Tap or click a corner's count to see who turns when.",
        { turns: tally.turns, corners: tally.corners },
    );
    return (
        <Popover.Root>
            {/* Short, as every tooltip (owner, 2026-11-17); the popover has the whole detail */}
            <Tip label={offCountTitle(tally)} hint={offCountHint()}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        className="text-yellow focus-visible:outline-accent flex items-center gap-4 rounded-full px-4 focus-visible:outline-2"
                        data-testid="path-off-count"
                        data-shape-ui=""
                        aria-label={detail}
                    >
                        <WarningIcon size={14} weight="bold" aria-hidden />
                        {tolgee.t(
                            "pathways.corners.offCountShort",
                            "Turns between counts",
                        )}
                    </button>
                </Popover.Trigger>
            </Tip>
            <Popover.Portal>
                <Popover.Content
                    side="top"
                    sideOffset={6}
                    collisionPadding={8}
                    className={clsx(
                        POPOVER_CLASS,
                        "text-sub z-50 max-w-288 p-8 whitespace-normal",
                    )}
                    data-testid="path-off-count-detail"
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {detail}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/**
 * A selected trail's path bar summary of its turns between counts (owner, 2026-11-17): "2 corners
 * turn between counts", after Edit path. It's a toggle (owner, 2026-11-18): a click or tap shows
 * the corners' chips on the field and stays pressed, again (or Escape) hides them; hovering shows
 * a short tip (the detail is its accessible name).
 */
export function CornerSummary({
    session,
    tally,
}: {
    session: PathSession;
    tally: { turns: number; corners: number };
}) {
    const pinned = useCornerChipsStore(
        (s) => s.pinnedFor === pathKey(session.target),
    );
    const hideLabel = tolgee.t(
        "pathways.corners.hideChips",
        "Hide the corners' counts",
    );
    // Escape hides the chips first; the next one lets the trail go, as the field's Escape does.
    // Registered as the chips show, so it sits above the field's own Escape
    useActionHandler(
        "cancelAlignmentUpdates",
        hideCornerChips,
        { label: hideLabel },
        pinned,
    );
    const detail = tolgee.t(
        "pathways.corners.offCountTip",
        "{turns, plural, one {# turn falls} other {# turns fall}} between counts, at {corners, plural, one {# corner} other {# corners}}. Each marcher reaches a corner at its own steady speed. Move the corner, change the spacing or the move's counts to put every turn on a count. Tap or click a corner's count to see who turns when.",
        { turns: tally.turns, corners: tally.corners },
    );
    return (
        <Tip
            label={
                pinned
                    ? hideLabel
                    : tolgee.t(
                          "pathways.corners.showChips",
                          "Show the corners' counts",
                      )
            }
            hint={offCountHint()}
        >
            <button
                type="button"
                className={clsx(
                    "text-yellow focus-visible:outline-accent flex items-center gap-4 rounded-full px-4 focus-visible:outline-2",
                    pinned && "bg-yellow/20 ring-yellow/60 ring-1",
                )}
                data-testid="path-corner-summary"
                data-shape-ui=""
                aria-pressed={pinned}
                aria-label={detail}
                onClick={() => toggleCornerChips(session)}
            >
                <WarningIcon size={14} weight="bold" aria-hidden />
                {tolgee.t(
                    "pathways.corners.summary",
                    "{corners, plural, one {# corner turns} other {# corners turn}} between counts",
                    { corners: tally.corners },
                )}
            </button>
        </Tip>
    );
}
