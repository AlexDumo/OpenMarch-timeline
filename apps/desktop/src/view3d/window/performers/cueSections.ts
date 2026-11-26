/**
 * The sections the cue compile gives defaults (ADR 0015 D-2, D-6; fork #992, #993). Every compile
 * caller passes `cueSectionsOf` as `sections`, so the defaults are the same wherever the show is
 * compiled:
 * - Equipment: each section whose performers all carry the same model holds that model's catalog
 *   item (a trumpet, a 6 ft flag, a rifle).
 * - Facing: a section's `defaultFacing` (the Section registry, e.g. bass drums face side 2 before
 *   their first Facing cue).
 */
import type { CueSection } from "@openmarch/core";
import type { ModelId } from "@/view3d/core/instruments/model";
import { sectionEquipment } from "@/cues/equipmentItems";
import { SECTIONS } from "@/global/classes/Sections";

/** The registry's Facing default for a section name, matched ignoring case and outer spaces. */
function defaultFacingOf(key: string): string | undefined {
    return Object.values(SECTIONS).find(
        (s) => s.name.trim().toLowerCase() === key,
    )?.defaultFacing;
}

/**
 * Each section with a usual equipment or a Facing default. Equipment is given only where a section's
 * performers all carry one model, with that model's catalog item; other sections keep what each
 * marcher carries. A section with no default for either is left out.
 */
export function cueSectionsOf(
    marchers: readonly { section: string; model: ModelId | null }[],
): CueSection[] {
    const models = new Map<string, Set<ModelId | null>>();
    for (const { section, model } of marchers) {
        const key = section.trim().toLowerCase();
        const set = models.get(key) ?? new Set();
        set.add(model);
        models.set(key, set);
    }
    const out: CueSection[] = [];
    const seen = new Set<string>();
    for (const { section } of marchers) {
        const key = section.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const set = models.get(key)!;
        const model = set.size === 1 ? [...set][0] : undefined;
        const equipment = model ? sectionEquipment(model) : undefined;
        const facing = defaultFacingOf(key);
        if (!equipment && !facing) continue;
        out.push({
            name: section,
            ...(equipment ? { equipment } : {}),
            ...(facing ? { facing } : {}),
        });
    }
    return out;
}
