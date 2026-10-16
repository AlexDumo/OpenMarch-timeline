/**
 * The field a new show copies from a previous `.dots` file (ADR 0002 D-23). The previous show's
 * floor names a Version embedded in that file only, so the copied field properties drop it, and
 * its original bytes (as imported) come across as the image the new show makes its own floor
 * from. A previous show from before D-23 passes its legacy field image instead.
 */
export interface NewShowField {
    fieldPropertiesJson: string;
    fieldImage: Uint8Array | null;
}

export function fieldForNewShow(
    fieldPropertiesJson: string,
    legacyImage: Uint8Array | null,
    floorOriginal: Uint8Array | null,
): NewShowField {
    const parsed = JSON.parse(fieldPropertiesJson) as Record<string, unknown>;
    if (!("floor" in parsed))
        return {
            fieldPropertiesJson,
            fieldImage: floorOriginal ?? legacyImage,
        };
    const { floor: _floor, ...rest } = parsed;
    return {
        fieldPropertiesJson: JSON.stringify(rest),
        fieldImage: floorOriginal ?? legacyImage,
    };
}
