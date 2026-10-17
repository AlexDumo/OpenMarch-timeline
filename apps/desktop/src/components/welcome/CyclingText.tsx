import { useEffect, useState } from "react";
import clsx from "clsx";

/** How long each language shows before fading to the next. */
export const CYCLE_INTERVAL_MS = 2800;

function prefersReducedMotion(): boolean {
    return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/**
 * Steps through `count` items, starting at `start`, so several CyclingTexts
 * can change together. Starts over at `start` when either changes. With
 * reduced motion it holds on `start`.
 */
export function useCycleIndex(count: number, start: number): number {
    const [index, setIndex] = useState(start);

    useEffect(() => {
        setIndex(start);
        if (count < 2 || prefersReducedMotion()) return;
        const timer = setInterval(
            () => setIndex((i) => (i + 1) % count),
            CYCLE_INTERVAL_MS,
        );
        return () => clearInterval(timer);
    }, [count, start]);

    return Math.min(index, Math.max(0, count - 1));
}

/**
 * Shows `texts[index]`, fading between them. All of them sit in one grid
 * cell, so the largest sets the size and nothing shifts as they change.
 * Hidden from screen readers; give them the text in the app's language.
 */
export default function CyclingText({
    texts,
    index,
    className,
    wrap = false,
    "data-testid": testId,
}: {
    texts: readonly { key: string; text: string; lang: string }[];
    index: number;
    className?: string;
    /** Let long text wrap (a paragraph) instead of staying on one line. */
    wrap?: boolean;
    "data-testid"?: string;
}) {
    return (
        <span
            aria-hidden
            className={clsx("grid place-items-center", className)}
            data-testid={testId}
        >
            {texts.map((text, i) => (
                <span
                    key={text.key}
                    lang={text.lang}
                    data-active={i === index || undefined}
                    className={clsx(
                        "col-start-1 row-start-1 transition-[opacity,translate] duration-700 ease-out motion-reduce:transition-none",
                        !wrap && "whitespace-nowrap",
                        i === index
                            ? "translate-y-0 opacity-100"
                            : "translate-y-4 opacity-0",
                    )}
                >
                    {text.text}
                </span>
            ))}
        </span>
    );
}
