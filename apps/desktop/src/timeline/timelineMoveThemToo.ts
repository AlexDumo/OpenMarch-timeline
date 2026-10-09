import type { Resolver, XY } from "@openmarch/core";
import { toast } from "sonner";
import { db } from "@/global/database/db";
import {
    moveMarchersInTarget,
    shapeBackedTransitionIds,
    shiftSlotDestinations,
    type SlotShift,
    type TimelineEditTarget,
    type TimelineMarcherMove,
    type TimelineMoveResult,
} from "@/db-functions/timelineMoves";
import type { DbConnection } from "@/db-functions/types";
import {
    useTimelineSelectionStore,
    type PageBox,
} from "@/stores/TimelineSelectionStore";
import {
    EDIT_SURPRISE_TOAST_ID,
    MOVE_THEM_TOO_TOAST_MS,
    inDrillOrder,
    marcherLabelsById,
    moveThemTooMessage,
} from "@/utilities/moveThemToo";
import { editedMarcherEnds, type CarrySpan } from "./timelineCarryForward";
import { toastTimelineError } from "./timelineErrorMessages";
import { toastPassThrough } from "./timelinePassThrough";
import {
    resolverSpans,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "./timelineStore";

/**
 * **Move them too** in timeline mode (`utilities/moveThemToo.ts`): after a coordinate edit, the
 * moved marchers whose next own move ends on a later page flag kept that move's destination. Read
 * from the resolver: where each moved marcher was at the edit's end before and after (its
 * offset), and its spans after. The action moves each such slot's destination by the offset, as
 * one undoable edit (`shiftSlotDestinations`); later pages that hold from it follow.
 */

/** Two offsets closer to zero than this, per axis, are no move (canvas pixels) */
const NO_OFFSET = 1e-6;

/** Where an edit's marchers were at its end beat, read just before it wrote. */
export interface EditStart {
    beat: number;
    positions: ReadonlyMap<number, XY>;
}

/** A moved marcher's later own move, which kept its destination: the slot it arrives in. */
export interface LaterOwnMove extends SlotShift {
    /** The page flag that move ends on */
    flag: number;
}

/**
 * The beat an edit to `target` ends at: the window's end, 0 for homes, the isolated move's end for
 * a stored timeline. `null` for a stored timeline that isn't the isolated one.
 */
export function editEndBeat(
    target: TimelineEditTarget,
    isolation: {
        timelineId: number;
        end: number;
    } | null = useTimelineSelectionStore.getState().isolation,
): number | null {
    if (target.kind === "range") return target.end;
    if (target.kind === "home") return 0;
    return isolation?.timelineId === target.timelineId ? isolation.end : null;
}

/** Where `marcherIds` are at `target`'s end beat now, from the current resolver. */
export function readEditStart(
    target: TimelineEditTarget,
    marcherIds: readonly number[],
    resolver: Resolver | null = useTimelineResolverStore.getState().resolver,
): EditStart | null {
    const beat = editEndBeat(target);
    if (!resolver || beat === null) return null;
    const known = new Set(resolver.marcherIds());
    const positions = new Map<number, XY>();
    for (const id of marcherIds)
        if (known.has(id)) positions.set(id, resolver.positionAt(id, beat));
    return { beat, positions };
}

/**
 * The moved marchers whose next own move (the first span after the edit's end that isn't a hold)
 * starts at or after that end and ends on a page flag, each with that move's slot and the offset
 * the edit moved the marcher at its end. Only the next move per marcher. Marchers the edit didn't
 * move (an offset within `NO_OFFSET`), with no later move, or whose next move ends between flags
 * are left out.
 *
 * @param moved the marchers the edit wrote (`editedMarcherEnds`)
 * @param flags every page flag, ascending
 */
export function laterOwnMoves({
    moved,
    start,
    spansOf,
    positionAt,
    flags,
}: {
    moved: Iterable<number>;
    start: EditStart;
    spansOf: (marcherId: number) => readonly (CarrySpan & {
        transitionId: number | null;
        slot: number | null;
    })[];
    positionAt: (marcherId: number, beat: number) => XY;
    flags: readonly number[];
}): LaterOwnMove[] {
    const out: LaterOwnMove[] = [];
    for (const marcherId of moved) {
        const before = start.positions.get(marcherId);
        if (!before) continue;
        const [x, y] = positionAt(marcherId, start.beat);
        const dx = x - before[0];
        const dy = y - before[1];
        if (Math.abs(dx) <= NO_OFFSET && Math.abs(dy) <= NO_OFFSET) continue;
        const next = spansOf(marcherId)
            .filter((s) => s.kind !== "hold" && s.end > start.beat)
            .sort((a, b) => a.end - b.end)[0];
        if (
            !next ||
            next.start < start.beat ||
            next.transitionId === null ||
            next.slot === null ||
            !flags.includes(next.end)
        )
            continue;
        out.push({
            marcherId,
            transitionId: next.transitionId,
            slotIndex: next.slot,
            flag: next.end,
            dx,
            dy,
        });
    }
    return out;
}

/** The page flags the timeline shows, ascending. */
const flagsOf = (boxes: readonly PageBox[]) =>
    [...new Set(boxes.map((b) => b.end))].sort((a, b) => a - b);

/**
 * After a timeline edit has committed: the later own moves it left behind (`laterOwnMoves`), read
 * from the resolver once the edit has reached it, without shape-backed ones (their slots have no
 * point of their own to shift).
 */
export async function findLaterOwnMoves({
    database = db,
    target,
    result,
    start,
    boxes = useTimelineSelectionStore.getState().pageBoxes,
}: {
    database?: DbConnection;
    target: TimelineEditTarget;
    result: Pick<TimelineMoveResult, "homes" | "slots" | "cleared">;
    start: EditStart | null;
    boxes?: readonly PageBox[];
}): Promise<LaterOwnMove[]> {
    if (!start) return [];
    await timelineResolverSettled();
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!resolver) return [];
    const spansOf = (id: number) => resolverSpans(resolver, id);
    const moved = editedMarcherEnds(target, result, spansOf).keys();
    const found = laterOwnMoves({
        moved,
        start,
        spansOf,
        positionAt: (id, beat) => resolver.positionAt(id, beat),
        flags: flagsOf(boxes),
    });
    if (found.length === 0) return [];
    const shaped = await shapeBackedTransitionIds({
        db: database,
        transitionIds: found.map((m) => m.transitionId),
    });
    return found.filter((m) => !shaped.has(m.transitionId));
}

/**
 * Shows the **Move them too** toast for `moves`, replacing the edit's pass-through toast (the same
 * id). Does nothing for none.
 */
export async function toastLaterOwnMoves(
    moves: readonly LaterOwnMove[],
    boxes: readonly PageBox[] = useTimelineSelectionStore.getState().pageBoxes,
): Promise<void> {
    if (moves.length === 0) return;
    const labels = await marcherLabelsById(moves.map((m) => m.marcherId));
    const byMarcher = new Map(moves.map((m) => [m.marcherId, m]));
    const kept = inDrillOrder([...byMarcher.keys()], labels).map((id) => ({
        label: labels.get(id)!.label,
        page: boxes.find((b) => b.end === byMarcher.get(id)!.flag)?.name ?? "?",
    }));
    if (kept.length === 0) return;
    const { message, actionLabel } = moveThemTooMessage(kept);
    toast.info(message, {
        id: EDIT_SURPRISE_TOAST_ID,
        duration: MOVE_THEM_TOO_TOAST_MS,
        action: {
            label: actionLabel,
            onClick: () => {
                shiftSlotDestinations({ db, shifts: moves }).catch(
                    (e: unknown) =>
                        toastTimelineError(e, "Error moving marchers"),
                );
            },
        },
    });
}

/**
 * A timeline coordinate edit (`moveMarchersInTarget`) with what it says after: the pass-through
 * toast as before, then, once the resolver has the edit, **Move them too** in its place when the
 * edit left later own moves behind. Errors finding them are logged, never thrown: the edit itself
 * has committed.
 */
export async function moveMarchersAndOfferFollowUp({
    database = db,
    target,
    moves,
    clearOwn,
}: {
    database?: DbConnection;
    target: TimelineEditTarget;
    moves: readonly TimelineMarcherMove[];
    clearOwn?: boolean;
}): Promise<TimelineMoveResult> {
    let start: EditStart | null = null;
    const result = await moveMarchersInTarget({
        db: database,
        target,
        moves,
        clearOwn,
        onStart: () => {
            start = readEditStart(
                target,
                moves.map((m) => m.marcherId),
            );
        },
    });
    toastPassThrough(result);
    void findLaterOwnMoves({ database, target, result, start })
        .then((found) => toastLaterOwnMoves(found))
        .catch((e: unknown) =>
            console.error("Couldn't check the edit's later moves", e),
        );
    return result;
}
