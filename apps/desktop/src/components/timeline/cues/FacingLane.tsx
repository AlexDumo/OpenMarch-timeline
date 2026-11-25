/**
 * The timeline's Facing lane (fork #993), under the Equipment lane: one row per group of
 * performers with the same Facing history, a striped bar where they turn and a solid bar where
 * they hold an angle. It follows the Equipment lane:
 *
 * - Click a cue's bar (its turn or its hold) to pick it: the cue commands act on it, and the
 *   click selects its counts, as a move's bar does. Right-click or long-press it for its menu;
 *   double-click it, or choose Edit turn…, for the turn popover.
 * - A cue is its result on its count; its turn leads into it. Drag a bar to move the cue (its
 *   turn goes with it), with the timeline's edge snapping. Drag the start of the result's bar, or
 *   of its turn, to the left to set where the turn starts: the turn grows backwards and the hold
 *   before it shrinks. Dragged back to the cue's count it's instant; it never starts before the
 *   cue before it.
 * - A press on empty lane space is the timeline's, as on the audio lane.
 */
import {
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    CaretDownIcon,
    CaretRightIcon,
    EyeSlashIcon,
} from "@phosphor-icons/react";
import { useTranslate } from "@tolgee/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import type { TimelineBandGeometry } from "@/components/timeline/TimelineBand";
import {
    KEEP_MENU_EVENTS,
    MenuItemWithReason,
    TIMELINE_MENU_CONTENT_CLASS,
} from "@/components/timeline/TimelineRangeMenu";
import {
    clamp,
    isPageSnapDisabled,
} from "@/components/timeline/TimelineGeometry";
import { snapEdgeBeat } from "@/components/timeline/timelineEdgeSnap";
import { TouchHitArea } from "@/components/timeline/TouchHitArea";
import { TOUCH_HIT_SIZE } from "@/components/timeline/touchTargets";
import { fingerDragSlop } from "@/components/timeline/timelineGestures";
import {
    MENU_ITEM_CLASS,
    MENU_LABEL_CLASS,
    MENU_SEPARATOR_CLASS,
} from "@/components/ui/popupClasses";
import { cueNeighbours, turnCounts, turnStartDrag } from "@/cues/cueEdges";
import { withEquipmentSet } from "@/cues/equipment";
import {
    facingLane,
    formatDegrees,
    turnLabel,
    type FacingDirection,
    type FacingLaneData,
    type FacingPiece,
    type FacingRow,
} from "@/cues/facing";
import { compileShowCues } from "@/cues/showCues";
import { countToSpecBeat } from "@/cues/equipmentLane";
import { useShowCues, type EditorCues } from "@/cues/useShowCues";
import { pickedCueIn, useCueSelectionStore } from "@/cues/cueSelectionStore";
import { describePerformers } from "@/cues/cueLabel";
import { cueChangeEdit } from "@/cues/useCueCommands";
import { useTurnPopoverStore } from "@/cues/turnPopoverStore";
import { editCuesMutationOptions, type CueEdit } from "@/hooks/queries/useCues";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { isPerformer } from "@/global/classes/Marcher";
import { createTimelineBeatAxis } from "@/timeline/timelineViewModel";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useFieldProperties } from "@/field/editMode/useApplyFieldEdits";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { beatWhere } from "@/timeline/timelineRangeWords";
import { translateTimelineText } from "@/timeline/translateTimelineText";
import {
    actionDisabledReason,
    isActionChecked,
    isActionEnabled,
    runAction,
    subscribeToActionHandlers,
} from "@/shortcuts/registry";
import type { ActionId } from "@/shortcuts/definitions";
import { getActionLabel } from "@/shortcuts/labels";
import {
    setLaneFolded,
    useLaneFolded,
    useLaneShown,
} from "@/timeline/timelineLanes";
import { useLaneNameMenu } from "./LanesMenu";
import {
    DRAG_SLOP_PX,
    EMPTY,
    HEADER,
    PAD,
    ROW,
    SUMMARY,
    useLongPressMenu,
} from "./cueLaneParts";
import { TurnPopover } from "./TurnPopover";

/** A second click this soon after a bar's click is a double-click (the popover's) */
const DOUBLE_CLICK_MS = 600;

/** The grip where a turn starts: drawn 6 px wide, astride the edge */
const GRIP_PX = 6;

/** The lane's height: its header, then its rows, its folded row, or the empty hint */
export function facingLaneHeight(
    lane: FacingLaneData | null,
    folded: boolean,
): number {
    if (!lane || lane.rows.length === 0) return HEADER + EMPTY + PAD;
    return HEADER + (folded ? SUMMARY : lane.rows.length * ROW) + PAD;
}

/**
 * The Facing lane's part of the timeline's lanes area: its height (0 while hidden) and what it
 * draws at a geometry.
 */
export function useFacingLaneParts(): {
    height: number;
    render: (geometry: TimelineBandGeometry) => ReactNode;
} {
    const shown = useLaneShown("facing");
    const folded = useLaneFolded("facing");
    const show = useShowCues();
    const beats = useTimingObjects()?.beats;
    const lane = useMemo(
        () =>
            show
                ? facingLane({
                      compiled: show.compiled,
                      cues: show.cues,
                      marcherIds: show.marchers
                          .filter(isPerformer)
                          .map((m) => m.id),
                  })
                : null,
        [show],
    );
    return useMemo(
        () => ({
            height: shown && beats ? facingLaneHeight(lane, folded) : 0,
            render: (geometry: TimelineBandGeometry) =>
                shown && beats ? (
                    <FacingLaneView
                        geometry={geometry}
                        lane={lane}
                        show={show}
                        beats={beats}
                        folded={folded}
                    />
                ) : null,
        }),
        [shown, folded, lane, show, beats],
    );
}

type LaneDrag = { cueId: number; edit: CueEdit | null };
/**
 * What a press on a cue drags: the cue (its result or diamond), where its turn starts (its turn),
 * or a new turn out of an instant cue (the diamond's tab)
 */
type LaneDragMode = "move" | "resultStart" | "turnStart";
type CueMenu = { x: number; y: number; cueId: number };

export function FacingLaneView({
    geometry,
    lane,
    show,
    beats,
    folded,
}: {
    geometry: TimelineBandGeometry;
    lane: FacingLaneData | null;
    show: EditorCues | null;
    beats: readonly { id: number; duration: number; position: number }[];
    folded: boolean;
}) {
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const { mutate: edit } = useMutation(editCuesMutationOptions(queryClient));
    const pickedCueId = useCueSelectionStore((s) => s.cueId);
    const pickedAt = useCueSelectionStore((s) => s.createdAt);
    const picked = show
        ? (pickedCueIn(show.cues, { cueId: pickedCueId, createdAt: pickedAt })
              ?.id ?? null)
        : null;
    const pickCue = useCueSelectionStore((s) => s.pick);
    const pick = (cueId: number | null) =>
        pickCue(
            cueId === null
                ? null
                : (show?.cues.find((c) => c.id === cueId) ?? null),
        );
    const popoverCueId = useTurnPopoverStore((s) => s.cueId);
    const pageBoxes = useTimelineSelectionStore((s) => s.pageBoxes);
    const sides = useFieldProperties()?.sideDescriptions;
    const names: Record<FacingDirection, string> = {
        front: t("cues.facing.front"),
        back: t("cues.facing.back"),
        side1: sides?.verboseLeft ?? t("cues.facing.side1"),
        side2: sides?.verboseRight ?? t("cues.facing.side2"),
    };
    const turnWords = {
        full: (icon: string, amount: string, count: number) =>
            t("cues.lane.turnLabel", { icon, amount, count }),
        short: (icon: string, amount: string) =>
            t("cues.lane.turnLabelShort", { icon, amount }),
    };
    const [menu, setMenu] = useState<CueMenu | null>(null);
    const [drag, setDrag] = useState<LaneDrag | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const ppb = geometry.pixelsPerBeat;
    const { xOf, axis, specOf } = useMemo(() => {
        const axis = createTimelineBeatAxis(beats);
        const specOf = new Map(beats.map((b, i) => [b.id, i]));
        const ids = show?.beatIds ?? [];
        return {
            axis,
            specOf,
            xOf: (count: number) =>
                axis.toView(countToSpecBeat(count, ids, specOf)) * ppb,
        };
    }, [beats, show, ppb]);
    // While dragging, the lane as the drop would leave it: the same edit, compiled
    const previewLane = useMemo(() => {
        if (!drag?.edit || !show) return null;
        const cues = withEquipmentSet(show.cues, drag.edit);
        return facingLane({
            compiled: compileShowCues(show.marchers, beats, cues, show.values)
                .compiled,
            cues,
            marcherIds: show.marchers.filter(isPerformer).map((m) => m.id),
        });
    }, [drag, show, beats]);
    const rows = (previewLane ?? lane)?.rows ?? [];
    const words = {
        performers: (n: number) => t("cues.label.performers", { count: n }),
    };
    const rowName = (ids: readonly number[], label: string | null) =>
        label ??
        describePerformers({ ids, marchers: show?.marchers ?? [], words });
    /** A cue's menu heading: where it turns them, then who it's for ("Side 2 · 90° · Trumpets") */
    const cueHeading = (cueId: number) => {
        const cue = show?.cues.find((c) => c.id === cueId);
        const row = rows.find((r) => r.pieces.some((p) => p.cueId === cueId));
        const hold = row?.pieces.find(
            (p) => p.cueId === cueId && p.kind === "hold",
        );
        if (!cue) return "";
        return t("cues.lane.menuHeading", {
            value: hold ? turnLabel(hold, names) : "",
            name: rowName(cue.marcherIds, cue.label),
        });
    };

    const openMenu = (cueId: number, clientX: number, clientY: number) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        pick(cueId);
        setMenu({ x: clientX - rect.left, y: clientY - rect.top, cueId });
    };
    // The window before a bar's click selected its counts, so the double-click that opens the
    // popover leaves the playhead where it was (the simulated users' finding: the first click threw
    // it to the end of the show)
    const beforeClick = useRef<{
        at: number;
        startBeat: number;
        playheadBeat: number;
    } | null>(null);
    const openPopover = (cueId: number) => {
        pick(cueId);
        const before = beforeClick.current;
        beforeClick.current = null;
        if (before && performance.now() - before.at < DOUBLE_CLICK_MS) {
            const store = useTimelineSelectionStore.getState();
            if (before.startBeat < before.playheadBeat)
                store.selectRange(before.startBeat, before.playheadBeat);
            else store.seekKeepingStart(before.playheadBeat);
        }
        useTurnPopoverStore.getState().open(cueId);
    };

    /**
     * A press on a cue's bar (`move`), or on the grip at the start of its result's bar (`resultStart`)
     * or of its turn (`turnStart`): past the slop it drags with the timeline's edge snapping, and
     * on release writes the new count or turn as one undo step. Short of the slop it's a click: it
     * picks the cue and selects its counts (its turn and its result), as a move's bar does.
     */
    const startDrag = (
        e: ReactPointerEvent<HTMLElement>,
        cueId: number,
        mode: LaneDragMode,
    ) => {
        if (isPlaying || !show || e.button !== 0) return;
        const cue = show.cues.find((c) => c.id === cueId);
        const at = cue ? specOf.get(cue.beatId) : undefined;
        if (!cue || at === undefined) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const slop = fingerDragSlop(e.pointerType, DRAG_SLOP_PX);
        const specAt = (count: number) =>
            countToSpecBeat(count, show.beatIds, specOf);
        const near = cueNeighbours({
            cues: show.cues,
            cue,
            countOf: (beatId) => show.countOfBeat.get(beatId),
        });
        const until = specAt(near.nextLasting ?? show.beatIds.length);
        // Its turn leads into it, never from before the cue before it (or the first count)
        const turnStart = at - turnCounts(cue.transition);
        const floor = specAt(near.previous ?? 0);
        const playhead = axis.toView(
            useTimelineSelectionStore.getState().playheadBeat,
        );
        const landAt = (ev: PointerEvent, view: number, offset: number) =>
            snapEdgeBeat({
                beat: view + offset,
                pageBeats: geometry.pageBeats ?? geometry.snapBeats,
                downbeats: geometry.downbeats ?? [],
                playheadBeat: playhead,
                pixelsPerBeat: ppb,
                snapDisabled: isPageSnapDisabled(ev),
                from: view,
            }) - view;
        let dragging = false;
        let planned: CueEdit | null = null;
        const plan = (ev: PointerEvent): CueEdit | null => {
            const offset = (ev.clientX - startX) / ppb;
            if (mode === "move") {
                const delta = clamp(
                    landAt(ev, axis.toView(at), offset),
                    1 - at,
                    beats.length - 1 - at,
                );
                return delta === 0
                    ? null
                    : cueChangeEdit(
                          show,
                          cueId,
                          { beatId: beats[at + delta]!.id },
                          words,
                      );
            }
            // The result's start begins the turn from the cue's count; the turn's, from its start
            const origin = mode === "resultStart" ? at : turnStart;
            const turned = turnStartDrag({
                count: at,
                transition: mode === "resultStart" ? null : cue.transition,
                floor,
                delta: landAt(ev, axis.toView(origin), offset),
            });
            return cueChangeEdit(
                show,
                cueId,
                { transition: turned.transition },
                words,
            );
        };
        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== e.pointerId) return;
            if (!dragging && Math.abs(ev.clientX - startX) < slop) return;
            dragging = true;
            planned = plan(ev);
            setDrag({ cueId, edit: planned });
        };
        const done = (commit: boolean) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            // A click selects the cue's counts, as a move's bar does (not with Ctrl or Cmd)
            if (commit && !dragging && !e.ctrlKey && !e.metaKey) {
                const { startBeat, playheadBeat } =
                    useTimelineSelectionStore.getState();
                beforeClick.current = {
                    at: performance.now(),
                    startBeat,
                    playheadBeat,
                };
                geometry.onSelectRange?.({
                    startBeatIndex: axis.toView(turnStart),
                    endBeatIndex: axis.toView(until),
                });
            }
            const write = dragging && commit ? planned : null;
            if (!write) {
                setDrag(null);
                return;
            }
            edit(write, { onSettled: () => setDrag(null) });
        };
        const onUp = (ev: PointerEvent) => {
            if (ev.pointerId === e.pointerId) done(true);
        };
        const onCancel = (ev: PointerEvent) => {
            if (ev.pointerId === e.pointerId) done(false);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
    };

    const nameMenu = useLaneNameMenu("facing");
    const height = facingLaneHeight(lane, folded);
    const lockedReason = isPlaying ? t("cues.reason.pausedFacing") : undefined;
    // The turn popover, at its cue's first bar
    const popoverRow = rows.findIndex((r) =>
        r.pieces.some((p) => p.cueId === popoverCueId),
    );
    const popoverPiece =
        popoverRow >= 0
            ? rows[popoverRow]!.pieces.find((p) => p.cueId === popoverCueId)
            : undefined;
    return (
        <div
            ref={rootRef}
            data-testid="facing-lane"
            className="border-stroke absolute left-0 border-t"
            style={{ top: geometry.top, width: geometry.width, height }}
            // A press on empty lane space goes on to the timeline, which moves the playhead or
            // scrubs as on the audio lane; the lane's name and buttons keep theirs (cues stop
            // their own)
            onPointerDown={(e) => {
                if (e.target === e.currentTarget) pick(null);
                // A press in the lane's menus and popovers (drawn elsewhere in the page, but
                // inside the lane for React) is theirs, not the timeline's
                if (
                    !(e.target instanceof Node) ||
                    !e.currentTarget.contains(e.target) ||
                    (e.target instanceof Element &&
                        e.target.closest(
                            '[data-testid="facing-lane-header"], button',
                        ))
                )
                    e.stopPropagation();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
        >
            <div
                data-testid="facing-lane-header"
                className="text-micro text-text-subtitle sticky left-0 z-10 flex w-fit items-center gap-4 px-4"
                style={{ height: HEADER }}
                onContextMenu={nameMenu.onContextMenu}
            >
                {nameMenu.menu}
                <button
                    type="button"
                    data-testid="facing-lane-fold"
                    aria-label={t(
                        folded
                            ? "cues.lane.expandRows"
                            : "cues.lane.collapseRows",
                    )}
                    title={t(
                        folded
                            ? "cues.lane.expandRows"
                            : "cues.lane.collapseRows",
                    )}
                    aria-expanded={!folded}
                    className="hover:text-text touch:size-44 flex size-16 items-center justify-center rounded-full"
                    onClick={() => setLaneFolded("facing", !folded)}
                >
                    {folded ? (
                        <CaretRightIcon size={12} />
                    ) : (
                        <CaretDownIcon size={12} />
                    )}
                </button>
                <span className="text-text font-medium">
                    {t("cues.lane.facing")}
                </span>
                {folded && rows.length > 0 && (
                    <span>
                        {t("cues.lane.foldedCount", {
                            groups: rows.length,
                            count: lane?.marcherIds.length ?? 0,
                        })}
                    </span>
                )}
                <button
                    type="button"
                    data-testid="facing-lane-hide"
                    aria-label={t("cues.lane.hide")}
                    title={t("cues.lane.hide")}
                    className="hover:text-text touch:size-44 flex size-16 items-center justify-center rounded-full"
                    onClick={() => runAction("toggleFacingLane")}
                >
                    <EyeSlashIcon size={12} />
                </button>
            </div>
            {rows.length === 0 ? (
                <div
                    className="text-micro text-text-subtitle sticky left-0 flex w-fit items-center px-24"
                    style={{ height: EMPTY }}
                >
                    {t("cues.lane.facingEmpty")}
                </div>
            ) : folded ? (
                <div
                    data-testid="facing-lane-summary"
                    className="relative"
                    style={{ height: SUMMARY }}
                >
                    {(lane?.marks ?? []).map((mark) => (
                        <TurnMark
                            key={mark.cueId}
                            cueId={mark.cueId}
                            left={xOf(mark.count)}
                            picked={mark.cueId === picked}
                            label={cueHeading(mark.cueId)}
                            onPick={() => pick(mark.cueId)}
                            onMenu={(x, y) => openMenu(mark.cueId, x, y)}
                            onOpen={() => openPopover(mark.cueId)}
                        />
                    ))}
                </div>
            ) : (
                rows.map((row) => (
                    <div
                        key={row.key}
                        data-testid="facing-lane-row"
                        data-marchers={row.marcherIds.join(",")}
                        className="relative"
                        style={{ height: ROW }}
                    >
                        {row.pieces.map((piece) => (
                            <FacingBar
                                key={`${piece.from}-${piece.kind}-${piece.cueId ?? "d"}`}
                                piece={piece}
                                left={xOf(piece.from)}
                                width={xOf(piece.to) - xOf(piece.from)}
                                {...(piece.kind === "turn"
                                    ? turnBarLabel(
                                          piece,
                                          xOf(piece.to) - xOf(piece.from),
                                          turnWords,
                                      )
                                    : {
                                          label: turnLabel(piece, names),
                                          fullLabel: turnLabel(piece, names),
                                      })}
                                instant={
                                    !row.pieces.some(
                                        (p) =>
                                            p.cueId === piece.cueId &&
                                            p.kind === "turn",
                                    )
                                }
                                dragging={
                                    drag !== null && drag.cueId === piece.cueId
                                }
                                picked={
                                    piece.cueId !== null &&
                                    piece.cueId === picked
                                }
                                lockedReason={lockedReason}
                                onPress={(e, mode) => {
                                    if (piece.cueId === null) return;
                                    if (e.button === 0) pick(piece.cueId);
                                    startDrag(e, piece.cueId, mode);
                                }}
                                onMenu={(x, y) =>
                                    piece.cueId !== null &&
                                    openMenu(piece.cueId, x, y)
                                }
                                onOpen={() =>
                                    piece.cueId !== null &&
                                    openPopover(piece.cueId)
                                }
                            />
                        ))}
                        <RowName
                            row={row}
                            name={rowName(row.marcherIds, row.label)}
                        />
                    </div>
                ))
            )}
            {menu && show && (
                <FacingMenuView
                    menu={menu}
                    show={show}
                    heading={cueHeading(menu.cueId)}
                    onClose={() => setMenu(null)}
                />
            )}
            {popoverPiece && popoverCueId !== null && show && (
                <TurnPopover
                    cueId={popoverCueId}
                    show={show}
                    names={names}
                    dialNames={{
                        ...names,
                        side1: sides?.terseLeft ?? "S1",
                        side2: sides?.terseRight ?? "S2",
                    }}
                    rowName={rowName(
                        rows[popoverRow]!.marcherIds,
                        rows[popoverRow]!.label,
                    )}
                    // Where the row faces as the turn starts: the turn's own start, which an
                    // instant turn has no bar for
                    fromDegrees={
                        show.compiled
                            .segments(
                                rows[popoverRow]!.marcherIds[0]!,
                                "facing",
                            )
                            .find(
                                (seg) =>
                                    seg.cueId === popoverCueId &&
                                    seg.kind === "transition",
                            )?.fromDegrees ?? popoverPiece.fromDegrees
                    }
                    whereOf={(count) => {
                        const where = beatWhere(
                            countToSpecBeat(count, show.beatIds, specOf),
                            pageBoxes,
                        );
                        return where ? translateTimelineText(where) : "";
                    }}
                    anchor={{
                        x: xOf(popoverPiece.from),
                        y: HEADER + popoverRow * ROW + ROW,
                    }}
                    onClose={() => useTurnPopoverStore.getState().close()}
                />
            )}
        </div>
    );
}

/** A row's name: selects its performers */
function RowName({ row, name }: { row: FacingRow; name: string }) {
    const { t } = useTranslate();
    return (
        <button
            type="button"
            data-testid="facing-lane-row-name"
            title={t("cues.lane.selectRow")}
            className="bg-bg-1/80 text-micro text-text hover:text-accent touch:min-h-44 sticky left-0 z-[5] flex h-full max-w-160 items-center gap-4 truncate rounded-full px-6 backdrop-blur-sm"
            onClick={() => activeFieldEditor()?.select(row.marcherIds)}
        >
            <span className="truncate">{name}</span>
            <span className="text-text-subtitle">{row.marcherIds.length}</span>
        </button>
    );
}

/** The diamond that marks a cue on its count, in px */
const DIAMOND_PX = 13;
/** The tab on an instant cue's diamond that pulls out a turn, in px */
const TAB_W = 12;
const TAB_H = 18;
/** About how wide a character of a lane label is, in px, to pick the label that fits */
const LABEL_CHAR_PX = 6;

/**
 * One piece of a row (fork #993):
 *
 * - **A turn** is a pale bar with a dashed edge, labelled with how far and how long it turns
 *   ("↻ 180° · 2 counts"). Anything on it changes the turn's length: dragging it, or its left
 *   edge, moves where the turn starts (the cue stays on its count). Double-click opens the dial.
 * - **A result** (the hold from the cue's count) is solid. Dragging it moves the cue, its turn
 *   coming along at the same length. A diamond marks the cue on its count, and drags the same
 *   way; an instant cue's diamond has a tab on its left that pulls a turn out.
 * - **The front before any cue** is dashed, and is empty lane space.
 */
function FacingBar({
    piece,
    left,
    width,
    label,
    fullLabel,
    instant,
    dragging,
    picked,
    lockedReason,
    onPress,
    onMenu,
    onOpen,
}: {
    piece: FacingPiece;
    left: number;
    width: number;
    label: string;
    /** The whole label, for the tooltip, where `label` is cut short to fit */
    fullLabel: string;
    /** A result whose cue has no turn: its diamond shows the tab that pulls one out */
    instant: boolean;
    dragging: boolean;
    picked: boolean;
    lockedReason?: string;
    onPress: (e: ReactPointerEvent<HTMLElement>, mode: LaneDragMode) => void;
    onMenu: (clientX: number, clientY: number) => void;
    onOpen: () => void;
}) {
    const { t } = useTranslate();
    const isCue = piece.cueId !== null;
    const turn = piece.kind === "turn";
    const longPress = useLongPressMenu(onMenu);
    const drawnWidth = Math.max(width - 1, 4);
    const editable = isCue && !lockedReason;
    /** A press on the bar: a turn changes its length, a result moves the cue */
    const press = (e: ReactPointerEvent<HTMLElement>, mode: LaneDragMode) => {
        e.stopPropagation();
        onPress(e, mode);
        longPress.start(e);
    };
    return (
        <div
            data-testid={
                isCue
                    ? turn
                        ? "facing-lane-turn"
                        : "facing-lane-hold"
                    : "facing-lane-default"
            }
            data-cue-id={piece.cueId ?? undefined}
            data-degrees={piece.degrees}
            data-timeline-interactive={isCue ? "" : undefined}
            title={isCue ? (lockedReason ?? fullLabel) : fullLabel}
            className={clsx(
                "text-micro rounded-4 absolute top-2 flex items-center leading-none whitespace-nowrap",
                isCue
                    ? clsx(
                          "text-text touch-none font-medium",
                          turn
                              ? "border-accent justify-center border border-dashed px-2"
                              : "bg-accent/40 px-4",
                          editable &&
                              (turn ? "cursor-ew-resize" : "cursor-grab"),
                      )
                    : "border-stroke text-text-subtitle border border-dashed px-4",
                picked && "ring-accent ring-2",
                dragging && "z-[6] cursor-grabbing opacity-90 shadow-lg",
            )}
            style={{
                left,
                width: drawnWidth,
                height: ROW - 4,
                ...(turn
                    ? {
                          backgroundColor:
                              "color-mix(in srgb, var(--color-accent) 22%, var(--color-bg-1))",
                      }
                    : {}),
            }}
            {...(isCue
                ? longPress.handlers
                : {
                      onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
                          e.preventDefault();
                          e.stopPropagation();
                      },
                  })}
            onDoubleClick={isCue ? onOpen : undefined}
            onPointerDown={(e) => {
                // The front before any cue is empty lane space: its press is the timeline's
                if (!isCue) return;
                press(e, turn ? "turnStart" : "move");
            }}
        >
            <span className={clsx("min-w-0 truncate", !turn && "pl-8")}>
                {label}
            </span>
            {turn && editable && (
                // The turn's left edge: where it starts, the one handle for its length
                <span
                    data-testid="facing-lane-turn-start"
                    data-timeline-interactive=""
                    title={t("cues.lane.dragTurnStart")}
                    aria-label={t("cues.lane.dragTurnStart")}
                    className="group/resize absolute top-0 z-[1] h-full cursor-ew-resize touch-none"
                    style={{ left: -GRIP_PX / 2, width: GRIP_PX }}
                    onPointerDown={(e) => press(e, "turnStart")}
                >
                    <span
                        className={clsx(
                            "bg-text/60 pointer-events-none absolute inset-y-[2px] left-[2px] hidden w-[2px] rounded-full group-hover/resize:block",
                            picked && "touch:block",
                        )}
                    />
                    {picked && (
                        <TouchHitArea
                            selected
                            className="touch:block pointer-events-auto absolute top-1/2 hidden h-full min-h-44 -translate-y-1/2"
                            style={{
                                width: TOUCH_HIT_SIZE,
                                left: GRIP_PX / 2 - TOUCH_HIT_SIZE / 2,
                            }}
                        />
                    )}
                </span>
            )}
            {isCue && !turn && (
                // The cue on its count: drag it to move the cue
                <span
                    data-testid="facing-lane-diamond"
                    data-timeline-interactive=""
                    title={lockedReason ?? t("cues.lane.dragCue")}
                    aria-label={t("cues.lane.dragCue")}
                    className={clsx(
                        "bg-text ring-bg-1 absolute top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2",
                        editable && "cursor-grab",
                    )}
                    style={{
                        left: 0,
                        width: DIAMOND_PX * 0.72,
                        height: DIAMOND_PX * 0.72,
                    }}
                    onPointerDown={(e) => press(e, "move")}
                />
            )}
            {isCue && !turn && instant && editable && (
                // An instant cue's tab: pull it left to turn over the counts before
                <span
                    data-testid="facing-lane-turn-tab"
                    data-timeline-interactive=""
                    title={t("cues.lane.dragToTurn")}
                    aria-label={t("cues.lane.dragToTurn")}
                    className="text-text-subtitle hover:text-text border-text-subtitle rounded-l-4 absolute top-1/2 z-[1] flex -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center border border-r-0 leading-none"
                    style={{
                        left: -DIAMOND_PX / 2 - TAB_W + 1,
                        width: TAB_W,
                        height: TAB_H,
                    }}
                    onPointerDown={(e) => press(e, "resultStart")}
                >
                    ◂
                    {picked && (
                        <TouchHitArea
                            selected
                            className="touch:block pointer-events-auto absolute top-1/2 hidden h-full min-h-44 -translate-y-1/2"
                            style={{ width: TOUCH_HIT_SIZE, right: 0 }}
                        />
                    )}
                </span>
            )}
        </div>
    );
}

/**
 * A turn's words for its bar: which way and how far it turns (To minus From, signed) and its
 * counts, "↺ 180° · 2 counts", then "↺ 180°", then the icon alone, whichever fits `width` px;
 * and the whole words, for its tooltip. A positive angle turns to the performers' own left, which
 * is anticlockwise as the dial draws it (front at the bottom, side 2 to the right): ↺. Negative is ↻.
 */
export function turnBarLabel(
    piece: Pick<FacingPiece, "fromDegrees" | "degrees" | "from" | "to">,
    width: number,
    words: {
        full: (icon: string, amount: string, counts: number) => string;
        short: (icon: string, amount: string) => string;
    },
): { label: string; fullLabel: string } {
    const turned = piece.degrees - piece.fromDegrees;
    const icon = turned < 0 ? "↻" : "↺";
    const amount = formatDegrees(turned);
    const counts = Math.round(piece.to - piece.from);
    const fits = (text: string) => text.length * LABEL_CHAR_PX + 8 <= width;
    const full = words.full(icon, amount, counts);
    if (fits(full)) return { label: full, fullLabel: full };
    const short = words.short(icon, amount);
    return { label: fits(short) ? short : icon, fullLabel: full };
}

/** A turn's mark in the folded lane: a diamond. Click picks, right-click or long press opens its menu */
function TurnMark({
    cueId,
    left,
    picked,
    label,
    onPick,
    onMenu,
    onOpen,
}: {
    cueId: number;
    left: number;
    picked: boolean;
    label: string;
    onPick: () => void;
    onMenu: (clientX: number, clientY: number) => void;
    onOpen: () => void;
}) {
    const longPress = useLongPressMenu(onMenu);
    return (
        <button
            type="button"
            data-testid="facing-lane-mark"
            data-cue-id={cueId}
            data-timeline-interactive=""
            aria-label={label}
            title={label}
            className="touch:size-44 absolute top-4 flex size-16 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
            style={{ left }}
            {...longPress.handlers}
            onDoubleClick={onOpen}
            onPointerDown={(e) => {
                e.stopPropagation();
                onPick();
                longPress.start(e);
            }}
        >
            <span
                className={clsx(
                    "bg-accent/60 size-8 rotate-45",
                    picked && "ring-accent ring-2",
                )}
            />
        </button>
    );
}

/** The commands a Facing cue's menu offers */
const FACING_MENU_ACTIONS: readonly ActionId[] = [
    "cueEditTurn",
    "cueAddSelected",
    "cueRemoveSelected",
    "cueMoveToPlayhead",
    "cueEndAtPlayhead",
    "cueDelete",
];

const menuSnapshot = () =>
    FACING_MENU_ACTIONS.map(
        (id) =>
            `${isActionEnabled(id) ? 1 : 0}${isActionChecked(id) ? 1 : 0}${actionDisabledReason(id) ?? ""}`,
    ).join("\n");

/** A Facing cue's menu: Edit turn…, the cue commands (on the picked cue), and selecting its performers */
function FacingMenuView({
    menu,
    show,
    heading,
    onClose,
}: {
    menu: CueMenu;
    show: EditorCues;
    heading: string;
    onClose: () => void;
}) {
    const { t } = useTranslate();
    // Opened by the press that picks the cue: the commands catch up a moment later
    useSyncExternalStore(subscribeToActionHandlers, menuSnapshot);
    const cue = show.cues.find((c) => c.id === menu.cueId);
    const label = (id: ActionId) =>
        getActionLabel(id, (key, params) => t(key, params as never));
    const item = (id: ActionId) => {
        const reason = isActionEnabled(id)
            ? null
            : (actionDisabledReason(id) ?? undefined);
        if (reason === undefined) return null;
        return (
            <MenuItemWithReason
                key={id}
                testId={`facing-menu-${id}`}
                reason={reason}
                reasonTestId={`facing-menu-${id}-reason`}
                onSelect={() => runAction(id)}
            >
                {label(id)}
            </MenuItemWithReason>
        );
    };
    return (
        <DropdownMenu.Root
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DropdownMenu.Trigger asChild>
                <div
                    aria-hidden
                    className="pointer-events-none absolute h-0 w-0"
                    style={{ left: menu.x, top: menu.y }}
                />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-testid="facing-menu"
                    align="start"
                    collisionPadding={8}
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    {cue && (
                        <DropdownMenu.Label
                            data-testid="facing-menu-heading"
                            className={MENU_LABEL_CLASS}
                        >
                            {heading}
                        </DropdownMenu.Label>
                    )}
                    {item("cueEditTurn")}
                    <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                    {item("cueAddSelected")}
                    {item("cueRemoveSelected")}
                    <DropdownMenu.Item
                        data-testid="facing-menu-select"
                        disabled={!cue}
                        onSelect={() =>
                            cue && activeFieldEditor()?.select(cue.marcherIds)
                        }
                        className={MENU_ITEM_CLASS}
                    >
                        {t("cues.lane.selectPerformers")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                    {item("cueMoveToPlayhead")}
                    {item("cueEndAtPlayhead")}
                    <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                    {item("cueDelete")}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
