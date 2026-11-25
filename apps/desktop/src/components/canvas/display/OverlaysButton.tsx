import * as Popover from "@radix-ui/react-popover";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    CaretDownIcon,
    CheckIcon,
    EyeIcon,
    GearSixIcon,
} from "@phosphor-icons/react";
import { SegmentedTextSwitch, Switch } from "@openmarch/ui";
import { useTranslate, type TFnType } from "@tolgee/react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ShortcutTooltip } from "@/components/timeline/ShortcutTooltip";
import Shortcut from "@/components/ui/Shortcut";
import {
    MENU_CONTENT_CLASS,
    MENU_ITEM_CLASS,
    MENU_LABEL_CLASS,
    MENU_SEPARATOR_CLASS,
    POPOVER_CLASS,
} from "@/components/ui/popupClasses";
import { useUiSettingsStore, type UiSettings } from "@/stores/UiSettingsStore";
import { useView3dWindowStore } from "@/stores/View3dWindowStore";
import { useVenueFieldStyle } from "@/hooks/queries/useVenueFieldStyle";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import {
    getSectionObjectByName,
    getTranslatedSectionName,
} from "@/global/classes/Sections";
import { venueShows } from "@/field/three/venueUnderlay/fieldVenue";
import {
    changedFieldShow,
    equipmentWho,
    fieldShowValue,
    resetFieldShow,
    setEquipmentIcons,
    setFieldChoice,
    toggleEquipmentSection,
    type EquipmentWho,
    type FieldShowChoiceKey,
} from "@/field/fieldShow";
import { useFollowTheLeader } from "@/pathways/followTheLeader";
import { useShowShortcutHints } from "@/stores/KeyboardSeenStore";
import { runAction } from "@/shortcuts/registry";
import type { ActionId } from "@/shortcuts/definitions";
import { openSettingsAt } from "@/settings/openSettingsAt";
import { DISPLAY_BUTTON_CLASS } from "./displayButton";

/** Where Show on field is: which mode rows apply */
function useFieldShowContext() {
    const followTheLeader = useFollowTheLeader();
    const view3dOpen = useView3dWindowStore((s) => s.open);
    return { followTheLeader, view3dOpen };
}

/**
 * Show on field (fork #1332, redesigned with the owner on 2026-11-25 after "an unorganized
 * parameter dump"): one button on the field's display bar, an eye, that opens one panel of what
 * the field draws. One row per thing you can see, with one column of switches on the right; a
 * row's choice shows beside its switch only while it's on. Rows that only matter in a mode (Line
 * order with Follow the leader, the 3D View's camera while it's open) appear under a plain "While
 * …" line. Set-once looks (sizes, where icons go, the venue's look) are in Settings › Field,
 * linked from the footer. Precedents: Blender's viewport Overlays popover, Figma's View menu.
 *
 * Every switch runs its action, which the View menu and the palette run too
 * (`field/fieldShow.ts` holds the rules). A dot on the button says something differs from how
 * it shipped, and Reset puts it all back.
 */
export default function OverlaysButton() {
    const { t } = useTranslate();
    const context = useFieldShowContext();
    const changed = useUiSettingsStore(
        useShallow((s) => changedFieldShow(s.uiSettings, context)),
    );
    const anyChanged = changed.length > 0;
    const label = t("fieldDisplay.overlays");
    return (
        <Popover.Root>
            <ShortcutTooltip
                label={label}
                hint={t("fieldDisplay.overlaysHint")}
                side="left"
            >
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={
                            anyChanged
                                ? t("fieldDisplay.overlaysChangedLabel", {
                                      label,
                                  })
                                : label
                        }
                        data-testid="field-display-overlays"
                        data-changed={anyChanged}
                        className={clsx(
                            DISPLAY_BUTTON_CLASS,
                            "text-text relative",
                        )}
                    >
                        <EyeIcon size={16} />
                        {anyChanged && (
                            <span
                                aria-hidden
                                data-testid="field-display-overlays-dot"
                                className="bg-accent touch:top-8 touch:right-8 absolute top-2 right-2 size-6 rounded-full"
                            />
                        )}
                    </button>
                </Popover.Trigger>
            </ShortcutTooltip>
            <Popover.Portal>
                <Popover.Content
                    side="left"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    aria-label={label}
                    data-testid="field-display-overlays-panel"
                    className={clsx(
                        POPOVER_CLASS,
                        "z-50 flex w-360 max-w-[calc(100vw-16px)] flex-col gap-4 px-16",
                        // Scrolls rather than running off a short window
                        "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain",
                    )}
                >
                    <div className="touch:min-h-44 flex min-h-26 items-center justify-between gap-8">
                        <h2 className="text-body font-medium">{label}</h2>
                        {anyChanged && (
                            <button
                                type="button"
                                data-testid="field-display-overlays-reset"
                                onClick={resetFieldShow}
                                className="text-sub text-text-subtitle border-stroke hover:text-accent focus-visible:ring-accent touch:min-h-44 rounded-full border px-8 py-2 outline-hidden transition-colors duration-150 focus-visible:ring-2"
                            >
                                {t("fieldDisplay.reset")}
                            </button>
                        )}
                    </div>
                    <MainRows />
                    <ModeRows context={context} />
                    <div className="border-stroke mt-4 border-t pt-8">
                        <p className="text-sub text-text-subtitle flex flex-wrap items-center gap-x-4">
                            <GearSixIcon size={16} aria-hidden />
                            {t("fieldDisplay.footer")}
                            <button
                                type="button"
                                data-testid="field-display-settings-link"
                                onClick={() => openSettingsAt("field")}
                                className="text-accent focus-visible:ring-accent touch:min-h-44 rounded-4 outline-hidden hover:underline focus-visible:ring-2"
                            >
                                {t("fieldDisplay.footerLink")}
                            </button>
                        </p>
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** One thing the field can show: its name on the left; its choice (while on), then its switch */
function Row({
    name,
    shortcut,
    choice,
    reason,
    children,
}: {
    name: string;
    /** An action whose key shows beside the name */
    shortcut?: ActionId;
    /** The choice beside the switch, shown only while it's on */
    choice?: ReactNode;
    /** Why the switch is greyed out, shown under the row */
    reason?: string;
    /** The switch */
    children: ReactNode;
}) {
    // No keycaps on a tablet without a keyboard (tablet-parity.md)
    const showKeys = useShowShortcutHints();
    return (
        <div className="flex flex-col gap-2">
            <div className="touch:min-h-44 flex min-h-32 items-center gap-8">
                <span className="text-body flex min-w-0 flex-1 items-center gap-4">
                    {name}
                    {shortcut && showKeys && <Shortcut action={shortcut} />}
                </span>
                {choice}
                {children}
            </div>
            {reason && (
                <p className="text-sub text-text-subtitle leading-snug">
                    {reason}
                </p>
            )}
        </div>
    );
}

/** A plain line over rows that only show in a mode ("While the 3D View is open") */
function ModeHeading({ children }: { children: ReactNode }) {
    return <h3 className="text-sub text-text-subtitle pt-4">{children}</h3>;
}

interface Choice<T extends string> {
    readonly value: T;
    /** The segment's text */
    readonly key: string;
    /** What a screen reader hears, where the segment shows an example rather than words */
    readonly spokenKey?: string;
}

const LABEL_CHOICES: readonly Choice<"names" | "numbers">[] = [
    {
        value: "names",
        key: "fieldDisplay.labelsNamesExample",
        spokenKey: "fieldDisplay.labelsNames",
    },
    {
        value: "numbers",
        key: "fieldDisplay.labelsNumbersExample",
        spokenKey: "fieldDisplay.labelsNumbers",
    },
];
const SELECTED_OR_ALL: readonly Choice<"selected" | "always">[] = [
    { value: "selected", key: "fieldDisplay.selected" },
    { value: "always", key: "fieldDisplay.all" },
];

/** A row's choice of two: the app's segmented switch, with finger-sized segments on touch */
function Choices<T extends string>({
    name,
    choices,
    value,
    onChange,
    testId,
}: {
    name: string;
    choices: readonly Choice<T>[];
    value: T;
    onChange: (value: T) => void;
    testId: string;
}) {
    const { t } = useTranslate();
    return (
        <SegmentedTextSwitch
            ariaLabel={name}
            testId={testId}
            selected={value}
            setSelected={(next) => onChange(next as T)}
            className="shrink-0 flex-nowrap"
            itemClassName="touch:min-h-44 whitespace-nowrap"
            options={choices.map((choice) => ({
                value: choice.value,
                testId: `${testId}-${choice.value}`,
                label: choice.spokenKey ? (
                    <>
                        <span aria-hidden>{t(choice.key)}</span>
                        <span className="sr-only">{t(choice.spokenKey)}</span>
                    </>
                ) : (
                    t(choice.key)
                ),
            }))}
        />
    );
}

/** A row's switch: runs the row's action, as the View menu and the palette do */
function OnOff({
    name,
    checked,
    action,
    testId,
    disabled = false,
}: {
    name: string;
    checked: boolean;
    action: ActionId;
    testId: string;
    disabled?: boolean;
}) {
    return (
        <Switch
            look="track"
            aria-label={name}
            data-testid={testId}
            checked={checked}
            disabled={disabled}
            onCheckedChange={() => runAction(action)}
        />
    );
}

/** A row with a choice: its value while on, or null while off */
const onValue = (s: UiSettings, key: FieldShowChoiceKey) => {
    const value = fieldShowValue(s, key);
    return value === "off" ? null : value;
};

/** The five rows always there: drill numbers, equipment icons, facing, shape outlines, venue */
function MainRows() {
    const { t } = useTranslate();
    const s = useUiSettingsStore(
        useShallow((state) => ({
            labels: onValue(state.uiSettings, "marcherLabels"),
            equipment: onValue(state.uiSettings, "equipmentIcons"),
            facing: state.uiSettings.facingArrows === true,
            shapes: onValue(state.uiSettings, "shapes"),
            venue: (state.uiSettings.fieldVenue ?? "off") !== "off",
        })),
    );
    const style = useVenueFieldStyle();
    const blank = !venueShows(style);
    return (
        <>
            <Row
                name={t("fieldDisplay.labels")}
                choice={
                    s.labels && (
                        <Choices
                            name={t("fieldDisplay.labels")}
                            choices={LABEL_CHOICES}
                            value={s.labels as "names" | "numbers"}
                            onChange={(value) =>
                                setFieldChoice("marcherLabels", value)
                            }
                            testId="field-display-labels"
                        />
                    )
                }
            >
                <OnOff
                    name={t("fieldDisplay.labels")}
                    checked={s.labels !== null}
                    action="toggleMarcherLabels"
                    testId="field-display-labels-on"
                />
            </Row>
            <Row
                name={t("fieldDisplay.equipmentIcons")}
                choice={s.equipment && <EquipmentWhoMenu />}
            >
                <OnOff
                    name={t("fieldDisplay.equipmentIcons")}
                    checked={s.equipment !== null}
                    action="toggleEquipmentIcons"
                    testId="field-display-equipment-on"
                />
            </Row>
            <Row name={t("fieldDisplay.facing")}>
                <OnOff
                    name={t("fieldDisplay.facing")}
                    checked={s.facing}
                    action="toggleFacingArrows"
                    testId="field-display-facing"
                />
            </Row>
            {/* Placed boxes' outlines (docs/timeline/research/shapes/07-placed-boxes.md) */}
            <Row
                name={t("fieldDisplay.shapes")}
                choice={
                    s.shapes && (
                        <Choices
                            name={t("fieldDisplay.shapes")}
                            choices={SELECTED_OR_ALL}
                            value={s.shapes as "selected" | "always"}
                            onChange={(value) =>
                                setFieldChoice("shapes", value)
                            }
                            testId="field-display-shapes"
                        />
                    )
                }
            >
                <OnOff
                    name={t("fieldDisplay.shapes")}
                    checked={s.shapes !== null}
                    action="toggleShapeOutlines"
                    testId="field-display-shapes-on"
                />
            </Row>
            {/* The show's 3D venue under the grid (#1207), in the look Settings › Field picks */}
            <Row
                name={t("toolbar.view.venue")}
                reason={blank ? t("toolbar.view.venueBlank") : undefined}
            >
                <OnOff
                    name={t("toolbar.view.venue")}
                    checked={s.venue && !blank}
                    disabled={blank}
                    action="toggleFieldVenue"
                    testId="field-display-venue"
                />
            </Row>
        </>
    );
}

/** The rows that only show in a mode, each under a plain "While …" line */
function ModeRows({
    context,
}: {
    context: { followTheLeader: boolean; view3dOpen: boolean };
}) {
    const { t } = useTranslate();
    const s = useUiSettingsStore(
        useShallow((state) => ({
            order: onValue(state.uiSettings, "lineOrder"),
            camera: state.uiSettings.view3dCameraOnField === true,
        })),
    );
    if (!context.followTheLeader && !context.view3dOpen) return null;
    return (
        <div className="border-stroke mt-4 flex flex-col gap-4 border-t pt-4">
            {/* A line's order (pathways step 4g): only with Follow-the-leader on (#1095) */}
            {context.followTheLeader && (
                <>
                    <ModeHeading>{t("fieldDisplay.whileFollow")}</ModeHeading>
                    <Row
                        name={t("fieldDisplay.lineOrder")}
                        shortcut="toggleMarcherOrder"
                        choice={
                            s.order && (
                                <Choices
                                    name={t("fieldDisplay.lineOrder")}
                                    choices={SELECTED_OR_ALL}
                                    value={s.order as "selected" | "always"}
                                    onChange={(value) =>
                                        setFieldChoice("lineOrder", value)
                                    }
                                    testId="field-display-order"
                                />
                            )
                        }
                    >
                        <OnOff
                            name={t("fieldDisplay.lineOrder")}
                            checked={s.order !== null}
                            action="toggleMarcherOrder"
                            testId="field-display-order-on"
                        />
                    </Row>
                </>
            )}
            {/* Where the 3D View looks (#1207), with the venue on or off */}
            {context.view3dOpen && (
                <>
                    <ModeHeading>{t("fieldDisplay.while3d")}</ModeHeading>
                    <Row name={t("toolbar.view.venueCamera")}>
                        <OnOff
                            name={t("toolbar.view.venueCamera")}
                            checked={s.camera}
                            action="toggleView3dCameraOnField"
                            testId="field-display-venue-camera"
                        />
                    </Row>
                </>
            )}
        </div>
    );
}

/** The show's sections with performers in them, in score order, by stored name */
function useShowSections(): string[] {
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    return useMemo(() => {
        const names = [...new Set((marchers ?? []).map((m) => m.section))];
        return names.sort((a, b) =>
            getSectionObjectByName(a).compareTo(getSectionObjectByName(b)),
        );
    }, [marchers]);
}

/** What the who button says: Not their own, Everyone, a section or two by name, or a count */
function whoText(who: EquipmentWho, t: TFnType): string {
    if (who.kind === "changed") return t("fieldDisplay.equipmentNotOwn");
    if (who.kind === "everyone") return t("fieldDisplay.equipmentEveryone");
    if (who.sections.length <= 2)
        return who.sections
            .map((name) => getTranslatedSectionName(name, t))
            .join(t("fieldDisplay.equipmentSectionsJoin"));
    return t("fieldDisplay.equipmentSectionsCount", {
        count: who.sections.length,
    });
}

/**
 * Who shows an equipment icon (owner, 2026-11-25, in place of a Not their own / Everyone switch):
 * Not their own (anyone holding something other than their own instrument), Everyone, or a tick
 * per section of the show ("guard only"). Ticking a section keeps the menu open for the next.
 */
function EquipmentWhoMenu() {
    const { t } = useTranslate();
    const who = useUiSettingsStore(
        useShallow((s) => equipmentWho(s.uiSettings)),
    );
    const sections = useShowSections();
    const picked = who.kind === "sections" ? who.sections : [];
    const item = (kind: "changed" | "everyone", key: string) => (
        <DropdownMenu.CheckboxItem
            checked={who.kind === kind}
            data-testid={`field-display-equipment-${kind}`}
            onSelect={() => setEquipmentIcons(kind)}
            className={clsx(MENU_ITEM_CLASS, "touch:min-h-44 pl-4")}
        >
            <span className="flex w-16 justify-center">
                <DropdownMenu.ItemIndicator className="flex">
                    <CheckIcon size={14} />
                </DropdownMenu.ItemIndicator>
            </span>
            {t(key)}
        </DropdownMenu.CheckboxItem>
    );
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button
                    type="button"
                    aria-label={t("fieldDisplay.equipmentWho", {
                        who: whoText(who, t),
                    })}
                    data-testid="field-display-equipment-who"
                    className="text-body bg-fg-2 border-stroke hover:border-accent focus-visible:ring-accent data-[state=open]:border-accent touch:min-h-44 flex h-26 max-w-160 shrink-0 items-center gap-4 rounded-full border pr-6 pl-10 outline-hidden transition-colors duration-150 focus-visible:ring-2"
                >
                    <span className="truncate">{whoText(who, t)}</span>
                    <CaretDownIcon size={12} aria-hidden className="shrink-0" />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                    data-testid="field-display-equipment-menu"
                    className={clsx(MENU_CONTENT_CLASS, "min-w-200")}
                >
                    {item("changed", "fieldDisplay.equipmentNotOwn")}
                    {item("everyone", "fieldDisplay.equipmentEveryone")}
                    {sections.length > 0 && (
                        <>
                            <DropdownMenu.Separator
                                className={MENU_SEPARATOR_CLASS}
                            />
                            <DropdownMenu.Label className={MENU_LABEL_CLASS}>
                                {t("fieldDisplay.equipmentOnly")}
                            </DropdownMenu.Label>
                            {sections.map((section) => (
                                <DropdownMenu.CheckboxItem
                                    key={section}
                                    checked={picked.includes(section)}
                                    data-testid={`field-display-equipment-section-${section}`}
                                    onSelect={(event) => {
                                        // Stays open: a few sections are picked in a row
                                        event.preventDefault();
                                        toggleEquipmentSection(section);
                                    }}
                                    className={clsx(
                                        MENU_ITEM_CLASS,
                                        "touch:min-h-44 pl-4",
                                    )}
                                >
                                    <span className="flex w-16 justify-center">
                                        <DropdownMenu.ItemIndicator className="flex">
                                            <CheckIcon size={14} />
                                        </DropdownMenu.ItemIndicator>
                                    </span>
                                    {getTranslatedSectionName(section, t)}
                                </DropdownMenu.CheckboxItem>
                            ))}
                        </>
                    )}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
