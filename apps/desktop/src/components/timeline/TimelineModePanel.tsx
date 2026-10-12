import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee } from "@tolgee/react";
import {
    pageFlagMoveLimits,
    type AddedPageFlag,
    type PageFlagMoveBlock,
} from "@/db-functions/pageFlags";
import {
    deletePageFlagsMutationOptions,
    deletePagesWithMovesMutationOptions,
    movePageFlagMutationOptions,
    useAddPageFlag,
} from "@/hooks/queries/usePageFlags";
import { updatePagesMutationOptions } from "@/hooks/queries/usePages";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import { useTimingObjects } from "@/hooks";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { db } from "@/global/database/db";
import {
    displayedBeat,
    selectionIsRange,
    useTimelineSelectionStore,
    type TimelineEditSelection,
    type TimelineIsolation,
} from "@/stores/TimelineSelectionStore";
import {
    pageFlags,
    selectionOfPage,
    type FlagPage,
} from "@/timeline/timelinePlayhead";
import { useTimelineTracksState } from "@/timeline/useTimelineTracks";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import {
    useRetimeBeats,
    useSetTempoSyncedBeatIds,
    useTempoSyncedBeatIds,
} from "@/hooks/queries/useTempo";
import { durationsByBeatId } from "@/db-functions/tempo";
import {
    appendPageOfCountsMutationOptions,
    appendPagesToEndMutationOptions,
    extendCountsToMutationOptions,
} from "@/hooks/queries/useShowLength";
import { pageEndBeat } from "@/timeline/pageEndBeat";
import { AudioClock } from "./Clock";
import { TempoMapMenu } from "./TempoMapPanel";
import { useTempoMapState } from "./useTempoMapState";
import { countUnits, typedSections } from "@/timeline/tempo";
import {
    TimelineCompactButton,
    TimelineLoopButton,
    TimelineSoundButton,
    TimelineSpeedButton,
} from "./TimelineControls";
import { useTempoLabFlag, useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    Timeline,
    TimelineWaveformProvider,
    type TimelineAlign,
    type TimelineCountOverlay,
    type TimelineInput,
    type TimelineProps,
    type TimelinePunchTapConfig,
    type TimelineSelection,
} from "./Timeline";
import {
    useAudioEnvelopeStore,
    waveformWithPastEnd,
    WAVEFORM_FLOOR_DB,
} from "@/timeline/timelineWaveform";
import { createTimelineBeatAxis } from "@/timeline/timelineViewModel";
import { showEndTime, timeAtBeat } from "@/timeline/timeMap";
import {
    countContinuation,
    formatMinutesSeconds,
    musicEndSeconds,
    musicRunsPastCounts,
} from "@/timeline/showLength";
import {
    moveCommandBlocker,
    useMoveCommands,
    useTimelineCommands,
} from "./useTimelineCommands";
import { useTimelineClipResize } from "./useTimelineClipResize";
import { useTimelinePlayback } from "./useTimelinePlayback";
import { useTimelineMeasureRow } from "./useTimelineMeasureRow";
import { useTimelineDrillEdits } from "./useTimelineDrillEdits";
import {
    handlerDelaySeconds,
    LineUpStrip,
    TapTheBeatLaneButton,
    TapTimelineOverlay,
    useTapTheBeatStore,
} from "./TapTheBeat";
import { getLivePlaybackPosition } from "./audio/AudioPlayer";
import {
    jumpTimelinePlayback,
    loopBounds,
    startTimelinePlayOn,
} from "@/timeline/timelineTransport";
import { useLabeledHoldMarks } from "./PageHoldMark";
import { useTimelineHoldMarks } from "@/timeline/usePageHoldMarks";
import {
    useKeepToggle,
    useMarcherNameOf,
    usePageKeepStates,
} from "@/timeline/useKeepLaterPages";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { keepHereMenu, usePageKeepChains } from "./PageKeepChain";
import { describeMoveClips } from "./moveClipText";
import { useMoveNotesStore } from "@/stores/MoveNotesStore";
import { useClearLeftoverMoveSelection } from "./useMoveMemberSelection";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { useBasicLocksStore } from "@/timeline/basicLocks";
import { useBasicPoints } from "./useBasicPoints";
import type Page from "@/global/classes/Page";

const NO_WAVEFORM = { peaksByBeat: [] };
const NO_CLIPS: TimelineInput[] = [];

/**
 * Basic's marks on the page boxes (UI-19): the selected marchers' mid-page positions, with
 * **Remove this count's position**, and the Expert mark where marchers are locked.
 */
function useBasicTimelineExtras(pages: readonly Page[]) {
    const { points, removePoint } = useBasicPoints();
    const locked = useBasicLocksStore((s) => s.locked);
    const boxes = useBasicLocksStore((s) => s.boxes);
    return useMemo(() => {
        const names = new Map(
            pageFlags(pages).flatMap((f) =>
                f.range
                    ? [[`${f.range.start}:${f.range.end}`, f.page] as const]
                    : [],
            ),
        );
        const expertMarks = new Map<number, number>();
        boxes.forEach((box, index) => {
            const count = locked.get(index)?.size ?? 0;
            const page = names.get(`${box.start}:${box.end}`);
            if (count > 0 && page) expertMarks.set(page.id, count);
        });
        return {
            basicPoints: points.map((point) => ({
                beat: point.beat,
                label: `count ${point.beat - point.box.start} of page ${names.get(`${point.box.start}:${point.box.end}`)?.name ?? ""}`,
            })),
            onRemoveBasicPoint: (beat: number) => {
                const point = points.find((p) => p.beat === beat);
                if (point) removePoint(point);
            },
            expertMarks,
        };
    }, [pages, points, removePoint, locked, boxes]);
}

// The transport's controls read their own state: the same elements every render, so the
// memoized transport doesn't re-render for them
const SOUND_BUTTON = <TimelineSoundButton />;
const LOOP_BUTTONS = (
    <>
        <TimelineLoopButton />
        <TimelineSpeedButton />
    </>
);
const SPEED_BUTTON = <TimelineSpeedButton />;
const VIEW_CONTROLS = (
    <>
        <TempoMapMenu />
        <TimelineCompactButton />
    </>
);
const LINE_UP_STRIP = <LineUpStrip />;
const TAP_LANE_BUTTON = <TapTheBeatLaneButton />;

/** Tap the beat's preview and flash over the timeline (FB-5) */
const renderTapOverlay: TimelineCountOverlay = (geometry) => (
    <TapTimelineOverlay {...geometry} />
);

/** The store's selection as the timeline draws it (spec beats; `Timeline` maps them to its axis) */
export const toTimelineSelection = (
    selection: TimelineEditSelection,
    startBeat?: number,
    startPinned = false,
): TimelineSelection =>
    selection.kind === "range"
        ? {
              kind: "range",
              range: {
                  startBeatIndex: selection.start,
                  endBeatIndex: selection.end,
              },
              // UI-10: with P on or before S the window falls back, but the flag stays where it is
              ...(startBeat !== undefined && startBeat !== selection.start
                  ? { startFlagBeatIndex: startBeat }
                  : {}),
              ...(startPinned ? { startPinned: true } : {}),
          }
        : selection.kind === "home"
          ? { kind: "home" }
          : null;

/**
 * The timeline (ui.md, from the 0.2 branch). It takes the file's real beats, pages and measures, and plays through the app's existing audio clock. Its
 * selection is `useTimelineSelectionStore`'s (UI-9): the initial page box selects home, a page box
 * or a dragged range selects that range, and each seeks (home to beat 0, a range to its end).
 * **+** after the free paused playhead adds a page flag there and selects the new page; a page
 * box's right-click menu deletes its flag (P8.13's writes, wired by P8.15), or the page and its
 * moves (defined coordinates, owner decision 3). Neither Create Track
 * nor **Add selected marchers** is offered: dragging marchers adds them (UI-10). Double-clicking
 * a page box or clip isolates its stored timeline (docs/timeline/research/ownership/09-isolation.md).
 * A clip is a move: its menu, its ⋯ button and Delete edit, rename and delete it (UI-14).
 * The measure row edits rehearsal marks and measure lines (tempo E8, `useTimelineMeasureRow`).
 */
export default function TimelineModePanel() {
    const { beats, pages, measures } = useTimingObjects()!;
    // UI-19: Basic is this timeline with its page boxes holding the music, and none of the
    // Expert parts (clips, the loop, isolation, moves): docs/timeline/research/basic-mode
    const basic = useIsBasicMode();
    const basicExtras = useBasicTimelineExtras(pages);
    const compact = useUiSettingsStore((s) => s.uiSettings.timelineCompact);
    // UI-12: the waveform lane, from the audio player's envelope, per beat on the view axis; E1:
    // and the music past the last count, on counts as the show would go on. Hidden in settings,
    // the lane goes away as it does with no audio.
    const envelope = useAudioEnvelopeStore((s) => s.envelope);
    const waveformHidden = useUiSettingsStore(
        (s) => s.uiSettings.timelineWaveformStyle === "hidden",
    );
    const continuation = useMemo(
        () =>
            countContinuation({
                beats,
                measureStarts: measures.map((m) => m.startBeat.index),
            }),
        [beats, measures],
    );
    const musicEnd = useMemo(
        () => (envelope ? musicEndSeconds(envelope, WAVEFORM_FLOOR_DB) : null),
        [envelope],
    );
    const waveform = useMemo(() => {
        if (!envelope || waveformHidden) return null;
        const peaks = waveformWithPastEnd(
            envelope,
            beats,
            createTimelineBeatAxis(beats).offset,
            { durationAt: continuation.durationAt, musicEnd },
        );
        // A show with no audio plays a silent placeholder: nothing to draw, so in Basic, where the
        // lane sets the pane's height, it counts as no waveform (UI-19)
        if (
            basic &&
            !peaks.peaksByBeat.some((beat) => beat.some((peak) => peak > 0))
        )
            return null;
        return peaks;
    }, [envelope, beats, continuation, musicEnd, waveformHidden, basic]);
    const zoomFitted = useUiSettingsStore(
        (s) => s.uiSettings.timelineZoomFitted,
    );
    const setZoomFitted = useUiSettingsStore((s) => s.setTimelineZoomFitted);
    const { isPlaying } = useIsPlaying()!;
    const selectedMarchers = useSelectedMarchers()?.selectedMarchers;
    const selectedIdsKey = (selectedMarchers ?? []).map((m) => m.id).join(",");
    const selectedMarcherIds = useMemo(
        () =>
            new Set(
                selectedIdsKey === ""
                    ? []
                    : selectedIdsKey.split(",").map(Number),
            ),
        [selectedIdsKey],
    );
    // UI-18: where the selected marchers hold, on the page boxes
    const selectedIdList = useMemo(
        () => [...selectedMarcherIds],
        [selectedMarcherIds],
    );
    const holdMarks = useLabeledHoldMarks(
        useTimelineHoldMarks(pages, selectedIdList),
    );
    // UI-18 keep later pages: the chains on the page boxes, and the page box menu's entries
    // (named up to three; K's target says so, from the current page)
    const keepStates = usePageKeepStates(pages, selectedIdList);
    const keepNameOf = useMarcherNameOf(selectedMarchers);
    const keepK = useKeepToggle(
        keepStates,
        pages,
        useSelectedPage()?.selectedPage?.id,
    );
    const keepChains = usePageKeepChains(keepStates, keepNameOf, keepK);
    const keepHere = useMemo(
        () => keepHereMenu(keepStates, keepK),
        [keepStates, keepK],
    );
    const { tracks: timelines, current: tracksCurrent } =
        useTimelineTracksState({
            database: db,
            enabled: true,
        });
    // A page flag move changes the pages and the tracks, and the pages can arrive first: matched
    // against the new boxes, the old page timelines would flash as clips. Until the tracks catch
    // up they're matched against the boxes they were built with
    const clipBoxPages = useHeldWhileStale(pages, tracksCurrent);
    // UI-10: a page box already stands for its page timeline, so only the others get a clip.
    // UI-14: each is a move, labelled by its name ("Move 2" since it was made), named for
    // screen readers in counts, and saying why it is dashed where it is (`describeMoveClips`)
    const storedTimelines = useTimelineSelectionStore((s) => s.storedTimelines);
    const pageBoxes = useTimelineSelectionStore((s) => s.pageBoxes);
    const { clips: offPage, overridden } = useMemo(
        () =>
            describeMoveClips({
                clips: timelinesOffPages(timelines, clipBoxPages),
                storedTimelines: storedTimelines ?? [],
                pageBoxes,
                pages,
            }),
        [timelines, clipBoxPages, pages, storedTimelines, pageBoxes],
    );
    // The Move card says it too
    useEffect(() => {
        useMoveNotesStore.getState().setOverridden(overridden);
    }, [overridden]);
    // UI-14 round-2 review: a "Select them" selection doesn't follow you to another move
    useClearLeftoverMoveSelection();
    const punchTap = useTimelinePunchTap(beats.length);
    const align = useTimelineAlign({
        beats,
        envelope,
        keyBlocked: selectedMarcherIds.size > 0,
        punchTap,
    });
    // Tempo E8: rehearsal marks and measure lines on the measure row
    const measureRow = useTimelineMeasureRow(measures);
    const commands = useTimelineCommands({
        database: db,
        timelines,
        selectedMarcherIds,
    });
    // UI-14: a clip is a move; it can be edited, renamed and deleted
    const moves = useMoveCommands(db);
    const moveCommands = useMemo(
        () => ({
            disabledReason: moveCommandBlocker(isPlaying),
            onEdit: (id: number) => {
                if (!isPlaying) moves.editMove(id);
            },
            onRename: (id: number, name: string) =>
                void moves.renameMove(id, name),
            onDelete: (id: number) => {
                if (!isPlaying) void moves.deleteMove(id);
            },
        }),
        [isPlaying, moves],
    );
    const clipResize = useTimelineClipResize({ database: db, timelines });
    const queryClient = useQueryClient();
    // Moving a page flag (research/move-page-flag): the playhead and start flag on it go with it
    const { mutateAsync: movePageFlag } = useMutation(
        movePageFlagMutationOptions(queryClient, ({ from, to }) =>
            useTimelineSelectionStore.getState().followPageFlagMove(from, to),
        ),
    );
    const isolated = useTimelineSelectionStore((s) => s.isolation !== null);
    const latestBlockText = useRef({ pages, timelines });
    latestBlockText.current = { pages, timelines };
    // Flags don't move while playing or isolated (cases 21, 22)
    const pageFlagMove = useMemo<TimelineProps["pageFlagMove"]>(
        () =>
            isPlaying || isolated
                ? undefined
                : {
                      limits: async (pageId) => {
                          const limits = await pageFlagMoveLimits({
                              db,
                              pageId: Number(pageId),
                          });
                          if (!limits) return null;
                          const { pages, timelines } = latestBlockText.current;
                          return {
                              flag: limits.flag,
                              min: limits.min,
                              max: limits.max,
                              minReason: describePageFlagBlock(
                                  limits.minBlock,
                                  pages,
                                  timelines,
                              ),
                              maxReason: describePageFlagBlock(
                                  limits.maxBlock,
                                  pages,
                                  timelines,
                              ),
                              holes: limits.holes.map((h) => ({
                                  beat: h.beat,
                                  reason: describePageFlagBlock(
                                      h.block,
                                      pages,
                                      timelines,
                                  ),
                              })),
                          };
                      },
                      commit: async (pageId, beat) => {
                          // A refusal is shown as a toast by the mutation
                          await movePageFlag({
                              pageId: Number(pageId),
                              beat,
                          }).catch(() => {});
                      },
                  },
        [isPlaying, isolated, movePageFlag],
    );
    // Not while a paused preview holds a frame (UI-11), as **+**
    const holding = useTimelineSelectionStore((s) => s.cursorBeat !== null);
    const showLength = useShowLengthControls({
        beats,
        lastFlag: pages.length > 0 ? pageEndBeat(pages[pages.length - 1]!) : 0,
        continuation,
        musicEnd,
        hidden: isPlaying || holding,
    });
    // Tempo lab `drillChoices` (E10): count edits that ask what the drill should do
    const counts = useTimelineDrillEdits({
        pages,
        beatCount: beats.length,
        isPlaying,
    });
    const windowBeforeClick = useRef<TimelineIsolation["restore"] | null>(null);
    // Change to subset / normal page: one `updatePages` edit, one undo step
    const { mutate: updatePages } = useMutation(
        updatePagesMutationOptions(queryClient),
    );
    const { mutate: deletePageFlags } = useMutation(
        deletePageFlagsMutationOptions(queryClient),
    );
    // The delete toast's Undo is the app's normal undo (Ctrl+Z)
    const { mutate: performHistoryAction } = usePerformHistoryAction();
    const undo = () => performHistoryAction("undo");
    const { mutate: deletePagesWithMoves } = useMutation(
        deletePagesWithMovesMutationOptions(queryClient, undo),
    );
    const selectAfterDelete = (
        after: ReturnType<typeof selectionAfterFlagDelete>,
    ) => {
        if (!after) return;
        const store = useTimelineSelectionStore.getState();
        if (after.kind === "home") store.selectHome();
        else store.selectRange(after.start, after.end);
    };
    // UI-9: selecting home seeks to beat 0 and a range to its end; not while playing
    const changeSelection = (next: TimelineSelection) => {
        // UI-17 follow-up: home while playing jumps playback to the start (a page box jumps by
        // its own scrub; home has nowhere else to go)
        if (isPlaying && next?.kind === "home") {
            jumpTimelinePlayback(beats, 0);
            return;
        }
        if (isPlaying) return;
        const store = useTimelineSelectionStore.getState();
        if (next?.kind === "home") store.selectHome();
        else if (next?.kind === "range") {
            const { startBeatIndex: start, endBeatIndex: end } = next.range;
            store.selectRange(start, end);
            // UI-17: a drawn range (Ctrl+drag) is the loop, and turns looping on, as dragging
            // Logic's cycle bar does; a page box or Shift+click takes a loop that is on to the
            // pages selected. A dragged start flag only moves the edit window
            const pageBox = store.pageBoxes.some(
                (b) => b.start === start && b.end === end,
            );
            if (
                store.isolation === null &&
                (next.drawn ||
                    (store.loop && (next.via === "pages" || pageBox)))
            )
                store.setLoop({ start, end });
        } else store.selectNothing();
    };

    return (
        // A double-click's two clicks select the range first; remember the window from before the
        // first one, so leaving isolation goes back there (V-18)
        <div
            className="contents"
            onMouseDownCapture={(event) => {
                if (event.detail !== 1) return;
                const s = useTimelineSelectionStore.getState();
                windowBeforeClick.current = s.isolation?.restore ?? {
                    startBeat: s.startBeat,
                    startPinned: s.startPinned,
                    playheadBeat: s.playheadBeat,
                };
            }}
        >
            <TimelineWaveformProvider waveform={waveform ?? NO_WAVEFORM}>
                <PlayingTimeline
                    mode={basic ? "basic" : compact ? "collapsed" : "expanded"}
                    showTransport
                    basic={basic}
                    {...(basic ? basicExtras : {})}
                    zoomFitted={zoomFitted}
                    onZoomFittedChange={setZoomFitted}
                    className="w-full"
                    beats={beats}
                    pages={pages}
                    measures={measures}
                    timelines={basic ? NO_CLIPS : offPage}
                    transportAccessories={basic ? SPEED_BUTTON : LOOP_BUTTONS}
                    transportSecondary={SOUND_BUTTON}
                    transportViewControls={basic ? undefined : VIEW_CONTROLS}
                    waveformNotice={LINE_UP_STRIP}
                    waveformAction={TAP_LANE_BUTTON}
                    countOverlay={renderTapOverlay}
                    holdMarks={holdMarks}
                    keepChains={keepChains}
                    keepHere={keepHere}
                    onSelectionChange={changeSelection}
                    onTimelineRangeCommit={
                        basic ? undefined : commands.commitTimelineRange
                    }
                    clipResize={basic ? undefined : clipResize}
                    measureRow={measureRow}
                    onUnpinStart={() =>
                        useTimelineSelectionStore.getState().unpinStart()
                    }
                    onOpenRange={
                        basic
                            ? undefined
                            : (range) => {
                                  if (isPlaying) return;
                                  const store =
                                      useTimelineSelectionStore.getState();
                                  const timeline = store.storedTimelines?.find(
                                      (t) =>
                                          t.start === range.startBeatIndex &&
                                          t.end === range.endBeatIndex,
                                  );
                                  if (timeline)
                                      store.isolate(
                                          timeline.id,
                                          windowBeforeClick.current ??
                                              undefined,
                                      );
                                  else
                                      toast.info(
                                          "Nothing moves here yet. Drag marchers in this range to make a move, then double-click it to isolate it.",
                                      );
                              }
                    }
                    moveCommands={basic ? undefined : moveCommands}
                    pageFlagMove={pageFlagMove}
                    onSetPageSubset={(pageId, subset) =>
                        updatePages({
                            modifiedPagesArgs: [
                                { id: pageId, is_subset: subset },
                            ],
                        })
                    }
                    align={align}
                    appendCounts={showLength.appendCounts}
                    musicPastEnd={showLength.musicPastEnd}
                    drillEdits={counts.drillEdits}
                    onDeletePageFlag={(pageId) => {
                        const after = selectionAfterFlagDelete(
                            pages,
                            pageId,
                            useTimelineSelectionStore.getState().selection,
                        );
                        deletePageFlags(new Set([pageId]), {
                            onSuccess: () => selectAfterDelete(after),
                        });
                    }}
                    onDeletePageWithMoves={(pageId) => {
                        const after = selectionAfterDeleteWithMoves(
                            pages,
                            pageId,
                            useTimelineSelectionStore.getState().selection,
                        );
                        deletePagesWithMoves(new Set([pageId]), {
                            onSuccess: () => selectAfterDelete(after),
                        });
                    }}
                />
            </TimelineWaveformProvider>
            {counts.dialog}
        </div>
    );
}

/**
 * The timeline fed by the audio playback, with its zoom, its window and **+**. The playback
 * position changes once a beat while playing or scrubbing, the window (from the start flag to the
 * playhead) with it, and the zoom every frame of a pinch, so all of them are read here, under the
 * panel: they re-render the timeline, not the panel and its queries.
 */
function PlayingTimeline({
    basic = false,
    ...props
}: { basic?: boolean } & Omit<
    TimelineProps,
    | "playback"
    | "pixelsPerBeat"
    | "onPixelsPerBeatChange"
    | "selection"
    | "transportClock"
    | "onAddPageFlag"
    | "onAddSubsetPage"
    | "addPageNames"
    | "loop"
    | "onLoopChange"
>) {
    const { beats, pages } = props;
    const playback = useTimelinePlayback({ beats, pages });
    const editSelection = useTimelineSelectionStore((s) => s.selection);
    const startBeat = useTimelineSelectionStore((s) => s.startBeat);
    // UI-17: the loop, drawn as a bar with draggable ends; an isolated move always loops, so its
    // range is drawn as the loop too, read-only
    const storeLoop = useTimelineSelectionStore((s) => s.loop);
    const isolation = useTimelineSelectionStore((s) => s.isolation);
    const loop = useMemo(() => {
        if (basic) return null;
        const region = isolation ?? storeLoop;
        return region
            ? { startBeatIndex: region.start, endBeatIndex: region.end }
            : null;
    }, [basic, isolation, storeLoop]);
    const changeLoop = useCallback(
        (next: { startBeatIndex: number; endBeatIndex: number }) =>
            useTimelineSelectionStore.getState().setLoop({
                start: next.startBeatIndex,
                end: next.endBeatIndex,
            }),
        [],
    );
    // UI-12: the pin shows outside isolation, whose start flag is the isolated move's own
    const startPinned = useTimelineSelectionStore(
        (s) => s.startPinned && s.isolation === null,
    );
    const selection = useMemo(
        () => toTimelineSelection(editSelection, startBeat, startPinned),
        [editSelection, startBeat, startPinned],
    );
    // UI-12: the paused clock reads the beat the timeline shows, not the selected page's end
    const shownBeat = useTimelineSelectionStore(displayedBeat);
    const pausedSeconds =
        beats.length > 0
            ? timeAtBeat(beats, Math.min(shownBeat, beats.length))
            : undefined;
    const clock = useMemo(
        () => <AudioClock pausedSeconds={pausedSeconds} />,
        [pausedSeconds],
    );
    // UI-9 **+** after the free paused playhead; the new page becomes the selection
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    // Not while a paused preview holds a frame: + is drawn there, but would add at P (UI-11)
    const holding = useTimelineSelectionStore((s) => s.cursorBeat !== null);
    const addPageFlag = useAddPageFlag({
        pages,
        beatCount: beats.length,
        playheadBeat,
        isPlaying: playback.isPlaying || holding,
        onAdded: selectAddedPage,
    });
    // The zoom changes every frame of a pinch: keep it here, and save it once the gesture settles
    const [pixelsPerBeat, setPixelsPerBeat] = useState(
        () => useUiSettingsStore.getState().uiSettings.timelinePixelsPerBeat,
    );
    useEffect(() => {
        const timeout = setTimeout(
            () =>
                useUiSettingsStore
                    .getState()
                    .setTimelinePixelsPerBeat(pixelsPerBeat),
            400,
        );
        return () => clearTimeout(timeout);
    }, [pixelsPerBeat]);
    return (
        <Timeline
            {...props}
            selection={selection}
            transportClock={clock}
            onAddPageFlag={addPageFlag.insertion ? addPageFlag.add : undefined}
            addPageNames={addPageFlag.names ?? undefined}
            onAddSubsetPage={
                addPageFlag.insertion ? addPageFlag.addSubset : undefined
            }
            playback={playback}
            pixelsPerBeat={pixelsPerBeat}
            onPixelsPerBeatChange={setPixelsPerBeat}
            loop={loop}
            onLoopChange={isolation || basic ? undefined : changeLoop}
        />
    );
}

/**
 * The Align view's data and writes (E7), when the Tempo lab flag `alignView` is on: the counts'
 * lengths, the synced counts (stored by beat id) as count indexes, and a retime written as one
 * undo entry with the offset and synced counts. A press of A doesn't toggle it while marchers are
 * selected, where A moves them.
 */
function useTimelineAlign({
    beats,
    envelope,
    keyBlocked,
    punchTap,
}: {
    beats: readonly { readonly id: number; readonly duration: number }[];
    envelope: TimelineAlign["envelope"];
    keyBlocked: boolean;
    punchTap: TimelinePunchTapConfig | undefined;
}): TimelineAlign | undefined {
    const enabled = useTempoLabFlag("alignView") === true;
    const on = useTimelineSelectionStore((s) => s.alignView);
    const syncedIds = useTempoSyncedBeatIds();
    const { data: settings } = useQuery(workspaceSettingsQueryOptions());
    const { mutateAsync: retime } = useRetimeBeats();
    const { mutate: setSyncedIds } = useSetTempoSyncedBeatIds();
    const durations = useMemo(() => beats.map((b) => b.duration), [beats]);
    const synced = useMemo(() => {
        const indexOf = new Map(beats.map((b, i) => [b.id, i]));
        return syncedIds
            .flatMap((id) => {
                const index = indexOf.get(id);
                return index === undefined ? [] : [index];
            })
            .sort((a, b) => a - b);
    }, [beats, syncedIds]);
    const audioOffsetSeconds = settings?.audioOffsetSeconds ?? 0;
    const map = useTempoMapState();
    const tempoMap = useMemo(
        () => ({
            units: countUnits(map.state.rows, map.state.durations.length),
            sections: typedSections(map.state.rows),
        }),
        [map],
    );
    return useMemo(() => {
        if (!enabled) return undefined;
        const idsOf = (indexes: readonly number[]) =>
            indexes.flatMap((i) => (beats[i] ? [beats[i].id] : []));
        return {
            on,
            onToggle: (next) =>
                useTimelineSelectionStore.getState().setAlignView(next),
            keyBlocked,
            durations,
            synced,
            audioOffsetSeconds,
            envelope,
            onRetime: ({ durations: next, originShift, synced: nextSynced }) =>
                retime({
                    newDurationsByBeatId: durationsByBeatId(
                        beats.map((b) => b.id),
                        next,
                    ),
                    originShift,
                    syncedBeatIds: idsOf(nextSynced),
                }).catch(() => {
                    // The mutation already told the user (`tempo.retimeError`)
                }),
            onSetSynced: (next) => setSyncedIds(idsOf(next)),
            punchTap,
            tempoMap,
        };
    }, [
        punchTap,
        tempoMap,
        audioOffsetSeconds,
        beats,
        durations,
        enabled,
        envelope,
        keyBlocked,
        on,
        retime,
        setSyncedIds,
        synced,
    ]);
}

/**
 * Punch-in tap's app side (E9), when the Tempo lab flag `punchInTap` is on: the live clock, a
 * count-in (or the user's own loop, UI-17), and the "Lined up" toast with
 * Undo. Tap the beat's open panel keeps T, and opening it applies the take (DT-1).
 */
function useTimelinePunchTap(
    showEndBeat: number,
): TimelinePunchTapConfig | undefined {
    const enabled = useTempoLabFlag("punchInTap") === true;
    const tapTheBeatOpen = useTapTheBeatStore((s) => s.open);
    const { setIsPlaying } = useIsPlaying()!;
    const { mutate: performHistoryAction } = usePerformHistoryAction();
    const { t } = useTolgee();
    return useMemo(() => {
        if (!enabled) return undefined;
        return {
            liveTime: (stamp) =>
                getLivePlaybackPosition() - handlerDelaySeconds(stamp),
            play: (from) => {
                const store = useTimelineSelectionStore.getState();
                // Looping on (or a move isolated) is the user's own window: play that, as Space does
                const bounds = loopBounds(store);
                if (bounds) {
                    store.cue(bounds.from);
                    store.setPlayback({ kind: "preview", ...bounds });
                    setIsPlaying(true);
                    return true;
                }
                store.cue(from);
                return startTimelinePlayOn(showEndBeat, setIsPlaying);
            },
            blocked: () => useTapTheBeatStore.getState().open,
            otherToolOpen: tapTheBeatOpen,
            onApplied: (message) =>
                toast.success(message, {
                    action: {
                        label: t("tempo.punchTap.undo"),
                        onClick: () => performHistoryAction("undo"),
                    },
                }),
            onNotice: (message) => toast.info(message),
        };
    }, [
        enabled,
        performHistoryAction,
        setIsPlaying,
        showEndBeat,
        t,
        tapTheBeatOpen,
    ]);
}

/**
 * E1, a show as long as its music: **+ N counts** after the last page (N is the show's "new page
 * counts" setting), and, when the music runs past the last count, the note that offers extending
 * the counts to its end. Each is one undoable edit; the new page is selected, as **+** selects it.
 */
function useShowLengthControls({
    beats,
    lastFlag,
    continuation,
    musicEnd,
    hidden,
}: {
    beats: Parameters<typeof showEndTime>[0];
    /** The last page's flag, a spec beat position */
    lastFlag: number;
    continuation: ReturnType<typeof countContinuation>;
    musicEnd: number | null;
    hidden: boolean;
}) {
    const { t } = useTolgee();
    const queryClient = useQueryClient();
    const counts =
        useQuery(workspaceSettingsQueryOptions()).data?.defaultNewPageCounts ??
        16;
    const { mutate: appendPage } = useMutation(
        appendPageOfCountsMutationOptions(queryClient, selectAddedPage),
    );
    const { mutate: extend } = useMutation(
        extendCountsToMutationOptions(queryClient, (added) => {
            if (added > 0)
                toast.success(
                    t("timeline.showLength.extended", { counts: added }),
                );
        }),
    );
    const { mutate: pagesToEnd } = useMutation(
        appendPagesToEndMutationOptions(queryClient, (added) => {
            if (added > 0)
                toast.success(
                    t("timeline.showLength.pagesAdded", { pages: added }),
                );
        }),
    );
    const countsEnd = showEndTime(beats);
    // Counts already past the last flag (a show made from an MP3): the pill adds a page over them,
    // and says so, and one more offers pages to the end (FB-7)
    const countsPast = beats.length - lastFlag;
    const overExisting = countsPast >= counts;
    const appendCounts = hidden
        ? undefined
        : {
              label: t(
                  overExisting
                      ? "timeline.showLength.appendPage"
                      : "timeline.showLength.appendCounts",
                  { counts },
              ),
              title: t(
                  overExisting
                      ? "timeline.showLength.appendPageTitle"
                      : "timeline.showLength.appendCountsTitle",
                  { counts },
              ),
              onAppend: () => appendPage(counts),
              ...(countsPast > counts
                  ? {
                        toEnd: {
                            label: t("timeline.showLength.pagesToEnd", {
                                counts,
                            }),
                            title: t("timeline.showLength.pagesToEndTitle", {
                                counts,
                            }),
                            onAppend: () => pagesToEnd(counts),
                        },
                    }
                  : {}),
          };
    const musicPastEnd =
        !hidden &&
        musicEnd !== null &&
        musicRunsPastCounts({
            countsEndSeconds: countsEnd,
            musicEnd,
            continuation,
        })
            ? {
                  message: t("timeline.showLength.musicPastEnd", {
                      countsEnd: formatMinutesSeconds(countsEnd),
                      musicEnd: formatMinutesSeconds(musicEnd),
                  }),
                  actionLabel: t("timeline.showLength.extendToEnd"),
                  onExtend: () => extend(musicEnd),
              }
            : undefined;
    return { appendCounts, musicPastEnd };
}

/**
 * What to select after deleting `pageId`'s flag (lead decision, 2026-10-02): when that page was
 * the selection, the merged box: the next page's box, which now runs from the deleted page's start
 * to the next flag. Deleting the last page's flag makes the previous page last, so that page's box
 * (home for page 0). `null` when the deleted page wasn't selected, so the selection stays.
 */
export function selectionAfterFlagDelete(
    pages: readonly FlagPage[],
    pageId: number,
    selection: TimelineEditSelection,
): Exclude<TimelineEditSelection, { kind: "none" }> | null {
    const flags = pageFlags(pages);
    const index = flags.findIndex((f) => f.page.id === pageId);
    const deleted = flags[index];
    if (
        !deleted?.range ||
        !selectionIsRange(selection, deleted.range.start, deleted.range.end)
    )
        return null;
    const next = flags[index + 1];
    if (next?.range)
        return {
            kind: "range",
            start: deleted.range.start,
            end: next.range.end,
        };
    const previous = flags[index - 1];
    return previous ? selectionOfPage(previous) : null;
}

/**
 * What to select after **Delete page and its moves** on `pageId` (lead default, 2026-10-08): when
 * that page was the selection, the box that now covers it. The page before it takes its beats, so
 * that is the previous page's box running to the deleted page's flag; after home, the next page
 * starts where the deleted one did. `null` when the deleted page wasn't selected.
 */
export function selectionAfterDeleteWithMoves(
    pages: readonly FlagPage[],
    pageId: number,
    selection: TimelineEditSelection,
): Exclude<TimelineEditSelection, { kind: "none" }> | null {
    const flags = pageFlags(pages);
    const index = flags.findIndex((f) => f.page.id === pageId);
    const deleted = flags[index];
    if (
        !deleted?.range ||
        !selectionIsRange(selection, deleted.range.start, deleted.range.end)
    )
        return null;
    const previous = flags[index - 1];
    if (previous?.range)
        return {
            kind: "range",
            start: previous.range.start,
            end: deleted.range.end,
        };
    const next = flags[index + 1];
    return next?.range
        ? { kind: "range", start: deleted.range.start, end: next.range.end }
        : { kind: "home" };
}

/** **+** selects the new page's page timeline (UI-9: "The new page is selected"). */
export const selectAddedPage = ({
    startBeat,
    endBeat,
}: Pick<AddedPageFlag, "startBeat" | "endBeat">) =>
    useTimelineSelectionStore.getState().selectRange(startBeat, endBeat);

/**
 * What stops a dragged page flag, in words for its readout (research/move-page-flag cases 1, 4, 6,
 * 9, 10): the neighboring flag, the show's end, or the move in the way, named by its page when it
 * is a page's move. `timelines` are the tracks (`useTimelineTracks`); ranges are spec beats.
 */
export function describePageFlagBlock(
    block: PageFlagMoveBlock,
    pages: readonly (FlagPage & { readonly name: string })[],
    timelines: readonly Pick<
        TimelineInput,
        "linkId" | "label" | "startBeatIndex" | "endBeatIndex"
    >[],
): string {
    if (block.kind === "show-end") return "The end of the show";
    const flags = pageFlags(pages);
    if (block.kind === "flag") {
        const flag = flags.find((f) => f.page.id === block.pageId);
        return !flag || !flag.range ? "Home" : `Page ${flag.page.name}'s flag`;
    }
    const track =
        block.timelineId === undefined
            ? undefined
            : timelines.find((t) => t.linkId === block.timelineId);
    const page = track
        ? flags.find(
              (f) =>
                  f.range?.start === track.startBeatIndex &&
                  f.range.end === track.endBeatIndex,
          )
        : undefined;
    const who = page
        ? `Page ${page.page.name}'s move`
        : track && !/^Timeline \d+$/.test(track.label)
          ? `"${track.label}"`
          : "A move";
    if (block.message.includes("share"))
        return `${who} already has these counts`;
    if (block.message.includes("left behind"))
        return `${who} starts or ends on this flag`;
    return `${who} is in the way`;
}

/** `value` as it was the last time `current` was true, or as it is now while `current` is. */
export function useHeldWhileStale<T>(value: T, current: boolean): T {
    const held = useRef(value);
    if (current) held.current = value;
    return held.current;
}

/**
 * The timelines that don't match a page box (UI-10, project owner, 2026-10-03). A page box
 * already stands for the stored timeline with exactly its range: clicking it sets the start flag
 * and playhead to its edges, so a clip under it would only repeat it. Timelines that start or end
 * off a flag (a mid-page arrival, a pinned start flag) keep their clips. Ranges are spec beats.
 */
export function timelinesOffPages<
    T extends Pick<TimelineInput, "startBeatIndex" | "endBeatIndex">,
>(timelines: readonly T[], pages: readonly FlagPage[]): T[] {
    const boxes = new Set(
        pageFlags(pages).flatMap((f) =>
            f.range ? [`${f.range.start}:${f.range.end}`] : [],
        ),
    );
    return timelines.filter(
        (t) => !boxes.has(`${t.startBeatIndex}:${t.endBeatIndex}`),
    );
}
