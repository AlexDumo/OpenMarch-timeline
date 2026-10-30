import { inArray, sql, type SQL } from "drizzle-orm";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbConnection, DbTransaction } from "./types";

/**
 * The Held marks as stored, and the one rule for a mark's **arrival** (ADR 0001 amendment
 * 2026-10-30, part 2). Kept apart from `timelineHeldMarks` so the page ripple
 * (`timelineRipple`), Hold from previous page, a drag inside a hold and the upkeep after each
 * edit (`timelineHeldUpkeep`) all find an arrival the same way, from one SQL fragment
 * (`arrivalRowSql`), and the ripple needn't import the commands that read its page grid.
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

/** A Held mark and the row it grows out of (`arrivalRowSql`), if any. */
export interface HeldMarkArrival extends HeldMark {
    /** The id of the `timeline_assignments` row arriving at `start`, or `null` */
    readonly arrivalId: number | null;
}

const toMark = (row: typeof schema.timeline_held_marks.$inferSelect) => ({
    id: row.id,
    marcherId: row.marcher_id,
    start: row.start_beat,
    end: row.end_beat,
});

/** Whether the file has the Held marks table (a page-era file being converted doesn't yet). */
export async function hasHeldMarksTable(
    db: DbConnection | DbTransaction,
): Promise<boolean> {
    const rows = (await db.all(
        sql`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'timeline_held_marks'`,
    )) as unknown[];
    return rows.length > 0;
}

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

/**
 * **The arrival rule**, as a scalar SQL subquery: the id of the row of the marcher `marcher`
 * arriving at the count `beat`, or NULL. That is the marcher's highest-layer row ending at
 * `beat`, when its move (transition) ends there too. A mark starting at `beat` grows out of it,
 * and a drag inside the mark edits it. One marcher's rows on one layer don't overlap (I-A3), so
 * there is at most one.
 */
export const arrivalRowSql = (marcher: SQL, beat: SQL): SQL => sql`(
    SELECT a.id FROM timeline_assignments a
      JOIN timeline_transitions t ON t.id = a.transition_id
     WHERE a.marcher_id = ${marcher} AND a.end_beat = ${beat}
       AND t.end_beat = ${beat}
       AND a.layer = (
            SELECT MAX(b.layer) FROM timeline_assignments b
             WHERE b.marcher_id = ${marcher} AND b.end_beat = ${beat}
       )
)`;

/** `tx.all` returns rows as objects or, through the proxy, as arrays in SELECT order. */
const rowValue = (row: unknown, index: number, key: string): unknown =>
    Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[key];

const numberOrNull = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);

/** Every Held mark with its arrival (`arrivalRowSql`); none in a file without the table. */
export async function readHeldMarkArrivals(
    db: DbConnection | DbTransaction,
): Promise<HeldMarkArrival[]> {
    if (!(await hasHeldMarksTable(db))) return [];
    const rows = (await db.all(sql`
        SELECT h.id, h.marcher_id, h.start_beat, h.end_beat,
               ${arrivalRowSql(sql.raw("h.marcher_id"), sql.raw("h.start_beat"))} AS arrival_id
          FROM timeline_held_marks h
         ORDER BY h.marcher_id, h.start_beat`)) as unknown[];
    return rows.map((row) => ({
        id: Number(rowValue(row, 0, "id")),
        marcherId: Number(rowValue(row, 1, "marcher_id")),
        start: Number(rowValue(row, 2, "start_beat")),
        end: Number(rowValue(row, 3, "end_beat")),
        arrivalId: numberOrNull(rowValue(row, 4, "arrival_id")),
    }));
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
 * The move of `marcherId` that arrives at `beat` and ends there (`arrivalRowSql`), if there is
 * one. A mark starting at `beat` grows out of it, and a drag inside the mark edits it.
 */
export async function readArrival(
    db: DbConnection | DbTransaction,
    marcherId: number,
    beat: number,
): Promise<HeldArrival | null> {
    const [row] = (await db.all(sql`
        SELECT t.timeline_id, t.id, t.dest_shape_id, t.path_style
          FROM timeline_assignments a
          JOIN timeline_transitions t ON t.id = a.transition_id
         WHERE a.id = ${arrivalRowSql(sql`${marcherId}`, sql`${beat}`)}`)) as unknown[];
    if (row === undefined) return null;
    return {
        timelineId: Number(rowValue(row, 0, "timeline_id")),
        transitionId: Number(rowValue(row, 1, "id")),
        shapeId: numberOrNull(rowValue(row, 2, "dest_shape_id")),
        pathStyle: String(rowValue(row, 3, "path_style")),
    };
}
