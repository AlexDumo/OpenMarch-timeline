export type HistoryDirection = "undo" | "redo";

/** Undoes or redoes once; resolves whether anything was undone or redone. */
export type HistoryPerformer = (
    direction: HistoryDirection,
) => Promise<boolean>;

let performer: HistoryPerformer | null = null;
let tail: Promise<unknown> = Promise.resolve();
/** Steps queued and not yet finished */
let pending = 0;

/** Installs what queued undo/redo presses run; returns the uninstall. */
export function setHistoryPerformer(next: HistoryPerformer): () => void {
    performer = next;
    return () => {
        if (performer === next) performer = null;
    };
}

/**
 * Undo or redo, after any earlier presses have finished. Fast presses queue
 * up instead of being dropped (each runs when the previous one is done, so
 * each sees the stack the previous one left), and each resolves whether it
 * actually undid or redid something.
 */
export function queueHistoryAction(
    direction: HistoryDirection,
): Promise<boolean> {
    return queueHistoryStep((perform) => perform(direction), false);
}

/**
 * Runs `step` in the same queue as undo/redo presses, so nothing undoes or
 * redoes between what it checks and what it does. `perform` undoes or redoes
 * once, directly (queueing from inside a step would wait for itself).
 * Resolves `fallback` if the step throws.
 */
export function queueHistoryStep<T>(
    step: (perform: HistoryPerformer) => Promise<T>,
    fallback: T,
): Promise<T> {
    pending++;
    const run = tail
        .then(() =>
            step(async (direction) =>
                performer ? await performer(direction) : false,
            ),
        )
        .finally(() => {
            pending--;
        });
    tail = run.catch(() => undefined);
    return run.catch(() => fallback);
}

/** Whether a step queued earlier hasn't finished, so one queued now waits for it */
export const historyStepsPending = (): boolean => pending > 0;
