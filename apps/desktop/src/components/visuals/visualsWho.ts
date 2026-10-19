/**
 * Who a Visuals mode edit is for (performer-behavior.md section 7.1): the
 * band, a section, a tag or the canvas selection. These are the same
 * targets cues take (ADR 0004), so the Who list and the cue lanes agree on
 * who is in each. Pure, so the inspector, the field's dimming and the
 * lanes read the same answers.
 */
import type { CueChannel } from "@/db-functions/cues";
import { FAMILIES, getSectionObjectByName } from "@/global/classes/Sections";

/** The behavior channels Visuals mode edits, one tab each, in tab order. */
export const VISUALS_CHANNELS = [
    "feet",
    "horn_equipment",
    "facing",
    "body",
] as const satisfies readonly CueChannel[];
export type VisualsChannel = (typeof VISUALS_CHANNELS)[number];

export type VisualsWho =
    | { kind: "band" }
    | { kind: "section"; section: string }
    | { kind: "tag"; tagId: number }
    | { kind: "selection" };

/** What the Who list needs of a marcher. */
export interface WhoMarcher {
    id: number;
    section: string;
}

/** What the Who list needs of a tag. */
export interface WhoTag {
    id: number;
    name: string | null;
}

/** One row of the Who list. */
export interface WhoEntry {
    who: VisualsWho;
    /** The section's name as the show spells it, or the tag's name. */
    label: string;
    /** How many marchers it holds. */
    count: number;
}

/** Sections match ignoring case and outer spaces, as cue targets do (rule 8). */
export const sectionKey = (name: string) => name.trim().toLowerCase();

export function sameWho(a: VisualsWho | null, b: VisualsWho | null): boolean {
    if (a === null || b === null) return a === b;
    if (a.kind !== b.kind) return false;
    if (a.kind === "section")
        return sectionKey(a.section) === sectionKey((b as typeof a).section);
    if (a.kind === "tag") return a.tagId === (b as typeof a).tagId;
    return true;
}

/**
 * The Who list, top to bottom: the band, each section in score order (as
 * the show spells it first), then each tag with members. The canvas
 * selection is listed apart, since it changes as the person clicks.
 */
export function whoEntries(
    marchers: readonly WhoMarcher[],
    tags: readonly WhoTag[],
    marcherIdsByTagId: ReadonlyMap<number, readonly number[]>,
): WhoEntry[] {
    const sections = new Map<string, { label: string; count: number }>();
    for (const m of marchers) {
        const key = sectionKey(m.section);
        const s = sections.get(key);
        if (s) s.count++;
        else sections.set(key, { label: m.section.trim(), count: 1 });
    }
    const sectionRows = [...sections.values()].sort((a, b) => {
        const sa = getSectionObjectByName(a.label);
        const sb = getSectionObjectByName(b.label);
        return sa.compareTo(sb) || a.label.localeCompare(b.label);
    });
    const ids = new Set(marchers.map((m) => m.id));
    const tagRows = tags
        .map((t) => ({
            tag: t,
            count: (marcherIdsByTagId.get(t.id) ?? []).filter((id) =>
                ids.has(id),
            ).length,
        }))
        .filter((t) => t.count > 0);
    return [
        { who: { kind: "band" }, label: "", count: marchers.length },
        ...sectionRows.map(({ label, count }) => ({
            who: { kind: "section", section: label } as const,
            label,
            count,
        })),
        ...tagRows.map(({ tag, count }) => ({
            who: { kind: "tag", tagId: tag.id } as const,
            label: tag.name?.trim() || `tag-${tag.id}`,
            count,
        })),
    ];
}

/** The marchers a who holds. The selection is whoever is selected now. */
export function whoMarcherIds(
    who: VisualsWho,
    marchers: readonly WhoMarcher[],
    marcherIdsByTagId: ReadonlyMap<number, readonly number[]>,
    selectedIds: readonly number[],
): Set<number> {
    switch (who.kind) {
        case "band":
            return new Set(marchers.map((m) => m.id));
        case "section": {
            const key = sectionKey(who.section);
            return new Set(
                marchers
                    .filter((m) => sectionKey(m.section) === key)
                    .map((m) => m.id),
            );
        }
        case "tag": {
            const ids = new Set(marchers.map((m) => m.id));
            return new Set(
                (marcherIdsByTagId.get(who.tagId) ?? []).filter((id) =>
                    ids.has(id),
                ),
            );
        }
        case "selection":
            return new Set(selectedIds);
    }
}

/** How many cues each Visuals channel has, for the tabs. */
export function cueCountsByChannel(
    cues: readonly { channel: CueChannel }[],
): Record<VisualsChannel, number> {
    const counts = Object.fromEntries(
        VISUALS_CHANNELS.map((c) => [c, 0]),
    ) as Record<VisualsChannel, number>;
    for (const cue of cues)
        if (cue.channel in counts) counts[cue.channel as VisualsChannel]++;
    return counts;
}

const EQUIPMENT_FAMILIES = new Set([
    FAMILIES.Guard,
    FAMILIES.Battery,
    FAMILIES.Pit,
]);
const HORN_FAMILIES = new Set([FAMILIES.Woodwind, FAMILIES.Brass]);

/**
 * How the Horn/Equipment tab names itself for the focused marchers: Horn
 * when they're all winds, Equipment when they're all guard or percussion,
 * else both.
 */
export function hornEquipmentLabel(
    sections: readonly string[],
): "horn" | "equipment" | "both" {
    if (sections.length === 0) return "both";
    const families = sections.map((s) => getSectionObjectByName(s).family);
    if (families.every((f) => HORN_FAMILIES.has(f))) return "horn";
    if (families.every((f) => EQUIPMENT_FAMILIES.has(f))) return "equipment";
    return "both";
}
