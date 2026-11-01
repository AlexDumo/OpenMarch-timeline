import * as Popover from "@radix-ui/react-popover";
import {
    BoundingBoxIcon,
    CompassIcon,
    TagIcon,
    UsersThreeIcon,
    type Icon,
} from "@phosphor-icons/react";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import {
    ShortcutTooltip,
    TransportTooltipProvider,
} from "@/components/timeline/ShortcutTooltip";
import {
    useUiSettingsStore,
    type MarcherLabelForm,
    type ShapeOutlines,
    type UiSettings,
} from "@/stores/UiSettingsStore";
import { StartFlagPositionsButton } from "./StartFlagPositionsButton";

/** The bar's square icon button, the same look as the transport's */
export const DISPLAY_BUTTON_CLASS =
    "focus-visible:ring-accent rounded-4 enabled:hover:text-accent enabled:hover:bg-fg-2 flex size-24 items-center justify-center outline-hidden transition-[color,background-color] duration-150 focus-visible:ring-2";

const POPOVER_CLASS =
    "border-stroke bg-modal text-text shadow-modal rounded-8 z-50 flex flex-col gap-4 border p-8 backdrop-blur-sm";

const LABEL_CHOICES: readonly Choice<MarcherLabelForm>[] = [
    { value: "auto", key: "toolbar.view.labelsAuto" },
    { value: "names", key: "toolbar.view.labelsNames" },
    { value: "numbers", key: "toolbar.view.labelsNumbers" },
    { value: "off", key: "toolbar.view.labelsOff" },
];
const SHAPE_CHOICES: readonly Choice<ShapeOutlines>[] = [
    { value: "selected", key: "toolbar.view.shapesSelected" },
    { value: "always", key: "toolbar.view.shapesAlways" },
    { value: "off", key: "toolbar.view.shapesOff" },
];

/**
 * How the field is displayed, apart from the timeline: a small bar at the field's top right (the
 * zoom controls hold the bottom right). It replaced the toolbar's View tab. Path overlays, marcher
 * labels and placed shapes' outlines work; sections and the field's direction are placeholders
 * until those features exist.
 */
export default function FieldDisplayBar() {
    const { t } = useTranslate();
    return (
        <TransportTooltipProvider>
            <div
                role="toolbar"
                aria-label={t("fieldDisplay.label")}
                aria-orientation="vertical"
                data-testid="field-display-bar"
                className="border-stroke bg-bg-1 text-text pointer-events-auto absolute top-6 right-6 z-10 flex flex-col items-center gap-4 rounded-lg border p-4 shadow-lg"
            >
                <StartFlagPositionsButton />
                <ChoiceButton
                    setting="marcherLabels"
                    fallback="auto"
                    choices={LABEL_CHOICES}
                    icon={TagIcon}
                    labelKey="toolbar.view.labels"
                    testId="field-display-labels"
                />
                {/* Placed boxes' outlines (docs/timeline/research/shapes/07-placed-boxes.md) */}
                <ChoiceButton
                    setting="shapes"
                    fallback="selected"
                    choices={SHAPE_CHOICES}
                    icon={BoundingBoxIcon}
                    labelKey="toolbar.view.shapes"
                    testId="field-display-shapes"
                />
                <span aria-hidden className="bg-stroke h-px w-16" />
                <PlaceholderButton
                    icon={UsersThreeIcon}
                    label={t("fieldDisplay.sections")}
                    testId="field-display-sections"
                />
                <PlaceholderButton
                    icon={CompassIcon}
                    label={t("fieldDisplay.direction")}
                    testId="field-display-direction"
                />
            </div>
        </TransportTooltipProvider>
    );
}

interface Choice<T extends string> {
    readonly value: T;
    readonly key: string;
}

/**
 * One setting picked from a short list (marcher labels, shape outlines): an icon that opens the
 * choices beside the bar, dimmed while the setting is off.
 */
function ChoiceButton<K extends "marcherLabels" | "shapes">({
    setting,
    fallback,
    choices,
    icon: IconComponent,
    labelKey,
    testId,
}: {
    setting: K;
    fallback: NonNullable<UiSettings[K]>;
    choices: readonly Choice<NonNullable<UiSettings[K]>>[];
    icon: Icon;
    labelKey: string;
    testId: string;
}) {
    const { t } = useTranslate();
    const value = useUiSettingsStore((s) => s.uiSettings[setting] ?? fallback);
    const label = t(labelKey);
    const currentKey = choices.find((c) => c.value === value)?.key;
    const current = currentKey ? t(currentKey) : undefined;
    const choose = (next: NonNullable<UiSettings[K]>) => {
        const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
        setUiSettings({ ...uiSettings, [setting]: next });
    };
    return (
        <Popover.Root>
            <ShortcutTooltip label={label} hint={current} side="left">
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={current ? `${label}: ${current}` : label}
                        data-testid={testId}
                        className={clsx(
                            DISPLAY_BUTTON_CLASS,
                            value === "off"
                                ? "text-text-disabled"
                                : "text-text",
                        )}
                    >
                        <IconComponent size={16} />
                    </button>
                </Popover.Trigger>
            </ShortcutTooltip>
            <Popover.Portal>
                <Popover.Content
                    side="left"
                    align="start"
                    sideOffset={6}
                    aria-label={label}
                    className={POPOVER_CLASS}
                >
                    <h3 className="text-sub text-text-subtitle px-8 pt-4 pb-2">
                        {label}
                    </h3>
                    {choices.map((choice) => (
                        <button
                            key={choice.value}
                            type="button"
                            aria-pressed={value === choice.value}
                            data-testid={`${testId}-${choice.value}`}
                            onClick={() => choose(choice.value)}
                            className={clsx(
                                "text-body rounded-6 hover:bg-fg-2 focus-visible:ring-accent px-8 py-4 text-left outline-hidden focus-visible:ring-2",
                                value === choice.value && "text-accent",
                            )}
                        >
                            {t(choice.key)}
                        </button>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/**
 * A display setting that doesn't exist yet: shown dimmed, says "coming soon" on hover, does
 * nothing. `aria-disabled` rather than `disabled`, so the tooltip still opens.
 */
function PlaceholderButton({
    icon: IconComponent,
    label,
    testId,
}: {
    icon: Icon;
    label: string;
    testId: string;
}) {
    const { t } = useTranslate();
    return (
        <ShortcutTooltip
            label={label}
            hint={t("fieldDisplay.comingSoon")}
            side="left"
        >
            <button
                type="button"
                aria-label={label}
                aria-disabled
                data-testid={testId}
                className={clsx(
                    DISPLAY_BUTTON_CLASS,
                    "text-text cursor-not-allowed opacity-40",
                )}
            >
                <IconComponent size={16} />
            </button>
        </ShortcutTooltip>
    );
}
