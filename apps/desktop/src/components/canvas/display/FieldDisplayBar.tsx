import * as Popover from "@radix-ui/react-popover";
import {
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
} from "@/stores/UiSettingsStore";
import { StartFlagPositionsButton } from "./StartFlagPositionsButton";

/** The bar's square icon button, the same look as the transport's */
export const DISPLAY_BUTTON_CLASS =
    "focus-visible:ring-accent rounded-4 enabled:hover:text-accent enabled:hover:bg-fg-2 flex size-24 items-center justify-center outline-hidden transition-[color,background-color] duration-150 focus-visible:ring-2";

const POPOVER_CLASS =
    "border-stroke bg-modal text-text shadow-modal rounded-8 z-50 flex flex-col gap-4 border p-8 backdrop-blur-sm";

const LABEL_FORMS: readonly MarcherLabelForm[] = [
    "auto",
    "names",
    "numbers",
    "off",
];
const LABEL_FORM_KEY: Record<MarcherLabelForm, string> = {
    auto: "toolbar.view.labelsAuto",
    names: "toolbar.view.labelsNames",
    numbers: "toolbar.view.labelsNumbers",
    off: "toolbar.view.labelsOff",
};

/**
 * How the field is displayed, apart from the timeline: a small bar at the field's top right (the
 * zoom controls hold the bottom right). Path overlays and marcher labels work; sections and the
 * field's direction are placeholders until those features exist.
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
                <LabelsButton />
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

/** Marcher labels: Auto, drill numbers, numbers only, or off (the View tab's Labels setting) */
function LabelsButton() {
    const { t } = useTranslate();
    const form = useUiSettingsStore(
        (s) => s.uiSettings.marcherLabels ?? "auto",
    );
    const label = t("toolbar.view.labels");
    const current = t(LABEL_FORM_KEY[form]);
    const setForm = (marcherLabels: MarcherLabelForm) => {
        const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
        setUiSettings({ ...uiSettings, marcherLabels });
    };
    return (
        <Popover.Root>
            <ShortcutTooltip label={label} hint={current} side="left">
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={`${label}: ${current}`}
                        data-testid="field-display-labels"
                        className={clsx(
                            DISPLAY_BUTTON_CLASS,
                            form === "off" ? "text-text-disabled" : "text-text",
                        )}
                    >
                        <TagIcon size={16} />
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
                    {LABEL_FORMS.map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={form === value}
                            data-testid={`field-display-labels-${value}`}
                            onClick={() => setForm(value)}
                            className={clsx(
                                "text-body rounded-6 hover:bg-fg-2 focus-visible:ring-accent px-8 py-4 text-left outline-hidden focus-visible:ring-2",
                                form === value && "text-accent",
                            )}
                        >
                            {t(LABEL_FORM_KEY[value])}
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
