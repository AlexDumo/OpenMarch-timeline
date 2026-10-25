import type { ReactNode } from "react";
import clsx from "clsx";

/** A floating panel in the 3D View overlay style (UX spec 4) */
export function Panel({
    children,
    className,
    label,
    testId,
}: {
    children: ReactNode;
    className?: string;
    label?: string;
    testId?: string;
}) {
    return (
        <div
            role="group"
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "border-stroke bg-modal backdrop-blur-32 rounded-6 shadow-modal text-text pointer-events-auto border",
                className,
            )}
        >
            {children}
        </div>
    );
}

/** A thin vertical rule between groups in a panel */
export function PanelSeparator() {
    return <span className="bg-stroke mx-4 w-px self-stretch" aria-hidden />;
}

/** A small uppercase-free section heading inside a panel */
export function SectionLabel({ children }: { children: ReactNode }) {
    return (
        <div className="text-sub text-text-subtitle mb-6 select-none">
            {children}
        </div>
    );
}

/** An icon or text button for panels; `pressed` shows the accent state */
export function PanelButton({
    pressed,
    onClick,
    label,
    title,
    children,
    shortcut,
    disabled,
    testId,
    className,
    accent,
}: {
    pressed?: boolean;
    onClick: () => void;
    /** Accessible name */
    label: string;
    /** Tooltip; defaults to the label */
    title?: string;
    children: ReactNode;
    /** Shown small in the corner, like Excalidraw's tool numbers */
    shortcut?: string;
    disabled?: boolean;
    testId?: string;
    className?: string;
    accent?: boolean;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            title={title ?? label}
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
            className={clsx(
                "rounded-4 relative flex h-32 min-w-32 shrink-0 items-center justify-center gap-6 border border-transparent px-6 whitespace-nowrap select-none disabled:opacity-40",
                accent
                    ? "bg-accent text-text-invert hover:brightness-110"
                    : pressed
                      ? "bg-accent/20 text-accent"
                      : "text-text enabled:hover:bg-text/10",
                className,
            )}
        >
            {children}
            {shortcut && (
                <span className="text-text-subtitle pointer-events-none absolute right-2 bottom-0 font-mono text-[8px] leading-none">
                    {shortcut}
                </span>
            )}
        </button>
    );
}

export interface SegmentOption<T extends string> {
    value: T;
    label: ReactNode;
    title: string;
    testId?: string;
}

/** One of several options in a row, the chosen one in accent */
export function Segmented<T extends string>({
    value,
    options,
    onChange,
    label,
    className,
    itemClassName,
    testId,
}: {
    value: T | null;
    options: readonly SegmentOption<T>[];
    onChange: (value: T) => void;
    label: string;
    className?: string;
    itemClassName?: string;
    testId?: string;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "border-stroke bg-fg-1 rounded-6 flex gap-2 border p-2",
                className,
            )}
        >
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    aria-label={o.title}
                    title={o.title}
                    data-testid={o.testId}
                    onClick={() => onChange(o.value)}
                    className={clsx(
                        "rounded-4 text-body flex h-28 flex-1 items-center justify-center px-6 whitespace-nowrap select-none",
                        value === o.value
                            ? "bg-accent/20 text-accent"
                            : "text-text-subtitle hover:bg-text/10 hover:text-text",
                        itemClassName,
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** A color swatch button; "transparent" shows a red slash */
export function Swatch({
    color,
    selected,
    onClick,
    label,
    testId,
}: {
    color: string;
    selected: boolean;
    onClick: () => void;
    label: string;
    testId?: string;
}) {
    const transparent = color === "transparent";
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={selected}
            title={label}
            data-testid={testId}
            onClick={onClick}
            className={clsx(
                "rounded-4 relative size-24 shrink-0 overflow-hidden border",
                selected ? "border-accent ring-accent ring-1" : "border-stroke",
            )}
            style={{ background: transparent ? "#fff" : color }}
        >
            {transparent && (
                <svg
                    viewBox="0 0 24 24"
                    className="absolute inset-0 size-full"
                    aria-hidden
                >
                    <line
                        x1="3"
                        y1="21"
                        x2="21"
                        y2="3"
                        stroke="#e03131"
                        strokeWidth="2"
                    />
                </svg>
            )}
        </button>
    );
}

/** A native color picker shown as a rainbow swatch */
export function CustomColor({
    value,
    onChange,
    label,
}: {
    value: string;
    onChange: (color: string) => void;
    label: string;
}) {
    const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    return (
        <label
            title={label}
            className="rounded-4 border-stroke relative size-24 shrink-0 cursor-pointer overflow-hidden border"
            style={{
                background:
                    "conic-gradient(#e03131, #f08c00, #2f9e44, #1971c2, #6741d9, #e03131)",
            }}
        >
            <span className="sr-only">{label}</span>
            <input
                type="color"
                value={hex}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
            />
        </label>
    );
}
