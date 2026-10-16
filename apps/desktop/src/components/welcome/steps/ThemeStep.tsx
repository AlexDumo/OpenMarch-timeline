import * as RadioGroup from "@radix-ui/react-radio-group";
import {
    CheckCircleIcon,
    CircleIcon,
    MoonIcon,
    SunIcon,
} from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import clsx from "clsx";

export type ThemeChoice = "light" | "dark";

/**
 * The preview's colors, from each theme's tokens in packages/ui tailwind.css.
 * Fixed rather than tokens so both previews show at once whatever the app's
 * current theme is.
 */
const PREVIEW_COLORS: Record<
    ThemeChoice,
    {
        bg: string;
        panel: string;
        stroke: string;
        text: string;
        accent: string;
        field: string;
    }
> = {
    light: {
        bg: "rgb(236, 235, 240)",
        panel: "rgb(250, 249, 251)",
        stroke: "rgba(0, 0, 0, 0.1)",
        text: "rgba(32, 32, 32, 0.35)",
        accent: "rgb(100, 66, 255)",
        field: "rgb(255, 255, 255)",
    },
    dark: {
        bg: "rgb(15, 14, 19)",
        panel: "rgb(28, 27, 33)",
        stroke: "rgba(255, 255, 255, 0.08)",
        text: "rgba(208, 208, 208, 0.35)",
        accent: "rgb(150, 126, 255)",
        field: "rgb(36, 35, 42)",
    },
};

/** A small drawing of the editor in a theme: title bar, sidebar, field, timeline. */
function ThemePreview({ theme }: { theme: ThemeChoice }) {
    const c = PREVIEW_COLORS[theme];
    return (
        <svg
            viewBox="0 0 160 100"
            className="rounded-4 border-stroke block aspect-[16/10] w-full border"
            aria-hidden
        >
            <rect width="160" height="100" fill={c.bg} />
            {/* title bar */}
            <rect x="6" y="5" width="24" height="3" rx="1.5" fill={c.text} />
            <rect x="134" y="5" width="20" height="3" rx="1.5" fill={c.text} />
            {/* sidebar */}
            <rect
                x="6"
                y="13"
                width="30"
                height="60"
                rx="3"
                fill={c.panel}
                stroke={c.stroke}
            />
            {[20, 28, 36, 44].map((y) => (
                <rect
                    key={y}
                    x="11"
                    y={y}
                    width={y === 20 ? 14 : 20}
                    height="3"
                    rx="1.5"
                    fill={c.text}
                />
            ))}
            {/* field */}
            <rect
                x="41"
                y="13"
                width="113"
                height="60"
                rx="3"
                fill={c.field}
                stroke={c.stroke}
            />
            {[55, 70, 85, 100, 115, 130, 145].map((x) => (
                <line
                    key={x}
                    x1={x}
                    y1="17"
                    x2={x}
                    y2="69"
                    stroke={c.stroke}
                    strokeWidth="0.8"
                />
            ))}
            {[
                [62, 34],
                [74, 30],
                [86, 28],
                [98, 28],
                [110, 30],
                [122, 34],
                [68, 50],
                [82, 47],
                [97, 46],
                [112, 47],
                [126, 50],
            ].map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={c.accent} />
            ))}
            {/* timeline */}
            <rect
                x="6"
                y="78"
                width="148"
                height="17"
                rx="3"
                fill={c.panel}
                stroke={c.stroke}
            />
            <rect
                x="11"
                y="83"
                width="34"
                height="7"
                rx="2"
                fill={c.accent}
                opacity="0.85"
            />
            <rect
                x="48"
                y="83"
                width="46"
                height="7"
                rx="2"
                fill={c.accent}
                opacity="0.45"
            />
            <rect
                x="97"
                y="83"
                width="28"
                height="7"
                rx="2"
                fill={c.accent}
                opacity="0.45"
            />
        </svg>
    );
}

const THEMES: readonly { value: ThemeChoice; Icon: typeof SunIcon }[] = [
    { value: "light", Icon: SunIcon },
    { value: "dark", Icon: MoonIcon },
];

/** Light or dark, as two picture cards. Choosing one switches the app right away. */
export default function ThemeStep({
    value,
    onChange,
}: {
    value: string;
    onChange: (theme: ThemeChoice) => void;
}) {
    const { t } = useTranslate();
    return (
        <div className="flex flex-col gap-12">
            <RadioGroup.Root
                value={value}
                onValueChange={(next) => {
                    if (next === "light" || next === "dark") onChange(next);
                }}
                aria-label={t("welcomeFlow.theme.title")}
                className="grid grid-cols-2 gap-16"
                data-testid="welcome-theme-options"
            >
                {THEMES.map(({ value: theme, Icon }) => {
                    const checked = value === theme;
                    return (
                        <RadioGroup.Item
                            key={theme}
                            value={theme}
                            data-testid={`welcome-theme-${theme}`}
                            className={clsx(
                                "rounded-6 flex min-w-0 flex-col items-stretch gap-10 border p-12 text-left transition-colors duration-150 ease-out",
                                "focus-visible:outline-accent outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2",
                                checked
                                    ? "bg-accent/20 border-accent"
                                    : "bg-fg-2 border-stroke hover:border-accent/60",
                            )}
                        >
                            <ThemePreview theme={theme} />
                            <span className="flex items-center gap-6">
                                {checked ? (
                                    <CheckCircleIcon
                                        size={20}
                                        weight="fill"
                                        className="text-accent shrink-0"
                                    />
                                ) : (
                                    <CircleIcon
                                        size={20}
                                        className="text-text/50 shrink-0"
                                    />
                                )}
                                <span className="text-h5 text-text font-medium">
                                    <T
                                        keyName={`settings.general.appearance.${theme}`}
                                    />
                                </span>
                                <Icon
                                    size={18}
                                    className="text-text-subtitle ml-auto"
                                />
                            </span>
                        </RadioGroup.Item>
                    );
                })}
            </RadioGroup.Root>
            <p className="text-sub text-text-subtitle text-center">
                <T keyName="welcomeFlow.changeLater" />
            </p>
        </div>
    );
}
