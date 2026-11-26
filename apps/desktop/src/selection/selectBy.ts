import {
    FAMILIES,
    getSectionObjectByName,
    type SectionFamily,
} from "@/global/classes/Sections";

/**
 * Selecting a group of performers at once: a section, a family, a tag or a drill prefix. The
 * Select tab's "Select by" and the field menu's Select submenu both pick from these lists and
 * select through `selectionWith`, so a group means the same people in either place.
 */

/** The ways the Select tab groups performers, in its "Select by" order */
export const SELECT_BY_OPTIONS = [
    "section",
    "tag",
    "family",
    "drillPrefix",
] as const;
export type SelectByOption = (typeof SELECT_BY_OPTIONS)[number];

/** A grouping's name ("Section", "Family"…), as the Select tab and the field menu show it */
export const selectByLabelKey = (option: SelectByOption) =>
    `toolbar.select.selectBy.${option}` as const;

type WithSection = { readonly id: number; readonly section: string };

/** The sections the performers are in, in score order (each once) */
export const sectionsOf = (marchers: readonly Pick<WithSection, "section">[]) =>
    Array.from(new Set(marchers.map((marcher) => marcher.section)))
        .map((name) => getSectionObjectByName(name))
        .sort((a, b) => a.compareTo(b));

/** Every family, in score order, whether or not anyone is in it (the Select tab lists them all) */
export const allFamilies = (): SectionFamily[] => Object.values(FAMILIES);

/** The performers in any of `sections` (by name) */
export const idsInSections = (
    marchers: readonly WithSection[],
    sections: ReadonlySet<string>,
): number[] => marchers.filter((m) => sections.has(m.section)).map((m) => m.id);

/** The performers in `family` */
export const idsInFamily = (
    marchers: readonly WithSection[],
    family: string,
): number[] =>
    idsInSections(
        marchers,
        new Set(
            sectionsOf(marchers)
                .filter((section) => section.family.name === family)
                .map((section) => section.name),
        ),
    );

/** The performers with drill prefix `prefix` */
export const idsWithDrillPrefix = (
    marchers: readonly { readonly id: number; readonly drill_prefix: string }[],
    prefix: string,
): number[] =>
    marchers.filter((m) => m.drill_prefix === prefix).map((m) => m.id);

/** The drill prefixes in use, sorted */
export const drillPrefixesOf = (
    marchers: readonly { readonly drill_prefix: string }[],
): string[] => Array.from(new Set(marchers.map((m) => m.drill_prefix))).sort();

/**
 * Everyone in the sections of `selected` (Select same section): the selected performers' own
 * sections, whoever else is in them. Empty with nobody selected
 */
export const idsInSameSections = (
    marchers: readonly WithSection[],
    selected: readonly number[],
): number[] => {
    const picked = new Set(selected);
    return idsInSections(
        marchers,
        new Set(marchers.filter((m) => picked.has(m.id)).map((m) => m.section)),
    );
};

/**
 * The selection after choosing a group: the group's performers in place of the selection, or
 * added to it (Shift, or Add on a tablet), keeping the order they were selected in.
 */
/** The ids in `ids` that belong to one of `rows`: a tag's members, without its locked items */
export const idsAmong = (
    ids: readonly number[],
    rows: readonly { readonly id: number }[],
): number[] => {
    const allowed = new Set(rows.map((r) => r.id));
    return ids.filter((id) => allowed.has(id));
};

export function selectionWith<T extends { readonly id: number }>(
    all: readonly T[],
    current: readonly T[],
    ids: readonly number[],
    add: boolean,
): T[] {
    const wanted = new Set(ids);
    const picked = all.filter((m) => wanted.has(m.id));
    if (!add) return picked;
    const had = new Set(current.map((m) => m.id));
    return [...current, ...picked.filter((m) => !had.has(m.id))];
}
