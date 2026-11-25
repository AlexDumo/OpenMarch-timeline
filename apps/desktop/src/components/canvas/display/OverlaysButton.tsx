import * as Popover from "@radix-ui/react-popover";
import { StackIcon } from "@phosphor-icons/react";
import { SegmentedTextSwitch, Switch } from "@openmarch/ui";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { useId, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { ShortcutTooltip } from "@/components/timeline/ShortcutTooltip";
import Shortcut from "@/components/ui/Shortcut";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import {
    useUiSettingsStore,
    type EquipmentIconPlace,
    type EquipmentIcons,
    type FieldVenueAround,
    type FieldVenueLook,
    type MarcherLabelForm,
    type ShapeOutlines,
    type UiSettings,
} from "@/stores/UiSettingsStore";
import { toggleFacingArrows } from "@/cues/useFieldFacing";
import { setEquipmentIcons } from "@/shortcuts/handlers/useCueActionHandlers";
import { useVenueFieldStyle } from "@/hooks/queries/useVenueFieldStyle";
import {
    setFieldVenue,
    venueAround,
    venueShows,
} from "@/field/three/venueUnderlay/fieldVenue";
import { useFollowTheLeader } from "@/pathways/followTheLeader";
import type { ActionId } from "@/shortcuts/definitions";
import { DISPLAY_BUTTON_CLASS } from "./displayButton";

interface Choice<T extends string> {
    readonly value: T;
    /** The segment's text */
    readonly key: string;
    /** What a screen reader hears, where the segment shows an example rather than words */
    readonly spokenKey?: string;
}

const LABEL_CHOICES: readonly Choice<MarcherLabelForm>[] = [
    { value: "auto", key: "fieldDisplay.labelsAuto" },
    {
        value: "names",
        key: "fieldDisplay.labelsNamesExample",
        spokenKey: "toolbar.view.labelsNames",
    },
    {
        value: "numbers",
        key: "fieldDisplay.labelsNumbersExample",
        spokenKey: "toolbar.view.labelsNumbers",
    },
    { value: "off", key: "toolbar.view.labelsOff" },
];
const EQUIPMENT_CHOICES: readonly Choice<EquipmentIcons>[] = [
    { value: "changed", key: "toolbar.view.equipmentChanged" },
    { value: "everyone", key: "toolbar.view.equipmentEveryone" },
    { value: "off", key: "toolbar.view.equipmentOff" },
];
const EQUIPMENT_PLACE_CHOICES: readonly Choice<EquipmentIconPlace>[] = [
    { value: "beside", key: "fieldDisplay.equipmentBeside" },
    { value: "dot", key: "fieldDisplay.equipmentOnDot" },
    { value: "label", key: "fieldDisplay.equipmentOnNumber" },
];
const ORDER_CHOICES: readonly Choice<ShapeOutlines>[] = [
    { value: "selected", key: "toolbar.view.orderSelected" },
    { value: "always", key: "toolbar.view.orderAlways" },
    { value: "off", key: "toolbar.view.orderOff" },
];
const SHAPE_CHOICES: readonly Choice<ShapeOutlines>[] = [
    { value: "selected", key: "toolbar.view.shapesSelected" },
    { value: "always", key: "toolbar.view.shapesAlways" },
    { value: "off", key: "toolbar.view.shapesOff" },
];
const VENUE_LOOKS: readonly Choice<Exclude<FieldVenueLook, "off">>[] = [
    { value: "faint", key: "toolbar.view.venueFaint" },
    { value: "soft", key: "toolbar.view.venueSoft" },
    { value: "markings", key: "fieldDisplay.venueMarkings" },
    { value: "full", key: "toolbar.view.venueFull" },
];
const VENUE_AROUND: readonly Choice<FieldVenueAround>[] = [
    { value: "field", key: "toolbar.view.venueAroundField" },
    { value: "edge", key: "toolbar.view.venueAroundEdge" },
    { value: "stands", key: "toolbar.view.venueAroundStands" },
];

/**
 * What the panel's settings are as shipped. The button shows a dot while any differs, and Reset
 * puts them back. Venue's look, surroundings and camera aren't counted: they only matter with the
 * venue on, which is.
 */
export const OVERLAY_DEFAULTS = {
    marcherLabels: "auto",
    equipmentIcons: "changed",
    equipmentIconPlace: "beside",
    facingArrows: false,
    lineOrder: "off",
    shapes: "selected",
    fieldVenue: "off",
} as const satisfies Partial<UiSettings>;

const change = (patch: Partial<UiSettings>) => {
    const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
    setUiSettings({ ...uiSettings, ...patch });
};

/** The overlays whose value differs from the shipped one (order only with Follow-the-leader on) */
function changedOverlays(
    s: UiSettings,
    followTheLeader: boolean,
): (keyof typeof OVERLAY_DEFAULTS)[] {
    const value = {
        marcherLabels: s.marcherLabels ?? "auto",
        equipmentIcons: s.equipmentIcons ?? "changed",
        // Where the icons go only counts while they show
        equipmentIconPlace:
            (s.equipmentIcons ?? "changed") === "off"
                ? "beside"
                : (s.equipmentIconPlace ?? "beside"),
        facingArrows: s.facingArrows === true,
        lineOrder: followTheLeader ? (s.lineOrder ?? "off") : "off",
        shapes: s.shapes ?? "selected",
        fieldVenue: s.fieldVenue ?? "off",
    };
    return (
        Object.keys(OVERLAY_DEFAULTS) as (keyof typeof OVERLAY_DEFAULTS)[]
    ).filter((key) => value[key] !== OVERLAY_DEFAULTS[key]);
}

/** Puts every overlay back as shipped (the venue's last look stays for its next time on) */
export function resetOverlays(): void {
    change({ ...OVERLAY_DEFAULTS });
}

/**
 * Show on field (owner, 2026-11-25: one button instead of an icon for every setting, without
 * nested menus): one button on the field's display bar that opens one flat panel of what the field
 * draws over the performers and the field. Performers: drill numbers, what they hold, facing, and a
 * line's order (with Follow-the-leader on). Field: shape outlines and the venue. Each row names
 * the setting with its control on the right: a segmented switch for a choice, a switch for on or
 * off. Precedents: Blender's viewport Overlays popover, the Layers panel of Google and Apple Maps.
 *
 * Each control does what its palette action does; the palette and shortcuts still set them
 * without the panel. A dot on the button says something differs from how it shipped, and Reset
 * in the panel puts it all back.
 */
export default function OverlaysButton() {
    const { t } = useTranslate();
    const followTheLeader = useFollowTheLeader();
    const changed = useUiSettingsStore(
        useShallow((s) => changedOverlays(s.uiSettings, followTheLeader)),
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
                        <StackIcon size={16} />
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
                        "z-50 flex w-400 max-w-[calc(100vw-16px)] flex-col gap-12 px-16",
                        // Scrolls rather than running off a short window
                        "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain",
                    )}
                >
                    <div className="flex items-center justify-between gap-8">
                        <h2 className="text-body font-medium">{label}</h2>
                        {anyChanged && (
                            <button
                                type="button"
                                data-testid="field-display-overlays-reset"
                                onClick={resetOverlays}
                                className="text-sub text-text-subtitle hover:text-accent focus-visible:ring-accent touch:min-h-44 rounded-full px-6 py-2 outline-hidden transition-colors duration-150 focus-visible:ring-2"
                            >
                                {t("fieldDisplay.reset")}
                            </button>
                        )}
                    </div>
                    <PerformersSection followTheLeader={followTheLeader} />
                    <FieldSection />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className="flex flex-col gap-6">
            <h3 id={id} className="text-sub text-text-subtitle">
                {title}
            </h3>
            {children}
        </section>
    );
}

/** One setting: its name on the left, its control on the right, and why it's greyed out under */
function Row({
    name,
    shortcut,
    indent = false,
    reason,
    children,
}: {
    name: string;
    /** An action whose key shows beside the name */
    shortcut?: ActionId;
    /** A setting that belongs to the row above */
    indent?: boolean;
    /** Why the control is greyed out, shown under it */
    reason?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="touch:min-h-44 flex min-h-26 items-center justify-between gap-12">
                <span
                    className={clsx(
                        "text-body flex shrink-0 items-center gap-4",
                        indent && "text-text-subtitle pl-12",
                    )}
                >
                    {name}
                    {shortcut && <Shortcut action={shortcut} />}
                </span>
                {children}
            </div>
            {reason && (
                <p
                    className={clsx(
                        "text-sub text-text-subtitle leading-snug",
                        indent && "pl-12",
                    )}
                >
                    {reason}
                </p>
            )}
        </div>
    );
}

/** A choice of a few: the app's segmented switch, with finger-sized segments on touch */
function Choices<T extends string>({
    name,
    choices,
    value,
    onChange,
    testId,
    disabled = false,
    disabledValues,
}: {
    name: string;
    choices: readonly Choice<T>[];
    value: T;
    onChange: (value: T) => void;
    testId: string;
    disabled?: boolean;
    disabledValues?: readonly T[];
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
                disabled: disabled || disabledValues?.includes(choice.value),
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

function OnOff({
    name,
    checked,
    onChange,
    testId,
    disabled = false,
}: {
    name: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    testId: string;
    disabled?: boolean;
}) {
    return (
        <Switch
            aria-label={name}
            data-testid={testId}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
        />
    );
}

function PerformersSection({ followTheLeader }: { followTheLeader: boolean }) {
    const { t } = useTranslate();
    const s = useUiSettingsStore(
        useShallow((state) => ({
            labels: state.uiSettings.marcherLabels ?? "auto",
            equipment: state.uiSettings.equipmentIcons ?? "changed",
            place: state.uiSettings.equipmentIconPlace ?? "beside",
            facing: state.uiSettings.facingArrows === true,
            order: state.uiSettings.lineOrder ?? "off",
        })),
    );
    const iconsOff = s.equipment === "off";
    return (
        <Section title={t("fieldDisplay.performers")}>
            <Row name={t("fieldDisplay.labels")}>
                <Choices
                    name={t("fieldDisplay.labels")}
                    choices={LABEL_CHOICES}
                    value={s.labels}
                    onChange={(marcherLabels) => change({ marcherLabels })}
                    testId="field-display-labels"
                />
            </Row>
            <Row name={t("fieldDisplay.equipment")}>
                <Choices
                    name={t("fieldDisplay.equipment")}
                    choices={EQUIPMENT_CHOICES}
                    value={s.equipment}
                    onChange={setEquipmentIcons}
                    testId="field-display-equipment"
                />
            </Row>
            <Row
                name={t("fieldDisplay.equipmentPlace")}
                indent
                reason={
                    iconsOff
                        ? t("toolbar.view.equipmentPlaceOffReason")
                        : undefined
                }
            >
                <Choices
                    name={t("fieldDisplay.equipmentPlace")}
                    choices={EQUIPMENT_PLACE_CHOICES}
                    value={s.place}
                    onChange={(equipmentIconPlace) =>
                        change({ equipmentIconPlace })
                    }
                    disabled={iconsOff}
                    testId="field-display-equipment-place"
                />
            </Row>
            <Row name={t("fieldDisplay.facing")}>
                <OnOff
                    name={t("fieldDisplay.facing")}
                    checked={s.facing}
                    onChange={toggleFacingArrows}
                    testId="field-display-facing"
                />
            </Row>
            {/* A line's order (pathways step 4g): only with Follow-the-leader on (#1095) */}
            {followTheLeader && (
                <Row
                    name={t("toolbar.view.order")}
                    shortcut="toggleMarcherOrder"
                >
                    <Choices
                        name={t("toolbar.view.order")}
                        choices={ORDER_CHOICES}
                        value={s.order}
                        onChange={(lineOrder) => change({ lineOrder })}
                        testId="field-display-order"
                    />
                </Row>
            )}
        </Section>
    );
}

function FieldSection() {
    const { t } = useTranslate();
    const s = useUiSettingsStore(
        useShallow((state) => ({
            shapes: state.uiSettings.shapes ?? "selected",
            look: state.uiSettings.fieldVenue ?? "off",
            last: state.uiSettings.fieldVenueLast ?? "faint",
            around: state.uiSettings.fieldVenueAround,
            camera: state.uiSettings.view3dCameraOnField === true,
        })),
    );
    const style = useVenueFieldStyle();
    const blank = !venueShows(style);
    const venueOn = s.look !== "off" && !blank;
    // What's drawn: Turf edge reads as None where there's no turf
    const drawnAround = venueAround(s.around, style);
    return (
        <Section title={t("fieldDisplay.field")}>
            {/* Placed boxes' outlines (docs/timeline/research/shapes/07-placed-boxes.md) */}
            <Row name={t("fieldDisplay.shapes")}>
                <Choices
                    name={t("fieldDisplay.shapes")}
                    choices={SHAPE_CHOICES}
                    value={s.shapes}
                    onChange={(shapes) => change({ shapes })}
                    testId="field-display-shapes"
                />
            </Row>
            {/* The show's 3D venue under the grid (#1207), back in the look last picked */}
            <Row
                name={t("toolbar.view.venue")}
                reason={blank ? t("toolbar.view.venueBlank") : undefined}
            >
                <OnOff
                    name={t("toolbar.view.venue")}
                    checked={venueOn}
                    disabled={blank}
                    onChange={(on) => setFieldVenue(on ? s.last : "off")}
                    testId="field-display-venue"
                />
            </Row>
            {venueOn && (
                <>
                    <Row name={t("fieldDisplay.venueLook")} indent>
                        <Choices
                            name={t("fieldDisplay.venueLook")}
                            choices={VENUE_LOOKS}
                            value={s.look as Exclude<FieldVenueLook, "off">}
                            onChange={setFieldVenue}
                            testId="field-display-venue-look"
                        />
                    </Row>
                    <Row
                        name={t("toolbar.view.venueAround")}
                        indent
                        reason={
                            style !== "turf"
                                ? t("toolbar.view.venueEdgeStadiumOnly")
                                : undefined
                        }
                    >
                        <Choices
                            name={t("toolbar.view.venueAround")}
                            choices={VENUE_AROUND}
                            value={drawnAround}
                            onChange={(fieldVenueAround) =>
                                change({ fieldVenueAround })
                            }
                            disabledValues={
                                style !== "turf" ? ["edge"] : undefined
                            }
                            testId="field-display-venue-around"
                        />
                    </Row>
                </>
            )}
            {/* Where the 3D View looks, with the venue on or off */}
            <Row
                name={t("toolbar.view.venueCamera")}
                reason={t("toolbar.view.venueCameraHint")}
            >
                <OnOff
                    name={t("toolbar.view.venueCamera")}
                    checked={s.camera}
                    onChange={(view3dCameraOnField) =>
                        change({ view3dCameraOnField })
                    }
                    testId="field-display-venue-camera"
                />
            </Row>
        </Section>
    );
}
