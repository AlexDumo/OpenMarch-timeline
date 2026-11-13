import type { ReactNode } from "react";
import { Input, Switch } from "@openmarch/ui";
import clsx from "clsx";
import { useDraft } from "../useDraft";

/**
 * The field inspector's inputs (#824). Text saves on blur or Enter, only when the value is valid
 * and different; an invalid value goes back to the stored one. They follow the stored value, so
 * after an undo they show what the field has (B1).
 */
export function CommitInput<T>({
    label,
    stored,
    current,
    parse,
    onCommit,
    unit,
    hint,
    testId,
    numeric,
    placeholder,
    title,
}: {
    label: string;
    /** The stored value as the input shows it */
    stored: string;
    /** The stored value itself: typing it again saves nothing */
    current: T;
    /** What the text means, or null when it isn't valid */
    parse: (text: string) => { value: T } | null;
    onCommit: (value: T) => void;
    unit?: string;
    hint?: ReactNode;
    testId?: string;
    numeric?: boolean;
    placeholder?: string;
    title?: string;
}) {
    const [draft, setDraft] = useDraft(stored);
    const parsed = parse(draft);
    const commit = () => {
        if (parsed === null || Object.is(parsed.value, current)) {
            setDraft(stored);
            return;
        }
        onCommit(parsed.value);
    };
    return (
        <label className="flex min-w-0 flex-col gap-4" title={title}>
            <span className="text-sub text-text/60">{label}</span>
            <span className="flex items-center gap-6">
                <Input
                    compact
                    className={clsx(
                        "w-full min-w-0",
                        numeric && "tabular-nums",
                        parsed === null && "border-red",
                    )}
                    value={draft}
                    placeholder={placeholder}
                    inputMode={numeric ? "decimal" : undefined}
                    data-testid={testId}
                    aria-invalid={parsed === null}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                            setDraft(stored);
                            e.currentTarget.blur();
                        }
                    }}
                />
                {unit && (
                    <span className="text-sub text-text-subtitle shrink-0">
                        {unit}
                    </span>
                )}
            </span>
            {hint && <span className="text-sub text-text/60">{hint}</span>}
        </label>
    );
}

/** A number ≥ `min` (or > `min` with `exclusive`); "" is `empty` when given */
export function parseNumber(
    text: string,
    {
        min = -Infinity,
        exclusive = false,
        empty,
    }: { min?: number; exclusive?: boolean; empty?: number } = {},
): { value: number } | null {
    const trimmed = text.trim();
    if (trimmed === "") return empty === undefined ? null : { value: empty };
    if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return null;
    if (exclusive ? value <= min : value < min) return null;
    return { value };
}

export function SwitchRow({
    label,
    checked,
    onChange,
    testId,
    children,
}: {
    label: string;
    checked: boolean;
    onChange: (on: boolean) => void;
    testId?: string;
    children?: ReactNode;
}) {
    return (
        <label className="text-body flex items-center justify-between gap-8">
            <span className="flex items-center gap-6">
                {label}
                {children}
            </span>
            <Switch
                checked={checked}
                onCheckedChange={onChange}
                data-testid={testId}
            />
        </label>
    );
}

export function SubHeading({ children }: { children: ReactNode }) {
    return <p className="text-sub text-text/60 mt-4 font-medium">{children}</p>;
}
