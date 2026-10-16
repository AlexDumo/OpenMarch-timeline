/**
 * Field files (`.fieldots`) and the show's floor (ADR 0002 D-23). The floor names a Version
 * embedded in this show, so it never travels in a field file: export leaves it out, and import
 * keeps the show's own floor.
 */

/** The field properties JSON to write to a field file, without the show's floor. */
export function exportableFieldJson(json: string): string {
    const { floor: _floor, ...rest } = JSON.parse(json) as Record<
        string,
        unknown
    >;
    return JSON.stringify(rest);
}

/** The JSON to store for an imported field file: its properties, plus the show's floor. */
export function importedFieldJson(
    imported: Record<string, unknown>,
    currentJson: string,
): string {
    const { floor } = JSON.parse(currentJson) as { floor?: unknown };
    const { floor: _ignored, ...rest } = imported;
    return JSON.stringify(floor === undefined ? rest : { ...rest, floor });
}
