import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    ArrowRightIcon,
    CaretRightIcon,
    CheckIcon,
    HandTapIcon,
    MinusIcon,
    PencilSimpleIcon,
    PlusIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { toast } from "sonner";
import {
    type ComponentPropsWithoutRef,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    measureForMark,
    nextRehearsalMark,
    previousRehearsalMark,
} from "@/timeline/measureLines";
import { clamp } from "./TimelineGeometry";
import type { TimelineXAxis } from "./timelineAxis";
import { measureRowText } from "./measureRowText";
import { isTyping, overlayOpen } from "./timelineHotkeys";
import type {
    BeatPosition,
    TimelineMeasureMarker,
    TimelineViewModel,
} from "./TimelineViewModel";

/**
 * Rehearsal marks and measure lines, edited on the timeline's measure row (tempo experiment E8;
 * 11-ui.md D). They are labels: none of these edits changes counts, timing or drill, none can be
 * refused, and each is one undo entry.
 *
 * - A rehearsal tab seeks on click (owner rule). Double-click it, or focus it and press Enter, to
 *   rename it inline; Delete removes it (the app offers Undo).
 * - R adds a mark at the playhead's measure, named after the previous mark (A, B, … Z, AA, or the
 *   next number). While playing it marks the nearest downbeat at once, without stopping, and lets
 *   you type a name; a show without measures is asked to start one at that count first.
 * - Clicking a measure number names that measure.
 * - Right-clicking the measure row offers measure lines (start one at a count, remove one) and a
 *   measure's beats.
 */

type MeasureId = TimelineMeasureMarker["id"];

/** The measure row's writes. `Timeline` takes spec beats; inside, beats are view beats. */
export interface TimelineMeasureRowCommands {
    /** Names, renames or (null) removes a measure's rehearsal mark */
    readonly onSetMark: (measureId: MeasureId, mark: string | null) => void;
    /** Starts a measure at `beat`, named `mark` when given */
    readonly onStartMeasure: (beat: number, mark?: string) => void;
    /** Removes a measure's line, joining it with the previous measure */
    readonly onRemoveLine: (measureId: MeasureId) => void;
    /** Gives a measure `beats` beats by moving bar lines only */
    readonly onSetBeats: (
        measureId: MeasureId,
        beats: number,
        laterKeep: boolean,
    ) => void;
    /** Re-bars from a measure up to the next rehearsal mark, or to the end */
    readonly onBeatsFrom: (
        measureId: MeasureId,
        beats: number,
        until: "mark" | "end",
    ) => void;
    /**
     * Moves a measure's rehearsal mark to another measure that has none (a tab dragged along the
     * measure row in the Normal view). Without it, tabs don't drag there.
     */
    readonly onMoveMark?: (from: MeasureId, to: MeasureId) => void;
    /**
     * Opens Tap the beat on From here, after the menu seeks to a rehearsal mark ("Tap from here
     * (C)", D4). Without it, the tab's menu doesn't offer it.
     */
    readonly onTapFrom?: () => void;
}

/** What was right-clicked on the measure row, in view beats */
export interface TimelineMeasureRowTarget {
    /** A count tick, a measure (between ticks), or a rehearsal tab */
    readonly kind: "count" | "measure" | "mark";
    /** The count's beat, or the measure's downbeat */
    readonly beat: number;
}

/** The inline input on the measure row, at `atBeat` */
export type MeasureRowEditor =
    | {
          /** Name or rename a measure's mark; `original` is what it holds now */
          readonly kind: "mark";
          readonly measureId: MeasureId;
          readonly atBeat: number;
          readonly initial: string;
          readonly original: string;
          /** R while playing already wrote `initial`; typing renames it */
          readonly addedWhilePlaying?: boolean;
      }
    | {
          /** A mark at a count with no measure: it starts one there */
          readonly kind: "new";
          readonly atBeat: number;
          readonly initial: string;
      }
    | {
          readonly kind: "beats";
          readonly measureId: MeasureId;
          readonly atBeat: number;
          readonly initial: string;
          readonly laterKeep: boolean;
      }
    | {
          readonly kind: "beatsFrom";
          readonly measureId: MeasureId;
          readonly atBeat: number;
          readonly initial: string;
          readonly until: "mark" | "end";
      };

/** The marks' tab and input height, and the beats the menu offers in one click */
const QUICK_BEATS = [2, 3, 4, 5, 6, 7] as const;

const numberOf = (measure: TimelineMeasureMarker) =>
    measure.label.replace(/^m/i, "");

const markOf = (measure: TimelineMeasureMarker | undefined) =>
    measure?.rehearsalMark?.trim() || null;

/** The measures in order, each with its beats (the last runs to the end of the show) */
export const orderedMeasures = (
    model: Pick<TimelineViewModel, "measures" | "beatCount">,
) => {
    const sorted = [...model.measures].sort((a, b) => a.atBeat - b.atBeat);
    return sorted.map((measure, index) => ({
        measure,
        index,
        beats: (sorted[index + 1]?.atBeat ?? model.beatCount) - measure.atBeat,
    }));
};

/** The measure holding `beat`, with its place and beats, or null before the first */
export const measureHolding = (
    model: Pick<TimelineViewModel, "measures" | "beatCount">,
    beat: number,
) => {
    const holding = orderedMeasures(model).filter(
        ({ measure }) => measure.atBeat <= beat,
    );
    return holding[holding.length - 1] ?? null;
};

/** The name R or a click offers for a new mark at `atBeat` */
export const suggestedMark = (
    model: Pick<TimelineViewModel, "measures">,
    atBeat: number,
) =>
    nextRehearsalMark(
        previousRehearsalMark(model.measures, atBeat),
        model.measures.map((m) => m.rehearsalMark),
    );

/**
 * The measure that already has rehearsal mark `name` (case and spaces ignored), other than
 * `exceptId`; null when the name is free. Two Cs make "go to C" ambiguous (FB-9).
 */
export const measureWithMark = (
    measures: readonly TimelineMeasureMarker[],
    name: string,
    exceptId?: MeasureId | null,
): TimelineMeasureMarker | null => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;
    return (
        measures.find(
            (m) => m.id !== exceptId && markOf(m)?.toLowerCase() === wanted,
        ) ?? null
    );
};

/** "There's already a C at m12" */
export const duplicateMarkMessage = (measure: TimelineMeasureMarker) =>
    measureRowText(
        "toast.duplicateMark",
        "There's already a {mark} at m{measure}",
        {
            mark: markOf(measure) ?? "",
            measure: numberOf(measure),
        },
    );

/** Hover title on a rehearsal tab (11-ui.md D) */
export const rehearsalTabTitle = (mark: string, measure: string) =>
    measureRowText(
        "tab.title",
        "Rehearsal {mark}, measure {measure}. Double-click to rename, R to add one.",
        { mark, measure },
    );

/** The tab's tooltip when it can be dragged to another measure (the Normal view) */
export const rehearsalTabMoveTitle = (mark: string, measure: string) =>
    measureRowText(
        "tab.titleMove",
        "Rehearsal {mark}, measure {measure}. Drag along the measure row to move the mark to another measure (the music stays put; in Line up with music, dragging it retimes the music instead). Double-click to rename, R to add one.",
        { mark, measure },
    );

/** Pixels a tab must move before a press becomes a drag */
const MARK_DRAG_PX = 4;

/** A tab being dragged along the measure row to another measure (the Normal view) */
interface MarkDrag {
    readonly measureId: MeasureId;
    readonly pointerId: number;
    readonly startX: number;
    /** Past `MARK_DRAG_PX`: a drag, not a click */
    readonly moved: boolean;
    /** The measure under the tab now */
    readonly toId: MeasureId;
}

/**
 * Rehearsal marks as tabs in the measure row (UI-12), in place of their measure's number. Clicking
 * one seeks there. With `onEdit`, double-clicking one (or Enter on it) renames it and Delete
 * removes it; the tab being edited gives way to the input. With `onMove` (the Normal view), a tab
 * drags along the row to another measure: a label edit, one undo; a measure that has a mark of
 * its own doesn't take it. In Align (`dragHandle`) a tab drags its measure onto the music instead.
 */
// eslint-disable-next-line max-lines-per-function
export const TimelineRehearsalMarkers = ({
    model,
    axis,
    top,
    compact = false,
    onSeek,
    editingMeasureId,
    onEdit,
    onRemove,
    onMove,
    dragHandle,
}: {
    model: TimelineViewModel;
    axis: TimelineXAxis;
    top: number;
    compact?: boolean;
    onSeek?: (beat: BeatPosition) => void;
    /** The measure whose mark the input is editing; its tab hides */
    editingMeasureId?: MeasureId | null;
    onEdit?: (measure: TimelineMeasureMarker) => void;
    onRemove?: (measure: TimelineMeasureMarker) => void;
    /** Moves a mark to another measure (the Normal view's tab drag) */
    onMove?: (from: MeasureId, to: MeasureId) => void;
    /**
     * In the Align view (E7) a tab is also a handle that drags its measure onto the music; the
     * click that follows a drag doesn't seek (`consumeClick`)
     */
    dragHandle?: (beat: BeatPosition) => {
        readonly props: ComponentPropsWithoutRef<"button">;
        readonly consumeClick: () => boolean;
    } | null;
}) => {
    const [drag, setDrag] = useState<MarkDrag | null>(null);
    // A drag's own click doesn't seek
    const dragged = useRef(false);
    const measureNear = (x: number) => {
        let best: TimelineMeasureMarker | null = null;
        for (const m of model.measures)
            if (
                !best ||
                Math.abs(axis.x(m.atBeat) - x) <
                    Math.abs(axis.x(best.atBeat) - x)
            )
                best = m;
        return best;
    };
    const target = drag?.moved
        ? model.measures.find((m) => m.id === drag.toId)
        : undefined;
    const source = drag
        ? model.measures.find((m) => m.id === drag.measureId)
        : undefined;
    const blocked =
        !!target && !!source && target.id !== source.id && !!markOf(target);
    const moveProps = (
        measure: TimelineMeasureMarker,
    ): ComponentPropsWithoutRef<"button"> => ({
        onPointerDown: (event) => {
            if (
                event.button !== 0 ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
            )
                return;
            dragged.current = false;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({
                measureId: measure.id,
                pointerId: event.pointerId,
                startX: event.clientX,
                moved: false,
                toId: measure.id,
            });
        },
        onPointerMove: (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const dx = event.clientX - drag.startX;
            if (!drag.moved && Math.abs(dx) < MARK_DRAG_PX) return;
            const near = measureNear(axis.x(measure.atBeat) + dx);
            setDrag({ ...drag, moved: true, toId: near?.id ?? drag.toId });
        },
        onPointerUp: (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            setDrag(null);
            if (!drag.moved) return;
            dragged.current = true;
            const to = model.measures.find((m) => m.id === drag.toId);
            if (to && to.id !== drag.measureId && !markOf(to))
                onMove?.(drag.measureId, to.id);
        },
        onPointerCancel: () => setDrag(null),
    });
    return (
        <div className="pointer-events-none absolute inset-0 z-20">
            {model.measures.flatMap((measure) => {
                const label = markOf(measure);
                if (!label || measure.id === editingMeasureId) return [];
                const number = numberOf(measure);
                const handle = dragHandle?.(measure.atBeat) ?? null;
                const movable = !handle && !!onMove;
                const title = movable
                    ? rehearsalTabMoveTitle(label, number)
                    : onEdit
                      ? rehearsalTabTitle(label, number)
                      : `Rehearsal ${label}, measure ${number}`;
                const lifted = drag?.moved && drag.measureId === measure.id;
                return [
                    <button
                        key={measure.id}
                        type="button"
                        data-timeline-interactive="true"
                        data-timeline-mark={String(measure.id)}
                        data-testid="timeline-rehearsal-tab"
                        aria-label={
                            onEdit
                                ? measureRowText(
                                      "tab.label",
                                      "Rehearsal {mark}, measure {measure}. Enter renames it, Delete removes it",
                                      { mark: label, measure: number },
                                  )
                                : title
                        }
                        {...handle?.props}
                        {...(movable ? moveProps(measure) : {})}
                        title={title}
                        onClick={(event) => {
                            // A pointer click only seeks: it doesn't leave the tab focused, where
                            // Backspace or Delete (meant for a tap or the canvas) would remove it.
                            // Tab to it to rename or remove it from the keyboard.
                            if (event.detail > 0) event.currentTarget.blur();
                            if (dragged.current) {
                                dragged.current = false;
                                return;
                            }
                            if (handle?.consumeClick()) return;
                            onSeek?.(measure.atBeat);
                        }}
                        onDoubleClick={
                            onEdit
                                ? (event) => {
                                      event.stopPropagation();
                                      onEdit(measure);
                                  }
                                : undefined
                        }
                        onKeyDown={(
                            event: ReactKeyboardEvent<HTMLButtonElement>,
                        ) => {
                            // Align: arrows nudge the mark onto the music, Esc drops a drag
                            handle?.props.onKeyDown?.(event);
                            if (event.defaultPrevented) return;
                            if (event.key === "Escape" && drag) {
                                event.preventDefault();
                                setDrag(null);
                                return;
                            }
                            if (event.altKey || event.ctrlKey || event.metaKey)
                                return;
                            if (
                                onEdit &&
                                (event.key === "Enter" || event.key === "F2")
                            ) {
                                // Enter renames rather than clicking (seeking): Space still seeks
                                event.preventDefault();
                                event.stopPropagation();
                                onEdit(measure);
                            } else if (
                                onRemove &&
                                // In Align, Backspace means "drop the last tap" to
                                // a tapper; only Delete removes the mark there (Jo)
                                (event.key === "Delete" ||
                                    (event.key === "Backspace" && !handle))
                            ) {
                                event.preventDefault();
                                event.stopPropagation();
                                onRemove(measure);
                            }
                        }}
                        className={clsx(
                            "border-text-subtitle bg-bg-1 text-text rounded-r-4 focus-visible:ring-accent pointer-events-auto absolute flex h-16 min-w-16 items-center justify-center border border-l-2 px-3 font-mono leading-none font-semibold outline-hidden focus-visible:ring-2",
                            compact ? "text-[9px]" : "text-[10px]",
                            handle && "cursor-col-resize touch-none",
                            movable && "cursor-grab touch-none",
                            lifted && "opacity-40",
                        )}
                        style={{
                            left: axis.x(measure.atBeat),
                            top,
                        }}
                    >
                        {label}
                    </button>,
                ];
            })}
            {target && source && target.id !== source.id && (
                <span
                    aria-hidden="true"
                    data-testid="timeline-rehearsal-tab-ghost"
                    data-blocked={blocked || undefined}
                    title={
                        blocked
                            ? measureRowText(
                                  "tab.moveTaken",
                                  "Measure {measure} already has {mark}",
                                  {
                                      measure: numberOf(target),
                                      mark: markOf(target) ?? "",
                                  },
                              )
                            : undefined
                    }
                    className={clsx(
                        "rounded-r-4 absolute flex h-16 min-w-16 items-center justify-center border border-l-2 border-dashed px-3 font-mono leading-none font-semibold",
                        compact ? "text-[9px]" : "text-[10px]",
                        blocked
                            ? "border-red text-red bg-bg-1"
                            : "border-accent text-accent bg-bg-1",
                    )}
                    style={{ left: axis.x(target.atBeat), top }}
                >
                    {blocked
                        ? `${markOf(source)} ✕ m${numberOf(target)}`
                        : `${markOf(source)} → m${numberOf(target)}`}
                </span>
            )}
        </div>
    );
};

const editorLabel = (
    editor: MeasureRowEditor,
    model: Pick<TimelineViewModel, "measures">,
) => {
    const measure = model.measures.find(
        (m) => "measureId" in editor && m.id === editor.measureId,
    );
    const number = measure ? numberOf(measure) : "";
    switch (editor.kind) {
        case "mark":
            return measureRowText(
                "editor.markLabel",
                "Rehearsal mark for measure {measure}",
                { measure: number },
            );
        case "new":
            return measureRowText(
                "editor.newLabel",
                "Rehearsal mark at this count",
            );
        case "beats":
            return measureRowText(
                "editor.beatsLabel",
                "Beats in measure {measure}",
                { measure: number },
            );
        case "beatsFrom":
            return measureRowText(
                "editor.beatsFromLabel",
                "Beats per measure from measure {measure}",
                { measure: number },
            );
    }
};

const editorHint = (editor: MeasureRowEditor) => {
    switch (editor.kind) {
        case "mark":
            return editor.addedWhilePlaying
                ? measureRowText(
                      "editor.addedHint",
                      "Added {mark}. Type a name and press Enter, or keep going",
                      { mark: editor.initial },
                  )
                : measureRowText(
                      "editor.markHint",
                      "Enter to save, Esc to cancel. Empty removes the mark",
                  );
        case "new":
            return measureRowText(
                "editor.newHint",
                "A rehearsal mark sits on a measure line, and there is none here. Enter starts a measure at this count",
            );
        case "beats":
        case "beatsFrom":
            return measureRowText(
                "editor.beatsHint",
                "Moves measure lines only. Counts and drill don't change",
            );
    }
};

/**
 * The measure row's inline input: a mark's name, or a number of beats. Enter commits and Esc
 * cancels. Before anything is typed, R and Space go on to the timeline (`onPassKey`), so marking
 * one hit after another while playing, or pausing, never types into the field.
 */
export function TimelineMeasureRowEditor({
    editor,
    model,
    axis,
    top,
    onCommit,
    onCancel,
    onPassKey,
}: {
    editor: MeasureRowEditor;
    model: Pick<TimelineViewModel, "measures">;
    axis: TimelineXAxis;
    top: number;
    onCommit: (text: string) => void;
    onCancel: () => void;
    onPassKey?: (key: "r" | " ") => void;
}) {
    const [text, setText] = useState(editor.initial);
    const touched = useRef(false);
    const done = useRef(false);
    const numeric = editor.kind === "beats" || editor.kind === "beatsFrom";
    const finish = (commit: boolean) => {
        if (done.current) return;
        done.current = true;
        if (commit) onCommit(text);
        else onCancel();
    };
    return (
        <div
            data-timeline-interactive="true"
            className="pointer-events-auto absolute z-[70] flex flex-col items-start gap-2"
            style={{ left: axis.x(editor.atBeat), top }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <input
                autoFocus
                data-testid="timeline-measure-row-input"
                aria-label={editorLabel(editor, model)}
                aria-describedby="timeline-measure-row-hint"
                inputMode={numeric ? "numeric" : undefined}
                value={text}
                size={Math.max(3, text.length + 1)}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                    touched.current = true;
                    setText(
                        numeric
                            ? event.target.value.replace(/\D/g, "")
                            : event.target.value,
                    );
                }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                        event.preventDefault();
                        finish(true);
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        finish(false);
                    } else if (
                        !touched.current &&
                        onPassKey &&
                        !event.altKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        (event.key === " " || event.key.toLowerCase() === "r")
                    ) {
                        event.preventDefault();
                        done.current = true;
                        onPassKey(event.key === " " ? " " : "r");
                    }
                }}
                // Leaving a rename keeps what was typed; leaving anything else cancels it
                onBlur={() => finish(editor.kind === "mark" && touched.current)}
                className="border-accent bg-bg-1 text-text rounded-4 h-16 min-w-24 border px-3 font-mono text-[10px] leading-none font-semibold outline-hidden"
            />
            <span
                id="timeline-measure-row-hint"
                className="border-stroke bg-modal text-text-subtitle rounded-4 shadow-modal max-w-[260px] border px-6 py-2 text-[10px] leading-snug"
            >
                {editorHint(editor)}
            </span>
        </div>
    );
}

/**
 * The editor state and its commands for one timeline surface: what R, a click on a measure number,
 * a double-click on a tab and the menu open, and what committing the input writes.
 */
export function useMeasureRowEditing({
    model,
    commands,
    positionBeat,
    livePositionBeat,
    isPlaying,
    onPlayingChange,
}: {
    model: TimelineViewModel;
    commands?: TimelineMeasureRowCommands;
    positionBeat: number;
    livePositionBeat?: () => number | null;
    isPlaying: boolean;
    onPlayingChange?: (isPlaying: boolean) => void;
}) {
    const [editor, setEditorState] = useState<MeasureRowEditor | null>(null);
    // Each opening is a new input, even at the same place (R, R while playing)
    const [editorKey, setEditorKey] = useState(0);
    const setEditor = useCallback((next: MeasureRowEditor | null) => {
        setEditorState(next);
        if (next) setEditorKey((key) => key + 1);
    }, []);
    const latest = useRef({
        model,
        commands,
        positionBeat,
        livePositionBeat,
        isPlaying,
        onPlayingChange,
    });
    latest.current = {
        model,
        commands,
        positionBeat,
        livePositionBeat,
        isPlaying,
        onPlayingChange,
    };

    /** Name or rename `measure`'s mark inline */
    const editMark = useCallback(
        (measure: TimelineMeasureMarker) => {
            const current = markOf(measure);
            setEditor({
                kind: "mark",
                measureId: measure.id,
                atBeat: measure.atBeat,
                initial: current ?? suggestedMark(model, measure.atBeat),
                original: current ?? "",
            });
        },
        [model, setEditor],
    );

    /** R (11-ui.md D; 21-persona-dana.md E4) */
    const addMarkAtPlayhead = useCallback(() => {
        const { model, commands, positionBeat, livePositionBeat, isPlaying } =
            latest.current;
        if (!commands || model.beatCount <= 0) return;
        const beat = isPlaying
            ? (livePositionBeat?.() ?? positionBeat)
            : positionBeat;
        const measure = measureForMark(model.measures, beat, isPlaying);
        if (!measure) {
            const atBeat = clamp(
                isPlaying ? Math.round(beat) : Math.floor(beat),
                0,
                model.beatCount - 1,
            );
            setEditor({
                kind: "new",
                atBeat,
                initial: suggestedMark(model, atBeat),
            });
            return;
        }
        const current = markOf(measure);
        // R on a measure that already has a mark while the music plays: say so, rather than
        // opening a small rename box the music runs past (Dana, FB-9)
        if (current && isPlaying) {
            toast.info(
                measureRowText(
                    "toast.alreadyMarked",
                    "{mark} is already at m{measure}. Pause and double-click it to rename it.",
                    { mark: current, measure: numberOf(measure) },
                ),
            );
            return;
        }
        if (current || !isPlaying) {
            setEditor({
                kind: "mark",
                measureId: measure.id,
                atBeat: measure.atBeat,
                initial: current ?? suggestedMark(model, measure.atBeat),
                original: current ?? "",
            });
            return;
        }
        // Playing: mark the spot now, so a name typed later can't land late
        const name = suggestedMark(model, measure.atBeat);
        commands.onSetMark(measure.id, name);
        setEditor({
            kind: "mark",
            measureId: measure.id,
            atBeat: measure.atBeat,
            initial: name,
            original: name,
            addedWhilePlaying: true,
        });
    }, [setEditor]);

    // R adds a mark, unless a text field, popover, menu or dialog has the keys
    useEffect(() => {
        if (!commands) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== "r" ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.shiftKey ||
                event.repeat ||
                isTyping(event.target) ||
                overlayOpen()
            )
                return;
            event.preventDefault();
            addMarkAtPlayhead();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [addMarkAtPlayhead, commands]);

    const commit = (text: string) => {
        const current = editor;
        setEditor(null);
        if (!current || !commands) return;
        const typed = text.trim();
        // A name another measure has is refused, and the input stays open to fix it
        const refuseDuplicate = (exceptId: MeasureId | null) => {
            const taken = measureWithMark(
                latest.current.model.measures,
                typed,
                exceptId,
            );
            if (!taken) return false;
            toast.error(duplicateMarkMessage(taken));
            setEditor({ ...current, initial: typed } as MeasureRowEditor);
            return true;
        };
        switch (current.kind) {
            case "mark":
                if (typed === current.original) return;
                if (typed && refuseDuplicate(current.measureId)) return;
                commands.onSetMark(current.measureId, typed || null);
                return;
            case "new":
                if (!typed || refuseDuplicate(null)) return;
                commands.onStartMeasure(current.atBeat, typed);
                return;
            case "beats":
            case "beatsFrom": {
                const beats = Number(typed);
                if (!Number.isInteger(beats) || beats < 1) return;
                if (current.kind === "beats")
                    commands.onSetBeats(
                        current.measureId,
                        beats,
                        current.laterKeep,
                    );
                else
                    commands.onBeatsFrom(
                        current.measureId,
                        beats,
                        current.until,
                    );
                return;
            }
        }
    };

    const passKey = (key: "r" | " ") => {
        setEditor(null);
        if (key === "r") addMarkAtPlayhead();
        else {
            const { isPlaying, onPlayingChange } = latest.current;
            onPlayingChange?.(!isPlaying);
        }
    };

    return {
        editor,
        editorKey,
        setEditor,
        editMark,
        addMarkAtPlayhead,
        commit,
        cancel: () => setEditor(null),
        passKey,
    };
}

const itemClass =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none data-[disabled]:opacity-50";
const hintClass = "text-text-subtitle px-8 pb-4 text-[11px]";

/**
 * The right-click menu's entries on the measure row (11-ui.md D): measure lines at a count, a
 * measure's mark and its beats. Rendered inside `useTimelineRangeMenu`'s menu.
 */
export function MeasureRowMenuItems({
    target,
    model,
    commands,
    onEditor,
    onEditMark,
    onSeek,
}: {
    target: TimelineMeasureRowTarget;
    model: TimelineViewModel;
    commands: TimelineMeasureRowCommands;
    onEditor: (editor: MeasureRowEditor) => void;
    onEditMark: (measure: TimelineMeasureMarker) => void;
    onSeek?: (beat: BeatPosition) => void;
}) {
    const [laterKeep, setLaterKeep] = useState(true);
    const measures = orderedMeasures(model);
    const holding = measureHolding(model, target.beat);
    const measure = holding?.measure;
    const onDownbeat = holding !== null && measure!.atBeat === target.beat;
    const isCount = target.kind === "count";
    const previous = holding ? measures[holding.index - 1] : undefined;
    const next = holding ? measures[holding.index + 1] : undefined;
    const mark = markOf(measure);
    const number = measure ? numberOf(measure) : "";
    const laterMark = holding
        ? measures.slice(holding.index + 1).find(({ measure: m }) => markOf(m))
        : undefined;
    const [until, setUntil] = useState<"mark" | "end">(
        laterMark ? "mark" : "end",
    );

    const header = !measure
        ? measureRowText("menu.noMeasureHeader", "Count {count}, no measure", {
              count: target.beat + 1,
          })
        : isCount && !onDownbeat
          ? measureRowText(
                "menu.countHeader",
                "Count {count} of measure {measure}",
                { count: target.beat - measure.atBeat + 1, measure: number },
            )
          : measureRowText(
                "menu.measureHeader",
                "Measure {measure} · {beats, plural, one {# beat} other {# beats}}",
                { measure: number, beats: holding!.beats },
            ) +
            (mark
                ? measureRowText("menu.markSuffix", " · rehearsal {mark}", {
                      mark,
                  })
                : "");

    const items: ReactNode[] = [];
    // Measure lines at a count (T11)
    if (isCount && !onDownbeat)
        items.push(
            <DropdownMenu.Item
                key="start"
                data-testid="measure-row-start"
                className={itemClass}
                onSelect={() => commands.onStartMeasure(target.beat)}
            >
                <PlusIcon size={14} />
                <span className="flex flex-col">
                    {measureRowText(
                        "menu.startMeasure",
                        "Start a measure here",
                    )}
                    {holding && (
                        <span className="text-text-subtitle text-[11px]">
                            {measureRowText(
                                "menu.startMeasureHint",
                                "m{measure} becomes {before} + {after} beats",
                                {
                                    measure: number,
                                    before: target.beat - measure!.atBeat,
                                    after:
                                        holding.beats -
                                        (target.beat - measure!.atBeat),
                                },
                            )}
                        </span>
                    )}
                </span>
            </DropdownMenu.Item>,
        );
    if (isCount && onDownbeat && previous)
        items.push(
            <DropdownMenu.Item
                key="remove"
                data-testid="measure-row-remove-line"
                className={itemClass}
                onSelect={() => commands.onRemoveLine(measure!.id)}
            >
                <MinusIcon size={14} />
                <span className="flex flex-col">
                    {measureRowText(
                        "menu.removeLine",
                        "Remove measure line (join with m{previous})",
                        { previous: numberOf(previous.measure) },
                    )}
                    {mark && (
                        <span className="text-text-subtitle text-[11px]">
                            {measureRowText(
                                "menu.removeLineMark",
                                "Also removes rehearsal {mark}",
                                { mark },
                            )}
                        </span>
                    )}
                </span>
            </DropdownMenu.Item>,
        );

    // The measure's rehearsal mark (T5)
    if (measure && mark)
        items.push(
            <DropdownMenu.Item
                key="rename"
                data-testid="measure-row-rename-mark"
                className={itemClass}
                onSelect={() => onEditMark(measure)}
            >
                <PencilSimpleIcon size={14} />
                {measureRowText("menu.renameMark", "Rename {mark}…", { mark })}
            </DropdownMenu.Item>,
            <DropdownMenu.Item
                key="remove-mark"
                data-testid="measure-row-remove-mark"
                className={itemClass}
                onSelect={() => commands.onSetMark(measure.id, null)}
            >
                <TrashIcon size={14} />
                {measureRowText(
                    "menu.removeMark",
                    "Remove rehearsal mark {mark}",
                    { mark },
                )}
            </DropdownMenu.Item>,
            <DropdownMenu.Item
                key="go-to"
                data-testid="measure-row-go-to"
                className={itemClass}
                onSelect={() => onSeek?.(measure.atBeat)}
            >
                <ArrowRightIcon size={14} />
                {measureRowText("menu.goToMark", "Go to {mark}", { mark })}
            </DropdownMenu.Item>,
            ...(commands.onTapFrom
                ? [
                      <DropdownMenu.Item
                          key="tap-from"
                          data-testid="measure-row-tap-from"
                          className={itemClass}
                          onSelect={() => {
                              onSeek?.(measure.atBeat);
                              commands.onTapFrom?.();
                          }}
                      >
                          <HandTapIcon size={14} />
                          {measureRowText(
                              "menu.tapFromMark",
                              "Tap from here ({mark})",
                              { mark },
                          )}
                      </DropdownMenu.Item>,
                  ]
                : []),
        );
    else
        items.push(
            <DropdownMenu.Item
                key="add-mark"
                data-testid="measure-row-add-mark"
                className={itemClass}
                onSelect={() =>
                    measure && !(isCount && !onDownbeat)
                        ? onEditMark(measure)
                        : onEditor({
                              kind: "new",
                              atBeat: target.beat,
                              initial: suggestedMark(model, target.beat),
                          })
                }
            >
                <PencilSimpleIcon size={14} />
                {measure && !(isCount && !onDownbeat)
                    ? measureRowText(
                          "menu.addMark",
                          "Add a rehearsal mark to m{measure}…",
                          { measure: number },
                      )
                    : measureRowText(
                          "menu.addMarkAtCount",
                          "Add a rehearsal mark here…",
                      )}
            </DropdownMenu.Item>,
        );

    if (!measure || !holding)
        return (
            <>
                <DropdownMenu.Label className={hintClass}>
                    {header}
                </DropdownMenu.Label>
                {items}
            </>
        );

    const pickBeats = (beats: number) =>
        commands.onSetBeats(measure.id, beats, laterKeep);
    const pickFrom = (beats: number) =>
        commands.onBeatsFrom(measure.id, beats, until);
    const beatButtons = (
        current: number | null,
        pick: (beats: number) => void,
        other: () => void,
        testId: string,
    ) => (
        <div role="group" className="flex flex-wrap items-center gap-2 px-6">
            {QUICK_BEATS.map((beats) => (
                <DropdownMenu.Item
                    key={beats}
                    data-testid={`${testId}-${beats}`}
                    aria-current={beats === current || undefined}
                    onSelect={() => {
                        if (beats !== current) pick(beats);
                    }}
                    className="rounded-4 data-[highlighted]:bg-fg-2 aria-[current]:border-accent flex h-22 min-w-22 cursor-default items-center justify-center border border-transparent px-4 font-mono text-[12px] outline-hidden select-none"
                >
                    {beats}
                </DropdownMenu.Item>
            ))}
            <DropdownMenu.Item
                data-testid={`${testId}-other`}
                onSelect={other}
                className="rounded-4 data-[highlighted]:bg-fg-2 flex h-22 cursor-default items-center px-6 text-[12px] outline-hidden select-none"
            >
                {measureRowText("menu.other", "Other…")}
            </DropdownMenu.Item>
        </div>
    );

    return (
        <>
            <DropdownMenu.Label className={hintClass}>
                {header}
            </DropdownMenu.Label>
            {items}
            <DropdownMenu.Separator className="bg-stroke my-2 h-px" />
            {next && (
                <DropdownMenu.Item
                    data-testid="measure-row-join-next"
                    className={itemClass}
                    onSelect={() => commands.onRemoveLine(next.measure.id)}
                >
                    <MinusIcon size={14} />
                    {measureRowText(
                        "menu.joinNext",
                        "Join with m{next} (remove its line)",
                        { next: numberOf(next.measure) },
                    )}
                </DropdownMenu.Item>
            )}
            <DropdownMenu.Label className="text-text px-8 pt-4 text-[12px]">
                {measureRowText("menu.beatsIn", "Beats in m{measure}", {
                    measure: number,
                })}
            </DropdownMenu.Label>
            {beatButtons(
                holding.beats,
                pickBeats,
                () =>
                    onEditor({
                        kind: "beats",
                        measureId: measure.id,
                        atBeat: measure.atBeat,
                        initial: String(holding.beats),
                        laterKeep,
                    }),
                "measure-row-beats",
            )}
            <DropdownMenu.CheckboxItem
                data-testid="measure-row-later-keep"
                checked={laterKeep}
                onCheckedChange={setLaterKeep}
                // Keep the menu open: this sets how the beats above apply
                onSelect={(event) => event.preventDefault()}
                className={itemClass}
            >
                <span className="flex size-14 items-center justify-center">
                    <DropdownMenu.ItemIndicator>
                        <CheckIcon size={12} />
                    </DropdownMenu.ItemIndicator>
                </span>
                {measureRowText(
                    "menu.laterKeep",
                    "Later measures keep their beats",
                )}
            </DropdownMenu.CheckboxItem>
            <p className={hintClass}>
                {laterKeep
                    ? measureRowText(
                          "menu.laterKeepOn",
                          "Moves every later measure line. Counts and drill don't change.",
                      )
                    : measureRowText(
                          "menu.laterKeepOff",
                          "Only m{next} changes. Counts and drill don't change.",
                          {
                              next: next ? numberOf(next.measure) : number,
                          },
                      )}
            </p>
            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                    data-testid="measure-row-beats-from"
                    className={itemClass}
                >
                    {measureRowText(
                        "menu.beatsFrom",
                        "Beats per measure from here",
                    )}
                    <CaretRightIcon size={12} className="ml-auto" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                        sideOffset={4}
                        className="bg-modal text-text rounded-6 border-stroke shadow-modal z-50 flex min-w-[200px] flex-col gap-2 border p-4 backdrop-blur-md"
                    >
                        <DropdownMenu.RadioGroup
                            value={until}
                            onValueChange={(value) =>
                                setUntil(value as "mark" | "end")
                            }
                        >
                            {laterMark && (
                                <DropdownMenu.RadioItem
                                    value="mark"
                                    data-testid="measure-row-until-mark"
                                    onSelect={(event) => event.preventDefault()}
                                    className={itemClass}
                                >
                                    <span className="flex size-14 items-center justify-center">
                                        <DropdownMenu.ItemIndicator>
                                            <CheckIcon size={12} />
                                        </DropdownMenu.ItemIndicator>
                                    </span>
                                    {measureRowText(
                                        "menu.untilMark",
                                        "Up to {mark} (m{measure})",
                                        {
                                            mark: markOf(laterMark.measure)!,
                                            measure: numberOf(
                                                laterMark.measure,
                                            ),
                                        },
                                    )}
                                </DropdownMenu.RadioItem>
                            )}
                            <DropdownMenu.RadioItem
                                value="end"
                                data-testid="measure-row-until-end"
                                onSelect={(event) => event.preventDefault()}
                                className={itemClass}
                            >
                                <span className="flex size-14 items-center justify-center">
                                    <DropdownMenu.ItemIndicator>
                                        <CheckIcon size={12} />
                                    </DropdownMenu.ItemIndicator>
                                </span>
                                {measureRowText(
                                    "menu.toEnd",
                                    "To the end of the show",
                                )}
                            </DropdownMenu.RadioItem>
                        </DropdownMenu.RadioGroup>
                        <DropdownMenu.Separator className="bg-stroke my-2 h-px" />
                        {beatButtons(
                            null,
                            pickFrom,
                            () =>
                                onEditor({
                                    kind: "beatsFrom",
                                    measureId: measure.id,
                                    atBeat: measure.atBeat,
                                    initial: String(holding.beats),
                                    until,
                                }),
                            "measure-row-beats-from",
                        )}
                    </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
            </DropdownMenu.Sub>
        </>
    );
}

/** How near a count tick (px) a right-click on the measure row must be to target that count */
export const MEASURE_ROW_COUNT_PX = 6;

/**
 * What a right-click on the measure row targets (11-ui.md D): a rehearsal tab; else the count tick
 * within `MEASURE_ROW_COUNT_PX`; else the measure under the pointer (or, with no measure there,
 * the count left of it). `null` outside the row. `surface` is the timeline's pointer surface.
 */
export function measureRowTargetAt({
    event,
    surface,
    model,
    axis,
    rowTop,
    rowHeight,
}: {
    event: Pick<ReactMouseEvent, "clientX" | "clientY" | "target">;
    surface: Element;
    model: TimelineViewModel;
    /** The timeline's x axis: counts, or seconds in the Align view */
    axis: Pick<TimelineXAxis, "x" | "beatAt">;
    rowTop: number;
    rowHeight: number;
}): {
    target: TimelineMeasureRowTarget;
    range: { startBeatIndex: number; endBeatIndex: number };
} | null {
    if (model.beatCount <= 0) return null;
    const tab =
        event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-timeline-mark]")
            : null;
    if (tab) {
        const measure = model.measures.find(
            (m) => String(m.id) === tab.dataset.timelineMark,
        );
        if (measure) return markTarget(model, measure.atBeat, "mark");
    }
    const rect = surface.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < rowTop || y > rowTop + rowHeight) return null;
    const px = event.clientX - rect.left;
    const beat = axis.beatAt(px);
    if (px < 0 || beat < 0 || beat > model.beatCount) return null;
    const tick = Math.round(beat);
    if (
        tick < model.beatCount &&
        Math.abs(axis.x(tick) - px) <= MEASURE_ROW_COUNT_PX
    )
        return markTarget(model, tick, "count");
    const holding = measureHolding(model, Math.floor(beat));
    return holding
        ? markTarget(model, holding.measure.atBeat, "measure")
        : markTarget(
              model,
              clamp(Math.floor(beat), 0, model.beatCount - 1),
              "count",
          );
}

const markTarget = (
    model: TimelineViewModel,
    beat: number,
    kind: TimelineMeasureRowTarget["kind"],
) => {
    const holding = kind === "count" ? null : measureHolding(model, beat);
    return {
        target: { kind, beat },
        range: {
            startBeatIndex: beat,
            endBeatIndex: holding ? beat + holding.beats : beat + 1,
        },
    };
};
