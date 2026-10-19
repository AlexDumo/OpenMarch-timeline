/**
 * Keeping item changes when every beat is replaced (a tempo edit in the audio editor, a MusicXML
 * import). Those paths create the new beats, then delete all the old ones but beat 0, and the
 * item tables' `beat_id ON DELETE CASCADE` would take every item change with them: a prop made
 * after beat 0 would lose its only Outline and stay Off field for good. Instead each change moves
 * to the new beat nearest its old time, in the same transaction, so one undo restores both.
 *
 * Extension point: every item table keyed by beat belongs in {@link BEAT_KEYED_ITEM_TABLES}. A
 * table added by a later migration (Placement changes, Artwork slot assignments) adds an entry
 * with its own uniqueness `key`; tables a file doesn't have yet are skipped by name.
 */
import { asc, eq, sql } from "drizzle-orm";
import { schema } from "@/global/database/db";
import type { DbConnection, DbTransaction } from "./types";
import { FIRST_BEAT_ID } from "./beat";

/** An item table whose rows are changes on a beat. */
type BeatKeyedItemTable = typeof schema.item_geometry;

interface BeatKeyedItemTableEntry {
    /** The SQLite table name, to skip files that don't have the table yet */
    name: string;
    table: BeatKeyedItemTable;
    /**
     * What a beat holds at most one change per, besides the beat: the item for Outline changes
     * (`item_geometry_item_beat_unique`). A per-slot table returns item and slot.
     */
    key: (row: { item_id: number }) => string;
}

/** The item tables whose changes are re-mapped onto replacement beats. */
export const BEAT_KEYED_ITEM_TABLES: readonly BeatKeyedItemTableEntry[] = [
    {
        name: "item_geometry",
        table: schema.item_geometry,
        key: (row) => String(row.item_id),
    },
];

/** Whether the file has table `name`: item tables come with timeline-only migrations. */
const hasTable = async (db: DbConnection | DbTransaction, name: string) =>
    !!(
        await db
            .select({ n: sql<number>`count(*)` })
            .from(sql`sqlite_schema`)
            .where(sql`type = 'table' AND name = ${name}`)
            .get()
    )?.n;

/**
 * For each beat about to be deleted, the surviving beat nearest it in time. Old and new times
 * are each counted from beat 0, along the deleted beats (the old timeline) and along the
 * survivors (the new one). Of new beats at the same time the last wins, so a change on the first
 * counted beat stays off beat 0; between two equally near beats the earlier wins. A change past
 * the new timeline's end goes to its last beat. `at` is the old time, to keep the latest of
 * several changes landing together.
 */
export const nearestSurvivingBeatByTime = (
    beats: readonly { id: number; position: number; duration: number }[],
    beatIds: ReadonlySet<number>,
): Map<number, { to: number; at: number }> => {
    const sorted = [...beats].sort(
        (a, b) => a.position - b.position || a.id - b.id,
    );
    const first = sorted.find((b) => b.id === FIRST_BEAT_ID);
    const times = (line: typeof sorted) => {
        let t = 0;
        return line.map((b) => {
            const at = t;
            t += b.duration;
            return { id: b.id, at };
        });
    };
    const oldLine = times(
        sorted.filter((b) => beatIds.has(b.id) || b === first),
    );
    const newLine = times(sorted.filter((b) => !beatIds.has(b.id)));
    const result = new Map<number, { to: number; at: number }>();
    if (newLine.length === 0) return result;
    let j = 0;
    for (const { id, at } of oldLine) {
        if (!beatIds.has(id)) continue;
        // Both lines are in time order: the last new beat at or before `at`, or the one after it
        // when that is strictly nearer
        while (j + 1 < newLine.length && newLine[j + 1].at <= at) j++;
        const after = newLine[j + 1];
        const to =
            after && after.at - at < at - newLine[j].at ? after : newLine[j];
        result.set(id, { to: to.id, at });
    }
    return result;
};

/**
 * Moves the item changes on `beatIds` to the surviving beat nearest each one's time, before a
 * caller deletes those beats as part of replacing them all. Call it after the new beats exist and
 * in the same transaction as the deletion. When several changes for one item (and key) land on
 * one beat, the latest in time is kept and the rest go with their beats; a change already on the
 * surviving beat wins, as with the carry on deleting beats (ADR 0004 amendment of 2026-10-15).
 */
export async function remapItemChangesOntoReplacementBeatsInTransaction({
    tx,
    beatIds,
}: {
    tx: DbTransaction;
    beatIds: ReadonlySet<number>;
}): Promise<void> {
    if (beatIds.size === 0) return;
    let nearest: Map<number, { to: number; at: number }> | null = null;
    for (const { name, table, key } of BEAT_KEYED_ITEM_TABLES) {
        if (!(await hasTable(tx, name))) continue;
        const rows = await tx
            .select({
                id: table.id,
                item_id: table.item_id,
                beat_id: table.beat_id,
            })
            .from(table)
            .all();
        if (!rows.some((row) => beatIds.has(row.beat_id))) continue;
        nearest ??= nearestSurvivingBeatByTime(
            await tx
                .select({
                    id: schema.beats.id,
                    position: schema.beats.position,
                    duration: schema.beats.duration,
                })
                .from(schema.beats)
                .orderBy(asc(schema.beats.position))
                .all(),
            beatIds,
        );

        const taken = new Set(
            rows
                .filter((row) => !beatIds.has(row.beat_id))
                .map((row) => `${key(row)}|${row.beat_id}`),
        );
        const kept = new Map<string, { id: number; to: number; at: number }>();
        for (const row of rows) {
            const target = nearest.get(row.beat_id);
            if (!target) continue;
            const slot = `${key(row)}|${target.to}`;
            if (taken.has(slot)) continue;
            const current = kept.get(slot);
            if (!current || target.at > current.at)
                kept.set(slot, { id: row.id, ...target });
        }
        for (const { id, to } of kept.values())
            await tx
                .update(table)
                .set({ beat_id: to })
                .where(eq(table.id, id))
                .run();
    }
}
