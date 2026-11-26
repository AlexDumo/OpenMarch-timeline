/**
 * Building blocks shared by the overlay's floating panels (ui.md UI-2).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Button, ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import clsx from "clsx";
import { Tip } from "@/components/ui/Tip";

/** A floating panel in the editor's overlay style. */
export function Panel({
    children,
    className,
    label,
    testId,
}: {
    children: ReactNode;
    className?: string;
    /** Accessible name for the group. */
    label?: string;
    testId?: string;
}) {
    return (
        <div
            role="group"
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "border-stroke bg-modal backdrop-blur-32 rounded-6 shadow-modal text-text pointer-events-auto flex min-w-0 items-center gap-4 border p-4",
                className,
            )}
        >
            {children}
        </div>
    );
}

/** A thin vertical rule between groups in a panel. */
export function PanelSeparator() {
    return <span className="bg-stroke mx-4 w-px self-stretch" aria-hidden />;
}

/**
 * A button in a panel, like Pick a seat or Play. With `pressed` it is an
 * on/off toggle, and pressed shows a soft accent fill. With `iconOnly`, the
 * label is only the accessible name.
 */
export function ToggleButton({
    pressed,
    onClick,
    icon,
    label,
    tooltip,
    shortcut,
    tooltipSide = "bottom",
    iconOnly = false,
    disabled,
    testId,
}: {
    /** Undefined for a plain action button that has no on/off state. */
    pressed?: boolean;
    onClick: () => void;
    icon: ReactNode;
    label: string;
    tooltip?: string;
    /** A binding ("F") the tooltip shows after `tooltip`, as a `Shortcut` */
    shortcut?: string;
    tooltipSide?: "top" | "bottom" | "left" | "right";
    iconOnly?: boolean;
    disabled?: boolean;
    testId?: string;
}) {
    const button = (
        <Button
            variant="ghost"
            size="compact"
            content={iconOnly ? "icon" : "text"}
            aria-pressed={pressed}
            aria-label={label}
            // A tooltip with a shortcut is the app's own (`Tip`), which can show it as a key
            tooltipText={shortcut === undefined ? tooltip : undefined}
            tooltipSide={tooltipSide}
            disabled={disabled}
            onClick={onClick}
            data-testid={testId}
            className={clsx(
                "rounded-4 text-text enabled:hover:bg-text/10 h-28 shrink-0 gap-6 border border-transparent whitespace-nowrap",
                iconOnly ? "size-28 p-0" : "px-10",
                pressed &&
                    "bg-accent/15 text-accent border-accent enabled:hover:bg-accent/20",
            )}
        >
            {icon}
            {!iconOnly && label}
        </Button>
    );
    return shortcut === undefined ? (
        button
    ) : (
        <Tip label={tooltip} shortcut={shortcut} side={tooltipSide}>
            {button}
        </Tip>
    );
}

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    title?: string;
    /**
     * Why this option can't be chosen now. It shows dimmed, with the reason
     * as its tooltip, and a click calls `onUnavailable` instead of choosing it.
     */
    unavailable?: string;
}

/**
 * A segmented control: one of several options, the active one in accent.
 * Built on the `ToggleGroup` primitive.
 */
export function Segmented<T extends string>({
    value,
    options,
    onChange,
    onUnavailable,
    label,
    testId,
    className,
}: {
    value: T | null;
    options: readonly SegmentOption<T>[];
    onChange: (value: T) => void;
    /** A click on an option that is `unavailable`, with its reason. */
    onUnavailable?: (value: T, reason: string) => void;
    label: string;
    testId?: string;
    /** Layout for the group, for example a grid instead of a row. */
    className?: string;
}) {
    return (
        <ToggleGroup
            type="single"
            value={value ?? ""}
            // Radix sends "" when the active item is clicked again; keep it.
            onValueChange={(next: string) => {
                if (!next) return;
                const reason = options.find(
                    (o) => o.value === next,
                )?.unavailable;
                if (reason) onUnavailable?.(next as T, reason);
                else onChange(next as T);
            }}
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "h-auto! shrink-0 gap-2 border-0! bg-transparent! bg-none!",
                className,
            )}
        >
            {options.map((option) => (
                <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    title={option.unavailable ?? option.title}
                    data-value={option.value}
                    data-unavailable={option.unavailable ? "" : undefined}
                    aria-disabled={option.unavailable ? true : undefined}
                    className={SEGMENT_CLASS}
                >
                    {option.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

/** The look of a segment, shared by {@link Segmented} and {@link SegmentedMany} */
const SEGMENT_CLASS =
    "data-[unavailable]:text-text/40 text-body rounded-4! hover:bg-text/10! data-[state=on]:bg-accent! data-[state=on]:hover:bg-accent! data-[state=on]:text-text-invert! h-28 border-0! px-10! whitespace-nowrap aria-disabled:cursor-not-allowed";

/**
 * Like {@link Segmented}, but any number of options can be on. With `atLeastOne`, the last one
 * on can't be turned off: it says why in its tooltip (`lastReason`), and clicking it calls
 * `onRefused` so the panel can say it too.
 */
export function SegmentedMany<T extends string>({
    value,
    options,
    onChange,
    label,
    testId,
    lastReason,
    onRefused,
    className,
}: {
    value: readonly T[];
    options: readonly SegmentOption<T>[];
    onChange: (value: T[]) => void;
    label: string;
    testId?: string;
    /** Why the last option on can't be turned off; set to keep at least one on */
    lastReason?: string;
    onRefused?: () => void;
    className?: string;
}) {
    const only = lastReason && value.length === 1 ? value[0] : null;
    return (
        <ToggleGroup
            type="multiple"
            value={[...value]}
            onValueChange={(next: string[]) => {
                if (lastReason && next.length === 0) onRefused?.();
                else onChange(next as T[]);
            }}
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "h-auto! shrink-0 flex-wrap gap-2 border-0! bg-transparent! bg-none!",
                className,
            )}
        >
            {options.map((option) => (
                <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    title={option.value === only ? lastReason : option.title}
                    aria-disabled={option.value === only || undefined}
                    data-value={option.value}
                    className={SEGMENT_CLASS}
                >
                    {option.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

/**
 * A color swatch. The native picker updates the swatch while it is open and
 * saves once when it closes, so one pick is one undo step.
 */
export function ColorField({
    label,
    value,
    onCommit,
    testId,
}: {
    label: string;
    value: string;
    onCommit: (color: string) => void;
    testId?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    // React's onChange fires on every `input`; saving waits for `change`.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onChange = () => commitRef.current(el.value.toLowerCase());
        el.addEventListener("change", onChange);
        return () => el.removeEventListener("change", onChange);
    }, []);
    useEffect(() => {
        if (ref.current && ref.current.value !== value) {
            ref.current.value = value;
        }
    }, [value]);

    return (
        <label className="flex items-center gap-6" title={label}>
            <span className="text-sub text-text/60">{label}</span>
            <input
                ref={ref}
                type="color"
                defaultValue={value}
                aria-label={label}
                data-testid={testId}
                className="border-stroke rounded-4 size-28 shrink-0 cursor-pointer border bg-transparent p-2"
            />
        </label>
    );
}
