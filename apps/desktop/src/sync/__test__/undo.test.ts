import { afterEach, expect } from "vitest";
import { eq } from "drizzle-orm";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import {
    performHistoryAction,
    transactionWithHistory,
} from "@/db-functions/history";
import { createMarchers, deleteMarchers } from "@/db-functions/marcher";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import { readShowTiming } from "@/timeline/showTiming";
import { startCapture } from "../capture";
import { applyRemoteChanges, readSyncedSnapshot } from "../apply";
import { ID_BLOCK_SIZE, setSyncSession } from "../session";
import { orderForTriggers, UserUndo, type UndoNotice } from "../undo";
import type { RowChange, SyncUser } from "../types";

/**
 * Per-user undo (WP-D) on real databases. The server is stood in for by echoing each local op
 * straight back as applied (its effective changes are the op's own when nothing conflicts);
 * another member's edits are written with `applyRemoteChanges` and reported as applied by them.
 */

const me: SyncUser = { id: "me", name: "Me", color: "#000" };
const pat: SyncUser = { id: "pat", name: "Pat", color: "#111" };

afterEach(() => setSyncSession(null));

const startUndoSession = async (db: DbConnection) => {
    await startCapture(db);
    let seq = 0;
    const notices: UndoNotice[] = [];
    const labels: string[] = [];
    const undo = new UserUndo({
        db,
        me: () => me,
        settled: async () => {},
        notify: (n) => notices.push(n),
        changed: () => {},
    });
    setSyncSession({
        isLive: () => true,
        idBase: ID_BLOCK_SIZE,
        onLocalOp: (op) => {
            const opId = `local-${seq + 1}`;
            labels.push(op.label);
            undo.tagLocal(opId, op.label);
            undo.applied(
                {
                    seq: ++seq,
                    opId,
                    by: me,
                    changes: op.changes,
                    label: op.label,
                },
                true,
            );
        },
        historyAction: (type, options) => undo.run(type, options),
        historyStackLength: (type) => undo.length(type),
    });
    /** Pat's edit: written without history and reported as applied by Pat */
    const remote = async (changes: RowChange[]) => {
        await applyRemoteChanges(db, changes);
        undo.applied(
            {
                seq: ++seq,
                opId: `remote-${seq}`,
                by: pat,
                changes,
                label: "Pat",
            },
            false,
        );
    };
    return { undo, notices, labels, remote };
};

const sortedPages = async (db: DbConnection) =>
    [...(await readShowTiming(db)).pages].sort((a, b) => a.order - b.order);

const destinationRow = async (db: DbConnection, id: number) =>
    (await db
        .select()
        .from(schema.timeline_slot_destinations)
        .where(eq(schema.timeline_slot_destinations.id, id))
        .get())!;

describeDbTests("per-user undo", (it) => {
    it("undo reverts only my fields: a field Pat changed since is kept", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { undo, notices, remote } = await startUndoSession(db);
        const page = (await sortedPages(db))[2]!;
        const before = await readSyncedSnapshot(db);
        const moved = await moveMarchersOnPage({
            db,
            page,
            moves: [
                { marcherId: 1, x: 11, y: 12 },
                { marcherId: 2, x: 21, y: 22 },
            ],
        });
        expect(undo.length("undo")).toBe(1);
        const ids = (undo.undoStack[0]!.changes as RowChange[])
            .filter((c) => c.table === "timeline_slot_destinations")
            .map((c) => c.id);
        expect(ids).toHaveLength(2);
        // Pat moves marcher 2's destination x afterwards
        const second = undo.undoStack[0]!.changes.find(
            (c) => c.kind === "update" && c.set.x === 21,
        )!.id;
        await remote([
            {
                kind: "update",
                table: "timeline_slot_destinations",
                id: second,
                set: { x: 99 },
                prev: { x: 21 },
            },
        ]);
        expect(moved.slots.length).toBeGreaterThan(0);

        const response = await performHistoryAction("undo", db, {
            currentPageId: page.id,
        });
        expect(response.failure).toBeUndefined();
        expect(response.nothingToDo).toBeFalsy();
        const after = await readSyncedSnapshot(db);
        const beforeRow = (id: number) =>
            before.timeline_slot_destinations!.find((r) => r.id === id)!;
        const first = ids.find((id) => id !== second)!;
        expect(await destinationRow(db, first)).toMatchObject({
            x: beforeRow(first).x,
            y: beforeRow(first).y,
        });
        // Pat's x stays; my y goes back
        expect(await destinationRow(db, second)).toMatchObject({
            x: 99,
            y: beforeRow(second).y,
        });
        expect(notices).toEqual([
            {
                kind: "undo-partial",
                which: "undo",
                label: "moveMarchersOnPage",
                names: ["Pat"],
            },
        ]);
        expect(after).not.toEqual(before);
        // The undo is on the redo stack; redo puts my y back, Pat's x still stays
        expect(undo.length("redo")).toBe(1);
        await performHistoryAction("redo", db);
        expect(await destinationRow(db, second)).toMatchObject({
            x: 99,
            y: 22,
        });
        expect(await destinationRow(db, first)).toMatchObject({ x: 11, y: 12 });
    });

    it("undo of a delete restores the same ids; undo of a create removes them; redo restores", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { undo } = await startUndoSession(db);
        const before = await readSyncedSnapshot(db);
        await deleteMarchers({ db, marcherIds: new Set([3]) });
        expect(
            (await readSyncedSnapshot(db)).marchers!.some((m) => m.id === 3),
        ).toBe(false);
        await performHistoryAction("undo", db);
        expect(await readSyncedSnapshot(db)).toEqual(before);

        const created = await createMarchers({
            db,
            newMarchers: [
                { section: "Brass", drill_prefix: "Z", drill_order: 1 },
            ],
        });
        const withNew = await readSyncedSnapshot(db);
        expect(created[0]!.id).toBe(ID_BLOCK_SIZE);
        await performHistoryAction("undo", db);
        expect(await readSyncedSnapshot(db)).toEqual(before);
        await performHistoryAction("redo", db);
        expect(await readSyncedSnapshot(db)).toEqual(withNew);
        expect(undo.length("undo")).toBe(1);
        expect(undo.length("redo")).toBe(0);
    });

    it("an insert someone else edited since is not undone", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { undo, notices, remote } = await startUndoSession(db);
        const [created] = await createMarchers({
            db,
            newMarchers: [
                { section: "Brass", drill_prefix: "Z", drill_order: 1 },
            ],
        });
        await remote([
            {
                kind: "update",
                table: "marchers",
                id: created!.id,
                set: { name: "Pat's" },
                prev: { name: created!.name ?? null },
            },
        ]);
        const response = await performHistoryAction("undo", db);
        expect(response.failure).toBeUndefined();
        const names = (await readSyncedSnapshot(db)).marchers!.map((m) => m.id);
        expect(names).toContain(created!.id);
        expect(notices[0]).toMatchObject({ kind: "undo-refused" });
        // Refused, so it stays on the stack
        expect(undo.length("undo")).toBe(1);
    });

    it("a structural undo is refused once someone else has written beats after it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { notices, remote } = await startUndoSession(db);
        const measure = (await db.select().from(schema.measures).all())[0]!;
        await transactionWithHistory(db, "renameMeasure", async (tx) => {
            await tx
                .update(schema.measures)
                .set({ rehearsal_mark: "Z" })
                .where(eq(schema.measures.id, measure.id));
        });
        const timeline = (await db.select().from(schema.timelines).all())[0];
        // Pat's beat-writing op: the timeline's own beats, written back unchanged
        await remote([
            {
                kind: "update",
                table: "timelines",
                id: timeline!.id,
                set: { end_beat: timeline!.end_beat },
                prev: { end_beat: timeline!.end_beat },
            },
        ]);
        await performHistoryAction("undo", db);
        expect(notices[0]).toMatchObject({ kind: "undo-refused" });
        expect(
            (await db.select().from(schema.measures).all())[0]!.rehearsal_mark,
        ).toBe("Z");
    });

    it("orders an inverse deletes children first, then updates, then inserts parents first", () => {
        const ch = (kind: RowChange["kind"], table: string, id: number) =>
            (kind === "insert"
                ? { kind, table, id, row: {} }
                : kind === "update"
                  ? { kind, table, id, set: {}, prev: {} }
                  : { kind, table, id, prev: {} }) as RowChange;
        const order = [
            "marchers",
            "timeline_transitions",
            "timeline_assignments",
        ];
        const out = orderForTriggers(
            [
                ch("insert", "timeline_assignments", 1),
                ch("delete", "marchers", 2),
                ch("update", "timeline_transitions", 3),
                ch("insert", "marchers", 4),
                ch("delete", "timeline_assignments", 5),
            ],
            order,
        );
        expect(out.map((c) => `${c.kind}:${c.table}`)).toEqual([
            "delete:timeline_assignments",
            "delete:marchers",
            "update:timeline_transitions",
            "insert:marchers",
            "insert:timeline_assignments",
        ]);
    });
});
