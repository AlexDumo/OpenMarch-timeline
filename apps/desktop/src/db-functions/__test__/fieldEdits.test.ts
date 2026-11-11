import { describe, expect } from "vitest";
import { describeDbTests, schema } from "@/test/base";
import { getTestWithHistory } from "@/test/history";
import { timelineHistoryTables } from "@/test/timelineMode";
import {
    applyFieldEdit,
    applyFieldEdits,
    getFieldPropertiesInTransaction,
} from "../fieldEdits";
import { getCurrentUndoGroup, performUndo, performRedo } from "../history";
import { runFieldEdit } from "@/field/edits";

describeDbTests("fieldEdits", (it) => {
    const testWithHistory = getTestWithHistory(it, [
        schema.field_properties,
        ...timelineHistoryTables(),
    ]);

    describe("applyFieldEdit", () => {
        testWithHistory(
            "writes one edit as one undo step, and undo restores the field",
            async ({ db, expectNumberOfChanges }) => {
                const before = await getFieldPropertiesInTransaction({
                    tx: db,
                });
                const databaseState =
                    await expectNumberOfChanges.getDatabaseState(db);

                const result = await applyFieldEdit({
                    db,
                    edit: {
                        edit: "addCheckpoint",
                        args: { axis: "x", steps: 4, mirror: true },
                    },
                });
                expect(result.diff.ok).toBe(true);
                expect(result.diff.checkpoints.added).toHaveLength(2);
                const after = await getFieldPropertiesInTransaction({
                    tx: db,
                });
                expect(after.xCheckpoints).toHaveLength(
                    before.xCheckpoints.length + 2,
                );
                // What was written is what the dry run said
                expect(JSON.stringify(after)).toBe(
                    JSON.stringify(
                        runFieldEdit(before, {
                            edit: "addCheckpoint",
                            args: { axis: "x", steps: 4, mirror: true },
                        }).next,
                    ),
                );

                await expectNumberOfChanges.test(db, 1, databaseState);

                // One undo takes the whole edit back
                await performUndo(db);
                const undone = await getFieldPropertiesInTransaction({
                    tx: db,
                });
                expect(JSON.stringify(undone)).toBe(JSON.stringify(before));
                await performRedo(db);
            },
        );

        testWithHistory(
            "several edits are still one undo step",
            async ({ db, expectNumberOfChanges }) => {
                const before = await getFieldPropertiesInTransaction({
                    tx: db,
                });
                const databaseState =
                    await expectNumberOfChanges.getDatabaseState(db);
                const first = before.xCheckpoints[0]!;
                const result = await applyFieldEdits({
                    db,
                    edits: [
                        {
                            edit: "updateCheckpoints",
                            args: {
                                ids: [{ axis: "x", id: first.id }],
                                patch: { name: "Renamed", visible: false },
                            },
                        },
                        {
                            edit: "setFieldSettings",
                            args: { patch: { topLabelsVisible: false } },
                        },
                    ],
                });
                expect(result.diff.ok).toBe(true);
                await expectNumberOfChanges.test(db, 1, databaseState);
            },
        );
    });

    it("a refused or empty edit writes nothing and makes no undo step", async ({
        db,
    }) => {
        const before = await getFieldPropertiesInTransaction({ tx: db });
        const groupBefore = await getCurrentUndoGroup(db);

        const refused = await applyFieldEdit({
            db,
            edit: {
                edit: "removeCheckpoints",
                args: {
                    ids: before.yCheckpoints.map((c) => ({
                        axis: "y" as const,
                        id: c.id,
                    })),
                },
            },
        });
        expect(refused.diff.ok).toBe(false);
        expect(refused.diff.errors[0]!.code).toBe("min-checkpoints");

        const empty = await applyFieldEdit({
            db,
            edit: {
                edit: "setFieldSettings",
                args: { patch: { name: before.name } },
            },
        });
        expect(empty.diff).toMatchObject({ ok: true, empty: true });

        expect(await getCurrentUndoGroup(db)).toBe(groupBefore);
        expect(
            JSON.stringify(await getFieldPropertiesInTransaction({ tx: db })),
        ).toBe(JSON.stringify(before));
    });
});
