import { FieldProperties } from "@openmarch/core";
import { db, schema } from "../database/db";
import { eq } from "drizzle-orm";
import { transactionWithHistory } from "../../db-functions/history";
import { getFieldFloorImage } from "../../db-functions/fieldFloor";

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
    const result = await transactionWithHistory(
        db,
        "updateFieldsPropertiesJSON",
        async (tx) => {
            return await tx
                .update(field_properties)
                .set({ json_data: fieldPropertiesJson })
                .where(eq(field_properties.id, 1))
                .returning()
                .get();
        },
    );
    return result.json_data;
}

export async function updateFieldProperties(
    fieldProperties: FieldProperties,
): Promise<FieldProperties> {
    const fieldPropertiesJson = JSON.stringify(fieldProperties);

    const result = await updateFieldsPropertiesJSON(fieldPropertiesJson);
    return new FieldProperties(JSON.parse(result));
}

export async function updateFieldPropertiesImage(
    image: Uint8Array,
): Promise<void> {
    await transactionWithHistory(
        db,
        "updateFieldPropertiesImage",
        async (tx) => {
            return await tx
                .update(field_properties)
                .set({ image: image })
                .where(eq(field_properties.id, 1))
                .run();
        },
    );
}

/**
 * The field image: the show's floor's display texture (ADR 0002 D-23), or null. The legacy
 * `field_properties.image` column is read only by convert on open.
 */
export async function getFieldPropertiesImage(): Promise<Uint8Array | null> {
    return getFieldFloorImage({ db });
}

export async function deleteFieldPropertiesImage(): Promise<void> {
    await transactionWithHistory(
        db,
        "deleteFieldPropertiesImage",
        async (tx) => {
            return await tx
                .update(field_properties)
                .set({ image: null })
                .where(eq(field_properties.id, 1))
                .run();
        },
    );
}
