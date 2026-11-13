import { useRef, type ReactNode } from "react";
import { Input, Switch } from "@openmarch/ui";
import clsx from "clsx";
import { useDraft } from "../useDraft";

/**
 * The Field panel's inputs (#824), one row each like the Metronome panel's: the label on the left,
 * the field on the right. Text saves on blur or Enter, only when the value is valid and different;
 * an invalid value goes back to the stored one. They follow the stored value, so after an undo
 * they show what the field has (B1).
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
    wide,
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
    /** Room for words (names), not a number */
    wide?: boolean;
}) {
    const [draft, setDraft] = useDraft(stored);
    const parsed = parse(draft);
    // Escape drops the typing: the blur that follows must not save it (roast)
    const cancelled = useRef(false);
    const commit = () => {
        if (cancelled.current) {
            cancelled.current = false;
            setDraft(stored);
            return;
        }
        if (parsed === null || Object.is(parsed.value, current)) {
            setDraft(stored);
            return;
        }
        onCommit(parsed.value);
    };
    return (
        <label className="flex min-w-0 flex-col gap-2" title={title}>
            <span className={ROW}>
                <span className="min-w-0">{label}</span>
                <span className="flex shrink-0 items-center gap-6">
                    <Input
                        compact
                        className={clsx(
                            wide ? "w-[14rem]" : "w-[6rem] text-right",
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
                                // The field's, not the panel's: it doesn't also step back
                                e.preventDefault();
                                e.stopPropagation();
                                cancelled.current = true;
                                setDraft(stored);
                                e.currentTarget.blur();
                            }
                        }}
                    />
                    {unit && (
                        <span className="text-sub text-text-subtitle w-36 shrink-0">
                            {unit}
                        </span>
                    )}
                </span>
            </span>
            {hint && <Hint>{hint}</Hint>}
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
        <label className={ROW}>
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

/** A setting's row, as in the Metronome panel: label left, control right */
export const ROW =
    "text-body text-text/80 flex min-h-26 w-full items-center justify-between gap-12 px-12";

/** A row holding any control (a select, a slider, a color) */
export function Row({
    label,
    children,
    title,
}: {
    label: ReactNode;
    children: ReactNode;
    title?: string;
}) {
    return (
        <div className={ROW} title={title}>
            <span className="min-w-0">{label}</span>
            <span className="flex shrink-0 items-center gap-6">{children}</span>
        </div>
    );
}

/** A note under a row */
export function Hint({ children }: { children: ReactNode }) {
    return (
        <span className="text-sub text-text-subtitle px-12">{children}</span>
    );
}

/** A group inside a tab: an h5 title (with an optional note beside it), then its rows */
export function Group({
    title,
    note,
    children,
    testId,
}: {
    title: ReactNode;
    note?: ReactNode;
    children: ReactNode;
    testId?: string;
}) {
    return (
        <section className="flex flex-col gap-10" data-testid={testId}>
            <div className="flex items-baseline gap-8">
                <h5 className="text-h5">{title}</h5>
                {note && (
                    <span className="text-sub text-text-subtitle">{note}</span>
                )}
            </div>
            {children}
        </section>
    );
}

/** A smaller heading inside a group */
export function SubHeading({ children }: { children: ReactNode }) {
    return (
        <p className="text-sub text-text-subtitle mt-4 px-12 font-medium">
            {children}
        </p>
    );
}
