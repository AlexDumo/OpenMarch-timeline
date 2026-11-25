/**
 * Record path (prototype, 2026-11-25; research thread "Research recorded live marcher paths"):
 * select marchers, press Record, hear four clicks, then the move under the playhead plays while
 * you drag on the field. Each marcher you drag walks exactly what you dragged (no easing), saved
 * as its exact path (ADR 0018); where it is at the move's last count becomes its end spot, or its
 * old end spot when it ends within a step of it. One undo step for the whole take.
 *
 * - The press can be anywhere on the field: the selected marchers move with the pointer from where
 *   they are (relative, so nobody jumps). Letting go leaves them standing there; pressing again
 *   picks them up from there.
 * - A marcher never dragged in the take keeps its path.
 * - Timing comes from the playback clock in counts, so recording at a slower playback speed plays
 *   back at full speed.
 *
 * Record mode (owner, 2026-11-25; docs/timeline/research/record-mode): Record first arms. The
 * field shows the move's start (the starting form, as the playback cursor, so the playhead and
 * the start flag stay put), the selected marchers are the armed ones, and Space records a take.
 * After a take the field goes back to the start, still armed, for a retake. Done or Escape leaves.
 */
import { create } from "zustand";
import { toast } from "sonner";
import {
    EXACT_DEFAULT_TOLERANCE,
    TICKS_PER_BEAT,
    type ExactPath,
} from "@openmarch/core";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import {
    getLivePlaybackPosition,
    playbackStartInfoRef,
} from "@/components/timeline/audio/AudioPlayer";
import type { CountClock } from "@/timeline/countGrid";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    effectivePlaybackSpeed,
    usePlaybackSpeedStore,
} from "@/stores/PlaybackSpeedStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { timelinePositionsSettled } from "@/timeline/timelineCoordinateWrites";
import { stopTimelinePlayback } from "@/timeline/timelineTransport";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import { setExactPathInTransaction } from "@/db-functions/timelineExactPaths";
import { currentShapeField } from "@/shapes/field/shapeField";
import { moveNameOf } from "@/db-functions/timelineRoutes";
import { translateTimelineText } from "@/timeline/translateTimelineText";
import { groupMoveAt } from "./pathTarget";
import { exactPathFromSamples, type RecordedSample } from "./recordedPath";

/** Clicks before the move plays */
const COUNT_IN = 4;

type XYPoint = { x: number; y: number };

export type RecordPhase = "idle" | "armed" | "countIn" | "recording" | "saving";

interface RecordPathState {
    phase: RecordPhase;
    /** The clicks still to come while counting in (4, 3, 2, 1) */
    countIn: number;
    /** The count playing while recording (1 is the move's first count) */
    count: number;
    /** How many counts the move has */
    counts: number;
    /** Bumped every frame something drawn changes */
    frame: number;
    /** While in Record mode, the armed move's name ("Page 2") */
    moveLabel: string;
}

export const useRecordPathStore = create<RecordPathState>(() => ({
    phase: "idle",
    countIn: 0,
    count: 0,
    counts: 0,
    frame: 0,
    moveLabel: "",
}));

type TakeArgs = {
    countGrid: CountClock;
    setIsPlaying: (playing: boolean) => void;
};

type MoveRange = { timelineId: number; start: number; end: number };

/** Record mode: the move armed, shown at its start, and where the timeline's lines were */
interface Armed extends MoveRange, TakeArgs {
    /** The playhead when armed: the move is the one it is in or arrives at */
    playhead: number;
    startFlag: number;
    unsubscribe: () => void;
}

let armed: Armed | null = null;

/** The move armed in Record mode, or null outside it */
export const armedMove = (): Readonly<MoveRange> | null => armed;

/** One take: everything that isn't drawn state */
interface Take {
    timelineId: number;
    start: number;
    end: number;
    ids: readonly number[];
    countGrid: CountClock;
    setIsPlaying: (playing: boolean) => void;
    /** Where each marcher is now, as shown */
    at: Map<number, XYPoint>;
    /** The samples of each marcher dragged at least once */
    samples: Map<number, RecordedSample[]>;
    /** Held: where the pointer and each marcher were when it went down, and where it is */
    grab: {
        from: XYPoint;
        pointer: XYPoint;
        at: Map<number, XYPoint>;
        /** Pressed during the count-in: the drag starts from wherever the pointer is on count 1 */
        early: boolean;
    } | null;
    /** Marchers let go of: they stand where they were left */
    left: Map<number, XYPoint>;
    /** Playback has started (the clock has reached the move) */
    started: boolean;
    timers: number[];
    frame: number | null;
    audio: AudioContext | null;
}

let take: Take | null = null;

const t = (key: string, fallback: string, params?: Record<string, unknown>) =>
    tolgee.t(key, fallback, params as never);

/** Whether a take is counting in or recording (the field mode is on) */
export const isRecordingPath = (): boolean => {
    const { phase } = useRecordPathStore.getState();
    return phase === "countIn" || phase === "recording";
};

/**
 * Record (Alt+Shift+R), and the transport's record button: arms Record mode, records a take
 * while armed, or ends a take and keeps it
 */
export async function toggleRecordPath(args: TakeArgs): Promise<void> {
    const { phase } = useRecordPathStore.getState();
    if (phase === "countIn" || phase === "recording") {
        await finishTake(true);
        return;
    }
    if (phase === "armed") {
        await recordTake();
        return;
    }
    if (phase !== "idle") return;
    await arm(args);
}

/** Escape while recording: the take is thrown away, nothing is written, still armed */
export function discardRecordPath(): void {
    if (isRecordingPath()) void finishTake(false);
}

/** Done, or Escape while armed: leaves Record mode, and the field shows the playhead again */
export function leaveRecordMode(): void {
    const current = armed;
    if (!current) return;
    armed = null;
    current.unsubscribe();
    if (useRecordPathStore.getState().phase === "armed")
        useRecordPathStore.setState({ phase: "idle", moveLabel: "" });
    useTimelineSelectionStore.getState().clearCursor();
}

/** The move the selected marchers `ids` are in or arrive at at `beat`, or null (with a toast why) */
async function moveFor(
    ids: readonly number[],
    beat: number,
): Promise<MoveRange | null> {
    if (ids.length === 0) {
        toast.info(
            t(
                "pathways.record.selectFirst",
                "Select the marchers to record first",
            ),
        );
        return null;
    }
    // The move the playhead is inside or arrives at (a page's own flag, as everywhere), else
    // the one starting there (the playhead at the show's start)
    let move = await groupMoveAt(db, ids, beat);
    if (move.kind !== "move") move = await groupMoveAt(db, ids, beat + 1e-6);
    if (move.kind === "twoMoves") {
        toast.info(
            t(
                "pathways.record.twoMoves",
                "The selected marchers are in different moves here. Record them one move at a time.",
            ),
        );
        return null;
    }
    if (move.kind === "noMove") {
        toast.info(
            t(
                "pathways.record.noMove",
                "There's no move at the playhead to record. Put the playhead inside a page.",
            ),
        );
        return null;
    }
    return { timelineId: move.timelineId, start: move.start, end: move.end };
}

const selectedIds = (): number[] => [
    ...(activeFieldEditor()?.selected() ?? []),
];

/** Arms Record mode on the move at the playhead: the field shows its start */
async function arm(args: TakeArgs): Promise<void> {
    const selection = useTimelineSelectionStore.getState();
    if (selection.playback) stopTimelinePlayback(args.setIsPlaying);
    await timelinePositionsSettled();
    const { playheadBeat, startBeat } = useTimelineSelectionStore.getState();
    const move = await moveFor(selectedIds(), playheadBeat);
    if (!move || armed || useRecordPathStore.getState().phase !== "idle")
        return;
    armed = {
        ...move,
        ...args,
        playhead: playheadBeat,
        startFlag: startBeat,
        unsubscribe: () => {},
    };
    useRecordPathStore.setState({
        phase: "armed",
        counts: Math.round(move.end - move.start),
        moveLabel: "",
    });
    void labelArmedMove(move.timelineId);
    useTimelineSelectionStore.getState().cue(move.start);
    const current = armed;
    current.unsubscribe = useTimelineSelectionStore.subscribe((s) => {
        if (armed !== current) return;
        if (useRecordPathStore.getState().phase !== "armed") return;
        // Going somewhere else on the timeline leaves Record mode
        if (
            s.playheadBeat !== current.playhead ||
            s.startBeat !== current.startFlag
        ) {
            leaveRecordMode();
            return;
        }
        // Saving a take (or anything else) put the cursor back on the playhead: show the start
        if (s.playback === null && s.cursorBeat !== current.start)
            s.cue(current.start);
    });
}

async function labelArmedMove(timelineId: number): Promise<void> {
    try {
        const name = translateTimelineText(
            await moveNameOf(db as never, timelineId),
        );
        if (armed?.timelineId === timelineId)
            useRecordPathStore.setState({ moveLabel: name });
    } catch {
        // The bar goes without the move's name
    }
}

/** Space or Record while armed: a take of the armed marchers (the selection) */
async function recordTake(): Promise<void> {
    const current = armed;
    if (!current) return;
    const ids = selectedIds();
    const move = await moveFor(ids, current.playhead);
    if (!move || armed !== current) return;
    if (useRecordPathStore.getState().phase !== "armed") return;
    // Another selection can be in another move (Expert): the take is that one's
    if (
        move.timelineId !== current.timelineId ||
        move.start !== current.start
    ) {
        Object.assign(current, move);
        useRecordPathStore.setState({
            counts: Math.round(move.end - move.start),
        });
        void labelArmedMove(move.timelineId);
    }
    startTake(ids, move, current);
}

function startTake(
    ids: readonly number[],
    move: MoveRange,
    { countGrid, setIsPlaying }: TakeArgs,
): void {
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!resolver) return;
    const at = new Map<number, XYPoint>();
    for (const id of ids) {
        const [x, y] = resolver.positionAt(id, move.start);
        at.set(id, { x, y });
    }
    take = {
        timelineId: move.timelineId,
        start: move.start,
        end: move.end,
        ids,
        countGrid,
        setIsPlaying,
        at,
        samples: new Map(),
        grab: null,
        left: new Map(),
        started: false,
        timers: [],
        frame: null,
        audio: null,
    };
    useTimelineSelectionStore.getState().cue(move.start);
    countIn(take);
}

/** Four clicks at the move's tempo and playback speed, then the move plays */
function countIn(current: Take): void {
    const speed = effectivePlaybackSpeed(usePlaybackSpeedStore.getState()) || 1;
    const beatSeconds =
        (current.countGrid.timeAtBeat(current.start + 1) -
            current.countGrid.timeAtBeat(current.start)) /
        speed;
    try {
        current.audio = new AudioContext();
    } catch {
        current.audio = null;
    }
    useRecordPathStore.setState({
        phase: "countIn",
        countIn: COUNT_IN,
        count: 0,
        counts: Math.round(current.end - current.start),
    });
    for (let i = 0; i < COUNT_IN; i++) {
        current.timers.push(
            window.setTimeout(countInBeat, i * beatSeconds * 1000, current, i),
        );
    }
    current.timers.push(
        window.setTimeout(
            () => {
                if (take !== current) return;
                const state = useTimelineSelectionStore.getState();
                state.cue(current.start);
                state.setPlayback({
                    kind: "preview",
                    from: current.start,
                    to: current.end,
                    once: true,
                });
                current.setIsPlaying(true);
                useRecordPathStore.setState({ phase: "recording", count: 1 });
                current.frame = requestAnimationFrame(() => sample(current));
            },
            COUNT_IN * beatSeconds * 1000,
        ),
    );
}

/** Click `i` of the count-in (0 first) */
function countInBeat(current: Take, i: number): void {
    if (take !== current) return;
    click(current.audio, i === 0);
    useRecordPathStore.setState({ countIn: COUNT_IN - i });
}

function click(audio: AudioContext | null, accent: boolean): void {
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.06);
}

/** One frame of the take: where each marcher is at the playing count, kept as a sample */
function sample(current: Take): void {
    if (take !== current) return;
    current.frame = null;
    const playing = useTimelineSelectionStore.getState().playback !== null;
    if (playbackStartInfoRef.current && playing) {
        const beat = current.countGrid.beatAtTime(getLivePlaybackPosition());
        if (!current.started && beat >= current.start - 0.01) {
            current.started = true;
            if (current.grab?.early)
                current.grab = {
                    ...current.grab,
                    from: current.grab.pointer,
                    at: new Map(current.at),
                    early: false,
                };
        }
        if (current.started) {
            const b = Math.min(Math.max(beat, current.start), current.end);
            record(current, b);
            useRecordPathStore.setState((s) => ({
                count: Math.min(s.counts, Math.floor(b - current.start) + 1),
                frame: s.frame + 1,
            }));
            if (beat >= current.end) {
                void finishTake(true);
                return;
            }
        }
    } else if (current.started) {
        // Stopped (Space, Stop): keep what was recorded
        void finishTake(true);
        return;
    }
    current.frame = requestAnimationFrame(() => sample(current));
}

function record(current: Take, beat: number): void {
    const resolver = useTimelineResolverStore.getState().resolver;
    const tick = (beat - current.start) * TICKS_PER_BEAT;
    for (const id of current.ids) {
        let p: XYPoint | undefined;
        if (current.grab) {
            const from = current.grab.at.get(id)!;
            p = {
                x: from.x + current.grab.pointer.x - current.grab.from.x,
                y: from.y + current.grab.pointer.y - current.grab.from.y,
            };
        } else p = current.left.get(id);
        if (!p && resolver) {
            const [x, y] = resolver.positionAt(id, beat);
            p = { x, y };
        }
        if (!p) continue;
        current.at.set(id, p);
        if (current.grab || current.left.has(id)) {
            let list = current.samples.get(id);
            if (!list) {
                // From the move's start to here, the walk it had (it was picked up mid-move)
                list = earlierWalk(current, id, beat);
                current.samples.set(id, list);
            }
            list.push({ tick, x: p.x, y: p.y });
        }
    }
}

/** A marcher first picked up at `beat`: its walk until then, a sample every 1/30 count */
function earlierWalk(
    current: Take,
    id: number,
    beat: number,
): RecordedSample[] {
    const resolver = useTimelineResolverStore.getState().resolver;
    const out: RecordedSample[] = [];
    if (!resolver) return out;
    for (let b = current.start; b < beat; b += 1 / 30) {
        const [x, y] = resolver.positionAt(id, b);
        out.push({ tick: (b - current.start) * TICKS_PER_BEAT, x, y });
    }
    return out;
}

/** The field mode's press: the selected marchers move with the pointer from where they are */
export function recordPress(pointer: XYPoint): void {
    if (!take) return;
    take.grab = {
        from: pointer,
        pointer,
        at: new Map(take.at),
        early: !take.started,
    };
}

export function recordMove(pointer: XYPoint): void {
    if (take?.grab) take.grab.pointer = pointer;
}

export function recordRelease(): void {
    if (!take?.grab) return;
    if (take.started)
        for (const id of take.ids) {
            const p = take.at.get(id);
            if (p) take.left.set(id, p);
        }
    take.grab = null;
}

/** What the field draws while recording: the dragged marchers where they are, and their trails */
export function recordDrawing(): {
    ids: number[];
    spots: XYPoint[];
    trails: XYPoint[][];
} | null {
    const current = take;
    if (!current) return null;
    const ids = [...current.samples.keys()];
    return {
        ids,
        spots: ids.map((id) => current.at.get(id)!),
        trails: ids.map((id) =>
            current.samples.get(id)!.map((s) => ({ x: s.x, y: s.y })),
        ),
    };
}

// eslint-disable-next-line max-lines-per-function
async function finishTake(keep: boolean): Promise<void> {
    const current = take;
    if (!current) return;
    take = null;
    current.timers.forEach((id) => window.clearTimeout(id));
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    void current.audio?.close();
    if (useTimelineSelectionStore.getState().playback)
        stopTimelinePlayback(current.setIsPlaying);
    // Back to Record mode, at the start (the selection store's watcher shows it once stopped)
    const after: RecordPhase = armed ? "armed" : "idle";
    if (!keep || current.samples.size === 0) {
        // Nobody dragged: it was a playback (only what you drag changes)
        useRecordPathStore.setState({ phase: after, countIn: 0, count: 0 });
        return;
    }
    useRecordPathStore.setState({ phase: "saving" });
    try {
        await saveTake(current);
    } catch (error) {
        toastTimelineError(
            error,
            t("pathways.record.saveFailed", "Couldn't save the recorded path"),
        );
    } finally {
        useRecordPathStore.setState({
            phase: armed ? "armed" : "idle",
            countIn: 0,
            count: 0,
        });
        const state = useTimelineSelectionStore.getState();
        if (armed && state.playback === null) state.cue(armed.start);
    }
}

async function saveTake(current: Take): Promise<void> {
    const resolver = useTimelineResolverStore.getState().resolver;
    const step = currentShapeField()?.fieldProperties.pixelsPerStep ?? 11.25;
    const ticks = Math.round((current.end - current.start) * TICKS_PER_BEAT);
    const tolerance = EXACT_DEFAULT_TOLERANCE * (step / 11.25);
    const paths: { marcherId: number; path: ExactPath }[] = [];
    const moves: { marcherId: number; x: number; y: number }[] = [];
    for (const [marcherId, samples] of current.samples) {
        const last = samples[samples.length - 1];
        if (!last) continue;
        // Where it ended is its new end spot, or its old one when that's within a step
        let end = { x: last.x, y: last.y };
        if (resolver) {
            const [ox, oy] = resolver.positionAt(marcherId, current.end);
            if (Math.hypot(ox - end.x, oy - end.y) <= step)
                end = { x: ox, y: oy };
        }
        const path = exactPathFromSamples(
            [...samples, { tick: ticks, ...end }],
            ticks,
            tolerance,
        );
        if (!path) continue;
        paths.push({ marcherId, path });
        moves.push({ marcherId, ...end });
    }
    if (paths.length === 0) return;
    await moveMarchersInTarget({
        db,
        target: { kind: "timeline", timelineId: current.timelineId },
        moves,
        afterWrite: async (tx, timelineId) => {
            for (const { marcherId, path } of paths)
                await setExactPathInTransaction({
                    tx,
                    timelineId: timelineId ?? current.timelineId,
                    marcherId,
                    path,
                });
        },
    });
}
