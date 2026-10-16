import { FieldProperties } from "@openmarch/core";
import { db, schema } from "../database/db";
import { eq } from "drizzle-orm";
import { transactionWithHistory } from "../../db-functions/history";
import {
    getFieldFloorImage,
    writeFieldJsonKeepingFloorInTransaction,
} from "../../db-functions/fieldFloor";

const { field_properties } = schema;

export async function getFieldPropertiesJSON(): Promise<string> {
    const fieldProperties = await db
        .select()
        .from(field_properties)
        .where(eq(field_properties.id, 1))
        .prepare()
        .get();
    if (!fieldProperties) {
        throw new Error("Field properties not found");
    }
    return fieldProperties.json_data;
}

export async function getFieldProperties(): Promise<FieldProperties> {
    const fieldPropertiesJson = await getFieldPropertiesJSON();
    return new FieldProperties(JSON.parse(fieldPropertiesJson));
}

export async function updateFieldsPropertiesJSON(
    fieldPropertiesJson: string,
): Promise<string> {
    // The floor is set only by setFieldFloor (D-23): a template or a stale edit keeps it
    return transactionWithHistory(db, "updateFieldsPropertiesJSON", (tx) =>
        writeFieldJsonKeepingFloorInTransaction({
            tx,
            json: fieldPropertiesJson,
        }),
    );
}

export async function updateFieldProperties(
    fieldProperties: FieldProperties,
): Promise<FieldProperties> {
    const fieldPropertiesJson = JSON.stringify(fieldProperties);

    const result = await updateFieldsPropertiesJSON(fieldPropertiesJson);
    return new FieldProperties(JSON.parse(result));
}

/**
 * The field image: the show's floor's display texture (ADR 0002 D-23), or null. The legacy
 * `field_properties.image` column is read only by convert on open.
 */
export async function getFieldPropertiesImage(): Promise<Uint8Array | null> {
    return getFieldFloorImage({ db });
}
