/**
 * The timeline's Facing lane (fork #993; one row of keyframes, #1315), under the Equipment lane:
 *
 * - **Keyframes.** Its top row has one diamond per count where anyone's facing changes. Cues for
 *   different performers on one count (different groups, different turn lengths) share it; its
 *   tooltip says how many. Click a diamond to select who changes there, as a movie editor selects
 *   a keyframe's layers; Shift-click (or the touch pill's Add) adds them, or takes them out when
 *   they're all selected already. Drag it to move every cue on that count, each keeping its turn.
 *   Right-click or long-press it for its cue's menu, or, where several cues share it, to select
 *   one group. Double-click a diamond with one cue for its turn popover.
 * - **The selection's turns.** With performers selected, a row for each group of them with its
 *   own Facing history (a striped bar where they turn, a solid one where they hold an angle),
 *   edited as before: click a bar to pick its cue (the cue commands act on it) and select its
 *   counts; right-click or long-press it for its menu; double-click it, or choose Edit turn…, for
 *   the turn popover. A cue is its result on its count; its turn leads into it. Drag a bar or its
 *   diamond to move the cue (its turn goes with it), with the timeline's edge snapping. Drag the
 *   start of the turn, or an instant cue's tab, to the left to set where the turn starts: the turn
 *   grows backwards and the hold before it shrinks. Dragged back to the cue's count it's instant;
 *   it never starts before the cue before it. Nothing selected, the lane is its keyframes alone.
 * - **Edits follow the selection (#1318).** With only some of a cue's performers selected, an edit
 *   to its row (a drag, the turn popover, Move cue to playhead) changes only them: they split off
 *   into a cue of their own. The row's name says how many are selected ("Trumpets 3 of 12"); a
 *   click on it selects them all. After a split the rest of the old cue keeps a dimmed, read-only
 *   row under the selection's until the selection changes; a click on its name selects them.
 * - A press on empty lane space is the timeline's, as on the audio lane.
 */
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { EyeSlashIcon } from "@phosphor-icons/react";
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
import {
    equipmentSetIsEmpty,
    planCuesMove,
    withEquipmentSet,
} from "@/cues/equipment";
import {
    facingLane,
    facingRowsFor,
    formatDegrees,
    selectionAfterKeyClick,
    turnLabel,
    type FacingDirection,
    type FacingKey,
    type FacingLaneData,
    type FacingPiece,
    type FacingRow,
} from "@/cues/facing";
import { compileShowCues } from "@/cues/showCues";
import {
    cueLandedFor,
    partOf,
    planFacingEdit,
    selectionKey,
    useFacingSplitStore,
    useSplitRest,
} from "@/cues/facingSplit";
import { countToSpecBeat } from "@/cues/equipmentLane";
import { useShowCues, type EditorCues } from "@/cues/useShowCues";
import { pickedCueIn, useCueSelectionStore } from "@/cues/cueSelectionStore";
import { describePerformers } from "@/cues/cueLabel";
import { cueChangeEdit, relabelIn } from "@/cues/useCueCommands";
import { useTurnPopoverStore } from "@/cues/turnPopoverStore";
import { editCuesMutationOptions, type CueEdit } from "@/hooks/queries/useCues";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { isPerformer } from "@/global/classes/Marcher";
import { createTimelineBeatAxis } from "@/timeline/timelineViewModel";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useFieldProperties } from "@/field/editMode/useApplyFieldEdits";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { isShiftHeld } from "@/stores/TouchModifierStore";
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
import { useLaneShown } from "@/timeline/timelineLanes";
import { useLaneReveal } from "@/timeline/laneReveal";
import { useLaneNameMenu } from "./LanesMenu";
import {
    DRAG_SLOP_PX,
    EMPTY,
    HEADER,
    PAD,
    ROW,
    useLongPressMenu,
} from "./cueLaneParts";
import { TurnPopover } from "./TurnPopover";

/** A second click this soon after a bar's click is a double-click (the popover's) */
const DOUBLE_CLICK_MS = 600;

/** The grip where a turn starts: drawn 6 px wide, astride the edge */
const GRIP_PX = 6;

/**
 * The lane's height: its header, then its keyframes and a row per group of the selection and of
 * a split's rest (`rows`), or the empty hint
 */
export function facingLaneHeight(
    lane: FacingLaneData | null,
    rows: number,
): number {
    if (!lane || lane.keys.length === 0) return HEADER + EMPTY + PAD;
    return HEADER + ROW + rows * ROW + PAD;
}

/**
 * The dimmed rows of the cue a split left behind (`useSplitRest`): the groups `restIds` are in
 * that the selection's rows don't already draw
 */
export function restRowsFor(
    rows: readonly FacingRow[],
    shown: readonly FacingRow[],
    restIds: readonly number[],
): readonly FacingRow[] {
    if (restIds.length === 0) return [];
    return facingRowsFor(rows, restIds).filter((r) => !shown.includes(r));
}

/** The selected performers' ids, items left out, kept the same while the selection is */
function useSelectedPerformerIds(): readonly number[] {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const key = (selected ?? [])
        .filter(isPerformer)
        .map((m) => m.id)
        .sort((a, b) => a - b)
        .join(",");
    return useMemo(() => (key === "" ? [] : key.split(",").map(Number)), [key]);
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
    const show = useShowCues();
    const beats = useTimingObjects()?.beats;
    const selectedIds = useSelectedPerformerIds();
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
    const restIds = useSplitRest(selectedIds);
    const shownRows = lane ? facingRowsFor(lane.rows, selectedIds) : [];
    const rowCount = lane
        ? shownRows.length + restRowsFor(lane.rows, shownRows, restIds).length
        : 0;
    return useMemo(
        () => ({
            height: shown && beats ? facingLaneHeight(lane, rowCount) : 0,
            render: (geometry: TimelineBandGeometry) =>
                shown && beats ? (
                    <FacingLaneView
                        geometry={geometry}
                        lane={lane}
                        show={show}
                        beats={beats}
                        selectedIds={selectedIds}
                    />
                ) : null,
        }),
        [shown, lane, rowCount, show, beats, selectedIds],
    );
}

/** A drag in progress: the cues it moves or turns, and what the drop would write */
type LaneDrag = { cueIds: readonly number[]; edit: CueEdit | null };
/**
 * What a press on a cue drags: the cue (its result or diamond), where its turn starts (its turn),
 * or a new turn out of an instant cue (the diamond's tab)
 */
type LaneDragMode = "move" | "resultStart" | "turnStart";
type CueMenu = { x: number; y: number; cueId: number };
/** The menu of a keyframe several cues share */
type KeyMenu = { x: number; y: number; count: number };

/** Selects `ids` on the field, as the field's own click would */
const selectPerformers = (ids: readonly number[]) =>
    activeFieldEditor()?.select(ids);

export function FacingLaneView({
    geometry,
    lane,
    show,
    beats,
    selectedIds,
}: {
    geometry: TimelineBandGeometry;
    lane: FacingLaneData | null;
    show: EditorCues | null;
    beats: readonly { id: number; duration: number; position: number }[];
    /** The selected performers: the lane draws their groups' rows */
    selectedIds: readonly number[];
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
    const [keyMenu, setKeyMenu] = useState<KeyMenu | null>(null);
    const [drag, setDrag] = useState<LaneDrag | null>(null);
    // After an edit, pick the cue its performers landed in, so the next edit acts on them (and
    // reopen the turn popover there when the edit came from it)
    const landing = useFacingSplitStore((s) => s.follow);
    useEffect(() => {
        if (!landing || !show) return;
        const landed = cueLandedFor(show.cues, landing.ids, landing.beatId);
        if (!landed) return;
        useFacingSplitStore.getState().followed();
        pickCue(landed);
        if (landing.popover) useTurnPopoverStore.getState().open(landed.id);
    }, [landing, show, pickCue]);
    // A split's rest stays drawn until the selection changes
    const restSelection = useFacingSplitStore((s) => s.rest?.selection);
    const selectionNow = selectionKey(selectedIds);
    useEffect(() => {
        if (restSelection !== undefined && restSelection !== selectionNow)
            useFacingSplitStore.getState().clearRest();
    }, [restSelection, selectionNow]);
    const rootRef = useRef<HTMLDivElement>(null);
    // A cue just set shows the lane, below the fold or not
    useLaneReveal("facing", rootRef);
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
        // A split's new cue is drawn too, under a stand-in id
        const cues = withEquipmentSet(show.cues, drag.edit).concat(
            drag.edit.newCues.map((n, i) => ({
                id: -1 - i,
                type: n.type,
                beatId: n.beatId,
                value: n.value,
                settings: n.settings ?? {},
                length: n.length ?? null,
                transition: n.transition ?? null,
                marcherIds: [...n.marcherIds],
                label: n.label ?? null,
                notes: n.notes ?? null,
                createdAt: "",
                updatedAt: "",
            })),
        );
        return facingLane({
            compiled: compileShowCues(show.marchers, beats, cues).compiled,
            cues,
            marcherIds: show.marchers.filter(isPerformer).map((m) => m.id),
        });
    }, [drag, show, beats]);
    const shownLane = previewLane ?? lane;
    const allRows = shownLane?.rows ?? [];
    const keys = shownLane?.keys ?? [];
    const rows = facingRowsFor(allRows, selectedIds);
    const restIds = useSplitRest(selectedIds);
    const restRows = restRowsFor(allRows, rows, restIds);
    const selected = new Set(selectedIds);
    const words = {
        performers: (n: number) => t("cues.label.performers", { count: n }),
    };
    const rowName = (ids: readonly number[], label: string | null) =>
        label ??
        describePerformers({ ids, marchers: show?.marchers ?? [], words });
    /** A cue's menu heading: where it turns them, then who it's for ("Side 2 · 90° · Trumpets") */
    const cueHeading = (cueId: number) => {
        const cue = show?.cues.find((c) => c.id === cueId);
        const row = allRows.find((r) =>
            r.pieces.some((p) => p.cueId === cueId),
        );
        const hold = row?.pieces.find(
            (p) => p.cueId === cueId && p.kind === "hold",
        );
        if (!cue) return "";
        return t("cues.lane.menuHeading", {
            value: hold ? turnLabel(hold, names) : "",
            name: rowName(cue.marcherIds, cue.label),
        });
    };
    /** A keyframe's words: its one cue's heading, or how many cues share it and for whom */
    const keyLabel = (key: FacingKey) =>
        key.cueIds.length === 1
            ? cueHeading(key.cueIds[0]!)
            : t("cues.lane.keyShared", {
                  count: key.cueIds.length,
                  names: key.cueIds
                      .map((id) => {
                          const cue = show?.cues.find((c) => c.id === id);
                          return cue ? rowName(cue.marcherIds, cue.label) : "";
                      })
                      .join(", "),
              });

    const openMenu = (cueId: number, clientX: number, clientY: number) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        pick(cueId);
        setMenu({ x: clientX - rect.left, y: clientY - rect.top, cueId });
    };
    const openKeyMenu = (key: FacingKey, clientX: number, clientY: number) => {
        if (key.cueIds.length === 1) {
            openMenu(key.cueIds[0]!, clientX, clientY);
            return;
        }
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        setKeyMenu({
            x: clientX - rect.left,
            y: clientY - rect.top,
            count: key.count,
        });
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

    /** Where a drag from view beat `view` by `offset` beats lands, with the timeline's edge snapping, as an offset */
    const snapper = () => {
        const playhead = axis.toView(
            useTimelineSelectionStore.getState().playheadBeat,
        );
        return (ev: PointerEvent, view: number, offset: number) =>
            snapEdgeBeat({
                beat: view + offset,
                pageBeats: geometry.pageBeats ?? geometry.snapBeats,
                downbeats: geometry.downbeats ?? [],
                playheadBeat: playhead,
                pixelsPerBeat: ppb,
                snapDisabled: isPageSnapDisabled(ev),
                from: view,
            }) - view;
    };

    /**
     * Follows a press past the slop as a drag (`plan` gives what the drop would write, drawn as
     * the preview) and writes it on release as one undo step; short of the slop, `onClick`.
     */
    const follow = (
        e: ReactPointerEvent<HTMLElement>,
        cueIds: readonly number[],
        plan: ((ev: PointerEvent) => CueEdit | null) | null,
        onClick: () => void,
        /** Before the drop's write goes (a split tells the lane what it did) */
        onWrite?: () => void,
    ) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const slop = fingerDragSlop(e.pointerType, DRAG_SLOP_PX);
        let dragging = false;
        let planned: CueEdit | null = null;
        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== e.pointerId || !plan) return;
            if (!dragging && Math.abs(ev.clientX - startX) < slop) return;
            dragging = true;
            planned = plan(ev);
            setDrag({ cueIds, edit: planned });
        };
        const done = (commit: boolean) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            if (commit && !dragging) onClick();
            const write = dragging && commit ? planned : null;
            if (!write) {
                setDrag(null);
                return;
            }
            onWrite?.();
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
        const landAt = snapper();
        const startX = e.clientX;
        // Only some of its performers selected, the edit is theirs alone: they split off (#1318)
        const part = partOf(cue, selectedIds);
        let landsOn = cue.beatId;
        const change = (c: { beatId?: number; transition?: number | null }) => {
            landsOn = c.beatId ?? cue.beatId;
            return part
                ? planFacingEdit({
                      cues: show.cues,
                      cueId,
                      part,
                      change: c,
                      relabelFor: relabelIn(show, words),
                  })
                : cueChangeEdit(show, cueId, c, words);
        };
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
                    : change({ beatId: beats[at + delta]!.id });
            }
            // The result's start begins the turn from the cue's count; the turn's, from its start
            const origin = mode === "resultStart" ? at : turnStart;
            const turned = turnStartDrag({
                count: at,
                transition: mode === "resultStart" ? null : cue.transition,
                floor,
                delta: landAt(ev, axis.toView(origin), offset),
            });
            return turned.transition === cue.transition
                ? null
                : change({ transition: turned.transition });
        };
        const ctrl = e.ctrlKey || e.metaKey;
        const onWrite = part
            ? () =>
                  useFacingSplitStore.getState().edited({
                      part,
                      beatId: landsOn,
                      rest: cue.marcherIds.filter((id) => !part.includes(id)),
                      selectedIds,
                      popover: false,
                  })
            : undefined;
        follow(
            e,
            [cueId],
            plan,
            () => {
                // A click selects the cue's counts, as a move's bar does (not with Ctrl or Cmd)
                if (ctrl) return;
                // A double-click's second click keeps what the first found: by then the first has
                // moved the playhead
                const now = performance.now();
                const earlier = beforeClick.current;
                if (!earlier || now - earlier.at >= DOUBLE_CLICK_MS) {
                    const { startBeat, playheadBeat } =
                        useTimelineSelectionStore.getState();
                    beforeClick.current = { at: now, startBeat, playheadBeat };
                }
                geometry.onSelectRange?.({
                    startBeatIndex: axis.toView(turnStart),
                    endBeatIndex: axis.toView(until),
                });
            },
            onWrite,
        );
    };

    /**
     * A press on a keyframe: a click selects who changes there (Shift, or the touch pill's Add,
     * adds them) and picks its cue when it has one; a drag moves every cue on its count, each
     * keeping its turn, as one undo step.
     */
    const pressKey = (e: ReactPointerEvent<HTMLElement>, key: FacingKey) => {
        if (!show || e.button !== 0) return;
        const first = show.cues.find((c) => c.id === key.cueIds[0]);
        const at = first ? specOf.get(first.beatId) : undefined;
        if (at === undefined) return;
        const add = isShiftHeld(e);
        const landAt = snapper();
        const startX = e.clientX;
        const plan = (ev: PointerEvent): CueEdit | null => {
            const delta = clamp(
                landAt(ev, axis.toView(at), (ev.clientX - startX) / ppb),
                1 - at,
                beats.length - 1 - at,
            );
            if (delta === 0) return null;
            const moved = planCuesMove({
                cues: show.cues,
                cueIds: key.cueIds,
                beatId: beats[at + delta]!.id,
                relabelFor: relabelIn(show, words),
            });
            return equipmentSetIsEmpty(moved) ? null : moved;
        };
        follow(e, key.cueIds, isPlaying ? null : plan, () =>
            activateKey(key, add),
        );
    };
    /** A keyframe's click: selects who changes there, and picks its cue when it has one */
    const activateKey = (key: FacingKey, add: boolean) => {
        pick(key.cueIds.length === 1 ? key.cueIds[0]! : null);
        selectPerformers(selectionAfterKeyClick(selectedIds, key, add));
    };

    const nameMenu = useLaneNameMenu("facing");
    const height = facingLaneHeight(lane, rows.length + restRows.length);
    const lockedReason = isPlaying ? t("cues.reason.pausedFacing") : undefined;
    // The turn popover, at its cue's bar when its row shows, else at its keyframe
    const popoverRow = rows.findIndex((r) =>
        r.pieces.some((p) => p.cueId === popoverCueId),
    );
    const popoverCue =
        popoverCueId === null
            ? undefined
            : show?.cues.find((c) => c.id === popoverCueId);
    const popoverKey = keys.find(
        (k) => popoverCueId !== null && k.cueIds.includes(popoverCueId),
    );
    const popoverPiece =
        popoverRow >= 0
            ? rows[popoverRow]!.pieces.find((p) => p.cueId === popoverCueId)
            : undefined;
    const popoverPart = popoverCue ? partOf(popoverCue, selectedIds) : null;
    // Who it turns, on the lane: the first of them faces as they all do
    const popoverFirst = popoverCue?.marcherIds.find((id) =>
        allRows.some((r) => r.marcherIds.includes(id)),
    );
    const sharedKey =
        keyMenu === null
            ? undefined
            : keys.find((k) => k.count === keyMenu.count);
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
                <span className="text-text pl-4 font-medium">
                    {t("cues.lane.facing")}
                </span>
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
            {keys.length === 0 ? (
                <div
                    className="text-micro text-text-subtitle sticky left-0 flex w-fit items-center px-24"
                    style={{ height: EMPTY }}
                >
                    {t("cues.lane.facingEmpty")}
                </div>
            ) : (
                <>
                    <div
                        data-testid="facing-lane-keys"
                        className="relative"
                        style={{ height: ROW }}
                    >
                        {keys.map((key) => (
                            <KeyMark
                                key={key.count}
                                keyframe={key}
                                left={xOf(key.count)}
                                active={
                                    selected.size === 0 ||
                                    key.marcherIds.some((id) =>
                                        selected.has(id),
                                    )
                                }
                                picked={
                                    picked !== null &&
                                    key.cueIds.includes(picked)
                                }
                                dragging={
                                    drag !== null &&
                                    key.cueIds.some((id) =>
                                        drag.cueIds.includes(id),
                                    )
                                }
                                label={keyLabel(key)}
                                hint={t(
                                    lockedReason
                                        ? "cues.lane.keyHintPlaying"
                                        : "cues.lane.keyHint",
                                )}
                                onPress={(e) => pressKey(e, key)}
                                onActivate={(add) => activateKey(key, add)}
                                onMenu={(x, y) => openKeyMenu(key, x, y)}
                                onOpen={() =>
                                    key.cueIds.length === 1 &&
                                    openPopover(key.cueIds[0]!)
                                }
                            />
                        ))}
                    </div>
                    {rows.map((row) => (
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
                                              fullLabel: turnLabel(
                                                  piece,
                                                  names,
                                              ),
                                          })}
                                    instant={
                                        !row.pieces.some(
                                            (p) =>
                                                p.cueId === piece.cueId &&
                                                p.kind === "turn",
                                        )
                                    }
                                    dragging={
                                        drag !== null &&
                                        piece.cueId !== null &&
                                        drag.cueIds.includes(piece.cueId)
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
                                selected={selected}
                            />
                        </div>
                    ))}
                    {restRows.map((row) => (
                        // The rest of a cue the selection split off: drawn to show the split,
                        // not edited here (#1318)
                        <div
                            key={row.key}
                            data-testid="facing-lane-rest-row"
                            data-marchers={row.marcherIds.join(",")}
                            className="relative"
                            style={{ height: ROW }}
                        >
                            <div className="pointer-events-none opacity-50">
                                {row.pieces.map((piece) => (
                                    <FacingBar
                                        key={`${piece.from}-${piece.kind}-${piece.cueId ?? "d"}`}
                                        piece={piece}
                                        left={xOf(piece.from)}
                                        width={xOf(piece.to) - xOf(piece.from)}
                                        {...(piece.kind === "turn"
                                            ? turnBarLabel(
                                                  piece,
                                                  xOf(piece.to) -
                                                      xOf(piece.from),
                                                  turnWords,
                                              )
                                            : {
                                                  label: turnLabel(
                                                      piece,
                                                      names,
                                                  ),
                                                  fullLabel: turnLabel(
                                                      piece,
                                                      names,
                                                  ),
                                              })}
                                        instant={false}
                                        dragging={false}
                                        picked={false}
                                        readOnly
                                        onPress={() => {}}
                                        onMenu={() => {}}
                                        onOpen={() => {}}
                                    />
                                ))}
                            </div>
                            <RowName
                                row={row}
                                name={rowName(row.marcherIds, row.label)}
                                selected={selected}
                                rest
                            />
                        </div>
                    ))}
                </>
            )}
            {menu && show && (
                <FacingMenuView
                    menu={menu}
                    show={show}
                    heading={cueHeading(menu.cueId)}
                    onClose={() => setMenu(null)}
                />
            )}
            {keyMenu && sharedKey && show && (
                <KeyMenuView
                    menu={keyMenu}
                    heading={keyLabel(sharedKey)}
                    groups={sharedKey.cueIds.flatMap((id) => {
                        const cue = show.cues.find((c) => c.id === id);
                        return cue
                            ? [{ cueId: id, label: cueHeading(id) }]
                            : [];
                    })}
                    onSelectAll={() => {
                        pick(null);
                        selectPerformers(sharedKey.marcherIds);
                    }}
                    onSelectGroup={(cueId) => {
                        const cue = show.cues.find((c) => c.id === cueId);
                        pick(cueId);
                        if (cue) selectPerformers(cue.marcherIds);
                    }}
                    onClose={() => setKeyMenu(null)}
                />
            )}
            {popoverCue &&
                popoverCueId !== null &&
                show &&
                popoverFirst !== undefined &&
                (popoverPiece || popoverKey) && (
                    <TurnPopover
                        cueId={popoverCueId}
                        show={show}
                        names={names}
                        dialNames={{
                            ...names,
                            side1: sides?.terseLeft ?? "S1",
                            side2: sides?.terseRight ?? "S2",
                        }}
                        rowName={
                            // Only some of its performers selected, the dial edits only them
                            popoverPart
                                ? t("cues.lane.popoverPart", {
                                      name: rowName(popoverPart, null),
                                      part: popoverPart.length,
                                      count: popoverCue.marcherIds.length,
                                  })
                                : popoverRow >= 0
                                  ? rowName(
                                        rows[popoverRow]!.marcherIds,
                                        rows[popoverRow]!.label,
                                    )
                                  : rowName(
                                        popoverCue.marcherIds,
                                        popoverCue.label,
                                    )
                        }
                        // Where they face as the turn starts: the turn's own start, which an
                        // instant turn has no bar for
                        fromDegrees={
                            show.compiled
                                .segments(popoverFirst, "facing")
                                .find(
                                    (seg) =>
                                        seg.cueId === popoverCueId &&
                                        seg.kind === "transition",
                                )?.fromDegrees ??
                            popoverPiece?.fromDegrees ??
                            0
                        }
                        whereOf={(count) => {
                            const where = beatWhere(
                                countToSpecBeat(count, show.beatIds, specOf),
                                pageBoxes,
                            );
                            return where ? translateTimelineText(where) : "";
                        }}
                        anchor={
                            popoverPiece
                                ? {
                                      x: xOf(popoverPiece.from),
                                      y: HEADER + ROW + popoverRow * ROW + ROW,
                                  }
                                : {
                                      x: xOf(popoverKey!.count),
                                      y: HEADER + ROW,
                                  }
                        }
                        onClose={() => useTurnPopoverStore.getState().close()}
                    />
                )}
        </div>
    );
}

/**
 * A row's name: selects its performers. A row only some of whose performers are selected says
 * how many ("Trumpets 3 of 12", #1318): an edit there changes only them, and a click selects them
 * all. A split's `rest` row is dimmed.
 */
function RowName({
    row,
    name,
    selected,
    rest = false,
}: {
    row: FacingRow;
    name: string;
    selected: ReadonlySet<number>;
    rest?: boolean;
}) {
    const { t } = useTranslate();
    const count = row.marcherIds.length;
    const part = row.marcherIds.filter((id) => selected.has(id)).length;
    const partial = !rest && part > 0 && part < count;
    return (
        <button
            type="button"
            data-testid={
                rest ? "facing-lane-rest-name" : "facing-lane-row-name"
            }
            data-part={partial ? part : undefined}
            title={
                rest
                    ? t("cues.lane.restHint")
                    : partial
                      ? t("cues.lane.selectAllOf", { count })
                      : t("cues.lane.selectRow")
            }
            className={clsx(
                "bg-bg-1/80 text-micro text-text hover:text-accent touch:min-h-44 sticky left-0 z-[5] flex h-full max-w-200 items-center gap-4 truncate rounded-full px-6 backdrop-blur-sm",
                rest && "text-text-subtitle",
            )}
            onClick={() => activeFieldEditor()?.select(row.marcherIds)}
        >
            <span className="truncate">{name}</span>
            {partial ? (
                <span
                    data-testid="facing-lane-row-part"
                    className="text-accent font-medium"
                >
                    {t("cues.lane.partOf", { part, count })}
                </span>
            ) : (
                <span className="text-text-subtitle">{count}</span>
            )}
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
    readOnly = false,
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
    /** Drawn only, with no handles (a split's rest) */
    readOnly?: boolean;
    onPress: (e: ReactPointerEvent<HTMLElement>, mode: LaneDragMode) => void;
    onMenu: (clientX: number, clientY: number) => void;
    onOpen: () => void;
}) {
    const { t } = useTranslate();
    const isCue = piece.cueId !== null;
    const turn = piece.kind === "turn";
    const longPress = useLongPressMenu(onMenu);
    const drawnWidth = Math.max(width - 1, 4);
    const editable = isCue && !lockedReason && !readOnly;
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

/**
 * A keyframe on the lane's top row: a diamond on a count where anyone's facing changes, with how
 * many cues share it when it's more than one. Dim when performers are selected and none of them
 * changes here. A press selects or drags (`onPress`); right-click or long press opens its menu.
 */
function KeyMark({
    keyframe,
    left,
    active,
    picked,
    dragging,
    label,
    hint,
    onPress,
    onActivate,
    onMenu,
    onOpen,
}: {
    keyframe: FacingKey;
    left: number;
    active: boolean;
    picked: boolean;
    dragging: boolean;
    label: string;
    /** What a click and a drag do, under `label` in the tooltip */
    hint: string;
    onPress: (e: ReactPointerEvent<HTMLElement>) => void;
    /** Enter or Space on the focused diamond: what a click does */
    onActivate: (add: boolean) => void;
    onMenu: (clientX: number, clientY: number) => void;
    onOpen: () => void;
}) {
    const longPress = useLongPressMenu(onMenu);
    const shared = keyframe.cueIds.length;
    return (
        <button
            type="button"
            data-testid="facing-lane-key"
            data-count={keyframe.count}
            data-cues={keyframe.cueIds.join(",")}
            data-active={active ? "" : undefined}
            data-timeline-interactive=""
            aria-label={label}
            title={`${label}\n${hint}`}
            className="group/key touch:size-44 absolute top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center"
            style={{ left }}
            {...longPress.handlers}
            onDoubleClick={onOpen}
            // A click from the keyboard (no pointer press came first)
            onClick={(e) => {
                if (e.detail === 0) onActivate(e.shiftKey);
            }}
            onPointerDown={(e) => {
                e.stopPropagation();
                onPress(e);
                longPress.start(e);
            }}
        >
            <span
                className={clsx(
                    "ring-bg-1 rotate-45 ring-2 transition-colors duration-150",
                    active
                        ? "bg-text group-hover/key:bg-accent"
                        : "bg-text-subtitle/50 group-hover/key:bg-text-subtitle",
                    picked && "outline-accent outline-2 outline-offset-1",
                    dragging && "bg-accent",
                )}
                style={{ width: DIAMOND_PX * 0.72, height: DIAMOND_PX * 0.72 }}
            />
            {shared > 1 && (
                <span
                    data-testid="facing-lane-key-shared"
                    className={clsx(
                        "text-micro pointer-events-none absolute top-0 left-full -translate-x-2 leading-none font-medium",
                        active ? "text-text" : "text-text-subtitle",
                    )}
                >
                    {shared}
                </span>
            )}
        </button>
    );
}

/**
 * The menu of a keyframe several cues share: select everyone who changes there, or one cue's
 * performers (the touch path to one group, where a desktop Shift-clicks rows)
 */
function KeyMenuView({
    menu,
    heading,
    groups,
    onSelectAll,
    onSelectGroup,
    onClose,
}: {
    menu: KeyMenu;
    heading: string;
    groups: readonly { cueId: number; label: string }[];
    onSelectAll: () => void;
    onSelectGroup: (cueId: number) => void;
    onClose: () => void;
}) {
    const { t } = useTranslate();
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
                    data-testid="facing-key-menu"
                    align="start"
                    collisionPadding={8}
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    <DropdownMenu.Label className={MENU_LABEL_CLASS}>
                        {heading}
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                        data-testid="facing-key-menu-all"
                        onSelect={onSelectAll}
                        className={MENU_ITEM_CLASS}
                    >
                        {t("cues.lane.keySelectAll")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                    {groups.map((g) => (
                        <DropdownMenu.Item
                            key={g.cueId}
                            data-testid="facing-key-menu-group"
                            data-cue-id={g.cueId}
                            onSelect={() => onSelectGroup(g.cueId)}
                            className={MENU_ITEM_CLASS}
                        >
                            {t("cues.lane.keySelectGroup", { name: g.label })}
                        </DropdownMenu.Item>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
