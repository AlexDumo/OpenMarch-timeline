/**
 * Show on field (fork #1332): what the field draws over the performers and the field, as the
 * panel on the field's display bar, the View menu's ticks and the palette's Show and Hide
 * actions set it. One place for the rules, so each of those does exactly the same thing:
 *
 * - A row with a choice beside its switch (Drill numbers, Equipment icons, Shape outlines, Line
 *   order, Figures) keeps that choice while off: switching it off remembers it in `fieldShowLast`, and
 *   switching it on brings it back (its default the first time).
 * - Equipment icons' "who" is Holding something else, Everyone, or some of the show's sections.
 * - What you set is how you want the field, kept on this computer: there's no Reset (owner,
 *   2026-11-27). Set-once looks (label size and position, where equipment icons go, the venue's
 *   look) live in Settings › Field.
 */
import {
    useUiSettingsStore,
    type EquipmentIcons,
    type FieldShowLast,
    type UiSettings,
} from "@/stores/UiSettingsStore";

/** The rows whose switch has a choice beside it */
export type FieldShowChoiceKey = keyof FieldShowLast;

/** What each of those rows shows as shipped */
const SHIPPED = {
    marcherLabels: "names",
    equipmentIcons: "changed",
    shapes: "selected",
    lineOrder: "off",
    performerFigures: "off",
} as const satisfies Record<FieldShowChoiceKey, string>;

/** What a row turns on to when it has never been on: its shipped choice, or Selected for order */
const FIRST_ON: Required<FieldShowLast> = {
    marcherLabels: "names",
    equipmentIcons: "changed",
    shapes: "selected",
    lineOrder: "selected",
    performerFigures: "figures",
};

const change = (patch: Partial<UiSettings>) => {
    const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
    setUiSettings({ ...uiSettings, ...patch });
};

const settings = () => useUiSettingsStore.getState().uiSettings;

/** A row's value now (its shipped value when not stored) */
export const fieldShowValue = (
    s: UiSettings,
    key: FieldShowChoiceKey,
): string => s[key] ?? SHIPPED[key];

/** Whether a row with a choice is on */
export const isFieldShown = (s: UiSettings, key: FieldShowChoiceKey) =>
    fieldShowValue(s, key) !== "off";

/** Switches a row with a choice on (back to its last choice) or off (remembering it) */
export function setFieldShown(key: FieldShowChoiceKey, on: boolean): void {
    const s = settings();
    const now = fieldShowValue(s, key);
    if ((now !== "off") === on) return;
    if (on) {
        change({ [key]: s.fieldShowLast?.[key] ?? FIRST_ON[key] });
        return;
    }
    change({
        [key]: "off",
        fieldShowLast: { ...s.fieldShowLast, [key]: now },
    });
}

/** Switches a row with a choice the other way */
export function toggleFieldShown(key: FieldShowChoiceKey): void {
    setFieldShown(key, !isFieldShown(settings(), key));
}

/** Picks a row's choice, which also switches it on */
export function setFieldChoice<K extends FieldShowChoiceKey>(
    key: K,
    value: NonNullable<FieldShowLast[K]>,
): void {
    if (settings()[key] !== value) change({ [key]: value });
}

/** Who shows an equipment icon: Holding something else, Everyone, or the sections picked */
export type EquipmentWho =
    | { kind: "changed" }
    | { kind: "everyone" }
    | { kind: "sections"; sections: readonly string[] };

/** Who Equipment icons shows for, whether or not the row is on */
export function equipmentWho(s: UiSettings): EquipmentWho {
    const sections = s.equipmentIconSections ?? [];
    if (sections.length > 0) return { kind: "sections", sections };
    const icons = s.equipmentIcons ?? "changed";
    const who =
        icons === "off"
            ? (s.fieldShowLast?.equipmentIcons ?? "changed")
            : icons;
    return { kind: who };
}

/**
 * Who the who button names in this show: picked sections the show has no one in are left out
 * (the pick is remembered across shows by section name). When none of them are in the show, it
 * still names them all rather than saying nothing, and the menu marks them as not in this show.
 */
export function equipmentWhoInShow(
    who: EquipmentWho,
    showSections: readonly string[],
): EquipmentWho {
    if (who.kind !== "sections") return who;
    const here = who.sections.filter((name) => showSections.includes(name));
    return here.length > 0 ? { kind: "sections", sections: here } : who;
}

/**
 * The section ticks in the who menu: the show's sections, then any picked ones the show has no
 * one in, so a pick from another show can still be cleared
 */
export function equipmentSectionChoices(
    showSections: readonly string[],
    picked: readonly string[],
): { section: string; inShow: boolean }[] {
    return [
        ...showSections.map((section) => ({ section, inShow: true })),
        ...picked
            .filter((name) => !showSections.includes(name))
            .map((section) => ({ section, inShow: false })),
    ];
}

/**
 * Sets who shows an equipment icon from the palette's choices or the panel's menu: Off, Not their
 * own or Everyone. Any sections picked are dropped: Everyone means everyone.
 */
export function setEquipmentIcons(shown: EquipmentIcons): void {
    if (shown === "off") {
        setFieldShown("equipmentIcons", false);
        return;
    }
    const s = settings();
    if (
        s.equipmentIcons === shown &&
        (s.equipmentIconSections ?? []).length === 0
    )
        return;
    change({ equipmentIcons: shown, equipmentIconSections: [] });
}

/** Adds a section to the ones showing equipment icons, or takes it out; switches the icons on */
export function toggleEquipmentSection(section: string): void {
    const s = settings();
    const now = s.equipmentIconSections ?? [];
    const next = now.includes(section)
        ? now.filter((name) => name !== section)
        : [...now, section];
    const icons = s.equipmentIcons ?? "changed";
    change({
        equipmentIconSections: next,
        ...(icons === "off"
            ? { equipmentIcons: s.fieldShowLast?.equipmentIcons ?? "changed" }
            : {}),
    });
}
