import { useEffect, useState } from "react";
import clsx from "clsx";

/** How long each greeting shows before fading to the next. */
export const GREETING_INTERVAL_MS = 2800;

function prefersReducedMotion(): boolean {
    return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/**
 * Fades through `greetings`, starting at `startIndex`. All of them sit in one
 * grid cell, so the widest sets the size and nothing shifts as they change.
 * With reduced motion it holds on the first one. Hidden from screen readers;
 * give the page a static heading.
 */
export default function CyclingGreeting({
    greetings,
    startIndex = 0,
    className,
}: {
    greetings: readonly { key: string; text: string; lang: string }[];
    startIndex?: number;
    className?: string;
}) {
    const [index, setIndex] = useState(startIndex);

    useEffect(() => {
        if (greetings.length < 2 || prefersReducedMotion()) return;
        const timer = setInterval(
            () => setIndex((i) => (i + 1) % greetings.length),
            GREETING_INTERVAL_MS,
        );
        return () => clearInterval(timer);
    }, [greetings.length]);

    return (
        <span
            aria-hidden
            className={clsx("grid place-items-center", className)}
            data-testid="welcome-greeting"
        >
            {greetings.map((greeting, i) => (
                <span
                    key={greeting.key}
                    lang={greeting.lang}
                    data-active={i === index || undefined}
                    className={clsx(
                        "col-start-1 row-start-1 whitespace-nowrap transition-[opacity,translate] duration-700 ease-out motion-reduce:transition-none",
                        i === index
                            ? "translate-y-0 opacity-100"
                            : "translate-y-4 opacity-0",
                    )}
                >
                    {greeting.text}
                </span>
            ))}
        </span>
    );
}
