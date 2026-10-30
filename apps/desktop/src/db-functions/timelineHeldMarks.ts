import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";
// A cycle (the ripple reads marks from here), safe because neither module uses the other at load
import { readPageGrid } from "./timelineRipple";

/**
 * **Held** holds (holds README decisions 2 and 4; ADR 0001 amendment 2026-10-30): a stored mark
 * (`timeline_held_marks`) over a stretch where one marcher has no move, meaning "stand still here
 * on purpose". The resolver never reads it: the marcher holds there anyway (spec R-6). It changes
 * only how an edit inside it is routed, and what the timeline draws.
 *
 * A mark runs over `[start, end)` in spec beats. A count `c` is **inside** it when
 * `start < c <= end`: the marcher stands there at every such count, and at `start` it is still
 * arriving. No move of the marcher overlaps a mark (H-1) and one marcher's marks don't overlap
 * (H-3); the commit check (`timeline_held_violations`) rejects an edit that breaks either.
 *
 * **Keeping marks true** (ADR 0001 amendment 2026-10-30, part 2). A mark grows out of its
 * **arrival**: the marcher's highest-layer row ending at the mark's start, whose move ends there
 * too (`arrivalTimeline`), which a drag inside the mark edits.
 *
 * - Page and beat edits move marks with the rows (`planTimelineRipple`).
 * - Every edit, after its own statements and before the commit check, drops the marks whose
 *   arrival is gone (`dropHeldMarksWithoutArrivalInTransaction`, run by `transactionWithHistory`,
 *   never by undo or redo replay, which restore the marks the edit dropped). This is the first
 *   step of the upkeep #473 completes (trim, keep, follow an arrival moved in time, drop).
 */

/** One Held mark. */
export interface HeldMark {
    readonly id: number;
    readonly marcherId: number;
    /** Where the hold starts: the arrival, a count the marcher has a move ending at */
    readonly start: number;
    /** Where it ends; the marcher may move again from here */
    readonly end: number;
}

const toMark = (row: typeof schema.timeline_held_marks.$inferSelect) => ({
    id: row.id,
    marcherId: row.marcher_id,
    start: row.start_beat,
    end: row.end_beat,
});

/** Every Held mark, or only `marcherIds`' ones, by marcher and start. */
export async function readHeldMarks(
    db: DbConnection | DbTransaction,
    marcherIds?: readonly number[],
): Promise<HeldMark[]> {
    if (marcherIds && marcherIds.length === 0) return [];
    const h = schema.timeline_held_marks;
    const rows = await db
        .select()
        .from(h)
        .where(marcherIds ? inArray(h.marcher_id, [...marcherIds]) : undefined)
        .orderBy(h.marcher_id, h.start_beat)
        .all();
    return rows.map(toMark);
}

/** Whether the count `beat` is inside `mark` (`start < beat <= end`). */
export const isInsideHeldMark = (mark: HeldMark, beat: number): boolean =>
    mark.start < beat && beat <= mark.end;

/** A Held marcher's edit, routed to the move that arrives at its hold's start (decision 4). */
export interface HeldArrivalEdit<M extends { marcherId: number }> {
    readonly move: M;
    readonly mark: HeldMark;
    /** The move (timeline) whose end is the hold's start */
    readonly timelineId: number;
}

/**
 * Splits an edit at the count `beat` into the moved marchers that are Held there and the rest.
 *
 * A Held marcher's edit is the edit of the move that arrives at its hold's start: the row of the
 * marcher ending there (the highest layer, should there be several), whose timeline ends there
 * too, so setting that move's ending moves the arrival and the whole hold with it. A marcher Held
 * at `beat` with no such move (a borrowed hold, which only #474 makes) stays with the rest.
 */
export async function splitHeldEditsInTransaction<
    M extends { marcherId: number },
>(
    tx: DbTransaction,
    beat: number,
    moves: readonly M[],
): Promise<{ held: HeldArrivalEdit<M>[]; rest: M[] }> {
    const marks = (
        await readHeldMarks(
            tx,
            moves.map((m) => m.marcherId),
        )
    ).filter((mark) => isInsideHeldMark(mark, beat));
    if (marks.length === 0) return { held: [], rest: [...moves] };
    const markOf = new Map(marks.map((mark) => [mark.marcherId, mark]));
    const held: HeldArrivalEdit<M>[] = [];
    const rest: M[] = [];
    for (const move of moves) {
        const mark = markOf.get(move.marcherId);
        const timelineId = mark
            ? await arrivalTimeline(tx, mark.marcherId, mark.start)
            : null;
        if (mark && timelineId !== null) held.push({ move, mark, timelineId });
        else rest.push(move);
    }
    return { held, rest };
}

/** The move a mark grows out of (`readArrival`). */
export interface HeldArrival {
    readonly timelineId: number;
    readonly transitionId: number;
    /** Its transition's destination shape, if any (a shape or follow-the-leader move) */
    readonly shapeId: number | null;
    readonly pathStyle: string;
}

/**
 * The move of `marcherId` that arrives at `beat` and ends there, if there is one: the marcher's
 * highest-layer row ending at `beat`, when its move ends there too. A mark starting at `beat`
 * grows out of it, and a drag inside the mark edits it.
 */
export async function readArrival(
    tx: DbConnection | DbTransaction,
    marcherId: number,
    beat: number,
): Promise<HeldArrival | null> {
    const a = schema.timeline_assignments;
    const t = schema.timeline_transitions;
    const row = await tx
        .select({
            timelineId: t.timeline_id,
            transitionId: t.id,
            transitionEnd: t.end_beat,
            shapeId: t.dest_shape_id,
            pathStyle: t.path_style,
        })
        .from(a)
        .innerJoin(t, eq(t.id, a.transition_id))
        .where(and(eq(a.marcher_id, marcherId), eq(a.end_beat, beat)))
        .orderBy(desc(a.layer))
        .get();
    if (!row || row.transitionEnd !== beat) return null;
    const { transitionEnd: _, ...arrival } = row;
    return arrival;
}

/** The timeline of `marcherId`'s arrival at `beat` (`readArrival`), if there is one. */
export async function arrivalTimeline(
    tx: DbConnection | DbTransaction,
    marcherId: number,
    beat: number,
): Promise<number | null> {
    return (await readArrival(tx, marcherId, beat))?.timelineId ?? null;
}

/** Whether the file has the Held marks table (a page-era file being converted doesn't yet). */
export async function hasHeldMarksTable(
    db: DbConnection | DbTransaction,
): Promise<boolean> {
    const rows = (await db.all(
        sql`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'timeline_held_marks'`,
    )) as unknown[];
    return rows.length > 0;
}

/**
 * Deletes every mark whose arrival is gone: no row of its marcher arrives at its start by the rule
 * of `arrivalTimeline` (the move that ended there was removed, or replaced by one ending
 * elsewhere). A mark over counts nothing arrives at could never be reached by a drag, and only
 * blocks edits (holds decision 17). Runs after each edit's statements (`transactionWithHistory`),
 * never during undo or redo replay.
 */
export async function dropHeldMarksWithoutArrivalInTransaction(
    tx: DbTransaction,
): Promise<void> {
    if (!(await hasHeldMarksTable(tx))) return;
    await tx.run(sql`
        DELETE FROM timeline_held_marks
         WHERE id IN (
            SELECT h.id FROM timeline_held_marks h
             WHERE NOT EXISTS (
                SELECT 1 FROM timeline_assignments a
                  JOIN timeline_transitions t ON t.id = a.transition_id
                 WHERE a.marcher_id = h.marcher_id
                   AND a.end_beat = h.start_beat
                   AND t.end_beat = h.start_beat
                   AND a.layer = (
                        SELECT MAX(b.layer) FROM timeline_assignments b
                         WHERE b.marcher_id = h.marcher_id AND b.end_beat = h.start_beat
                   )
             )
         )`);
}

/** Who an E-H1 refusal is about: the marchers with a move inside their mark, and its pages. */
export interface HeldConflict {
    /** Drill numbers ("T1"), by drill order */
    readonly names: string[];
    /** The names of the pages those marks start on, in show order */
    readonly pages: string[];
}

/**
 * The marchers that have a move inside one of their marks (the E-H1 rows of
 * `timeline_held_violations`), named for the refusal's message.
 */
export async function heldConflictInTransaction(
    tx: DbTransaction,
): Promise<HeldConflict> {
    const h = schema.timeline_held_marks;
    const a = schema.timeline_assignments;
    const m = schema.marchers;
    const rows = await tx
        .selectDistinct({
            marcherId: h.marcher_id,
            start: h.start_beat,
            prefix: m.drill_prefix,
            order: m.drill_order,
        })
        .from(h)
        .innerJoin(a, eq(a.marcher_id, h.marcher_id))
        .innerJoin(m, eq(m.id, h.marcher_id))
        .where(
            and(
                sql`${a.start_beat} < ${h.end_beat}`,
                sql`${h.start_beat} < ${a.end_beat}`,
            ),
        )
        .all();
    const grid = await readPageGrid(tx);
    const pageOf = (beat: number) =>
        grid.pages.find((p) => p.id !== 0 && p.start <= beat && beat < p.end);
    const names = [
        ...new Map(
            [...rows]
                .sort(
                    (x, y) =>
                        x.prefix.localeCompare(y.prefix) || x.order - y.order,
                )
                .map((r) => [r.marcherId, `${r.prefix}${r.order}`]),
        ).values(),
    ];
    const pages = grid.pages
        .filter((p) => rows.some((r) => pageOf(r.start) === p))
        .flatMap((p) => (p.name === undefined ? [] : [p.name]));
    return { names, pages };
}
