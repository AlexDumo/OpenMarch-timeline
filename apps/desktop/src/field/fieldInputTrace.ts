/**
 * A short, always-on trace of what the field's pointer input saw, for drags undone on release
 * (a marquee that selects nothing, moved marchers that snap back), which only happen now and then
 * on some Macs and haven't been reproduced elsewhere.
 *
 * Notes are kept in memory: presses, releases, button changes mid-press, a lost pointer, window
 * focus, and what the editor did with them. When a drag ends without doing what it showed
 * ({@link fieldDragUndone}), the trace goes to the console as a warning, which the diagnostics log
 * sends with a bug report (#801), and to the reporter set at startup (usage analytics, sent only
 * after an opt-in). It holds no show content: kinds, buttons, pointer ids, counts and times only.
 */

export const MAX_TRACE_NOTES = 40;
/** At most this many undone drags are reported per window load */
export const MAX_UNDONE_REPORTS = 10;

type Note = { at: number; text: string };

export type FieldDragUndone = {
    /** What undid it, in a few words */
    reason: string;
    /** The notes before it, oldest first, one per line with its time */
    trace: string;
};

let notes: Note[] = [];
let reported = 0;
let reporter: ((undone: FieldDragUndone) => void) | null = null;
let now: () => number = () => performance.now();

/** Adds a line to the trace. */
export function noteFieldInput(text: string): void {
    notes.push({ at: now(), text });
    if (notes.length > MAX_TRACE_NOTES) notes = notes.slice(-MAX_TRACE_NOTES);
}

/** The trace as text, times in seconds before the last note. */
export function fieldInputTrace(): string {
    const last = notes.at(-1)?.at ?? 0;
    return notes
        .map(
            ({ at, text }) =>
                `${((at - last) / 1000).toFixed(3).padStart(7)}s ${text}`,
        )
        .join("\n");
}

/**
 * A drag (or press) ended without doing what it showed: says so with the trace, as a console
 * warning and to the reporter. Never throws.
 */
export function fieldDragUndone(reason: string): void {
    try {
        noteFieldInput(`UNDONE: ${reason}`);
        if (reported >= MAX_UNDONE_REPORTS) return;
        reported++;
        const undone = { reason, trace: fieldInputTrace() };
        console.warn(
            `Field drag undone (${undone.reason}). Field input trace:\n${undone.trace}`,
        );
        reporter?.(undone);
    } catch {
        // Diagnostics mustn't break the field
    }
}

/** Where undone drags go besides the console (usage analytics), or null. */
export function setFieldDragUndoneReporter(
    report: ((undone: FieldDragUndone) => void) | null,
): void {
    reporter = report;
}

/** A pointer event for the trace: its button, the buttons held, its kind and id. */
export function describePointerEvent(
    event: Pick<
        PointerEvent,
        "type" | "button" | "buttons" | "pointerType" | "pointerId"
    > & { ctrlKey?: boolean },
): string {
    return `${event.type} button=${event.button} buttons=${event.buttons} ${event.pointerType}#${event.pointerId}${event.ctrlKey ? " ctrl" : ""}`;
}

/** Starts over, for tests. */
export function resetFieldInputTraceForTests(clock?: () => number): void {
    notes = [];
    reported = 0;
    reporter = null;
    now = clock ?? (() => performance.now());
}
