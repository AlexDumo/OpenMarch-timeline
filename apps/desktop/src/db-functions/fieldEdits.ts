import { eq } from "drizzle-orm";
import { FieldProperties } from "@openmarch/core";
import { schema } from "@/global/database/db";
import {
    runFieldEdits,
    type FieldEditRequest,
    type FieldEditResult,
} from "@/field/edits";
import { transactionWithHistory } from "./history";
import type { DbConnection, DbTransaction } from "./types";

/** The only row of `field_properties` */
const FIELD_PROPERTIES_ROW_ID = 1;

export async function getFieldPropertiesInTransaction({
    tx,
}: {
    tx: DbConnection | DbTransaction;
}): Promise<FieldProperties> {
    const row = await tx
        .select({ json_data: schema.field_properties.json_data })
        .from(schema.field_properties)
        .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ROW_ID))
        .get();
    if (!row) throw new Error("Field properties not found");
    return new FieldProperties(JSON.parse(row.json_data));
}

/**
 * Applies field edits (#823) as one undo step: reads the stored field inside the transaction,
 * runs the edits on it, and writes the result. A refused or empty edit writes nothing and makes
 * no undo step; its result says why (`diff.ok`, `diff.errors`, `diff.empty`).
 *
 * The dry run is `runFieldEdit`/`runFieldEdits` from `@/field/edits`, with no database.
 */
export async function applyFieldEdits({
    db,
    edits,
}: {
    db: DbConnection;
    edits: readonly FieldEditRequest[];
}): Promise<FieldEditResult> {
    // A first run outside the transaction: refusals and no-ops must not open an undo step, which
    // transactionWithHistory requires to write something
    const dryRun = runFieldEdits(
        await getFieldPropertiesInTransaction({ tx: db }),
        edits,
    );
    if (!dryRun.diff.ok || dryRun.diff.empty) return dryRun;
    const name = `fieldEdit:${dryRun.diff.edit}`;
    return await transactionWithHistory(db, name, async (tx) => {
        // Again on what is stored now, in case another write landed in between
        const result = runFieldEdits(
            await getFieldPropertiesInTransaction({ tx }),
            edits,
        );
        if (!result.diff.ok || result.diff.empty)
            throw new Error(
                `Field edit ${result.diff.edit} no longer applies: ${result.diff.errors.map((e) => e.message).join("; ") || "nothing to change"}`,
            );
        await tx
            .update(schema.field_properties)
            .set({ json_data: JSON.stringify(result.next) })
            .where(eq(schema.field_properties.id, FIELD_PROPERTIES_ROW_ID));
        return result;
    });
}

/** applyFieldEdits for one edit */
export async function applyFieldEdit({
    db,
    edit,
}: {
    db: DbConnection;
    edit: FieldEditRequest;
}): Promise<FieldEditResult> {
    return await applyFieldEdits({ db, edits: [edit] });
}
