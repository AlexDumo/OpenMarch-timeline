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
import { useTimingObjects } from "@/hooks/useTimingObjects";
import {
    workspaceSettingsKeys,
    workspaceSettingsQueryOptions,
} from "@/hooks/queries/useWorkspaceSettings";
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
    bpmOf,
    lockAfter,
    lockBefore,
    moveBeatTo,
    moveLimits,
    moveOneCount,
    pinBeats,
    rampLengths,
    regroupMeasures,
    respace,
    retime,
    startsOf,
    tempoSegments,
    type TempoEditResult,
    type TempoSegment,
} from "./tempoMath";
import {
    deleteCounts,
    insertCounts,
    patchWorkspaceSettings,
    regroupMeasuresWrite,
    setMeasureNumber as writeMeasureNumber,
    writeMarks,
    setRehearsalMark,
    writeDurations,
    type CountEditResult,
} from "./tempoWrites";
import { useMusicOnsets } from "./useMusicOnsets";
import { estimateBeatPeriod, fitCountsToOnsets, snapToOnset } from "./onsets";
import { firstCountLength, trackCounts } from "./onsetsTrack";
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
        title: "Rehearsal marks: double-click to name one, or press M while playing to drop the next",
    },
    {
        ...MEASURES,
        name: "Meas.",
        title: "Measures: drag along to select counts, double-click to renumber, click a time signature to change it",
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
    const { data: settings } = useQuery(workspaceSettingsQueryOptions());
    const { data: marks } = useQuery(tempoMarksQuery());
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
            audioOffset: settings?.audioOffsetSeconds ?? 0,
        };
    }, [beats, measures, countGrid, settings, marks, beatCount]);
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
    });
    await refetch();
    if (result.note) toast.info(result.note);
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
    | { kind: "range"; anchor: number; to: number };

interface Editor {
    x: number;
    y: number;
    value: string;
    hint: string;
    onCommit: (value: string) => void;
}

interface Menu {
    x: number;
    y: number;
    items: {
        label: string;
        onSelect: () => void;
        disabled?: boolean;
        hint?: string;
    }[];
}

interface CountAsk {
    x: number;
    y: number;
    title: string;
    keep:
        | { text: string; run: () => void }
        | { text: string; disabled: string };
    shift: { text: string; run: () => void };
}

// eslint-disable-next-line max-lines-per-function
function TempoLanes({ geometry }: { geometry: TimelineBandGeometry }) {
    const { top, width, pixelsPerBeat: ppb, beatCount } = geometry;
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const win = useScrollWindow(rootRef);
    const headerSlot = useHeaderSlot((s) => s.element);
    const data = useTempoData(beatCount);
    const { fetchTimingObjects } = useTimingObjects();
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

    const durations = preview?.durations ?? data.durations;
    const locks = preview?.locks ?? data.locks;
    const starts = useMemo(() => startsOf(durations), [durations]);
    // Holds aren't tempo: the tempo lane leaves them out
    const segments = useMemo(() => {
        const d = durations.slice(0, data.storedCount).map((len, b) => {
            if (!data.holds.has(b)) return len;
            let n = b - 1;
            while (n > 0 && data.holds.has(n)) n--;
            return durations[n] ?? len;
        });
        return tempoSegments(d, 1.2);
    }, [durations, data.storedCount, data.holds]);

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
            const bpm = bpmOf(durations[b]!);
            if (bpm < lo) lo = bpm;
            if (bpm > hi) hi = bpm;
        }
        if (!Number.isFinite(lo)) return { lo: 60, hi: 180 };
        const pad = Math.max(12, (hi - lo) * 0.2);
        return { lo: Math.max(10, lo - pad), hi: hi + pad };
    }, [durations, data.holds]);
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
        (label: string, result: TempoEditResult | null, keepUnsure = false) => {
            if (!result) {
                toast.error(
                    `${label}: that would make a count too fast or too slow`,
                );
                setPreview(null);
                return;
            }
            if (!keepUnsure) useTempoUi.getState().setUnsure(new Set());
            setPreview(result);
            void run(label, () => commitEdit(data, result, refetch));
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
            const y = yOfBpm(bpmOf(durations[b]!));
            if (!pen) ctx.moveTo(X(b), y);
            else ctx.lineTo(X(b), y);
            ctx.lineTo(X(b + 1), y);
            pen = true;
        }
        ctx.stroke();

        // a count whose tempo jumps one way and back is probably one misplaced count line
        ctx.fillStyle = red;
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
            const a = bpmOf(durations[b - 1]!);
            const m = bpmOf(durations[b]!);
            const c = bpmOf(durations[b + 1]!);
            const up = (m - a) / a;
            const down = (c - m) / m;
            if (
                Math.abs(up) > 0.08 &&
                Math.abs(down) > 0.08 &&
                Math.sign(up) !== Math.sign(down)
            ) {
                ctx.beginPath();
                ctx.arc(X(b) + ppb / 2, yOfBpm(m), 3, 0, Math.PI * 2);
                ctx.fill();
            }
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
        win,
        width,
        ppb,
        envelope,
        onsets,
        durations,
        starts,
        locks,
        data.measures,
        data.storedCount,
        data.holds,
        firstBeat,
        lastBeat,
        yOfBpm,
        gesture,
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
            const offset = data.audioOffset - seconds;
            await patchWorkspaceSettings(() => ({
                audioOffsetSeconds: offset,
            }));
            await refetch();
            toast.success(
                `Moved the music ${Math.abs(seconds).toFixed(2)} s ${seconds > 0 ? "earlier" : "later"}, so that hit is on count 1`,
            );
        });

    // ---- tempo edits ---------------------------------------------------------------------
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
                rampLengths(to - from, bpmFrom, bpmTo),
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
            hint: `Tempo of ${measureLabel(from)} to ${measureLabel(to - 1)}: "120", or "120-90" to change gradually`,
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
        // split at the pins inside, so each stretch is fitted between its own pins
        const cuts = [
            from,
            ...[...data.locks]
                .filter((l) => l > from && l < end)
                .sort((a, b) => a - b),
            end,
        ];
        let result: TempoEditResult = {
            durations: [...data.durations],
            locks: new Set(data.locks),
        };
        const unsure = new Set<number>();
        for (let i = 0; i + 1 < cuts.length; i++) {
            const a = cuts[i]!;
            const b = cuts[i + 1]!;
            if (b - a < 1) continue;
            const s = startsOf(result.durations);
            const endPinned =
                result.locks.has(b) || lockAfter(result.locks, a) === b;
            let fitted: number[];
            if (endPinned) {
                fitted = fitCountsToOnsets({
                    env: onsets,
                    guess: s.slice(a, b + 1),
                    startFixed: true,
                    endFixed: true,
                });
            } else {
                const now = (s[b]! - s[a]!) / (b - a);
                const first =
                    firstCountLength(onsets, s[a]!, estimateBeatPeriod) ?? now;
                // the octave nearest the counts as they are
                const len = [first, first / 2, first * 2].reduce((x, y) =>
                    Math.abs(Math.log(y / now)) < Math.abs(Math.log(x / now))
                        ? y
                        : x,
                );
                const tr = trackCounts({
                    env: onsets,
                    start: s[a]!,
                    firstLength: len,
                    counts: b - a,
                });
                fitted = tr.times;
                tr.onHit.forEach((hit, k) => {
                    if (!hit) unsure.add(a + k + 1);
                });
            }
            result = retime(
                result.durations,
                result.locks,
                a,
                b,
                fitted.slice(1).map((t, k) => t - fitted[k]!),
            );
        }
        useTempoUi.getState().setUnsure(unsure);
        commit(
            unsure.size
                ? `Fitted counts ${from}–${end}; ${unsure.size} found no hit (dashed red)`
                : `Fitted counts ${from}–${end} to the music`,
            {
                ...result,
                note: unsure.size
                    ? `${unsure.size} count(s) found no hit in the music: check the dashed red lines`
                    : undefined,
            },
            true,
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
            ),
        );
    };

    // ---- adding and removing counts ------------------------------------------------------
    const countEdit = (label: string, work: () => Promise<CountEditResult>) =>
        void run(label, async () => {
            const result = await work();
            await refetch();
            const parts = [label];
            if (result.kept)
                parts.push(`${result.kept} move(s) kept their counts and hold`);
            if (result.couldNotKeep)
                parts.push(
                    `${result.couldNotKeep} move(s) had no hold to give and changed length`,
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
    const askAdd = (
        e: { clientX: number; clientY: number },
        at: number,
        count: number,
    ) => {
        const whole = count > 1;
        const span = keepSpan(at === 1 ? 1 : at - 1, whole);
        const len = data.durations[Math.max(1, at - 1)] ?? 0.5;
        const what = whole
            ? `a measure (${count} counts) before ${measureLabel(at)}`
            : `a count before ${measureLabel(at)}`;
        setAsk({
            x: e.clientX,
            y: e.clientY,
            title: `Add ${what}`,
            keep: span
                ? {
                      text: whole
                          ? `Counts ${span.a}–${span.e - 1} make room for it in the same time. Drill stays where it is in the music; the move over it holds.`
                          : `${measureLabel(span.a).split(" count")[0]} gets ${span.e - span.a + count} counts in the same time. Later counts and drill stay where they are in the music; the move over it holds.`,
                      run: () => {
                          const before = data.durations.slice(span.a, span.e);
                          const withNew = [
                              ...before.slice(0, at - span.a),
                              ...Array<number>(count).fill(len),
                              ...before.slice(at - span.a),
                          ];
                          const total =
                              startsOf(data.durations)[span.e]! -
                              startsOf(data.durations)[span.a]!;
                          countEdit(`Added ${what}`, () =>
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
                          );
                      },
                  }
                : {
                      text: "Pin a count after it first, so there's a stretch of music to fit it into",
                      disabled: "no pin after",
                  },
            shift: {
                text: `One more count of time here: later counts and drill move ${count === 1 ? "one count" : `${count} counts`} later in the music; the move over it gets longer.`,
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
        });
    };
    const askRemove = (
        e: { clientX: number; clientY: number },
        from: number,
        to: number,
    ) => {
        const whole = to - from > 1;
        const what = whole ? `counts ${from}–${to - 1}` : measureLabel(from);
        const span = keepSpan(from, whole);
        setAsk({
            x: e.clientX,
            y: e.clientY,
            title: `Remove ${what}`,
            keep:
                span && span.e - span.a > to - from
                    ? {
                          text: `The counts around it fill the same time. Later counts and drill stay where they are in the music; the move over it takes the count from a hold where it can.`,
                          run: () => {
                              const before = data.durations.slice(
                                  span.a,
                                  span.e,
                              );
                              const left = [
                                  ...before.slice(0, from - span.a),
                                  ...before.slice(to - span.a),
                              ];
                              const total =
                                  startsOf(data.durations)[span.e]! -
                                  startsOf(data.durations)[span.a]!;
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
                      }
                    : {
                          text: "Pin a count after it first, so the counts around it have a stretch of music to fill",
                          disabled: "no pin after",
                      },
            shift: {
                text: `Its time goes too: later counts and drill move earlier in the music; the move over it gets shorter.`,
                run: () =>
                    countEdit(`Removed ${what}`, () =>
                        deleteCounts({ from, to, drill: "adjust" }),
                    ),
            },
        });
    };

    // ---- measures and marks --------------------------------------------------------------
    const setTimeSignature = (start: number, counts: number) => {
        const r = regroupMeasures(
            data.measures.filter((m) => m.id !== null).map((m) => m.start),
            data.storedCount,
            start,
            counts,
        );
        void run("Time signature", async () => {
            await regroupMeasuresWrite(r);
            await refetch();
            if (r.leftover)
                toast.info(
                    `The last measure before the next change is short: ${r.leftover} count(s) (marked *)`,
                );
        });
    };
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
            onCommit: (value) =>
                void run("Rehearsal mark", async () => {
                    await setRehearsalMark({
                        measureId: measure.id!,
                        mark: value.trim() || null,
                    });
                    await refetch();
                }),
        });
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
                    `Count ${beat} is a hold. Drag the next count line (or its hit) to where the music goes on.`,
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
        // the first time, check how late this person's taps land (and how even they are)
        if (!readTapCheck()) {
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
    // band's, a dialog or menu, or a text field
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
        } else return;
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const xOfSeconds = (t: number) => {
        let b = 1;
        while (b + 1 < starts.length - 1 && starts[b + 1]! <= t) b++;
        return xOf(b, ppb) + ((t - starts[b]!) / (durations[b] || 1)) * ppb;
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!gesture || cancelGesture.current) return;
        const x = localX(e);
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
        if (g.kind === "grab" || (g.kind === "line" && !g.moved)) {
            const beat = g.kind === "grab" ? g.beat : null;
            if (beat === null) {
                useTimelineSelectionStore
                    .getState()
                    .seek(Math.round(beatAtX(localX(e), ppb)));
                setPreview(null);
                return;
            }
            if (beat === 1) {
                setPreview(null);
                moveMusicToCountOne((g as { seconds: number }).seconds);
                return;
            }
            if (!preview) return;
            commit(`Pinned ${measureLabel(beat)} to the music`, preview);
        } else if (g.kind === "line") {
            if (g.beat === 1) {
                moveMusicToCountOne(g.seconds);
                return;
            }
            commit(
                `Pinned ${measureLabel(g.beat)} to the music`,
                placement(g.beat, g.seconds, g.one),
            );
        } else if (g.kind === "tempo") {
            if (Math.abs(g.factor - 1) < 1e-6) {
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
            if (m && m.id !== null)
                setEditor({
                    x: e.clientX,
                    y: e.clientY,
                    value: String(m.number),
                    hint: "Measure number: the measures after count on from it. Empty goes back to counting on.",
                    onCommit: (v) => setMeasureNumber(m, v),
                });
        } else if (y >= MARKS.top) {
            const m = measureAt(beat);
            if (m) editMark(e, m);
        }
    };
    const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const x = localX(e);
        const y = localY(e);
        const beat = Math.max(1, Math.round(beatAtX(x, ppb)));
        const floor = Math.max(1, Math.floor(beatAtX(x, ppb)));
        const m = measureAt(floor);
        const range = ui.range;
        const items: Menu["items"] = [];
        if (y >= TEMPO.top) {
            items.push(
                data.locks.has(beat)
                    ? {
                          label: `Unpin ${measureLabel(beat)}`,
                          onSelect: () => togglePin(beat),
                      }
                    : {
                          label: `Pin ${measureLabel(beat)} where it is`,
                          onSelect: () => togglePin(beat),
                      },
                data.holds.has(floor)
                    ? {
                          label: `${measureLabel(floor)} is not a hold`,
                          onSelect: () => toggleHold(floor),
                      }
                    : {
                          label: `Make ${measureLabel(floor)} a hold (fermata)`,
                          onSelect: () => toggleHold(floor),
                      },
            );
            const seg = segmentAt(floor);
            if (seg) {
                items.push({
                    label: `Change the tempo from ${measureLabel(floor)}…`,
                    onSelect: () =>
                        editTempo(
                            e,
                            floor,
                            seg.to,
                            `${Math.round(bpmOf(data.durations[floor]!))}`,
                        ),
                });
                const next = segments[segments.indexOf(seg) + 1];
                items.push({
                    label: next
                        ? `Change gradually to ♩${Math.round(next.bpmFrom)}`
                        : "Change gradually to the next tempo",
                    onSelect: () =>
                        next &&
                        setTempo(seg.from, seg.to, seg.bpmFrom, next.bpmFrom),
                    disabled: !next,
                });
            }
        }
        if (range)
            items.push(
                {
                    label: `Fit counts ${range.from}–${range.to} to the music`,
                    onSelect: () => fitToMusic(range.from, range.to),
                },
                {
                    label: `Set the tempo of counts ${range.from}–${range.to - 1}…`,
                    onSelect: () =>
                        editTempo(
                            e,
                            range.from,
                            range.to,
                            `${Math.round(bpmOf(data.durations[range.from]!))}`,
                        ),
                },
                {
                    label: "Counts twice as fast (×2)",
                    onSelect: () => scaleSelection(0.5),
                },
                {
                    label: "Counts half as fast (÷2)",
                    onSelect: () => scaleSelection(2),
                },
                {
                    label: `Remove counts ${range.from}–${range.to - 1}…`,
                    onSelect: () => askRemove(e, range.from, range.to),
                },
            );
        else {
            const from = lockBefore(data.locks, beat + 1);
            const end = lockAfter(data.locks, from) ?? musicEndBeat();
            items.push({
                label: `Fit counts ${from}–${end} to the music`,
                onSelect: () => fitToMusic(from, end),
            });
        }
        items.push(
            {
                label: `Add a count before ${measureLabel(beat)}…`,
                onSelect: () => askAdd(e, beat, 1),
            },
            {
                label: `Remove ${measureLabel(floor)}…`,
                onSelect: () => askRemove(e, floor, floor + 1),
            },
        );
        if (m) {
            items.push(
                {
                    label: `Add a measure before measure ${m.number}…`,
                    onSelect: () => askAdd(e, m.start, m.counts),
                },
                {
                    label: `Remove measure ${m.number}…`,
                    onSelect: () => askRemove(e, m.start, m.start + m.counts),
                },
                {
                    label: `Rehearsal mark at measure ${m.number}…`,
                    onSelect: () => editMark(e, m),
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
    const signatureMenu = (x: number, y: number, start: number): Menu => ({
        x,
        y,
        items: [2, 3, 4, 5, 6, 7, 8, 9, 12].map((n) => ({
            label: `${n} counts a measure`,
            onSelect: () => setTimeSignature(start, n),
        })),
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
            ? textWidth(`${m.counts}/4`, `10px ${fontFamily}`) + 10
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
                        title={`Time signature ${m.counts}/4: click to change it from here to the next change`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) =>
                            setMenu(
                                signatureMenu(e.clientX, e.clientY, m.start),
                            )
                        }
                    >
                        {m.counts}/4
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
                              ? `Measure ${m.number}: numbered by hand`
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
                        className="bg-accent text-text-invert pointer-events-none absolute rounded-[3px] px-4 text-[11px] leading-[16px] font-bold whitespace-nowrap"
                        style={{ left: box.x, top: box.y }}
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
        const texts = s.uneven
            ? [`♩~${Math.round((s.bpmFrom + s.bpmTo) / 2)}`]
            : s.ramp
              ? [`♩${from}→${Math.round(s.bpmTo)}`, `♩${from}`]
              : [`♩${Math.round(s.bpmFrom * 10) / 10}`, `♩${from}`];
        const y = yOfBpm(s.bpmFrom);
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
            data-pins={[...data.locks].join(",")}
            data-counts={durations
                .slice(1, 80)
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
                        lockCount={data.locks.size}
                        onFit={() => {
                            const r = ui.range;
                            if (r) return fitToMusic(r.from, r.to);
                            const from = lockBefore(
                                data.locks,
                                Math.round(playheadBeat) + 1,
                            );
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
                    <ContextMenu menu={menu} onClose={() => setMenu(null)} />,
                    document.body,
                )}
            {tapCheck &&
                createPortal(
                    <TapCheckPanel
                        onClose={(result: TapCheckResult | null) => {
                            const thenTap = tapCheck.thenTap;
                            setTapCheck(null);
                            if (thenTap && result)
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
        ? `Fit to the music: counts ${props.range.from}–${props.range.to}`
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
                                        ? `Fit ${props.range.from}–${props.range.to}`
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
        ["Right-click", "pins, holds, adding and removing counts"],
    ];
    const keys: [string, string][] = [
        ["T", "Tap along (plays from a measure back)"],
        ["M", "Drop a rehearsal mark while playing"],
        ["Enter", "Apply taps"],
        ["Esc", "Cancel a drag or taps, or leave tempo mode"],
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
    const choose = (choice: CountChoice) => {
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
        choice: CountChoice,
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
            className="bg-modal shadow-modal text-text border-stroke rounded-6 fixed z-[100] flex w-[340px] max-w-[calc(100vw-16px)] flex-col gap-6 border p-8 shadow-lg backdrop-blur-md"
            style={position}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") onClose();
            }}
        >
            <div className="text-[12px] font-bold">{ask.title}</div>
            {option(
                "keep",
                "Keep everything else in place",
                ask.keep.text,
                "disabled" in ask.keep ? ask.keep.disabled : undefined,
            )}
            {option("shift", "Shift everything after", ask.shift.text)}
            <div className="text-text-subtitle text-[10px]">
                Your choice is remembered for next time. Esc cancels.
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

function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
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
        >
            {menu.items.map((item) => (
                <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    title={item.hint}
                    className="hover:bg-fg-2 text-text px-10 py-3 text-left text-[12px] whitespace-nowrap disabled:opacity-40"
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
