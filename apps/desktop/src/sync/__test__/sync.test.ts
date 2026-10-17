import { afterEach, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle as sqliteProxyDrizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync } from "node:sqlite";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { handleSqlProxyWithDbBetterSqlite } from "@/test/sqlProxyTestUtil";
import {
    getUndoStackLength,
    performUndo,
    performHistoryAction,
    transactionWithHistory,
} from "@/db-functions/history";
import { createMarchers, deleteMarchers } from "@/db-functions/marcher";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import {
    subscribeTimelineChanges,
    type TimelineChangeEvent,
} from "@/db-functions/timelineChanges";
import { readShowTiming } from "@/timeline/showTiming";
import { isCapturing, startCapture, stopCapture } from "../capture";
import { readSyncedTables } from "../tables";
import {
    applyRemoteChanges,
    invertChanges,
    readSyncedSnapshot,
    replaceAllSyncedTables,
} from "../apply";
import {
    ID_BLOCK_SIZE,
    setSyncSession,
    SyncReadOnlyError,
    SyncUndoUnavailableError,
} from "../session";
import type { LocalOp, RowChange } from "../types";

/**
 * WP-A of the collaboration spike (docs/collaboration/spike/CONTRACT.md): capture, the session
 * gate in `transactionWithHistory`, session ids, and remote apply / revert / replace-all, all on
 * real databases. "DB-2" is a second connection on a `VACUUM INTO` copy of the test's file, so
 * two members can be compared row for row.
 */

const ID_BASE = ID_BLOCK_SIZE; // member 1

afterEach(() => setSyncSession(null));

/** Starts capture and a session that records the ops it is handed. */
const startSession = async (db: DbConnection, live = { value: true }) => {
    await startCapture(db);
    const ops: LocalOp[] = [];
    setSyncSession({
        isLive: () => live.value,
        onLocalOp: (op) => ops.push(op),
        idBase: ID_BASE,
    });
    return { ops, live };
};

/** A second connection on a copy of `db`'s file as it is now. */
const openCopy = async (db: DbConnection) => {
    const file = path.join(
        os.tmpdir(),
        `openmarch-sync-copy-${process.pid}-${Math.random().toString(36).slice(2)}.dots`,
    );
    await db.run(sql.raw(`VACUUM INTO '${file}'`));
    const raw = new DatabaseSync(file);
    const orm = sqliteProxyDrizzle(
        async (query, params, method) =>
            handleSqlProxyWithDbBetterSqlite(raw, query, params, method),
        { schema, casing: "snake_case" },
    ) as unknown as DbConnection;
    return {
        db: orm,
        close: async () => {
            raw.close();
            await fs.remove(file);
        },
    };
};

const sortedPages = async (db: DbConnection) =>
    [...(await readShowTiming(db)).pages].sort((a, b) => a.order - b.order);

const recordTimelineEvents = () => {
    const events: TimelineChangeEvent[] = [];
    const stop = subscribeTimelineChanges((e) => {
        events.push(e);
    });
    return { events, stop };
};

describeDbTests("collaboration capture and apply", (it) => {
    it("solo: no temp objects, and inserts keep their usual ids", async ({
        db,
        marchersAndPages,
    }) => {
        expect(await isCapturing(db)).toBe(false);
        const maxBefore = Math.max(
            ...marchersAndPages.expectedMarchers.map((m) => m.id),
        );
        const created = await createMarchers({
            db,
            newMarchers: [
                { section: "Brass", drill_prefix: "Z", drill_order: 1 },
            ],
        });
        expect(created.map((m) => m.id)).toEqual([maxBefore + 1]);
        expect(await isCapturing(db)).toBe(false);
    });

    it("captures a timeline move edit as one exact slot-destination update", async ({
        db,
        marchersAndPages: _,
    }) => {
        const pages = await sortedPages(db);
        const page = pages[3]!;
        const { ops } = await startSession(db);
        const before = await readSyncedSnapshot(db);

        const x = 123.456789012345;
        const y = -0.1 + 0.2;
        const result = await moveMarchersOnPage({
            db,
            page,
            moves: [{ marcherId: 5, x, y }],
        });
        expect(ops).toHaveLength(1);
        expect(ops[0]!.label).toBe("moveMarchersOnPage");
        const [{ transitionId, slotIndex }] = result.slots;
        const row = before.timeline_slot_destinations!.find(
            (r) =>
                r.transition_id === transitionId && r.slot_index === slotIndex,
        )!;
        expect(ops[0]!.changes).toEqual([
            {
                kind: "update",
                table: "timeline_slot_destinations",
                id: row.id,
                set: { x, y },
                prev: { x: row.x, y: row.y },
            },
        ]);
        // Exact doubles, not SQLite's 15-digit JSON
        const set = (
            ops[0]!.changes[0] as Extract<RowChange, { kind: "update" }>
        ).set;
        expect(Object.is(set.y, y)).toBe(true);
    });

    it("captures marcher create (with session ids) and delete with its cascades", async ({
        db,
        marchersAndPages: _,
    }) => {
        // A tag on marcher 3, so deleting it cascades to marcher_tags
        await transactionWithHistory(db, "tag", async (tx) => {
            const [tag] = await tx
                .insert(schema.tags)
                .values({ name: "T" })
                .returning();
            await tx
                .insert(schema.marcher_tags)
                .values({ marcher_id: 3, tag_id: tag!.id });
        });
        const { ops } = await startSession(db);

        const created = await createMarchers({
            db,
            newMarchers: [
                { section: "Brass", drill_prefix: "Z", drill_order: 1 },
                { section: "Brass", drill_prefix: "Z", drill_order: 2 },
            ],
        });
        expect(created.map((m) => m.id)).toEqual([ID_BASE, ID_BASE + 1]);
        const inserts = ops[0]!.changes.filter(
            (c) => c.kind === "insert" && c.table === "marchers",
        );
        expect(inserts.map((c) => c.id)).toEqual([ID_BASE, ID_BASE + 1]);
        expect(
            inserts.every(
                (c) =>
                    c.kind === "insert" &&
                    c.row.id === c.id &&
                    c.row.drill_prefix === "Z",
            ),
        ).toBe(true);

        const assignmentsOf3 = await db
            .select({ id: schema.timeline_assignments.id })
            .from(schema.timeline_assignments)
            .where(eq(schema.timeline_assignments.marcher_id, 3))
            .all();
        expect(assignmentsOf3.length).toBeGreaterThan(0);
        await deleteMarchers({ db, marcherIds: new Set([3]) });
        const deletes = ops[1]!.changes.filter((c) => c.kind === "delete");
        const deleted = (table: string) =>
            deletes.filter((c) => c.table === table).map((c) => c.id);
        expect(deleted("marchers")).toEqual([3]);
        expect(deleted("marcher_tags")).toHaveLength(1);
        expect(new Set(deleted("timeline_assignments"))).toEqual(
            new Set(assignmentsOf3.map((a) => a.id)),
        );
    });

    it("a rolled-back edit captures and sends nothing", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { ops } = await startSession(db);
        await expect(
            transactionWithHistory(db, "fails", async (tx) => {
                await tx
                    .update(schema.marchers)
                    .set({ name: "x" })
                    .where(eq(schema.marchers.id, 1));
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(ops).toEqual([]);
        const log = (await db.all(
            sql.raw("SELECT count(*) FROM temp.sync_change_log"),
        )) as unknown[][];
        expect(log[0]![0]).toBe(0);
    });

    it("refuses edits while not live, and built-in undo in a session", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { ops, live } = await startSession(db);
        live.value = false;
        const before = await readSyncedSnapshot(db);
        await expect(
            transactionWithHistory(db, "rename", async (tx) => {
                await tx
                    .update(schema.marchers)
                    .set({ name: "x" })
                    .where(eq(schema.marchers.id, 1));
            }),
        ).rejects.toBeInstanceOf(SyncReadOnlyError);
        expect(await readSyncedSnapshot(db)).toEqual(before);
        expect(ops).toEqual([]);

        live.value = true;
        await expect(performUndo(db)).rejects.toBeInstanceOf(
            SyncUndoUnavailableError,
        );
        await expect(performHistoryAction("redo", db)).rejects.toBeInstanceOf(
            SyncUndoUnavailableError,
        );
    });

    it("applying DB-1's ops to a copy makes the synced tables equal, without undo history", async ({
        db,
        marchersAndPages: _,
    }) => {
        const copy = await openCopy(db);
        try {
            const { ops } = await startSession(db);
            const pages = await sortedPages(db);
            await moveMarchersOnPage({
                db,
                page: pages[2]!,
                moves: [
                    { marcherId: 1, x: 10.5, y: 1 / 3 },
                    { marcherId: 2, x: -3, y: 4 },
                ],
            });
            await moveMarchersOnPage({
                db,
                page: pages[0]!,
                moves: [{ marcherId: 4, x: 7, y: 8 }],
            });
            await createMarchers({
                db,
                newMarchers: [
                    { section: "Brass", drill_prefix: "Z", drill_order: 1 },
                ],
            });
            await deleteMarchers({ db, marcherIds: new Set([6]) });
            expect(ops).toHaveLength(4);

            const undoBefore = await getUndoStackLength(copy.db);
            const { events, stop } = recordTimelineEvents();
            let tables = new Set<string>();
            try {
                for (const op of ops) {
                    const result = await applyRemoteChanges(
                        copy.db,
                        op.changes,
                    );
                    for (const t of result.tables) tables.add(t);
                }
            } finally {
                stop();
            }
            expect(await readSyncedSnapshot(copy.db)).toEqual(
                await readSyncedSnapshot(db),
            );
            expect(await getUndoStackLength(copy.db)).toBe(undoBefore);
            expect(tables.has("marchers")).toBe(true);
            expect(tables.has("timeline_slot_destinations")).toBe(true);
            // Timeline listeners got incremental batches, not resets
            expect(events.length).toBeGreaterThan(0);
            expect(events.every((e) => e.kind === "batch")).toBe(true);

            // Applying the same changes again is harmless (inserts become updates, deletes find nothing)
            for (const op of ops) await applyRemoteChanges(copy.db, op.changes);
            expect(await readSyncedSnapshot(copy.db)).toEqual(
                await readSyncedSnapshot(db),
            );
        } finally {
            await copy.close();
        }
    });

    it("reverting an op (its inverse) restores the rows and leaves undo alone", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { ops } = await startSession(db);
        const before = await readSyncedSnapshot(db);
        const pages = await sortedPages(db);
        await moveMarchersOnPage({
            db,
            page: pages[4]!,
            moves: [{ marcherId: 2, x: 50, y: 60 }],
        });
        await deleteMarchers({ db, marcherIds: new Set([3]) });
        expect(ops).toHaveLength(2);
        const undoBefore = await getUndoStackLength(db);

        for (const op of [...ops].reverse())
            await applyRemoteChanges(db, invertChanges(op.changes));
        expect(await readSyncedSnapshot(db)).toEqual(before);
        expect(await getUndoStackLength(db)).toBe(undoBefore);
        // Recording is back on, and the revert itself was not captured
        expect(ops).toHaveLength(2);
        const log = (await db.all(
            sql.raw("SELECT count(*) FROM temp.sync_change_log"),
        )) as unknown[][];
        expect(log[0]![0]).toBe(0);
        await moveMarchersOnPage({
            db,
            page: pages[4]!,
            moves: [{ marcherId: 2, x: 51, y: 61 }],
        });
        expect(ops).toHaveLength(3);
    });

    it("skip keeps fields with a pending local write", async ({
        db,
        marchersAndPages: _,
    }) => {
        const [m] = await db
            .select()
            .from(schema.marchers)
            .where(eq(schema.marchers.id, 1))
            .all();
        await applyRemoteChanges(
            db,
            [
                {
                    kind: "update",
                    table: "marchers",
                    id: 1,
                    set: { name: "remote", drill_order: 99 },
                    prev: { name: m!.name, drill_order: m!.drill_order },
                },
            ],
            { skip: (_t, _id, col) => col === "name" },
        );
        const [after] = await db
            .select()
            .from(schema.marchers)
            .where(eq(schema.marchers.id, 1))
            .all();
        expect(after!.name).toBe(m!.name);
        expect(after!.drill_order).toBe(99);
    });

    it("replace-all (join) makes a stale copy match and emits a timeline reset", async ({
        db,
        marchersAndPages: _,
    }) => {
        const copy = await openCopy(db);
        try {
            const pages = await sortedPages(db);
            await moveMarchersOnPage({
                db,
                page: pages[1]!,
                moves: [{ marcherId: 1, x: 1, y: 2 }],
            });
            await createMarchers({
                db,
                newMarchers: [
                    { section: "Brass", drill_prefix: "Z", drill_order: 1 },
                ],
            });
            await deleteMarchers({ db, marcherIds: new Set([2]) });

            const undoBefore = await getUndoStackLength(copy.db);
            const { events, stop } = recordTimelineEvents();
            try {
                await replaceAllSyncedTables(
                    copy.db,
                    await readSyncedSnapshot(db),
                );
            } finally {
                stop();
            }
            expect(await readSyncedSnapshot(copy.db)).toEqual(
                await readSyncedSnapshot(db),
            );
            expect(await getUndoStackLength(copy.db)).toBe(undoBefore);
            expect(events).toEqual([{ kind: "reset" }]);
        } finally {
            await copy.close();
        }
    });

    it("orders synced tables parents first, keys them by rowid and leaves blobs out", async ({
        db,
    }) => {
        const tables = await readSyncedTables(db);
        const seen = new Set<string>();
        for (const t of tables) {
            for (const p of t.parents)
                if (tables.some((o) => o.name === p))
                    expect(seen.has(p), `${p} before ${t.name}`).toBe(true);
            seen.add(t.name);
        }
        const keyOf = Object.fromEntries(tables.map((t) => [t.name, t.key]));
        expect(keyOf.timeline_kept_assignments).toBe("assignment_id");
        expect(keyOf.page_performer_settings).toBe("page_id");
        expect(keyOf.marcher_tags).toBe("id");
        expect(keyOf.cue_marchers).toBe("id");
        const fp = tables.find((t) => t.name === "field_properties")!;
        expect(fp.columns.map((c) => c.name)).not.toContain("image");
        const snapshot = await readSyncedSnapshot(db);
        for (const row of snapshot.field_properties ?? [])
            expect(row).not.toHaveProperty("image");
    });

    it("stopCapture removes every temp object", async ({ db }) => {
        await startCapture(db);
        expect(await isCapturing(db)).toBe(true);
        await stopCapture(db);
        expect(await isCapturing(db)).toBe(false);
        const temp = (await db.all(
            sql.raw("SELECT count(*) FROM temp.sqlite_schema"),
        )) as unknown[][];
        expect(temp[0]![0]).toBe(0);
    });
});
