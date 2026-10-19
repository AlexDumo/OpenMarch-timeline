/**
 * The field a new show copies from a previous `.dots` file (ADR 0002 D-23). The previous show's
 * floor names a Version embedded in that file only, so the copied field properties drop the
 * reference, and the Version itself comes across to embed in the new show as it is (same item,
 * name and license). A previous show from before D-23 passes its legacy field image instead,
 * which the new show makes its own floor from.
 */
import type { EmbedLibraryVersion } from "../../../src/db-functions/showLibrary";

export interface NewShowField {
    fieldPropertiesJson: string;
    /** A legacy field image, when the previous show has no floor */
    fieldImage: Uint8Array | null;
    /** The previous show's floor Version, with its bytes */
    fieldFloor: EmbedLibraryVersion | null;
}

export function fieldForNewShow(
    fieldPropertiesJson: string,
    legacyImage: Uint8Array | null,
    floor: EmbedLibraryVersion | null,
): NewShowField {
    const { floor: _reference, ...rest } = JSON.parse(
        fieldPropertiesJson,
    ) as Record<string, unknown>;
    return {
        fieldPropertiesJson:
            _reference === undefined
                ? fieldPropertiesJson
                : JSON.stringify(rest),
        fieldImage: floor ? null : legacyImage,
        fieldFloor: floor,
    };
}
