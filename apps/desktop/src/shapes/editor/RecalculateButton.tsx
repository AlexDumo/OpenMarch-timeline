import { useEffect, useRef, useState } from "react";
import { animated, useSpring, useTransition } from "@react-spring/web";
import { UserSwitchIcon } from "@phosphor-icons/react";
import { prefersReducedMotion } from "@/components/timeline/reducedMotion";

/** The word opening out: quick, with a little give */
const WORD_SPRING = { tension: 320, friction: 26 };
/** The accent flash fading back to the editor's normal look */
const FLASH_MS = 1200;
/** The flash's tint, as the editor's toggles have when on (bg-accent/15) */
const TINT = 0.15;
/** Wider than the word, so its width never clips it */
const WORD_MAX = "7em";

/**
 * The floating editor's Recalculate (#429): its icon alone while it would change nothing, and its
 * word too once it can act. The word springs open, and the button flashes accent text on a faint
 * accent tint that fades back to its normal look (owner: readable all the way through, unlike
 * inverted text on a solid accent), only when it becomes available, not when it shows up already available or re-renders
 * (owner). With reduced motion the word appears at once and only the color fades. During a drag
 * the edit target holds what it last knew (`useToolEditTarget`), so a drag doesn't flash it.
 */
export function useRecalculateLook(available: boolean) {
    const reduced = prefersReducedMotion();
    const was = useRef(available);
    const [flashing, setFlashing] = useState(false);
    const [flash, api] = useSpring(() => ({ p: 0 }));
    useEffect(() => {
        const became = available && !was.current;
        was.current = available;
        if (!became) return;
        setFlashing(true);
        void api.start({
            from: { p: 1 },
            to: { p: 0 },
            config: { duration: FLASH_MS },
            onRest: () => setFlashing(false),
        });
    }, [available, api]);
    const word = useTransition(available, {
        from: { maxWidth: "0em", opacity: 0 },
        enter: { maxWidth: WORD_MAX, opacity: 1 },
        leave: { maxWidth: "0em", opacity: 0 },
        // Already available when it shows up: no entrance
        initial: null,
        config: WORD_SPRING,
        immediate: reduced,
    });
    return { flash, flashing, word };
}

/** The button's face: the icon, then the word while it can act, over the fading accent */
export function RecalculateFace({
    look,
}: {
    look: ReturnType<typeof useRecalculateLook>;
}) {
    const { flash, flashing, word } = look;
    return (
        <>
            <animated.span
                aria-hidden
                className="bg-accent rounded-4 pointer-events-none absolute inset-0"
                style={{ opacity: flash.p.to((p) => p * TINT) }}
            />
            <animated.span
                className="relative flex items-center gap-4"
                data-flashing={flashing || undefined}
                style={{
                    // Accent text, fading back to the editor's
                    color: flash.p.to((p) =>
                        p > 0.01
                            ? `color-mix(in srgb, var(--color-accent) ${Math.round(p * 100)}%, var(--color-text))`
                            : "",
                    ),
                }}
            >
                <UserSwitchIcon size={14} />
                {word(
                    (style, shown) =>
                        shown && (
                            <animated.span
                                className="overflow-hidden whitespace-nowrap"
                                style={style}
                            >
                                Recalculate
                            </animated.span>
                        ),
                )}
            </animated.span>
        </>
    );
}
