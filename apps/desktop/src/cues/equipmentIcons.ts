/**
 * The icon the 2D field draws after a drill number for what a performer holds (fork #992): the
 * section icons (upstream OpenMarch #1071), one per catalog item where a section icon is that
 * item, else the "Other" icon. Pure, so the field, its tests and the guide read the same answers.
 */
import type { CompiledCues } from "@openmarch/core";
import { SECTIONS, getSectionObjectByName } from "@/global/classes/Sections";
import {
    SECTION_ICONS,
    type SectionKey,
} from "@/components/marcher/sectionIcons/SectionIcon";
import { heldValueAt } from "./equipment";
import { itemKeyOf } from "./equipmentItems";
import { SHOW_ASSET_REF_PREFIX } from "@/showAssets/ref";

/**
 * An icon the field can draw: a section's, the marching (bell-front) tuba, the sabre, or one of
 * the show's flags by its Equipment value (`library:<id>@<hash>`, fork #985), drawn as its picture.
 */
export type EquipmentIconKey =
    | SectionKey
    | "MarchingTuba"
    | "Sabre"
    | `${typeof SHOW_ASSET_REF_PREFIX}${string}`;

/** Whether an icon is one of the show's flags, drawn as its own picture */
export const isPictureIcon = (
    key: EquipmentIconKey,
): key is `${typeof SHOW_ASSET_REF_PREFIX}${string}` =>
    key.startsWith(SHOW_ASSET_REF_PREFIX);

/**
 * Each catalog item's icon. Swing flags take the Flag icon, the nearest drawn; the sabre has its
 * own (`SabreIcon`); values without one take "Other" (`ITEMS_WITHOUT_ICON`).
 */
const ITEM_ICON: Readonly<Record<string, EquipmentIconKey>> = {
    flag: "Flag",
    swingFlag: "Flag",
    doubleSwingFlag: "Flag",
    rifle: "Rifle",
    sabre: "Sabre",
    trumpet: "Trumpet",
    mellophone: "Mellophone",
    baritone: "Baritone",
    euphonium: "Euphonium",
    trombone: "Trombone",
    bassTrombone: "BassTrombone",
    // The catalog's tuba is the marching (contra) tuba; SECTION_ICONS.Tuba is the sousaphone
    tuba: "MarchingTuba",
    sousaphone: "Tuba",
    piccolo: "Piccolo",
    flute: "Flute",
    clarinet: "Clarinet",
    bassClarinet: "BassClarinet",
    sopranoSax: "SopranoSax",
    altoSax: "AltoSax",
    tenorSax: "TenorSax",
    bariSax: "BariSax",
    snare: "Snare",
    tenors: "Tenors",
    bassDrum: "BassDrum",
    cymbals: "Cymbals",
};

/** Catalog items and values with no icon of their own: they show "Other". */
export const ITEMS_WITHOUT_ICON: readonly string[] = [
    "none",
    // Older shows' generic values: a wind instrument, a drum
    "winds",
    "battery",
];

/** The icon of an Equipment value (a catalog item, or Nothing for null); "Other" without one. */
export function iconOfValue(valueId: string | null): EquipmentIconKey {
    // One of the show's flags: its own picture (the Flag icon until it's drawn)
    if (valueId?.startsWith(SHOW_ASSET_REF_PREFIX))
        return valueId as `${typeof SHOW_ASSET_REF_PREFIX}${string}`;
    const key = valueId === null ? "none" : itemKeyOf(valueId);
    return (key && ITEM_ICON[key]) || "Other";
}

/** A section's own icon, by the name stored on a marcher; "Other" for one without an icon. */
export function sectionIconKey(sectionName: string): EquipmentIconKey {
    const section = getSectionObjectByName(sectionName);
    const key = Object.keys(SECTIONS).find((k) => SECTIONS[k] === section);
    // A few front ensemble sections have no icon drawn yet (Timpani, Rack…): Other
    return key && key in SECTION_ICONS ? (key as SectionKey) : "Other";
}

/**
 * Who shows an equipment icon on the field: nobody, only performers holding something other than
 * their own instrument (the default), or everyone, their own instrument included.
 */
export type EquipmentIcons = "off" | "changed" | "everyone";

/**
 * Where an equipment icon goes: after the drill number (the default), centered on the performer's
 * spot instead of their dot, or instead of their drill number (which still shows while they're
 * hovered or selected).
 */
export type EquipmentIconPlace = "beside" | "dot" | "label";

/**
 * Each performer's icon at `count`. A performer holding something other than their section's
 * usual item gets that item's icon; with `everyone`, the others get the icon of what they hold
 * too: their usual item's (a flag for the Color Guard). Only a usual with no item icon of its own
 * (a section without a catalog item, such as Marimba) takes the section's icon.
 */
export function equipmentIconsAt({
    compiled,
    usualValue,
    sectionOf,
    count,
    shown,
    sections,
}: {
    compiled: CompiledCues;
    usualValue: ReadonlyMap<number, string | null>;
    /** A performer's section name */
    sectionOf: (id: number) => string | undefined;
    count: number;
    shown: EquipmentIcons;
    /**
     * Only these sections (by stored name), everyone in them, whatever `shown` says other than
     * off (Show on field's Equipment icons for some sections, fork #1332). Empty or left out: all
     */
    sections?: ReadonlySet<string>;
}): Map<number, EquipmentIconKey> {
    const icons = new Map<number, EquipmentIconKey>();
    if (shown === "off") return icons;
    const some = sections !== undefined && sections.size > 0;
    for (const [id, usual] of usualValue) {
        if (some && !sections.has(sectionOf(id) ?? "")) continue;
        const held = heldValueAt(compiled, id, count);
        if (held !== usual) icons.set(id, iconOfValue(held));
        else if (some || shown === "everyone") {
            const own = iconOfValue(usual);
            icons.set(
                id,
                own !== "Other" ? own : sectionIconKey(sectionOf(id) ?? ""),
            );
        }
    }
    return icons;
}

/** A stable key for an icon map, so a hook only hands out a new map when an icon changes. */
export const iconsKey = (icons: ReadonlyMap<number, EquipmentIconKey>) =>
    [...icons].map(([id, icon]) => `${id}${icon}`).join(",");
