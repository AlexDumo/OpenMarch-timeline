/**
 * PROTOTYPE (tempo mode, branch tempo/track-proto): the lanes the timeline shows in place of its
 * clip rows while tempo mode is on (docs/tempo/daw-research.md). The axis stays counts, so drill
 * doesn't move while you edit tempo; the music slides and stretches under the counts. The audio is
 * never changed: every edit only re-times counts (the grid follows the audio).
 *
 * - **Marks**: rehearsal marks. Double-click to add (next letter) or rename; M while playing drops
 *   one on the nearest measure.
 * - **Measures**: numbers (double-click to set a number from there on) and time signatures (click
 *   a chip to regroup from that measure to the next change). Drag along it to select counts.
 * - **Tempo**: each count's tempo as a line. Drag a step up or down; double-click to type "120",
 *   or "120-90" for a gradual change. Holds (fermatas) leave a gap marked 𝄐.
 * - **Music**: the waveform under the count lines, with the hits found in it. Drag a hit onto the
 *   count it belongs to, or a count line onto its hit (Logic's Beat Mapping). The count pins; the
 *   counts back to the pin before re-space, and the counts up to the pin after (if any) too,
 *   otherwise the rest slides. Shift moves only that count line; Alt doesn't snap to hits. A drag
 *   stops at a pin and says why. Dropping a hit on count 1 moves the music instead.
 * - **T** taps along while playing; stopping shows the taps as drafts to apply or discard.
 */
import {
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import {
    CheckIcon,
    HandTapIcon,
    MagicWandIcon,
    MagnetIcon,
    MetronomeIcon,
    PushPinSlashIcon,
    QuestionIcon,
    SpeakerHighIcon,
    TimerIcon,
    XIcon,
} from "@phosphor-icons/react";
import {
    Keycaps,
    ShortcutTooltip,
    TransportTooltipProvider,
} from "@/components/timeline/ShortcutTooltip";
import { create } from "zustand";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/App";
import { historyKeys } from "@/hooks/queries/useHistory";
import { subscribeHistoryChanges } from "@/db-functions/history";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { workspaceSettingsKeys } from "@/hooks/queries/useWorkspaceSettings";
import { useAudioEnvelopeStore } from "@/timeline/timelineWaveform";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useMetronomeStore } from "@/stores/MetronomeStore";
import { useIsPlaying } from "@/context/IsPlayingContext";
import {
    audioContextRef,
    getLivePlaybackPosition,
    getLivePlaybackRate,
    LIVE_LEAD,
} from "@/components/timeline/audio/AudioPlayer";
import {
    startTimelinePlayOn,
    stopTimelinePlayback,
} from "@/timeline/timelineTransport";
import type {
    TimelineBand,
    TimelineBandGeometry,
} from "@/components/timeline/TimelineBand";
import {
    assignTaps,
    lockAfter,
    lockBefore,
    moveBeatTo,
    moveLimits,
    moveOneCount,
    pinBeats,
    rampLengths,
    respace,
    retime,
    startsOf,
    tempoSegments,
    type TempoEditResult,
    type TempoSegment,
} from "./tempoMath";
import {
    deleteCounts,
    endMovesEarly,
    insertCounts,
    moveRehearsalMark,
    readMoves,
    type MoveSpan,
    setMeasureNumber as writeMeasureNumber,
    writeMarks,
    setRehearsalMark,
    writeDurations,
    type CountEditResult,
} from "./tempoWrites";
import { useMusicOnsets } from "./useMusicOnsets";
import { snapToOnset } from "./onsets";
import { planFit } from "./fitMusic";
import {
    tempoSettingsKey,
    useAudioOffsetSeconds,
    writeAudioOffset,
} from "./audioOffset";
import {
    METER_CHOICES,
    meterLabel,
    meterOfMeasure,
    parseMeter,
    quarterBpmOf,
} from "./meters";
import { planMeter, writeMeter } from "./meterWrites";
import { readTapCheck, TapCheckPanel, type TapCheckResult } from "./TapCheck";
import {
    createLabelPlacer,
    textWidth,
    useOnScreen,
    type LabelBox,
} from "./bandLayout";
import { useTempoModeStore } from "./tempoModeStore";

// ---------------------------------------------------------------------------------------------
// State

export { useTempoModeStore };

/** Adding or removing counts: re-divide the same time, or shift everything after */
type CountChoice = "keep" | "shift";

const readChoice = (): CountChoice => {
    try {
        return localStorage.getItem("tempoProto.countChoice") === "shift"
            ? "shift"
            : "keep";
    } catch {
        return "keep";
    }
};

interface TempoUiState {
    /** The last answer to "keep everything else in place / shift everything after" */
    choice: CountChoice;
    /** Whether grabbing the music, count lines and taps snap to hits in the music */
    snap: boolean;
    /** Selected counts (spec beats, `to` exclusive), from dragging along the measures lane */
    range: { from: number; to: number } | null;
    /** Taps of the pass in progress (show seconds), or null when not tapping */
    taps: number[] | null;
    /** Taps waiting to be applied: which count, and when */
    draft: { beat: number; seconds: number }[] | null;
    /** Counts the last fit placed without a hit to land on */
    unsure: ReadonlySet<number>;
    setChoice: (choice: CountChoice) => void;
    setSnap: (snap: boolean) => void;
    setRange: (range: { from: number; to: number } | null) => void;
    setTaps: (taps: number[] | null) => void;
    setDraft: (draft: { beat: number; seconds: number }[] | null) => void;
    setUnsure: (unsure: ReadonlySet<number>) => void;
}

const useTempoUi = create<TempoUiState>((set) => ({
    choice: readChoice(),
    snap: true,
    range: null,
    taps: null,
    draft: null,
    unsure: new Set(),
    setChoice: (choice) => {
        try {
            localStorage.setItem("tempoProto.countChoice", choice);
        } catch {
            /* a per-viewer convenience only */
        }
        set({ choice });
    },
    setSnap: (snap) => set({ snap }),
    setRange: (range) => set({ range }),
    setTaps: (taps) => set({ taps }),
    setDraft: (draft) => set({ draft }),
    setUnsure: (unsure) => set({ unsure }),
}));

// ---------------------------------------------------------------------------------------------
// Layout

// The mode's header row (its tools) is over the timeline's transport, not in the band
const MARKS = { top: 0, height: 20 };
const MEASURES = { top: 20, height: 22 };
const TEMPO = { top: 42, height: 76 };
const MUSIC = { top: 118, height: 124 };
export const TEMPO_BAND_HEIGHT = MUSIC.top + MUSIC.height + 6;
/** The lane names' column at the view's left edge: as wide as the home page's column before beat 0 */
const LANE_GUTTER = 40;
/** The lanes' names in that column, with what each lane does */
const LANES = [
    {
        ...MARKS,
        name: "Marks",
        title: "Rehearsal marks: double-click to name one, drag one to another measure, or press M while playing to drop the next",
    },
    {
        ...MEASURES,
        name: "Meas.",
        title: "Measures: drag along to select counts, right-click or double-click a number to renumber from there, click a time signature to change it",
    },
    {
        ...TEMPO,
        name: "Tempo",
        title: "Tempo: drag the line up or down, double-click it to type a tempo, right-click for holds and more",
    },
    {
        ...MUSIC,
        name: "Music",
        title: "The music: drag a hit onto its count, or a count's handle (the triangle at the top) onto the music",
    },
];

/** Where tempo mode's header goes: a row over the timeline's transport (`TimelineBand.header`) */
const useHeaderSlot = create<{
    element: HTMLElement | null;
    setElement: (element: HTMLElement | null) => void;
}>((set) => ({
    element: null,
    setElement: (element) => set({ element }),
}));

function TempoHeaderSlot() {
    const setElement = useHeaderSlot((s) => s.setElement);
    return (
        <div
            ref={setElement}
            data-testid="tempo-mode-header"
            className="border-stroke relative flex h-32 shrink-0 border-b"
        />
    );
}

/** The band the timeline draws in tempo mode */
export const TEMPO_BAND: TimelineBand = {
    height: TEMPO_BAND_HEIGHT,
    focus: true,
    header: <TempoHeaderSlot />,
    render: (geometry) => <TempoLanes geometry={geometry} />,
};

/** x of spec beat `b`'s start: the band's x 0 is spec beat 1 (the timeline hides beat 0) */
const xOf = (b: number, ppb: number) => (b - 1) * ppb;
const beatAtX = (x: number, ppb: number) => x / ppb + 1;

/** How close (px) a press must be to a count line's handle to grab the line */
const LINE_GRAB_PX = 6;
/** The strip at the top of the music lane holding the count lines' handles (Logic's beat markers) */
const HANDLE_STRIP = 16;

/** The surface's visible horizontal window, from its scroll container */
function useScrollWindow(ref: React.RefObject<HTMLElement | null>) {
    const [win, setWin] = useState({ left: 0, width: 1200 });
    useLayoutEffect(() => {
        let scroller: HTMLElement | null = ref.current?.parentElement ?? null;
        while (scroller) {
            const style = getComputedStyle(scroller);
            if (
                /(auto|scroll)/.test(style.overflowX) &&
                scroller.scrollWidth > scroller.clientWidth
            )
                break;
            scroller = scroller.parentElement;
        }
        if (!scroller) return;
        const el = scroller;
        let frame = 0;
        const read = () => {
            frame = 0;
            setWin((w) =>
                w.left === el.scrollLeft && w.width === el.clientWidth
                    ? w
                    : { left: el.scrollLeft, width: el.clientWidth },
            );
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(read);
        };
        read();
        el.addEventListener("scroll", onScroll, { passive: true });
        const observer = new ResizeObserver(onScroll);
        observer.observe(el);
        return () => {
            el.removeEventListener("scroll", onScroll);
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [ref]);
    return win;
}

const cssColor = (el: Element | null, name: string, fallback: string) =>
    (el && getComputedStyle(el).getPropertyValue(name).trim()) || fallback;

// ---------------------------------------------------------------------------------------------
// Data

interface TempoMeasure {
    start: number;
    number: number;
    mark: string | null;
    counts: number;
    id: number | null;
    overridden: boolean;
    /** The time signature written here ("7/8"), and its grouping in eighths ("2+2+3") */
    meter?: string | null;
    grouping?: string | null;
}

interface TempoData {
    /** Count lengths by spec beat, out to the axis end (endless counts included) */
    durations: number[];
    /** Pinned spec beats */
    locks: Set<number>;
    /** Held spec beats (fermatas) */
    holds: Set<number>;
    /** Beat id by spec beat, for the stored counts */
    ids: number[];
    measures: TempoMeasure[];
    storedCount: number;
    audioOffset: number;
}

/** Pinned and held beats (flags on the beats rows, so they're in undo with the edits) */
const tempoMarksQuery = () => ({
    // under "beats", so whatever refreshes the beats (an edit, undo) refreshes these too
    queryKey: ["beats", "tempoMarks"] as const,
    queryFn: async () => {
        const { db, schema } = await import("@/global/database/db");
        const { or, eq } = await import("drizzle-orm");
        return await db
            .select({
                id: schema.beats.id,
                pin: schema.beats.tempo_pin,
                hold: schema.beats.tempo_hold,
            })
            .from(schema.beats)
            .where(
                or(
                    eq(schema.beats.tempo_pin, 1),
                    eq(schema.beats.tempo_hold, 1),
                ),
            );
    },
});

function useTempoData(beatCount: number): TempoData {
    const { beats, measures, countGrid } = useTimingObjects();
    const { data: marks } = useQuery(tempoMarksQuery());
    // The music offset in the show's history (it undoes with the counts it lines up)
    const audioOffset = useAudioOffsetSeconds();
    return useMemo(() => {
        const n = Math.max(beatCount + 1, beats.length);
        const durations = [0];
        for (let b = 1; b < n; b++) durations.push(countGrid.durationAt(b));
        const ids = beats.map((b) => b.id);
        const ordinalOf = new Map(ids.map((id, i) => [id, i]));
        const toOrdinals = (list: readonly number[]) => {
            const out = new Set<number>();
            for (const id of list) {
                const o = ordinalOf.get(id);
                if (o !== undefined && o >= 1) out.add(o);
            }
            return out;
        };
        const locks = toOrdinals(
            (marks ?? []).filter((m) => m.pin === 1).map((m) => m.id),
        );
        locks.delete(1);
        const holds = toOrdinals(
            (marks ?? []).filter((m) => m.hold === 1).map((m) => m.id),
        );
        const ms: TempoMeasure[] = measures.map((m) => ({
            start: m.startBeat.index,
            number: m.number,
            mark: m.rehearsalMark,
            counts: m.counts,
            id: m.id,
            overridden:
                (m as { number_override?: number | null }).number_override !=
                null,
            meter: (m as { meter?: string | null }).meter ?? null,
            grouping: (m as { grouping?: string | null }).grouping ?? null,
        }));
        // The endless measures carry on the last one's length
        const last = ms[ms.length - 1];
        if (last && last.counts > 0) {
            let start = last.start + last.counts;
            let number = last.number + 1;
            while (start < n) {
                ms.push({
                    start,
                    number: number++,
                    mark: null,
                    counts: last.counts,
                    id: null,
                    overridden: false,
                });
                start += last.counts;
            }
        }
        return {
            durations,
            locks,
            holds,
            ids,
            measures: ms,
            storedCount: beats.length,
            audioOffset,
        };
    }, [beats, measures, countGrid, marks, beatCount, audioOffset]);
}

/** Save pins and holds (spec beats) as beat flags: one undo step */
async function saveMarks(sets: {
    locks?: ReadonlySet<number>;
    holds?: ReadonlySet<number>;
}) {
    await writeMarks({ pins: sets.locks, holds: sets.holds });
    await queryClient.invalidateQueries({ queryKey: ["beats"] });
}

/** Write a tempo edit: the new lengths, then the pins by beat id (the counts may be new) */
async function commitEdit(
    before: TempoData,
    result: TempoEditResult,
    refetch: () => Promise<unknown>,
    /** The music offset to set in the same edit (a fit that moved the music) */
    audioOffset?: number,
) {
    const maxLock = Math.max(0, ...result.locks);
    const after = [...result.durations];
    // a pin past the stored counts needs its count stored
    while (after.length <= maxLock) after.push(after[after.length - 1]!);
    // the lengths and the pins in one undo step
    await writeDurations({
        before: before.durations,
        after,
        pins: result.locks,
        audioOffset,
    });
    await queryClient.invalidateQueries({ queryKey: tempoSettingsKey });
    await refetch();
    if (result.note) toast.info(result.note, { id: NOTE_TOAST });
}

// ---------------------------------------------------------------------------------------------
// The lanes

type Gesture =
    | {
          /** Holding a hit in the music: it lands on the count under the pointer */
          kind: "grab";
          seconds: number;
          pointerX: number;
          beat: number | null;
          one: boolean;
      }
    | {
          /** Holding a count line: it lands on the music under the pointer */
          kind: "line";
          beat: number;
          seconds: number;
          pointerX: number;
          moved: boolean;
          one: boolean;
      }
    | {
          kind: "tempo";
          segment: TempoSegment;
          startY: number;
          factor: number;
      }
    | { kind: "range"; anchor: number; to: number }
    | {
          /** Dragging a rehearsal mark along the marks lane to another measure */
          kind: "mark";
          measure: TempoMeasure;
          to: number;
          moved: boolean;
      };

/** A stretch of counts (spec beats, `to` exclusive); `from === to` marks the line before `from` */
interface CountRange {
    from: number;
    to: number;
}

interface Editor {
    x: number;
    y: number;
    value: string;
    hint: string;
    onCommit: (value: string) => void;
    /** The counts the edit changes, shown in the lanes while it's open */
    range?: CountRange;
}

interface Menu {
    x: number;
    y: number;
    /** A line above the items (a question the items answer) */
    title?: string;
    items: {
        label: string;
        onSelect: () => void;
        disabled?: boolean;
        hint?: string;
        /** The counts the item changes, shown in the lanes while the item is pointed at */
        range?: CountRange;
    }[];
}

type AskOption =
    | { text: string; run: () => void }
    | { text: string; disabled: string };

interface CountAsk {
    x: number;
    y: number;
    title: string;
    /** What adding or removing a count is for, and that the recording stays as it is */
    intro: string;
    keep: AskOption;
    shift: { text: string; run: () => void };
    /** Adding only: hold the drill there instead, with no count added */
    hold?: AskOption;
    /** The counts it's about */
    range: CountRange;
}

/** The toast a tempo edit's note goes in (one at a time; undo and leaving the mode clear it) */
const NOTE_TOAST = "tempo-note";

/** The tapping check is offered once a session before tapping; after that, taps go as they land */
let tapCheckOffered = false;

// eslint-disable-next-line max-lines-per-function
function TempoLanes({ geometry }: { geometry: TimelineBandGeometry }) {
    const { top, width, pixelsPerBeat: ppb, beatCount } = geometry;
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const win = useScrollWindow(rootRef);
    const headerSlot = useHeaderSlot((s) => s.element);
    const data = useTempoData(beatCount);
    const { fetchTimingObjects, pages } = useTimingObjects();
    const refetch = useCallback(async () => {
        await fetchTimingObjects();
        await queryClient.invalidateQueries({
            queryKey: workspaceSettingsKeys.all(),
        });
    }, [fetchTimingObjects]);
    const envelope = useAudioEnvelopeStore((s) => s.envelope);
    const { envelope: onsets, status: onsetStatus } = useMusicOnsets(true);
    const ui = useTempoUi();
    const playing = useIsPlaying();
    const isPlaying = playing?.isPlaying ?? false;
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const [preview, setPreview] = useState<TempoEditResult | null>(null);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const [blocked, setBlocked] = useState<{ x: number; text: string } | null>(
        null,
    );
    const [editor, setEditor] = useState<Editor | null>(null);
    const [menu, setMenu] = useState<Menu | null>(null);
    const [ask, setAsk] = useState<CountAsk | null>(null);
    const [busy, setBusy] = useState(false);
    /** The counts the menu item under the pointer would change */
    const [menuRange, setMenuRange] = useState<CountRange | null>(null);
    useEffect(() => {
        if (!menu) setMenuRange(null);
    }, [menu]);
    /** What a menu item, an open editor or the add/remove box is about to change */
    const highlight = menuRange ?? editor?.range ?? ask?.range ?? null;
    /** A hover explanation (a red dot, a count that found no hit) */
    const [tip, setTip] = useState<{
        x: number;
        y: number;
        text: string;
    } | null>(null);

    // Tempo edits aren't mutations, so the title bar's undo and redo don't hear of them otherwise
    useEffect(
        () =>
            subscribeHistoryChanges(() => {
                void queryClient.invalidateQueries({
                    queryKey: historyKeys.all(),
                });
            }),
        [],
    );
    // The counts a fit found no hit for are marked until the counts change under them (an undo,
    // a redo, another edit); leaving tempo mode clears them, the selection and the fit's note
    const unsureFor = useRef<{ durations: number[]; landed: boolean } | null>(
        null,
    );
    useEffect(() => {
        const watch = unsureFor.current;
        if (!watch) return;
        if (useTempoUi.getState().unsure.size === 0) {
            unsureFor.current = null;
            return;
        }
        const n = Math.min(watch.durations.length, data.durations.length);
        let same = true;
        for (let b = 1; b < n && same; b++)
            same = Math.abs(watch.durations[b]! - data.durations[b]!) < 1e-6;
        if (same) {
            watch.landed = true;
            return;
        }
        if (!watch.landed) return; // the fit isn't written yet
        unsureFor.current = null;
        useTempoUi.getState().setUnsure(new Set());
        toast.dismiss(NOTE_TOAST);
    }, [data.durations]);
    useEffect(
        () => () => {
            const state = useTempoUi.getState();
            state.setRange(null);
            state.setUnsure(new Set());
            toast.dismiss(NOTE_TOAST);
        },
        [],
    );

    const durations = preview?.durations ?? data.durations;
    const locks = preview?.locks ?? data.locks;
    const starts = useMemo(() => startsOf(durations), [durations]);
    // Eighths per count, from each measure's grouping (2 = a quarter): the tempo lane reads in
    // quarter notes, so 7/8 as 2+2+3 at ♩=176 reads 176, not a sawtooth
    const units = useMemo(() => {
        const out: number[] = [];
        for (const m of data.measures) {
            if (!m.meter) continue;
            const g = meterOfMeasure(m).grouping;
            if (g.length !== m.counts) continue;
            g.forEach((u, i) => (out[m.start + i] = u));
        }
        return out;
    }, [data.measures]);
    /** Count `b`'s tempo, in quarter notes per minute */
    const qBpm = useCallback(
        (b: number, d: readonly number[] = durations) =>
            quarterBpmOf(d[b]!, units[b] ?? 2),
        [durations, units],
    );
    // Holds aren't tempo: the tempo lane leaves them out
    const segments = useMemo(() => {
        // in quarter-note lengths, so groupings read as one tempo
        const q = (b: number) => (durations[b] ?? 0) / ((units[b] ?? 2) / 2);
        const d = durations.slice(0, data.storedCount).map((_, b) => {
            if (!data.holds.has(b)) return q(b);
            let n = b - 1;
            while (n > 0 && data.holds.has(n)) n--;
            return q(n);
        });
        return tempoSegments(d, 1.2);
    }, [durations, data.storedCount, data.holds, units]);

    // Visible spec beats
    const firstBeat = Math.max(1, Math.floor(beatAtX(win.left, ppb)) - 1);
    const lastBeat = Math.min(
        durations.length - 1,
        Math.ceil(beatAtX(win.left + win.width, ppb)) + 1,
    );

    // The tempo lane's scale: the show's range (holds left out), with room
    const bpmScale = useMemo(() => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let b = 1; b < durations.length; b++) {
            if (data.holds.has(b)) continue;
            const bpm = qBpm(b);
            if (bpm < lo) lo = bpm;
            if (bpm > hi) hi = bpm;
        }
        if (!Number.isFinite(lo)) return { lo: 60, hi: 180 };
        const pad = Math.max(12, (hi - lo) * 0.2);
        return { lo: Math.max(10, lo - pad), hi: hi + pad };
    }, [durations, data.holds, qBpm]);
    const yOfBpm = useCallback(
        (bpm: number) =>
            TEMPO.top +
            4 +
            Math.min(
                1,
                Math.max(
                    0,
                    1 - (bpm - bpmScale.lo) / (bpmScale.hi - bpmScale.lo),
                ),
            ) *
                (TEMPO.height - 8),
        [bpmScale],
    );

    // A count whose tempo jumps one way and back is probably one misplaced count line
    const outliers = useMemo(() => {
        const out: {
            beat: number;
            bpm: number;
            before: number;
            after: number;
        }[] = [];
        for (
            let b = Math.max(2, firstBeat);
            b <= lastBeat && b + 1 < data.storedCount;
            b++
        ) {
            if (
                data.holds.has(b) ||
                data.holds.has(b - 1) ||
                data.holds.has(b + 1)
            )
                continue;
            const a = qBpm(b - 1);
            const m = qBpm(b);
            const c = qBpm(b + 1);
            const up = (m - a) / a;
            const down = (c - m) / m;
            if (
                Math.abs(up) > 0.08 &&
                Math.abs(down) > 0.08 &&
                Math.sign(up) !== Math.sign(down)
            )
                out.push({ beat: b, bpm: m, before: a, after: c });
        }
        return out;
    }, [data.holds, data.storedCount, firstBeat, lastBeat, qBpm]);

    const run = useCallback(
        async (label: string, work: () => Promise<unknown>) => {
            if (busy) return;
            setBusy(true);
            try {
                await work();
            } catch (e) {
                toast.error(
                    `${label}: ${e instanceof Error ? e.message : String(e)}`,
                );
            } finally {
                setBusy(false);
                setPreview(null);
            }
        },
        [busy],
    );
    const commit = useCallback(
        (
            label: string,
            result: TempoEditResult | null,
            keepUnsure = false,
            audioOffset?: number,
        ) => {
            if (!result) {
                toast.error(
                    `${label}: that would make a count too fast or too slow`,
                );
                setPreview(null);
                return;
            }
            if (!keepUnsure) useTempoUi.getState().setUnsure(new Set());
            unsureFor.current = keepUnsure
                ? { durations: result.durations, landed: false }
                : null;
            setPreview(result);
            void run(label, () =>
                commitEdit(data, result, refetch, audioOffset),
            );
        },
        [data, refetch, run],
    );

    // ---- drawing -------------------------------------------------------------------------
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.min(win.width, width));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(TEMPO_BAND_HEIGHT * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${TEMPO_BAND_HEIGHT}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, TEMPO_BAND_HEIGHT);
        const root = rootRef.current;
        const text = cssColor(root, "--color-text", "#222");
        const accent = cssColor(root, "--color-accent", "#6442ff");
        const subtle = cssColor(
            root,
            "--color-text-subtitle",
            "rgba(0,0,0,.5)",
        );
        const stroke = cssColor(root, "--color-stroke", "rgba(0,0,0,.1)");
        const yellow = cssColor(root, "--color-yellow", "#c8aa00");
        const red = cssColor(root, "--color-red", "#b03333");
        const ox = -win.left;
        const X = (b: number) => xOf(b, ppb) + ox;
        const xAtSeconds = (t: number) => {
            let b = 1;
            let lo = 1;
            let hi = starts.length - 2;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (starts[mid]! <= t) {
                    b = mid;
                    lo = mid + 1;
                } else hi = mid - 1;
            }
            return X(b) + ((t - starts[b]!) / (durations[b] || 1)) * ppb;
        };

        ctx.fillStyle = stroke;
        ctx.fillRect(0, TEMPO.top, w, 1);
        ctx.fillRect(0, MUSIC.top, w, 1);
        ctx.fillRect(0, MEASURES.top, w, 1);

        if (ui.range) {
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.1;
            ctx.fillRect(
                X(ui.range.from),
                MARKS.top,
                (ui.range.to - ui.range.from) * ppb,
                TEMPO_BAND_HEIGHT - MARKS.top,
            );
            ctx.globalAlpha = 1;
        }
        // what the menu item, editor or add/remove box at hand would change: outlined
        if (highlight) {
            ctx.save();
            ctx.fillStyle = accent;
            ctx.strokeStyle = accent;
            if (highlight.to > highlight.from) {
                const x0 = X(highlight.from);
                const w = (highlight.to - highlight.from) * ppb;
                ctx.globalAlpha = 0.2;
                ctx.fillRect(
                    x0,
                    MEASURES.top,
                    w,
                    TEMPO_BAND_HEIGHT - MEASURES.top,
                );
                ctx.globalAlpha = 1;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(
                    x0 + 0.75,
                    MEASURES.top + 0.75,
                    w - 1.5,
                    TEMPO_BAND_HEIGHT - MEASURES.top - 1.5,
                );
            } else {
                // a spot between two counts (adding a count there)
                ctx.fillRect(
                    X(highlight.from) - 1.5,
                    MEASURES.top,
                    3,
                    TEMPO_BAND_HEIGHT - MEASURES.top,
                );
            }
            ctx.restore();
        }

        // the waveform, count by count: each count's slice of the music fills its width
        if (envelope) {
            const mid = MUSIC.top + MUSIC.height / 2;
            const half = MUSIC.height / 2 - 8;
            const { peaks, rate } = envelope;
            // scale to the loudest bit of the show, so quiet recordings still read
            let loud = 0;
            for (let i = 0; i < peaks.length; i += 7)
                if (peaks[i]! > loud) loud = peaks[i]!;
            const gain = loud > 0 ? 0.95 / loud : 1;
            ctx.fillStyle = subtle;
            ctx.globalAlpha = 0.55;
            for (
                let b = firstBeat;
                b <= lastBeat && b < durations.length;
                b++
            ) {
                const x0 = X(b);
                const t0 = starts[b]!;
                const t1 = starts[b + 1] ?? t0 + durations[b]!;
                const cols = Math.max(1, Math.round(ppb));
                for (let c = 0; c < cols; c++) {
                    const ta = t0 + ((t1 - t0) * c) / cols;
                    const tb = t0 + ((t1 - t0) * (c + 1)) / cols;
                    let peak = 0;
                    const ia = Math.max(0, Math.floor(ta * rate));
                    const ib = Math.min(peaks.length, Math.ceil(tb * rate));
                    for (let i = ia; i < ib; i++)
                        if (peaks[i]! > peak) peak = peaks[i]!;
                    const h = Math.max(0.5, Math.min(1, peak * gain) * half);
                    ctx.fillRect(x0 + c, mid - h, 1, h * 2);
                }
            }
            ctx.globalAlpha = 1;
        }

        // hits in the music: what drags and taps snap to
        if (onsets) {
            ctx.fillStyle = yellow;
            const t0 = starts[firstBeat] ?? 0;
            const t1 = starts[Math.min(lastBeat + 1, starts.length - 1)] ?? t0;
            const { values, rate, startSeconds } = onsets;
            const i0 = Math.max(1, Math.floor((t0 - startSeconds) * rate));
            const i1 = Math.min(
                values.length - 1,
                Math.ceil((t1 - startSeconds) * rate),
            );
            for (let i = i0; i < i1; i++) {
                const v = values[i]!;
                if (v < 0.35 || v < values[i - 1]! || v < values[i + 1]!)
                    continue;
                const x = xAtSeconds(startSeconds + i / rate);
                const h = Math.min(12, 3 + v * 6);
                ctx.globalAlpha = Math.min(1, 0.35 + v * 0.5);
                ctx.beginPath();
                ctx.moveTo(x, MUSIC.top + MUSIC.height - h);
                ctx.lineTo(x - 3, MUSIC.top + MUSIC.height);
                ctx.lineTo(x + 3, MUSIC.top + MUSIC.height);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // count lines: faint, downbeats stronger, pins in the accent with a dot, unsure ones red
        const downbeats = new Set(data.measures.map((m) => m.start));
        for (let b = firstBeat; b <= lastBeat; b++) {
            const x = Math.round(X(b)) + 0.5;
            const pinned = locks.has(b);
            const down = downbeats.has(b);
            const unsure = ui.unsure.has(b);
            if (!pinned && !unsure && ppb < 6 && !down) continue;
            ctx.save();
            ctx.strokeStyle = pinned ? accent : unsure ? red : text;
            ctx.globalAlpha = pinned || unsure ? 1 : down ? 0.5 : 0.16;
            ctx.lineWidth = pinned ? 1.5 : 1;
            if (unsure) ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, TEMPO.top);
            ctx.lineTo(x, MUSIC.top + MUSIC.height);
            ctx.stroke();
            ctx.restore();
            // the handle a count line drags by
            ctx.fillStyle = pinned ? accent : text;
            ctx.globalAlpha = pinned ? 1 : down ? 0.55 : 0.3;
            ctx.beginPath();
            ctx.moveTo(x - 4, MUSIC.top + 1);
            ctx.lineTo(x + 4, MUSIC.top + 1);
            ctx.lineTo(x, MUSIC.top + (pinned ? 10 : 8));
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // holds: the count shaded, with a fermata (an arc over a dot)
        ctx.fillStyle = accent;
        ctx.strokeStyle = accent;
        for (const b of data.holds) {
            if (b < firstBeat || b > lastBeat) continue;
            ctx.globalAlpha = 0.08;
            ctx.fillRect(
                X(b),
                TEMPO.top,
                ppb,
                MUSIC.top + MUSIC.height - TEMPO.top,
            );
            ctx.globalAlpha = 1;
            // centred on the count, as its "hold" label is
            const cx = X(b) + ppb / 2;
            const cy = TEMPO.top + 22;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, 6, Math.PI, 0);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy - 1.5, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // the tempo line: each count's tempo as a step, gaps at holds
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let pen = false;
        for (let b = firstBeat; b <= lastBeat && b < durations.length; b++) {
            if (data.holds.has(b)) {
                pen = false;
                continue;
            }
            const y = yOfBpm(qBpm(b));
            if (!pen) ctx.moveTo(X(b), y);
            else ctx.lineTo(X(b), y);
            ctx.lineTo(X(b + 1), y);
            pen = true;
        }
        ctx.stroke();

        // a count whose tempo jumps one way and back (hover one for why)
        ctx.fillStyle = red;
        for (const o of outliers) {
            ctx.beginPath();
            ctx.arc(X(o.beat) + ppb / 2, yOfBpm(o.bpm), 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // a count line being dragged onto the music: a connector from the line to where it lands
        if (gesture?.kind === "line" && gesture.moved) {
            const x0 = X(gesture.beat);
            const x1 = xAtSeconds(gesture.seconds);
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x0, MUSIC.top + 4);
            ctx.lineTo(x1, MUSIC.top + MUSIC.height - 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x1, MUSIC.top + MUSIC.height - 4, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        if (gesture?.kind === "grab" && gesture.beat !== null) {
            const x = Math.round(X(gesture.beat)) + 0.5;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, MUSIC.top);
            ctx.lineTo(x, MUSIC.top + MUSIC.height);
            ctx.stroke();
        }

        // taps: live, then as drafts
        ctx.fillStyle = accent;
        for (const t of ui.taps ?? []) {
            const x = xAtSeconds(t);
            ctx.fillRect(x - 1, MUSIC.top, 2, MUSIC.height);
        }
        if (ui.draft) {
            ctx.save();
            ctx.strokeStyle = accent;
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 2;
            for (const d of ui.draft) {
                const x = xAtSeconds(d.seconds);
                ctx.beginPath();
                ctx.moveTo(x, MUSIC.top);
                ctx.lineTo(x, MUSIC.top + MUSIC.height);
                ctx.stroke();
            }
            ctx.restore();
        }
    }, [
        qBpm,
        win,
        width,
        ppb,
        envelope,
        onsets,
        durations,
        starts,
        locks,
        data.measures,
        data.holds,
        firstBeat,
        lastBeat,
        yOfBpm,
        gesture,
        outliers,
        highlight,
        ui.range,
        ui.taps,
        ui.draft,
        ui.unsure,
    ]);

    // ---- helpers -------------------------------------------------------------------------
    const localX = (e: { clientX: number }) =>
        e.clientX - rootRef.current!.getBoundingClientRect().left;
    const localY = (e: { clientY: number }) =>
        e.clientY - rootRef.current!.getBoundingClientRect().top;
    const secondsAtX = (x: number) => {
        const beat = beatAtX(x, ppb);
        const b = Math.max(1, Math.min(durations.length - 1, Math.floor(beat)));
        return starts[b]! + (beat - b) * durations[b]!;
    };
    /** Snap to a hit within 0.12 s, or 8 px of music where a count holds a lot of it (a hold) */
    const snapSeconds = (s: number, alt: boolean, window = 0.12) => {
        if (!ui.snap || alt || !onsets) return s;
        let b = 1;
        while (b + 1 < starts.length - 1 && starts[b + 1]! <= s) b++;
        const perPx = (durations[b] ?? 0.5) / ppb;
        return snapToOnset(onsets, s, Math.max(window, 8 * perPx));
    };
    const segmentAt = (beat: number) =>
        segments.find((s) => beat >= s.from && beat < s.to) ?? null;
    const measureAt = (beat: number) => {
        let found = data.measures[0];
        for (const m of data.measures) if (m.start <= beat) found = m;
        return found ?? null;
    };
    const measureLabel = (beat: number) => {
        const m = measureAt(beat);
        return m
            ? `m. ${m.number} count ${beat - m.start + 1}`
            : `count ${beat}`;
    };
    /** Counts `from`..`to - 1` in measure words: "m. 11 count 1 to m. 12 count 4" */
    const rangeLabel = (from: number, to: number) =>
        to - from <= 1
            ? measureLabel(from)
            : `${measureLabel(from)} to ${measureLabel(to - 1)}`;
    /** The same, shorter, in measures: "m. 11–12" */
    const measuresLabel = (from: number, to: number) => {
        const a = measureAt(from)?.number;
        const b = measureAt(Math.max(from, to - 1))?.number;
        if (a === undefined || b === undefined) return rangeLabel(from, to);
        return a === b ? `m. ${a}` : `m. ${a}–${b}`;
    };
    /**
     * Where a tempo change from `beat` stops: the end of its tempo segment, or the next pin or
     * hold if that comes first (holds and pins past it are never touched)
     */
    const tempoStretchEnd = (beat: number) => {
        let end = segmentAt(beat)?.to ?? beat + 1;
        const pin = lockAfter(data.locks, beat);
        if (pin !== null && pin < end) end = pin;
        for (const h of data.holds) if (h > beat && h < end) end = h;
        return Math.max(beat + 1, end);
    };
    /** The tempo the music goes on at after `end` (past any holds), or null past the counts */
    const tempoAfter = (end: number) => {
        let b = end;
        while (data.holds.has(b)) b++;
        return b < data.storedCount ? qBpm(b, data.durations) : null;
    };
    const bpmText = (bpm: number) => `♩${Math.round(bpm * 10) / 10}`;
    /** The stretches of counts whose lengths differ, split at `split`, with their tempo before and after */
    const changedStretches = (
        before: readonly number[],
        after: readonly number[],
        split: number,
    ) => {
        const out: (CountRange & { before: number; after: number })[] = [];
        const n = Math.min(before.length, after.length);
        const differs = (b: number) => Math.abs(before[b]! - after[b]!) > 1e-9;
        const bpm = (d: readonly number[], a: number, e: number) => {
            let sum = 0;
            for (let b = a; b < e; b++) sum += d[b]!;
            return ((e - a) * 60) / sum;
        };
        let b = 1;
        while (b < n) {
            if (!differs(b)) {
                b++;
                continue;
            }
            let e = b + 1;
            while (e < n && differs(e) && e !== split) e++;
            out.push({
                from: b,
                to: e,
                before: bpm(before, b, e),
                after: bpm(after, b, e),
            });
            b = e;
        }
        return out;
    };
    /** The count where the music ends (its last hit), or the last count drawn */
    const musicEndBeat = () => {
        const last = data.durations.length - 1;
        if (!onsets) return last;
        let i = onsets.values.length - 1;
        while (i > 0 && onsets.values[i]! < 0.2) i--;
        const t = onsets.startSeconds + i / onsets.rate;
        let b = 1;
        while (b < last && starts[b + 1]! <= t) b++;
        return Math.min(last, b + 1);
    };
    /** The music heard now; for a tap, less how late this person's taps land (the tapping check) */
    const audible = (tap = false) =>
        getLivePlaybackPosition() -
        (LIVE_LEAD +
            (audioContextRef?.outputLatency ?? 0) +
            (tap ? (readTapCheck()?.latency ?? 0) : 0)) *
            getLivePlaybackRate();

    /**
     * Put the start of `beat` at `seconds` of music. Count 1 can't move (the show starts there),
     * so the music moves instead; after a hold, only the hold's length changes; with `one`, only
     * that count line moves; otherwise the counts back to the pin before re-space (scale left,
     * move right).
     */
    const placement = (
        beat: number,
        seconds: number,
        one: boolean,
        base = data,
    ): TempoEditResult | null => {
        if (data.holds.has(beat - 1)) {
            const r = retime(
                base.durations,
                base.locks,
                beat - 1,
                beat,
                [seconds - startsOf(base.durations)[beat - 1]!],
                { hold: true },
            );
            r.locks.add(beat);
            return r;
        }
        return one
            ? moveOneCount(base.durations, base.locks, beat, seconds)
            : moveBeatTo(base.durations, base.locks, beat, seconds);
    };
    const moveMusicToCountOne = (seconds: number) =>
        void run("Music start", async () => {
            // in the show's history: it undoes like any tempo edit
            await writeAudioOffset(data.audioOffset - seconds);
            await queryClient.invalidateQueries({ queryKey: tempoSettingsKey });
            await refetch();
            toast.success(
                `Moved the music ${Math.abs(seconds).toFixed(2)} s ${seconds > 0 ? "earlier" : "later"}, so that hit is on count 1`,
            );
        });

    // ---- tempo edits ---------------------------------------------------------------------
    // Holds keep their length through every tempo edit
    const setTempo = (
        from: number,
        to: number,
        bpmFrom: number,
        bpmTo: number,
    ) =>
        commit(
            "Tempo",
            retime(
                data.durations,
                data.locks,
                from,
                to,
                // quarter-note tempos; a count of a grouping is as long as its eighths
                rampLengths(to - from, bpmFrom, bpmTo).map(
                    (l, i) => (l * (units[from + i] ?? 2)) / 2,
                ),
                { fixed: data.holds },
            ),
        );
    const parseTempo = (value: string): [number, number] | null => {
        const m = value
            .trim()
            .match(/^(\d+(?:\.\d+)?)\s*(?:(?:-|>|→|to)\s*(\d+(?:\.\d+)?))?$/);
        if (!m) return null;
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        return a >= 20 && a <= 400 && b >= 20 && b <= 400 ? [a, b] : null;
    };
    const editTempo = (
        e: { clientX: number; clientY: number },
        from: number,
        to: number,
        current: string,
    ) =>
        setEditor({
            x: e.clientX,
            y: e.clientY,
            value: current,
            hint: `Tempo of ${rangeLabel(from, to)}: "120", or "120-90" to change gradually`,
            range: { from, to },
            onCommit: (value) => {
                const t = parseTempo(value);
                if (t) setTempo(from, to, t[0], t[1]);
                else toast.error(`"${value}" isn't a tempo`);
            },
        });

    /**
     * Fit counts to the hits in the music, never moving a pin (research: detection is
     * suggestions; it fills between pins). Between two pins both ends stay; past the last pin the
     * counts are followed one at a time from the pin, and the ones that found no hit are marked.
     */
    const fitToMusic = (from: number, to: number) => {
        if (!onsets) {
            toast.info("Still listening to the music…");
            return;
        }
        const end = Math.min(to, data.durations.length - 1);
        const plan = planFit({
            env: onsets,
            durations: data.durations,
            locks: data.locks,
            holds: data.holds,
            from,
            to: end,
            measureStarts: data.measures
                .filter((m) => m.id !== null)
                .map((m) => m.start),
        });
        useTempoUi.getState().setUnsure(plan.unsure);
        const parts: string[] = [];
        if (plan.moveMusic !== 0)
            parts.push(
                `Moved the music ${Math.abs(plan.moveMusic).toFixed(2)} s ${plan.moveMusic > 0 ? "earlier" : "later"} so its first hit is on count 1`,
            );
        const last = plan.stoppedAt ?? end;
        parts.push(`Lined up ${rangeLabel(from, last)} with the music`);
        if (plan.stoppedAt !== null)
            parts.push(
                `It lost the music at ${measureLabel(plan.stoppedAt)}: a hold, a meter change or a cut there? Fix it, then Fit again from there`,
            );
        if (plan.unsure.size)
            parts.push(
                `${plan.unsure.size} count(s) found no hit (dashed red)`,
            );
        commit(
            "Fit to the music",
            { ...plan.result, note: parts.join(". ") },
            true,
            plan.moveMusic !== 0
                ? data.audioOffset - plan.moveMusic
                : undefined,
        );
    };

    const scaleSelection = (factor: number) => {
        const r = ui.range;
        if (!r) return;
        if ([...data.locks].some((l) => l > r.from && l < r.to)) {
            toast.error(
                "There are pinned counts in the selection; unpin them first",
            );
            return;
        }
        commit(
            factor < 1 ? "Counts twice as fast" : "Counts half as fast",
            retime(
                data.durations,
                data.locks,
                r.from,
                r.to,
                data.durations.slice(r.from, r.to).map((d) => d * factor),
                { fixed: data.holds },
            ),
        );
    };

    // ---- adding and removing counts ------------------------------------------------------
    // For when the music has an extra or a missing beat: the recording never changes. A breath in
    // the drill with the music as it is ("hold the drill here") ends a move early instead.
    const countEdit = (
        label: string,
        work: () => Promise<CountEditResult>,
        keptText?: (kept: number) => string,
    ) =>
        void run(label, async () => {
            const result = await work();
            await refetch();
            const parts = [label];
            if (result.kept)
                parts.push(
                    keptText?.(result.kept) ??
                        `${result.kept} move(s) kept their counts`,
                );
            if (result.couldNotKeep)
                parts.push(
                    `${result.couldNotKeep} move(s) couldn't keep their counts and changed length`,
                );
            toast.success(parts.join(". "));
        });
    /** The stretch "keep everything else in place" re-divides: the measure, inside the pins */
    const keepSpan = (beat: number, whole: boolean) => {
        const m = measureAt(beat);
        const prevPin = lockBefore(data.locks, beat + 1);
        const nextPin = lockAfter(data.locks, beat);
        if (whole) {
            // a whole measure needs pins either side to take its time from
            return nextPin === null ? null : { a: prevPin, e: nextPin };
        }
        const a = Math.max(m?.start ?? 1, prevPin);
        const e = Math.min(
            (m?.start ?? beat) + (m?.counts ?? 1),
            nextPin ?? Infinity,
        );
        return { a, e };
    };
    /** The page holding count `beat` (spec beat) */
    const pageAt = (beat: number) =>
        pages.find((p) => {
            const start = p.beats[0]?.index;
            return (
                start !== undefined &&
                p.counts > 0 &&
                start <= beat &&
                beat < start + p.counts
            );
        }) ?? null;
    const isPageStart = (beat: number) =>
        pages.some((p) => p.counts > 0 && p.beats[0]?.index === beat);
    /** A move by the page it starts on: "Page 11" */
    const moveName = (m: MoveSpan) => {
        const p = pageAt(m.start);
        return p ? `Page ${p.name}` : `The move from ${measureLabel(m.start)}`;
    };
    const countsText = (n: number) => (n === 1 ? "1 count" : `${n} counts`);
    /** "m. 103 count 4, before C" when a rehearsal mark starts right after */
    const holdSpot = (end: number) => {
        const next = data.measures.find((m) => m.start === end);
        return `${measureLabel(end - 1)}${next?.mark ? `, before ${next.mark}` : ""}`;
    };
    const readMovesSafely = () => readMoves().catch(() => [] as MoveSpan[]);

    const askAdd = async (
        e: { clientX: number; clientY: number },
        at: number,
        count: number,
        what: string,
    ) => {
        const whole = count > 1;
        const span = keepSpan(at === 1 ? 1 : at - 1, whole);
        const len = data.durations[Math.max(1, at - 1)] ?? 0.5;
        const moves = await readMovesSafely();
        const page = pageAt(Math.max(1, at - 1));
        const pageText = page
            ? `Page ${page.name}: ${page.counts} → ${page.counts + count} counts`
            : `${countsText(count)} more`;
        const whose = (m: MoveSpan) =>
            page && moveName(m) === `Page ${page.name}`
                ? "its move"
                : `${moveName(m)}'s move`;
        // The moves the new counts lengthen: one running over the spot, or a page's own move
        // ending at a page boundary (the page before takes the count)
        const grows = moves.filter(
            (m) =>
                m.start < at &&
                (m.end > at || (m.end === at && isPageStart(at))),
        );
        const drill = (choice: CountChoice) => {
            if (grows.length === 0)
                return "No move runs over it, so the marchers hold through it.";
            if (grows.length === 1) {
                const m = grows[0]!;
                const n = m.end - m.start;
                return choice === "keep"
                    ? `${whose(m)} stays ${n} counts and its marchers hold ${countsText(count)} at its end.`
                    : `${whose(m)} stretches from ${n} to ${n + count} counts.`;
            }
            return choice === "keep"
                ? `The ${grows.length} moves over it keep their counts; their marchers hold ${countsText(count)} at each one's end.`
                : `The ${grows.length} moves over it each get ${countsText(count)} longer.`;
        };
        const starts = startsOf(data.durations);
        // The breath instead: the move over the spot ends a count early, no count added
        const breath =
            count === 1
                ? moves.filter(
                      (m) =>
                          m.start < at && m.end >= at && m.end - m.start >= 2,
                  )
                : [];
        const breathText = () => {
            if (breath.length === 1) {
                const m = breath[0]!;
                const n = m.end - m.start;
                return `No count is added and the music stays. ${moveName(m)}: move ${n} → ${n - 1} counts; the marchers hold on ${holdSpot(m.end)}.`;
            }
            return `No count is added and the music stays. The ${breath.length} moves over it end 1 count early; their marchers hold for that count.`;
        };
        setAsk({
            x: e.clientX,
            y: e.clientY,
            title: `Add ${what}`,
            intro: "For when the music has an extra beat here that the counts miss. The recording doesn't change: only the counts do.",
            range: { from: at, to: at },
            keep: span
                ? (() => {
                      const total = starts[span.e]! - starts[span.a]!;
                      const n = span.e - span.a;
                      const tempo = `${bpmText((n * 60) / total)} → ${bpmText(((n + count) * 60) / total)}`;
                      return {
                          text: `${
                              whole
                                  ? `${rangeLabel(span.a, span.e)} make room for it in the same time (${tempo})`
                                  : `${measureLabel(span.a).split(" count")[0]} gets ${n + count} counts in the same time (${tempo})`
                          }. Later counts stay on the music: for when they already are. ${pageText}; ${drill("keep")}`,
                          run: () => {
                              const before = data.durations.slice(
                                  span.a,
                                  span.e,
                              );
                              const withNew = [
                                  ...before.slice(0, at - span.a),
                                  ...Array<number>(count).fill(len),
                                  ...before.slice(at - span.a),
                              ];
                              countEdit(
                                  `Added ${what}`,
                                  () =>
                                      insertCounts({
                                          at,
                                          count,
                                          duration: len,
                                          drill: "keep",
                                          respaced: {
                                              from: span.a,
                                              lengths: respace(
                                                  withNew,
                                                  withNew.length,
                                                  total,
                                              ),
                                          },
                                      }),
                                  (kept) =>
                                      `${kept === 1 ? "The move over it kept its counts: its marchers hold" : `${kept} moves kept their counts: their marchers hold`} ${countsText(count)} at the end`,
                              );
                          },
                      };
                  })()
                : {
                      text: "Pin a count after it first, so there's a stretch of music to fit it into",
                      disabled: "no pin after",
                  },
            shift: {
                text: `${countsText(count)} more time here (${(len * count).toFixed(2)} s): later counts and drill move that much later against the music, for when they were early. ${pageText}; ${drill("shift")}`,
                run: () =>
                    countEdit(`Added ${what}`, () =>
                        insertCounts({
                            at,
                            count,
                            duration: len,
                            drill: "adjust",
                        }),
                    ),
            },
            hold:
                count !== 1
                    ? undefined
                    : breath.length
                      ? {
                            text: breathText(),
                            run: () =>
                                void run("Hold the drill", async () => {
                                    await endMovesEarly({
                                        timelineIds: breath.map((m) => m.id),
                                    });
                                    await refetch();
                                    toast.success(
                                        breathText().replace(
                                            "No count is added and the music stays. ",
                                            "",
                                        ),
                                    );
                                }),
                        }
                      : {
                            text: "For a breath in the drill with the music as it is: no move runs over this spot to end early.",
                            disabled: "no move here",
                        },
        });
    };
    const askRemove = async (
        e: { clientX: number; clientY: number },
        from: number,
        to: number,
    ) => {
        const whole = to - from > 1;
        const what = whole ? rangeLabel(from, to) : measureLabel(from);
        const removed = to - from;
        const span = keepSpan(from, whole);
        const moves = await readMovesSafely();
        const pagesHit = pages.filter((p) => {
            const start = p.beats[0]?.index;
            return (
                start !== undefined &&
                p.counts > 0 &&
                start < to &&
                start + p.counts > from
            );
        });
        const pageText = pagesHit.length
            ? pagesHit
                  .map((p) => {
                      const start = p.beats[0]!.index;
                      const lost =
                          Math.min(to, start + p.counts) -
                          Math.max(from, start);
                      return `Page ${p.name}: ${p.counts} → ${p.counts - lost} counts`;
                  })
                  .join(", ")
            : `${countsText(removed)} fewer`;
        const whose = (m: MoveSpan) =>
            pagesHit.length === 1 && moveName(m) === `Page ${pagesHit[0]!.name}`
                ? "its move"
                : `${moveName(m)}'s move`;
        // The moves that lose counts: the ones running over a removed count
        const losing = moves.filter((m) => m.start < to && m.end > from);
        const drill = (choice: CountChoice) => {
            if (losing.length === 0) return "No move runs over it.";
            if (losing.length === 1) {
                const m = losing[0]!;
                const n = m.end - m.start;
                return choice === "keep"
                    ? `${whose(m)} keeps its ${n} counts by ending ${countsText(removed)} later, if nothing is in the way there.`
                    : `${whose(m)} gets ${countsText(removed)} shorter.`;
            }
            return choice === "keep"
                ? `The ${losing.length} moves over it keep their counts by ending later, if nothing is in the way there.`
                : `The ${losing.length} moves over it get shorter.`;
        };
        const starts = startsOf(data.durations);
        setAsk({
            x: e.clientX,
            y: e.clientY,
            title: `Remove ${what}`,
            intro: "For when the music has fewer beats here than counts. The recording doesn't change: only the counts do.",
            range: { from, to },
            keep:
                span && span.e - span.a > removed
                    ? (() => {
                          const total = starts[span.e]! - starts[span.a]!;
                          const n = span.e - span.a;
                          const tempo = `${bpmText((n * 60) / total)} → ${bpmText(((n - removed) * 60) / total)}`;
                          return {
                              text: `The counts around it fill the same time (${whole ? rangeLabel(span.a, span.e) : measureLabel(span.a).split(" count")[0]}: ${n} → ${n - removed} counts, ${tempo}). Later counts stay on the music: for when they already are. ${pageText}; ${drill("keep")}`,
                              run: () => {
                                  const before = data.durations.slice(
                                      span.a,
                                      span.e,
                                  );
                                  const left = [
                                      ...before.slice(0, from - span.a),
                                      ...before.slice(to - span.a),
                                  ];
                                  countEdit(`Removed ${what}`, () =>
                                      deleteCounts({
                                          from,
                                          to,
                                          drill: "keep",
                                          respaced: {
                                              from: span.a,
                                              lengths: respace(
                                                  left,
                                                  left.length,
                                                  total,
                                              ),
                                          },
                                      }),
                                  );
                              },
                          };
                      })()
                    : {
                          text: "Pin a count after it first, so the counts around it have a stretch of music to fill",
                          disabled: "no pin after",
                      },
            shift: {
                text: `Its time goes too: later counts and drill move earlier against the music, for when they were late. ${pageText}; ${drill("shift")}`,
                run: () =>
                    countEdit(`Removed ${what}`, () =>
                        deleteCounts({ from, to, drill: "adjust" }),
                    ),
            },
        });
    };

    // ---- measures and marks --------------------------------------------------------------
    const setMeasureNumber = (measure: TempoMeasure, value: string) => {
        if (measure.id === null) return;
        const n = value.trim() === "" ? null : Number(value);
        if (n !== null && !Number.isInteger(n)) {
            toast.error(`"${value}" isn't a measure number`);
            return;
        }
        void run("Measure number", async () => {
            await writeMeasureNumber({ measureId: measure.id!, number: n });
            await refetch();
        });
    };
    const nextMarkName = () => {
        const used = new Set(data.measures.map((m) => m.mark).filter(Boolean));
        for (let c = 65; c < 91; c++) {
            const s = String.fromCharCode(c);
            if (!used.has(s)) return s;
        }
        return "";
    };
    const editMark = (
        e: { clientX: number; clientY: number },
        measure: TempoMeasure,
    ) => {
        if (measure.id === null) {
            toast.info("Add pages or counts out here first");
            return;
        }
        setEditor({
            x: e.clientX,
            y: e.clientY,
            value: measure.mark ?? nextMarkName(),
            hint: `Rehearsal mark at measure ${measure.number} (empty removes it)`,
            range: { from: measure.start, to: measure.start + measure.counts },
            onCommit: (value) => {
                const mark = value.trim() || null;
                const write = () =>
                    void run("Rehearsal mark", async () => {
                        await setRehearsalMark({
                            measureId: measure.id!,
                            mark,
                        });
                        await refetch();
                    });
                // The same letter twice is allowed, but not by accident
                const other =
                    mark === null
                        ? undefined
                        : data.measures.find(
                              (o) =>
                                  o.mark === mark &&
                                  o.id !== null &&
                                  o.start !== measure.start,
                          );
                if (!other || mark === null) return write();
                setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    title: `${mark} is already at m. ${other.number}. Use it again?`,
                    items: [
                        {
                            label: `Use ${mark} again at m. ${measure.number}`,
                            onSelect: write,
                        },
                        {
                            label: `Move ${mark} here from m. ${other.number}`,
                            onSelect: () =>
                                void run("Rehearsal mark", async () => {
                                    await moveRehearsalMark({
                                        fromId: other.id!,
                                        toId: measure.id!,
                                        mark,
                                    });
                                    await refetch();
                                }),
                        },
                        { label: "Cancel", onSelect: () => {} },
                    ],
                });
            },
        });
    };
    /** Number measures by hand from `measure` on */
    const renumber = (
        e: { clientX: number; clientY: number },
        measure: TempoMeasure,
    ) => {
        if (measure.id === null) {
            toast.info("Add pages or counts out here first");
            return;
        }
        setEditor({
            x: e.clientX,
            y: e.clientY,
            value: String(measure.number),
            hint: `Renumber from m. ${measure.number}: the measures after count on from the number you give it. Empty goes back to counting on.`,
            range: { from: measure.start, to: measure.start + measure.counts },
            onCommit: (v) => setMeasureNumber(measure, v),
        });
    };
    /** The measure whose rehearsal mark is drawn under `x` (local px), for dragging it */
    const markAtX = (x: number) => {
        const m = measureAt(Math.floor(beatAtX(x, ppb)));
        if (!m?.mark || m.id === null) return null;
        const left = xOf(m.start, ppb);
        return x >= left - 2 && x <= left + 14 + 8 * m.mark.length ? m : null;
    };
    const togglePin = (beat: number) => {
        const next = new Set(data.locks);
        if (next.has(beat)) next.delete(beat);
        else next.add(beat);
        void run("Pin", () => saveMarks({ locks: next }));
    };
    const toggleHold = (beat: number) => {
        const next = new Set(data.holds);
        const making = !next.has(beat);
        if (making) next.add(beat);
        else next.delete(beat);
        void run("Hold", async () => {
            await saveMarks({ holds: next });
            if (making)
                toast.info(
                    `${measureLabel(beat)} is a hold. Drag the next count line (or its hit) to where the music goes on.`,
                );
        });
    };

    // ---- keys while playing: T taps, M drops a rehearsal mark ----------------------------
    const gestureRef = useRef<Gesture | null>(null);
    gestureRef.current = gesture;
    /** Set by Escape: the release that ends the cancelled drag does nothing */
    const cancelGesture = useRef(false);
    const tapsRef = useRef<number[] | null>(null);
    tapsRef.current = ui.taps;
    const [tapCheck, setTapCheck] = useState<null | { thenTap: boolean }>(null);
    const startTapping = useCallback(() => {
        if (!playing) return;
        // Offer (once a session) to check how late this person's taps land; without a check,
        // taps are used as they land
        if (!readTapCheck() && !tapCheckOffered) {
            tapCheckOffered = true;
            setTapCheck({ thenTap: true });
            return;
        }
        const m = measureAt(playheadBeat);
        useTempoUi.getState().setDraft(null);
        useTempoUi.getState().setTaps([]);
        startTimelinePlayOn(
            playing.setIsPlaying,
            Math.max(0, (m?.start ?? playheadBeat) - (m?.counts ?? 4)),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, playheadBeat, data.measures]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            const target = e.target as HTMLElement | null;
            if (
                target?.closest(
                    "input, textarea, select, [contenteditable=true]",
                )
            )
                return;
            const key = e.key.toLowerCase();
            if (e.key === "Escape" && gestureRef.current) {
                e.preventDefault();
                e.stopPropagation();
                cancelGesture.current = true;
                setGesture(null);
                setPreview(null);
                setBlocked(null);
                return;
            }
            const draft = useTempoUi.getState().draft;
            if (
                draft &&
                !isPlaying &&
                (e.key === "Enter" || e.key === "Escape")
            ) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Enter") applyDraft();
                else useTempoUi.getState().setDraft(null);
                return;
            }
            if (key === "t") {
                e.preventDefault();
                e.stopPropagation();
                if (e.repeat) return;
                if (!isPlaying) startTapping();
                else
                    useTempoUi
                        .getState()
                        .setTaps([...(tapsRef.current ?? []), audible(true)]);
            } else if (key === "m" && isPlaying) {
                e.preventDefault();
                e.stopPropagation();
                const t = audible();
                let best: TempoMeasure | null = null;
                for (const m of data.measures)
                    if (
                        m.id !== null &&
                        (!best ||
                            Math.abs(starts[m.start]! - t) <
                                Math.abs(starts[best.start]! - t))
                    )
                        best = m;
                if (!best) return;
                const name = nextMarkName();
                const measure = best;
                void setRehearsalMark({ measureId: measure.id!, mark: name })
                    .then(refetch)
                    .then(() =>
                        toast.success(
                            `Rehearsal mark ${name} at measure ${measure.number}`,
                        ),
                    );
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });
    // Esc leaves tempo mode once nothing else takes it: a drag or taps waiting, a popover of the
    // band's, a dialog or menu, a text field, or selected counts (cleared first)
    const popoverOpen = !!(editor || menu || ask || tapCheck);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented || e.repeat) return;
            if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            if (popoverOpen || gestureRef.current) return;
            const state = useTempoUi.getState();
            if (state.draft || state.taps) return;
            const target = e.target as HTMLElement | null;
            if (
                target?.closest(
                    "input, textarea, select, [contenteditable=true]",
                ) ||
                document.querySelector(
                    '[role="dialog"], [role="alertdialog"], [role="menu"]',
                )
            )
                return;
            e.preventDefault();
            // A selection goes first; Esc with nothing left to clear leaves the mode
            if (state.range) {
                e.stopPropagation();
                state.setRange(null);
                return;
            }
            useTempoModeStore.getState().setOn(false);
        };
        // Before the app's shortcuts, which give Esc to the canvas; the checks above leave a
        // drag, taps and popovers their own Esc
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [popoverOpen]);
    // Stopping turns the pass into drafts (taps that don't fit the counts are dropped)
    const wasPlaying = useRef(isPlaying);
    useEffect(() => {
        const stopped = wasPlaying.current && !isPlaying;
        wasPlaying.current = isPlaying;
        if (!stopped) return;
        const taps = useTempoUi.getState().taps;
        useTempoUi.getState().setTaps(null);
        if (!taps || taps.length === 0) return;
        const snapped = taps.map((t) => snapSeconds(t, false, 0.07));
        const s = startsOf(data.durations);
        let pins = assignTaps(s, snapped);
        // a tap far from where the counts say the next one is (more than 40% off) is a stray
        let strays = 0;
        pins = pins.filter((p, i) => {
            const prev = pins[i - 1];
            if (!prev) return true;
            const expected = s[p.beat]! - s[prev.beat]!;
            const ok =
                Math.abs(p.seconds - prev.seconds - expected) <=
                    0.4 * expected || pins.length < 3;
            if (!ok) strays++;
            return ok;
        });
        const range = useTempoUi.getState().range;
        if (range)
            pins = pins.filter(
                (p) => p.beat >= range.from && p.beat <= range.to,
            );
        if (pins.length === 0) return;
        useTempoUi.getState().setDraft(pins);
        if (strays)
            toast.info(`Left out ${strays} tap(s) that didn't fit the counts`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying]);
    const applyDraft = () => {
        const draft = useTempoUi.getState().draft;
        useTempoUi.getState().setDraft(null);
        if (!draft?.length) return;
        const result = pinBeats(data.durations, data.locks, draft);
        commit(`Tapped ${draft.length} count(s)`, {
            ...result,
            note:
                result.note ??
                `Pinned ${draft.length} tapped count(s) to the music`,
        });
    };
    const tapCue = (() => {
        if (!ui.taps) return null;
        if (ui.taps.length === 0) return "Tap T on the counts";
        const pins = assignTaps(starts, ui.taps);
        const last = pins[pins.length - 1];
        return last ? `Next tap: ${measureLabel(last.beat + 1)}` : null;
    })();

    // ---- pointer -------------------------------------------------------------------------
    const nearLine = (x: number) => {
        const b = Math.round(beatAtX(x, ppb));
        return Math.abs(xOf(b, ppb) - x) <= LINE_GRAB_PX && b >= 1 ? b : null;
    };
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        // the band owns its lanes: the timeline's own scrub mustn't take the press
        e.stopPropagation();
        cancelGesture.current = false;
        if (e.button !== 0 || busy) return;
        setMenu(null);
        setTip(null);
        const x = localX(e);
        const y = localY(e);
        const beat = beatAtX(x, ppb);
        if (y >= MUSIC.top) {
            if (ui.draft) {
                // a click on a draft tap takes it out
                const hit = ui.draft.findIndex(
                    (d) => Math.abs(xOfSeconds(d.seconds) - x) < 5,
                );
                if (hit >= 0) {
                    useTempoUi
                        .getState()
                        .setDraft(ui.draft.filter((_, i) => i !== hit));
                    return;
                }
            }
            const line = y < MUSIC.top + HANDLE_STRIP ? nearLine(x) : null;
            if (line !== null)
                setGesture({
                    kind: "line",
                    beat: line,
                    seconds: starts[line]!,
                    pointerX: x,
                    moved: false,
                    one: e.shiftKey,
                });
            else
                setGesture({
                    kind: "grab",
                    seconds: snapSeconds(secondsAtX(x), e.altKey),
                    pointerX: x,
                    beat: null,
                    one: e.shiftKey,
                });
        } else if (y >= TEMPO.top) {
            const segment = segmentAt(Math.floor(beat));
            if (!segment) return;
            setGesture({ kind: "tempo", segment, startY: y, factor: 1 });
        } else if (y >= MEASURES.top) {
            const b = Math.round(beat);
            setGesture({ kind: "range", anchor: b, to: b });
        } else {
            const m = markAtX(x);
            if (!m) {
                // a click on empty lane space clears the selection
                useTempoUi.getState().setRange(null);
                return;
            }
            setGesture({ kind: "mark", measure: m, to: m.start, moved: false });
        }
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    /** The explanation for what's under the pointer: a red dot, or a count that found no hit */
    const tipAt = (x: number, y: number) => {
        for (const o of outliers) {
            const cx = xOf(o.beat, ppb) + ppb / 2;
            if (
                Math.abs(cx - x) <= Math.max(8, ppb / 2) &&
                Math.abs(yOfBpm(o.bpm) - y) <= 9
            )
                return {
                    x: cx,
                    y: yOfBpm(o.bpm),
                    text: `${measureLabel(o.beat)} is much ${o.bpm > o.before ? "faster" : "slower"} (${bpmText(o.bpm)}) than its neighbours (${bpmText(o.before)}, ${bpmText(o.after)}): a count line may be on the wrong hit. Drag its handle onto the right hit, or leave it if the music really does that.`,
                };
        }
        if (y >= TEMPO.top && ui.unsure.size) {
            const b = Math.round(beatAtX(x, ppb));
            if (ui.unsure.has(b) && Math.abs(xOf(b, ppb) - x) <= 6)
                return {
                    x: xOf(b, ppb),
                    y: Math.max(y, TEMPO.top + 8),
                    text: `No hit in the music near ${measureLabel(b)}: Fit placed it by the tempo around it. Fine in a silence; elsewhere, drag its handle onto the music.`,
                };
        }
        return null;
    };
    const xOfSeconds = (t: number) => {
        let b = 1;
        while (b + 1 < starts.length - 1 && starts[b + 1]! <= t) b++;
        return xOf(b, ppb) + ((t - starts[b]!) / (durations[b] || 1)) * ppb;
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!gesture) {
            const next = tipAt(localX(e), localY(e));
            if (next?.text !== tip?.text) setTip(next);
            return;
        }
        if (cancelGesture.current) return;
        const x = localX(e);
        if (gesture.kind === "mark") {
            // the nearest stored measure's start
            let to = gesture.measure.start;
            for (const m of data.measures)
                if (
                    m.id !== null &&
                    Math.abs(xOf(m.start, ppb) - x) < Math.abs(xOf(to, ppb) - x)
                )
                    to = m.start;
            if (to !== gesture.to || !gesture.moved)
                setGesture({
                    ...gesture,
                    to,
                    moved:
                        gesture.moved ||
                        Math.abs(x - xOf(gesture.measure.start, ppb)) > 6,
                });
            return;
        }
        if (gesture.kind === "grab") {
            if (Math.abs(x - gesture.pointerX) < 3 && gesture.beat === null)
                return;
            const beat = Math.max(1, Math.round(beatAtX(x, ppb)));
            if (beat === 1) {
                setGesture({ ...gesture, beat });
                setBlocked({
                    x: xOf(1, ppb),
                    text: "Drop to move the music so this hit is on count 1",
                });
                return;
            }
            const result = placement(beat, gesture.seconds, gesture.one);
            if (result) {
                setGesture({ ...gesture, beat });
                setPreview(result);
                setBlocked(null);
            } else {
                const lim = moveLimits(data.durations, data.locks, beat);
                setBlocked({
                    x: xOf(beat, ppb),
                    text: `Can't put it on count ${beat}: ${gesture.seconds < lim.min ? lim.minReason : lim.maxReason}`,
                });
            }
        } else if (gesture.kind === "line") {
            if (Math.abs(x - gesture.pointerX) < 3 && !gesture.moved) return;
            let seconds = snapSeconds(secondsAtX(x), e.altKey);
            if (gesture.beat === 1) {
                setGesture({ ...gesture, seconds, moved: true });
                setBlocked({
                    x,
                    text: "Drop to move the music so this spot is on count 1",
                });
                return;
            }
            const lim = moveLimits(data.durations, data.locks, gesture.beat);
            let reason: string | null = null;
            if (seconds < lim.min) {
                seconds = lim.min;
                reason = lim.minReason;
            } else if (seconds > lim.max) {
                seconds = lim.max;
                reason = lim.maxReason;
            }
            setGesture({ ...gesture, seconds, moved: true });
            setBlocked(reason ? { x, text: `Stops here: ${reason}` } : null);
        } else if (gesture.kind === "tempo") {
            const dy = localY(e) - gesture.startY;
            const perPx = (bpmScale.hi - bpmScale.lo) / (TEMPO.height - 8);
            const bpm0 = (gesture.segment.bpmFrom + gesture.segment.bpmTo) / 2;
            const step = e.shiftKey ? 0.1 : 1;
            const bpm = Math.round((bpm0 - dy * perPx) / step) * step;
            const factor = bpm0 / Math.max(20, bpm);
            setGesture({ ...gesture, factor });
            const { from, to } = gesture.segment;
            setPreview(
                retime(
                    data.durations,
                    data.locks,
                    from,
                    to,
                    data.durations.slice(from, to).map((d) => d * factor),
                    { fixed: data.holds },
                ),
            );
        } else {
            setGesture({ ...gesture, to: Math.round(beatAtX(x, ppb)) });
        }
    };
    const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        const g = gesture;
        setGesture(null);
        setBlocked(null);
        if (cancelGesture.current) {
            cancelGesture.current = false;
            setPreview(null);
            return;
        }
        if (!g) return;
        if (g.kind === "mark") {
            const target = data.measures.find((m) => m.start === g.to);
            const mark = g.measure.mark;
            if (
                !g.moved ||
                !target ||
                target.start === g.measure.start ||
                !mark
            )
                return;
            if (target.mark) {
                toast.error(
                    `m. ${target.number} already has rehearsal mark ${target.mark}`,
                );
                return;
            }
            void run("Rehearsal mark", async () => {
                await moveRehearsalMark({
                    fromId: g.measure.id!,
                    toId: target.id!,
                    mark,
                });
                await refetch();
                toast.success(
                    `Moved ${mark} from m. ${g.measure.number} to m. ${target.number}`,
                );
            });
            return;
        }
        if (g.kind === "grab" || (g.kind === "line" && !g.moved)) {
            const beat = g.kind === "grab" ? g.beat : null;
            if (beat === null) {
                useTimelineSelectionStore
                    .getState()
                    .seek(Math.round(beatAtX(localX(e), ppb)));
                // a click on the music clears the selection too
                useTempoUi.getState().setRange(null);
                setPreview(null);
                return;
            }
            if (beat === 1) {
                setPreview(null);
                moveMusicToCountOne((g as { seconds: number }).seconds);
                return;
            }
            if (!preview) return;
            sayRespaced(beat, preview);
            commit(`Pinned ${measureLabel(beat)} to the music`, preview);
        } else if (g.kind === "line") {
            if (g.beat === 1) {
                moveMusicToCountOne(g.seconds);
                return;
            }
            const result = placement(g.beat, g.seconds, g.one);
            if (result) sayRespaced(g.beat, result);
            commit(`Pinned ${measureLabel(g.beat)} to the music`, result);
        } else if (g.kind === "tempo") {
            if (Math.abs(g.factor - 1) < 1e-6) {
                // a click on the tempo lane clears the selection
                useTempoUi.getState().setRange(null);
                setPreview(null);
                return;
            }
            commit("Tempo", preview);
        } else {
            const from = Math.min(g.anchor, g.to);
            const to = Math.max(g.anchor, g.to);
            if (to - from < 1) {
                useTempoUi.getState().setRange(null);
            } else useTempoUi.getState().setRange({ from, to });
        }
    };
    const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const x = localX(e);
        const y = localY(e);
        const beat = beatAtX(x, ppb);
        if (y >= MUSIC.top) {
            const b = nearLine(x);
            if (b !== null && data.locks.has(b)) togglePin(b);
        } else if (y >= TEMPO.top) {
            const s = segmentAt(Math.floor(beat));
            if (s)
                editTempo(
                    e,
                    s.from,
                    s.to,
                    s.ramp
                        ? `${Math.round(s.bpmFrom)}-${Math.round(s.bpmTo)}`
                        : `${Math.round(s.bpmFrom * 10) / 10}`,
                );
        } else if (y >= MEASURES.top) {
            const m = measureAt(beat);
            if (m && m.id !== null) renumber(e, m);
        } else if (y >= MARKS.top) {
            const m = measureAt(beat);
            if (m) editMark(e, m);
        }
    };
    /** After a drag: which counts it re-spaced, when that reaches past the counts beside it */
    const sayRespaced = (beat: number, result: TempoEditResult) => {
        const stretches = changedStretches(
            data.durations,
            result.durations,
            beat,
        );
        if (stretches.every((s) => s.from >= beat - 4 && s.to <= beat + 4))
            return;
        toast.info(
            `Pinned ${measureLabel(beat)}. Re-spaced ${stretches
                .map(
                    (s) =>
                        `${rangeLabel(s.from, s.to)} (${bpmText(s.before)} → ${bpmText(s.after)})`,
                )
                .join("; ")}`,
            { id: "tempo-respaced" },
        );
    };
    const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setTip(null);
        const x = localX(e);
        const y = localY(e);
        // The count under the pointer: every item names the same one
        const beat = Math.max(1, Math.floor(beatAtX(x, ppb)));
        const m = measureAt(beat);
        const range = ui.range;
        const one = { from: beat, to: beat + 1 };
        const items: Menu["items"] = [];
        if (y >= TEMPO.top) {
            items.push(
                data.locks.has(beat)
                    ? {
                          label: `Unpin ${measureLabel(beat)}`,
                          onSelect: () => togglePin(beat),
                          range: { from: beat, to: beat },
                      }
                    : {
                          label: `Pin ${measureLabel(beat)} where it is`,
                          onSelect: () => togglePin(beat),
                          range: { from: beat, to: beat },
                      },
                data.holds.has(beat)
                    ? {
                          label: `${measureLabel(beat)} is not a hold`,
                          onSelect: () => toggleHold(beat),
                          range: one,
                      }
                    : {
                          label: `Make ${measureLabel(beat)} a hold (fermata)`,
                          onSelect: () => toggleHold(beat),
                          range: one,
                      },
            );
            if (!data.holds.has(beat) && beat < data.storedCount) {
                // From this count to the end of its tempo, or the next pin or hold first
                const end = tempoStretchEnd(beat);
                const stretch = { from: beat, to: end };
                const span = rangeLabel(beat, end);
                const current = qBpm(beat, data.durations);
                items.push({
                    label: `Change the tempo from ${span}…`,
                    onSelect: () =>
                        editTempo(e, beat, end, `${Math.round(current)}`),
                    range: stretch,
                });
                const target = tempoAfter(end);
                const same =
                    target === null ||
                    end - beat < 2 ||
                    Math.abs(target - current) < 0.5;
                items.push({
                    label: same
                        ? `Change gradually from ${measureLabel(beat)}`
                        : `Change gradually to ${bpmText(target!)} from ${span}`,
                    onSelect: () =>
                        target !== null && setTempo(beat, end, current, target),
                    disabled: same,
                    hint: same
                        ? "Nothing to change to: the tempo after it is the same, or it's one count"
                        : `Ends on the tempo after it (${bpmText(target!)}); holds and pins outside stay as they are`,
                    range: stretch,
                });
            }
        }
        if (range)
            items.push(
                {
                    label: `Fit ${rangeLabel(range.from, range.to)} to the music`,
                    onSelect: () => fitToMusic(range.from, range.to),
                    range,
                },
                {
                    label: `Set the tempo of ${rangeLabel(range.from, range.to)}…`,
                    onSelect: () =>
                        editTempo(
                            e,
                            range.from,
                            range.to,
                            `${Math.round(qBpm(range.from, data.durations))}`,
                        ),
                    range,
                },
                {
                    label: "Counts twice as fast (×2)",
                    onSelect: () => scaleSelection(0.5),
                    range,
                },
                {
                    label: "Counts half as fast (÷2)",
                    onSelect: () => scaleSelection(2),
                    range,
                },
                {
                    label: `Remove ${rangeLabel(range.from, range.to)}…`,
                    onSelect: () => void askRemove(e, range.from, range.to),
                    range,
                },
                {
                    label: "Clear the selection",
                    onSelect: () => useTempoUi.getState().setRange(null),
                },
            );
        else {
            // from the count clicked: what's before it stays as it is
            const from = Math.max(1, beat);
            const end = lockAfter(data.locks, from) ?? musicEndBeat();
            items.push({
                label: `Fit ${rangeLabel(from, end)} to the music`,
                onSelect: () => fitToMusic(from, end),
                range: { from, to: end },
            });
        }
        items.push(
            {
                label: `Add a count before ${measureLabel(beat)}…`,
                onSelect: () =>
                    void askAdd(
                        e,
                        beat,
                        1,
                        `a count before ${measureLabel(beat)}`,
                    ),
                range: { from: beat, to: beat },
            },
            {
                label: `Add a count after ${measureLabel(beat)}…`,
                onSelect: () =>
                    void askAdd(
                        e,
                        beat + 1,
                        1,
                        `a count after ${measureLabel(beat)}`,
                    ),
                range: { from: beat + 1, to: beat + 1 },
            },
            {
                label: `Remove ${measureLabel(beat)}…`,
                onSelect: () => void askRemove(e, beat, beat + 1),
                range: one,
            },
        );
        if (m) {
            const measure = { from: m.start, to: m.start + m.counts };
            items.push(
                {
                    label: `Add a measure before measure ${m.number}…`,
                    onSelect: () =>
                        void askAdd(
                            e,
                            m.start,
                            m.counts,
                            `a measure (${m.counts} counts) before measure ${m.number}`,
                        ),
                    range: { from: m.start, to: m.start },
                },
                {
                    label: `Remove measure ${m.number}…`,
                    onSelect: () =>
                        void askRemove(e, m.start, m.start + m.counts),
                    range: measure,
                },
                {
                    label: `Rehearsal mark at measure ${m.number}…`,
                    onSelect: () => editMark(e, m),
                    range: measure,
                },
                {
                    label: `Renumber from m. ${m.number}…`,
                    onSelect: () => renumber(e, m),
                    range: measure,
                },
                {
                    label: `Time signature from measure ${m.number}…`,
                    onSelect: () =>
                        setMenu(signatureMenu(e.clientX, e.clientY, m.start)),
                },
            );
        }
        setMenu({ x: e.clientX, y: e.clientY, items });
    };
    /**
     * Set a meter with its grouping from the measure at `start` to the next change, at the
     * quarter-note tempo just before it (owner, 2026-10-21: "7/8 2+2+3")
     */
    const setMeter = (start: number, text: string) => {
        const meter = parseMeter(text);
        if (!meter) {
            toast.error(
                `"${text}" isn't a time signature: try 7/8, or 7/8 2+2+3 (the grouping in eighths)`,
            );
            return;
        }
        const plan = planMeter({
            durations: data.durations,
            locks: data.locks,
            measureStarts: data.measures
                .filter((m) => m.id !== null)
                .map((m) => m.start),
            beatCount: data.storedCount,
            start,
            meter,
            // the tempo just before: the counts from `start` on may still be at a guessed tempo
            quarterBpm: qBpm(Math.max(1, start - 1), data.durations),
        });
        const label = meterLabel(meter, true);
        setPreview(plan.result);
        void run("Time signature", async () => {
            await writeMeter({
                plan,
                before: data.durations,
                meter: {
                    meter: `${meter.top}/${meter.bottom}`,
                    grouping: meter.grouping.join("+"),
                },
            });
            await refetch();
            toast.success(
                `${label} from ${measureLabel(plan.from)}, ${meter.grouping.length} counts a measure at ♩${Math.round(plan.quarterBpm * 10) / 10}` +
                    (plan.leftover
                        ? `. The last measure before the next change is short: ${plan.leftover} count(s) (marked *)`
                        : ""),
                { id: NOTE_TOAST },
            );
        });
    };
    const signatureMenu = (x: number, y: number, start: number): Menu => ({
        x,
        y,
        items: [
            ...METER_CHOICES.map((choice) => ({
                label: choice.includes(" ")
                    ? `${choice.split(" ")[0]} counted ${choice.split(" ")[1]}`
                    : choice,
                onSelect: () => setMeter(start, choice),
            })),
            {
                label: "Other… (like 11/8 3+3+3+2)",
                onSelect: () =>
                    setEditor({
                        x,
                        y,
                        value: "",
                        hint: 'Time signature, and how it is counted in eighths: "7/8 2+2+3", "5/8 3+2", "3/2" (counted in quarters)',
                        onCommit: (value) => setMeter(start, value),
                    }),
            },
        ],
    });

    // ---- labels --------------------------------------------------------------------------
    // Placed in order of importance; one that would overlap another (or hide under the lane
    // names) is shortened or left out, so zooming out thins the text instead of piling it up
    const fontFamily = rootRef.current
        ? getComputedStyle(rootRef.current).fontFamily
        : "sans-serif";
    const viewLeft = win.left - geometry.leadingInset;
    const viewRight = viewLeft + win.width;
    const gutterRight = viewLeft + LANE_GUTTER;
    const labelGap = 4;
    const placer = createLabelPlacer(
        [
            // the lane names' column: a label may start right at its edge
            {
                x: viewLeft,
                y: 0,
                w: LANE_GUTTER - labelGap,
                h: TEMPO_BAND_HEIGHT,
            },
        ],
        labelGap,
    );
    const candidates: {
        priority: number;
        boxes: LabelBox[];
        render: (index: number, box: LabelBox) => ReactNode;
    }[] = [];
    // Zoomed out, every 2nd, 4th, 8th... measure is numbered, so the numbers stay evenly spaced
    const visibleMeasures = data.measures.filter(
        (m) => m.start + m.counts >= firstBeat && m.start <= lastBeat,
    );
    const typicalCounts =
        [...visibleMeasures].sort((a, b) => a.counts - b.counts)[
            Math.floor(visibleMeasures.length / 2)
        ]?.counts ?? 4;
    const widestNumber = textWidth(
        String(visibleMeasures[visibleMeasures.length - 1]?.number ?? 99),
        `10px ${fontFamily}`,
    );
    let numberStride = 1;
    while (
        numberStride < 64 &&
        ppb * typicalCounts * numberStride < widestNumber + 3 + labelGap + 2
    )
        numberStride *= 2;
    data.measures.forEach((m, i) => {
        const prev = data.measures[i - 1];
        const next = data.measures[i + 1];
        const visible = m.start + m.counts >= firstBeat && m.start <= lastBeat;
        const changed = !prev || m.counts !== prev.counts;
        const partial =
            !!prev &&
            m.counts < prev.counts &&
            (!next || next.counts !== m.counts);
        if (!visible) return;
        const left = xOf(m.start, ppb);
        const chip = changed && !partial;
        const chipWidth = chip
            ? textWidth(meterLabel(meterOfMeasure(m)), `10px ${fontFamily}`) +
              10
            : 0;
        const measureWidth = ppb * m.counts;
        if (chip)
            candidates.push({
                // a chip wider than its measure (a pickup) gives way to the next measure's
                priority: measureWidth >= chipWidth + 4 ? 0 : 1,
                boxes: [
                    {
                        x: left + 2,
                        y: MEASURES.top + 3,
                        w: chipWidth,
                        h: 16,
                    },
                ],
                render: (_, box) => (
                    <button
                        key={`sig-${m.start}`}
                        type="button"
                        className="bg-fg-1 border-stroke text-text hover:border-accent absolute rounded-full border px-4 text-[10px] leading-[14px] whitespace-nowrap"
                        style={{ left: box.x, top: box.y }}
                        title={`Time signature ${meterLabel(meterOfMeasure(m), true)}: click to change it from here to the next change`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) =>
                            setMenu(
                                signatureMenu(e.clientX, e.clientY, m.start),
                            )
                        }
                    >
                        {meterLabel(meterOfMeasure(m))}
                    </button>
                ),
            });
        const numberText = `${m.number}${partial ? "*" : ""}`;
        const marked = partial || m.overridden;
        const onStride = (m.number - 1) % numberStride === 0;
        const numberWidth = textWidth(
            numberText,
            `${m.overridden ? "bold " : ""}10px ${fontFamily}`,
        );
        candidates.push({
            priority: marked ? 1 : 2,
            // at the measure's start, or after its time signature chip when that was placed;
            // never starting past the measure's end
            boxes: [
                left + 3,
                ...(chip ? [left + 2 + chipWidth + labelGap] : []),
            ]
                .filter(
                    (x) => (marked || onStride) && x < left + measureWidth - 2,
                )
                .map((x) => ({
                    x,
                    y: MEASURES.top + 4,
                    w: numberWidth,
                    h: 14,
                })),
            render: (_, box) => (
                <span
                    key={`n-${m.start}`}
                    title={
                        partial
                            ? `Measure ${m.number}: a short measure, ${m.counts} count(s)`
                            : m.overridden
                              ? `Measure ${m.number}: renumbered by hand; the measures after count on from it. Right-click or double-click to change it.`
                              : undefined
                    }
                    className={`absolute text-[10px] leading-[14px] whitespace-nowrap ${m.overridden ? "text-accent font-bold" : "text-text-subtitle"} ${partial ? "text-red" : ""}`}
                    style={{
                        left: box.x,
                        top: box.y,
                        pointerEvents:
                            partial || m.overridden ? "auto" : "none",
                    }}
                >
                    {numberText}
                </span>
            ),
        });
        if (m.mark) {
            const mark = m.mark;
            candidates.push({
                priority: 0,
                boxes: [
                    {
                        x: left + 1,
                        y: MARKS.top + 2,
                        w: textWidth(mark, `bold 11px ${fontFamily}`) + 8,
                        h: 16,
                    },
                ],
                render: (_, box) => (
                    <span
                        key={`mk-${m.start}`}
                        className={clsx(
                            "bg-accent text-text-invert absolute cursor-grab rounded-[3px] px-4 text-[11px] leading-[16px] font-bold whitespace-nowrap",
                            gesture?.kind === "mark" &&
                                gesture.moved &&
                                gesture.measure.start === m.start &&
                                "opacity-40",
                        )}
                        style={{ left: box.x, top: box.y }}
                        title={`Rehearsal mark ${mark} at m. ${m.number}: drag it to another measure; double-click to rename it`}
                    >
                        {mark}
                    </span>
                ),
            });
        }
    });
    for (const s of segments) {
        if (s.to < firstBeat || s.from > lastBeat) continue;
        // the label stays in view along its segment, right of the lane names
        const left = Math.max(xOf(s.from, ppb), gutterRight) + 3;
        const right = Math.min(xOf(s.to, ppb), viewRight) - 3;
        const from = Math.round(s.bpmFrom);
        // An uneven stretch is labelled with its range, over its highest step, so the label never
        // sits at the height of a step it doesn't name
        let lo = Infinity;
        let hi = -Infinity;
        if (s.uneven)
            for (let b = s.from; b < s.to && b < durations.length; b++) {
                if (data.holds.has(b)) continue;
                const bpm = qBpm(b);
                lo = Math.min(lo, bpm);
                hi = Math.max(hi, bpm);
            }
        const uneven = s.uneven && Number.isFinite(hi);
        const texts = uneven
            ? Math.round(lo) === Math.round(hi)
                ? [`♩${Math.round(hi)}`]
                : [`♩${Math.round(lo)}–${Math.round(hi)}`, `♩${Math.round(hi)}`]
            : s.ramp
              ? [`♩${from}→${Math.round(s.bpmTo)}`, `♩${from}`]
              : [`♩${Math.round(s.bpmFrom * 10) / 10}`, `♩${from}`];
        const y = yOfBpm(uneven ? hi : s.bpmFrom);
        const top = y < TEMPO.top + 16 ? y + 3 : y - 14;
        const boxes = texts
            .map((text) => ({
                x: left,
                y: top,
                w: textWidth(text, `500 10px ${fontFamily}`),
                h: 12,
            }))
            // only in its own segment, where the line is at its height
            .filter((box) => box.x + box.w <= right);
        candidates.push({
            priority: 1,
            boxes,
            render: (index, box) => (
                <span
                    key={`t-${s.from}`}
                    className="text-accent pointer-events-none absolute text-[10px] leading-[12px] font-medium whitespace-nowrap"
                    style={{ left: box.x, top: box.y }}
                >
                    {texts[index]}
                </span>
            ),
        });
    }
    for (const b of data.holds) {
        if (b < firstBeat || b > lastBeat) continue;
        const seconds = durations[b]!.toFixed(1);
        const texts = [`hold ${seconds}s`, `${seconds}s`];
        const center = xOf(b, ppb) + ppb / 2;
        candidates.push({
            priority: 0,
            boxes: texts.map((text) => {
                const w = textWidth(text, `11px ${fontFamily}`);
                return { x: center - w / 2, y: TEMPO.top + 26, w, h: 12 };
            }),
            render: (index, box) => (
                <span
                    key={`h-${b}`}
                    className="text-accent pointer-events-none absolute text-[11px] leading-[12px] whitespace-nowrap"
                    style={{ left: box.x, top: box.y }}
                >
                    {texts[index]}
                </span>
            ),
        });
    }
    const labels: ReactNode[] = [];
    // stable: within a priority, left to right
    candidates
        .map((c, order) => ({ c, order }))
        .sort((a, b) => a.c.priority - b.c.priority || a.order - b.order)
        .forEach(({ c }) => {
            const index = placer.place(c.boxes);
            if (index >= 0) labels.push(c.render(index, c.boxes[index]!));
        });
    // While a hit or count line is dragged: the counts it will re-space, with their tempo now
    // and after (sam: a pin re-spaces back to the pin before, which nothing showed)
    const dragBeat =
        gesture?.kind === "grab"
            ? gesture.beat
            : gesture?.kind === "line" && gesture.moved
              ? gesture.beat
              : null;
    if (dragBeat !== null && dragBeat > 1 && gesture) {
        const result =
            gesture.kind === "grab"
                ? preview
                : gesture.kind === "line"
                  ? placement(gesture.beat, gesture.seconds, gesture.one)
                  : null;
        const stretches = result
            ? changedStretches(data.durations, result.durations, dragBeat)
            : [];
        stretches.forEach((st, i) => {
            const left = xOf(st.from, ppb);
            const w = (st.to - st.from) * ppb;
            labels.push(
                <div
                    key={`respace-${i}`}
                    className="border-accent bg-accent/10 pointer-events-none absolute border-x border-dashed"
                    style={{
                        left,
                        width: w,
                        top: TEMPO.top,
                        height: MUSIC.top + MUSIC.height - TEMPO.top,
                    }}
                />,
            );
            const full = `${rangeLabel(st.from, st.to)}: ${bpmText(st.before)} → ${bpmText(st.after)}`;
            const short = `${bpmText(st.before)} → ${bpmText(st.after)}`;
            const text =
                textWidth(full, `11px ${fontFamily}`) + 12 < w ? full : short;
            const tw = textWidth(text, `11px ${fontFamily}`) + 10;
            labels.push(
                <span
                    key={`respace-label-${i}`}
                    data-testid="tempo-respace-label"
                    className="bg-modal border-accent text-accent pointer-events-none absolute z-[5] rounded-[3px] border px-4 text-[11px] leading-[14px] whitespace-nowrap"
                    style={{
                        left: Math.max(
                            gutterRight + 2,
                            Math.min(left + w / 2 - tw / 2, viewRight - tw - 4),
                        ),
                        top: TEMPO.top + 2 + (i % 2) * 17,
                    }}
                >
                    {text}
                </span>,
            );
        });
    }
    // A rehearsal mark being dragged: where it lands
    if (gesture?.kind === "mark" && gesture.moved && gesture.measure.mark) {
        const target = data.measures.find((m) => m.start === gesture.to);
        labels.push(
            <span
                key="mark-drag"
                className={clsx(
                    "text-text-invert pointer-events-none absolute z-[5] rounded-[3px] px-4 text-[11px] leading-[16px] font-bold whitespace-nowrap",
                    target?.mark && target.start !== gesture.measure.start
                        ? "bg-red"
                        : "bg-accent",
                )}
                style={{ left: xOf(gesture.to, ppb) + 1, top: MARKS.top + 2 }}
            >
                {gesture.measure.mark} → m. {target?.number ?? "?"}
            </span>,
        );
    }
    // The selection, with a way to clear it besides Esc
    if (ui.range && ui.range.to >= firstBeat && ui.range.from <= lastBeat) {
        const right = xOf(ui.range.to, ppb);
        labels.push(
            <button
                key="clear-range"
                type="button"
                data-testid="tempo-clear-selection"
                aria-label="Clear the selection"
                title="Clear the selection (Esc)"
                className="bg-accent text-text-invert absolute z-[6] flex size-16 items-center justify-center rounded-full hover:opacity-90"
                style={{
                    left: Math.max(
                        Math.max(gutterRight + 2, xOf(ui.range.from, ppb) + 2),
                        Math.min(right - 18, viewRight - 20),
                    ),
                    top: MARKS.top + 2,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    useTempoUi.getState().setRange(null);
                }}
            >
                <XIcon size={9} weight="bold" aria-hidden />
            </button>,
        );
    }
    if (tip && !gesture) {
        const w = Math.min(300, textWidth(tip.text, `11px ${fontFamily}`) + 16);
        labels.push(
            <div
                key="tip"
                role="tooltip"
                data-testid="tempo-tip"
                className="bg-modal border-stroke text-text shadow-modal pointer-events-none absolute z-[7] rounded-[4px] border px-8 py-4 text-[11px] leading-[14px]"
                style={{
                    left: Math.max(
                        gutterRight + 2,
                        Math.min(tip.x - w / 2, viewRight - w - 4),
                    ),
                    width: w,
                    top: tip.y + 10,
                }}
            >
                {tip.text}
            </div>,
        );
    }
    if (blocked) {
        const w = textWidth(blocked.text, `11px ${fontFamily}`) + 10;
        labels.push(
            <span
                key="blocked"
                className="bg-red text-text-invert pointer-events-none absolute z-[5] rounded-[3px] px-4 text-[11px] whitespace-nowrap"
                style={{
                    left: Math.max(
                        gutterRight + 2,
                        Math.min(blocked.x + 6, viewRight - w - 6),
                    ),
                    top: MUSIC.top + 14,
                }}
            >
                {blocked.text}
            </span>,
        );
    }

    const status =
        tapCue ??
        (onsetStatus === "working"
            ? "Listening to the music…"
            : onsetStatus === "none"
              ? "No music in this show"
              : onsetStatus === "error"
                ? "Couldn't read the music"
                : null);

    return (
        <div
            ref={rootRef}
            data-testid="tempo-band"
            data-ppb={ppb}
            data-offset={data.audioOffset}
            data-pins={[...data.locks].join(",")}
            // for scenario checks: the selection, unsure counts, red dots (beat:x:y), page starts
            data-range={ui.range ? `${ui.range.from}-${ui.range.to}` : ""}
            data-unsure={[...ui.unsure].join(",")}
            data-outliers={outliers
                .map(
                    (o) =>
                        `${o.beat}:${Math.round(xOf(o.beat, ppb) + ppb / 2)}:${Math.round(yOfBpm(o.bpm))}`,
                )
                .join(",")}
            data-page-starts={pages
                .flatMap((p) =>
                    p.counts > 0 && p.beats[0] ? [p.beats[0].index] : [],
                )
                .join(",")}
            data-marks={data.measures
                .flatMap((m) => (m.mark ? [`${m.start}:${m.mark}`] : []))
                .join(",")}
            data-counts={durations
                .slice(1, 400)
                .map((d) => d.toFixed(3))
                .join(",")}
            className="absolute left-0 select-none"
            style={{ top, width, height: TEMPO_BAND_HEIGHT }}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
                e.stopPropagation();
                onPointerMove(e);
            }}
            onPointerUp={(e) => {
                e.stopPropagation();
                onPointerUp(e);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerCancel={() => {
                setGesture(null);
                setPreview(null);
                setBlocked(null);
            }}
            onPointerLeave={() => setTip(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            <canvas
                ref={canvasRef}
                className="pointer-events-none absolute top-0"
                style={{ left: win.left }}
            />
            {labels}
            {/* The lane names, fixed to the view's left edge while it scrolls */}
            <div
                className="border-stroke bg-bg-1 bg-fg-1 absolute top-0 border-r"
                style={{
                    left: viewLeft,
                    width: LANE_GUTTER,
                    height: TEMPO_BAND_HEIGHT,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                {LANES.map((lane) => (
                    <div
                        key={lane.name}
                        className="border-stroke text-text-subtitle absolute inset-x-0 border-b px-4 pt-3 text-[9px] leading-[12px] tracking-wide uppercase"
                        style={{ top: lane.top, height: lane.height }}
                        title={lane.title}
                    >
                        {lane.name}
                    </div>
                ))}
            </div>
            {/* The mode's header, over the transport (in a portal: it is outside the viewport) */}
            {headerSlot &&
                createPortal(
                    <TempoToolbar
                        status={status}
                        busy={busy}
                        tapping={ui.taps !== null}
                        draftCount={ui.draft?.length ?? 0}
                        range={ui.range}
                        rangeText={
                            ui.range
                                ? measuresLabel(ui.range.from, ui.range.to)
                                : null
                        }
                        lockCount={data.locks.size}
                        onFit={() => {
                            const r = ui.range;
                            if (r) return fitToMusic(r.from, r.to);
                            // from the playhead: what's before it stays as it is
                            const from = Math.max(1, Math.floor(playheadBeat));
                            fitToMusic(
                                from,
                                lockAfter(data.locks, from) ?? musicEndBeat(),
                            );
                        }}
                        onTap={() => {
                            if (!playing) return;
                            if (isPlaying)
                                stopTimelinePlayback(playing.setIsPlaying);
                            else startTapping();
                        }}
                        onCheckTapping={() => setTapCheck({ thenTap: false })}
                        onApplyDraft={applyDraft}
                        onDiscardDraft={() =>
                            useTempoUi.getState().setDraft(null)
                        }
                        onClearPins={() =>
                            void run("Pins", () =>
                                saveMarks({ locks: new Set() }),
                            )
                        }
                    />,
                    headerSlot,
                )}
            {/* in a portal: the timeline's viewport clips anything fixed inside it */}
            {editor &&
                createPortal(
                    <InlineEditor
                        editor={editor}
                        onClose={() => setEditor(null)}
                    />,
                    document.body,
                )}
            {menu &&
                createPortal(
                    <ContextMenu
                        menu={menu}
                        onClose={() => setMenu(null)}
                        onHover={setMenuRange}
                    />,
                    document.body,
                )}
            {tapCheck &&
                createPortal(
                    <TapCheckPanel
                        beforeTapping={tapCheck.thenTap}
                        onClose={(
                            result: TapCheckResult | null,
                            tapAnyway?: boolean,
                        ) => {
                            const thenTap = tapCheck.thenTap;
                            setTapCheck(null);
                            if (thenTap && (result || tapAnyway))
                                setTimeout(startTapping, 300);
                        }}
                    />,
                    document.body,
                )}
            {ask &&
                createPortal(
                    <CountAskPopover ask={ask} onClose={() => setAsk(null)} />,
                    document.body,
                )}
        </div>
    );
}

/** A tool button in tempo mode's header, lit when `on` (its colors are either/or, not overrides) */
const toolButton = (on = false, iconOnly = false) =>
    clsx(
        "pointer-events-auto rounded-6 bg-fg-1 hover:border-accent focus-visible:ring-accent flex h-22 shrink-0 items-center gap-4 border text-[11px] whitespace-nowrap outline-hidden focus-visible:ring-2 disabled:opacity-50",
        iconOnly ? "px-4" : "px-8",
        on ? "border-accent text-accent" : "border-stroke text-text",
    );

/**
 * Tempo mode's header row: the mode's name, its tools, a line of status, help and Done. Narrow, the
 * tools drop their words for their icons (the full name is the tooltip) and the status shortens.
 */
function TempoToolbar(props: {
    status: string | null;
    busy: boolean;
    tapping: boolean;
    draftCount: number;
    range: { from: number; to: number } | null;
    /** The selection in measures ("m. 11–12") */
    rangeText: string | null;
    lockCount: number;
    onFit: () => void;
    onTap: () => void;
    onCheckTapping: () => void;
    onApplyDraft: () => void;
    onDiscardDraft: () => void;
    onClearPins: () => void;
}) {
    const ui = useTempoUi();
    const click = useMetronomeStore((s) => s.isMetronomeOn);
    const toggleClick = useMetronomeStore((s) => s.toggleMetronome);
    const fitName = props.range
        ? `Fit to the music: ${props.rangeText}`
        : "Fit to the music";
    return (
        <TransportTooltipProvider>
            <div
                className="@container flex min-w-0 flex-1 items-center gap-6 px-8"
                // In a portal: the band's own pointer handling mustn't see these
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
            >
                <span className="text-accent flex shrink-0 items-center gap-4 text-[12px] font-bold whitespace-nowrap">
                    <MetronomeIcon size={14} weight="bold" aria-hidden />
                    <span className="@max-[640px]:hidden">Tempo mode</span>
                </span>
                <span className="bg-stroke h-16 w-px shrink-0" aria-hidden />
                {props.draftCount > 0 ? (
                    <>
                        <span
                            className="min-w-0 truncate text-[11px]"
                            title="Click a tap in the music to drop it"
                        >
                            {props.draftCount} taps to check
                            <span className="text-text-subtitle @max-[720px]:hidden">
                                {" "}
                                · click one to drop it
                            </span>
                        </span>
                        <ShortcutTooltip
                            label="Apply the taps"
                            shortcut="Enter"
                        >
                            <button
                                type="button"
                                className={toolButton(true)}
                                onClick={props.onApplyDraft}
                            >
                                <CheckIcon
                                    size={12}
                                    weight="bold"
                                    aria-hidden
                                />
                                Apply
                            </button>
                        </ShortcutTooltip>
                        <ShortcutTooltip
                            label="Discard the taps"
                            shortcut="Esc"
                        >
                            <button
                                type="button"
                                className={toolButton()}
                                onClick={props.onDiscardDraft}
                            >
                                Discard
                            </button>
                        </ShortcutTooltip>
                    </>
                ) : (
                    <>
                        <ShortcutTooltip
                            label={fitName}
                            hint="Moves counts onto hits in the music between pins, from the playhead or across the selected counts. Pinned counts never move."
                        >
                            <button
                                type="button"
                                aria-label={fitName}
                                className={toolButton()}
                                disabled={props.busy}
                                onClick={props.onFit}
                            >
                                <MagicWandIcon size={12} aria-hidden />
                                <span className="@max-[860px]:hidden">
                                    {props.range
                                        ? `Fit ${props.rangeText}`
                                        : "Fit to the music"}
                                </span>
                            </button>
                        </ShortcutTooltip>
                        <ShortcutTooltip
                            label={
                                props.tapping
                                    ? "Tapping: stop to review"
                                    : "Tap along"
                            }
                            shortcut="T"
                            hint="Plays from a measure before the playhead: tap T on the counts, then stop to review the taps"
                        >
                            <button
                                type="button"
                                aria-label={
                                    props.tapping ? "Stop tapping" : "Tap (T)"
                                }
                                className={toolButton(props.tapping)}
                                onClick={props.onTap}
                            >
                                <HandTapIcon size={12} aria-hidden />
                                <span className="@max-[860px]:hidden">
                                    {props.tapping ? "Stop" : "Tap"}
                                </span>
                            </button>
                        </ShortcutTooltip>
                    </>
                )}
                <ShortcutTooltip
                    label={click ? "Click: on" : "Click: off"}
                    hint="A click on every count, to hear whether the counts sit on the music"
                >
                    <button
                        type="button"
                        aria-label="Click"
                        aria-pressed={click}
                        className={toolButton(click)}
                        onClick={toggleClick}
                    >
                        <SpeakerHighIcon size={12} aria-hidden />
                        <span className="@max-[860px]:hidden">Click</span>
                    </button>
                </ShortcutTooltip>
                <ShortcutTooltip
                    label={ui.snap ? "Snap to hits: on" : "Snap to hits: off"}
                    hint="Dragged counts and taps land on hits in the music. Hold Alt while dragging to place freely."
                >
                    <button
                        type="button"
                        aria-label="Snap to hits"
                        aria-pressed={ui.snap}
                        className={toolButton(ui.snap)}
                        onClick={() => ui.setSnap(!ui.snap)}
                    >
                        <MagnetIcon size={12} aria-hidden />
                        <span className="@max-[860px]:hidden">Snap</span>
                    </button>
                </ShortcutTooltip>
                {props.lockCount > 0 && (
                    <ShortcutTooltip
                        label={`Unpin all ${props.lockCount} pinned counts`}
                        hint="Pinned counts stay where they are when you fit or drag"
                    >
                        <button
                            type="button"
                            aria-label={`Unpin all (${props.lockCount})`}
                            className={toolButton()}
                            onClick={props.onClearPins}
                        >
                            <PushPinSlashIcon size={12} aria-hidden />
                            <span className="@max-[860px]:hidden">
                                Unpin all
                            </span>
                            <span className="text-text-subtitle tabular-nums">
                                {props.lockCount}
                            </span>
                        </button>
                    </ShortcutTooltip>
                )}
                <span
                    className="text-text-subtitle min-w-0 flex-1 truncate text-[11px]"
                    title={props.status ?? DRAG_HINT}
                >
                    {props.status ?? DRAG_HINT}
                </span>
                <ShortcutTooltip
                    label="Check tapping"
                    hint="Tap along to a click for 10 seconds: measures how late your taps land on this computer, and how even they are"
                >
                    <button
                        type="button"
                        aria-label="Check tapping"
                        className={toolButton()}
                        onClick={props.onCheckTapping}
                    >
                        <TimerIcon size={12} aria-hidden />
                        <span className="@max-[1100px]:hidden">
                            Check tapping
                        </span>
                    </button>
                </ShortcutTooltip>
                <TempoHelp />
                <ShortcutTooltip label="Done: leave tempo mode" shortcut="Esc">
                    <button
                        type="button"
                        aria-label="Done"
                        className="bg-accent text-text-invert rounded-6 focus-visible:ring-accent pointer-events-auto flex h-22 shrink-0 items-center gap-4 px-10 text-[11px] font-bold whitespace-nowrap outline-hidden hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-1"
                        onClick={() =>
                            useTempoModeStore.getState().setOn(false)
                        }
                    >
                        <CheckIcon size={12} weight="bold" aria-hidden />
                        Done
                    </button>
                </ShortcutTooltip>
            </div>
        </TransportTooltipProvider>
    );
}

/** The toolbar's line when there's nothing to report: the main gesture */
const DRAG_HINT = "Drag a hit in the music onto its count";

/** How tempo mode works, behind a "?" in its header */
function TempoHelp() {
    const rows: [string, string][] = [
        ["Drag a hit in the music", "onto its count"],
        [
            "Drag a count's handle",
            "(the triangle atop the music) onto the music",
        ],
        ["Shift while dragging", "moves just that count"],
        ["Alt while dragging", "places it without snapping to hits"],
        ["Drag the tempo line", "up or down; double-click it to type a tempo"],
        ["Drag along Measures", "selects counts to fit or edit"],
        [
            "Right-click",
            "pins, holds, tempo changes, adding and removing counts",
        ],
        [
            "Right-click a measure",
            "renumber from there (or double-click its number), rehearsal mark, time signature",
        ],
        ["Drag a rehearsal mark", "to another measure"],
    ];
    const keys: [string, string][] = [
        ["T", "Tap along (plays from a measure back)"],
        ["M", "Drop a rehearsal mark while playing"],
        ["Enter", "Apply taps"],
        [
            "Esc",
            "Clear the selection, or cancel a drag or taps; with nothing to clear, leave tempo mode",
        ],
        ["Shift + T", "Tempo mode on and off"],
    ];
    return (
        <Popover.Root>
            <ShortcutTooltip label="How tempo mode works">
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label="How tempo mode works"
                        className={toolButton(false, true)}
                    >
                        <QuestionIcon size={13} aria-hidden />
                    </button>
                </Popover.Trigger>
            </ShortcutTooltip>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    className="border-stroke bg-modal text-text shadow-modal rounded-8 z-[100] flex w-[340px] max-w-[calc(100vw-16px)] flex-col gap-8 border px-12 py-10 backdrop-blur-md"
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <div className="text-[12px] font-bold">
                        Line the counts up with the music
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-[11px]">
                        {rows.map(([what, how]) => (
                            <Fragment key={what}>
                                <dt className="font-medium whitespace-nowrap">
                                    {what}
                                </dt>
                                <dd className="text-text-subtitle">{how}</dd>
                            </Fragment>
                        ))}
                    </dl>
                    <dl className="border-stroke grid grid-cols-[auto_1fr] items-center gap-x-8 gap-y-3 border-t pt-8 text-[11px]">
                        {keys.map(([key, what]) => (
                            <Fragment key={key}>
                                <dt>
                                    <Keycaps shortcut={key} />
                                </dt>
                                <dd className="text-text-subtitle">{what}</dd>
                            </Fragment>
                        ))}
                    </dl>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function CountAskPopover({
    ask,
    onClose,
}: {
    ask: CountAsk;
    onClose: () => void;
}) {
    const ui = useTempoUi();
    const keepOk = "run" in ask.keep;
    const preferred: CountChoice = keepOk ? ui.choice : "shift";
    const choose = (choice: CountChoice | "hold") => {
        if (choice === "hold") {
            if (!ask.hold || !("run" in ask.hold)) return;
            onClose();
            ask.hold.run();
            return;
        }
        if (choice === "keep" && !("run" in ask.keep)) return;
        ui.setChoice(choice);
        onClose();
        if (choice === "keep" && "run" in ask.keep) ask.keep.run();
        else ask.shift.run();
    };
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => ref.current?.focus(), []);
    const boxRef = useRef<HTMLDivElement>(null);
    const position = useOnScreen(boxRef, ask.x, ask.y, "above", ask);
    // Esc cancels wherever the focus is, and only cancels (tempo mode stays on)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);
    const option = (
        choice: CountChoice | "hold",
        title: string,
        text: string,
        disabled?: string,
    ) => (
        <button
            ref={choice === preferred ? ref : undefined}
            type="button"
            disabled={!!disabled}
            className={`rounded-6 border p-8 text-left disabled:opacity-50 ${choice === preferred ? "border-accent" : "border-stroke"} hover:border-accent`}
            onClick={() => choose(choice)}
        >
            <div className="text-[12px] font-bold">{title}</div>
            <div className="text-text-subtitle text-[11px]">{text}</div>
        </button>
    );
    return (
        <div
            ref={boxRef}
            data-testid="tempo-count-ask"
            className="bg-modal shadow-modal text-text border-stroke rounded-6 fixed z-[100] flex max-h-[calc(100vh-16px)] w-[380px] max-w-[calc(100vw-16px)] flex-col gap-6 overflow-y-auto border p-8 shadow-lg backdrop-blur-md"
            style={position}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") onClose();
            }}
        >
            <div className="text-[12px] font-bold">{ask.title}</div>
            <div className="text-text-subtitle text-[11px]">{ask.intro}</div>
            {option(
                "keep",
                "Keep everything else in place",
                ask.keep.text,
                "disabled" in ask.keep ? ask.keep.disabled : undefined,
            )}
            {option("shift", "Shift everything after", ask.shift.text)}
            {ask.hold && (
                <>
                    <div className="text-text-subtitle pt-2 text-[11px]">
                        The music has no extra beat, but the marchers need a
                        breath here?
                    </div>
                    {option(
                        "hold",
                        "Hold the drill here instead",
                        ask.hold.text,
                        "disabled" in ask.hold ? ask.hold.disabled : undefined,
                    )}
                </>
            )}
            <div className="text-text-subtitle text-[10px]">
                The first two remember your last choice. Esc cancels; Undo takes
                any of them back.
            </div>
        </div>
    );
}

function InlineEditor({
    editor,
    onClose,
}: {
    editor: Editor;
    onClose: () => void;
}) {
    const [value, setValue] = useState(editor.value);
    const ref = useRef<HTMLInputElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const position = useOnScreen(boxRef, editor.x, editor.y, "above", editor);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    return (
        <div
            ref={boxRef}
            className="bg-modal shadow-modal text-text border-stroke rounded-6 fixed z-[100] flex max-w-[280px] flex-col gap-4 border p-6 shadow-lg backdrop-blur-md"
            style={position}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <span className="text-text-subtitle text-[11px]">
                {editor.hint}
            </span>
            <input
                ref={ref}
                data-testid="tempo-editor-input"
                className="border-stroke bg-fg-1 rounded-4 border px-6 py-2 text-[13px]"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        editor.onCommit(value);
                        onClose();
                    } else if (e.key === "Escape") onClose();
                }}
                onBlur={onClose}
            />
        </div>
    );
}

function ContextMenu({
    menu,
    onClose,
    onHover,
}: {
    menu: Menu;
    onClose: () => void;
    /** The counts the item under the pointer (or focus) would change, or null */
    onHover: (range: CountRange | null) => void;
}) {
    useEffect(() => {
        const close = () => onClose();
        // Esc closes the menu, and only the menu (not tempo mode)
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        window.addEventListener("pointerdown", close);
        window.addEventListener("blur", close);
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("blur", close);
            window.removeEventListener("keydown", onKey, true);
        };
    }, [onClose]);
    const ref = useRef<HTMLDivElement>(null);
    const position = useOnScreen(ref, menu.x, menu.y, "below", menu);
    return (
        <div
            ref={ref}
            data-testid="tempo-menu"
            className="bg-modal shadow-modal text-text border-stroke rounded-6 fixed z-[100] flex max-h-[calc(100vh-16px)] min-w-[220px] flex-col overflow-y-auto border py-4 shadow-lg backdrop-blur-md"
            style={position}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            onPointerLeave={() => onHover(null)}
        >
            {menu.title && (
                <div className="border-stroke mb-2 border-b px-10 py-4 text-[12px] font-bold whitespace-nowrap">
                    {menu.title}
                </div>
            )}
            {menu.items.map((item) => (
                <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    title={item.hint}
                    className="hover:bg-fg-2 text-text px-10 py-3 text-left text-[12px] whitespace-nowrap disabled:opacity-40"
                    onPointerEnter={() => onHover(item.range ?? null)}
                    onFocus={() => onHover(item.range ?? null)}
                    onClick={() => {
                        onClose();
                        item.onSelect();
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
