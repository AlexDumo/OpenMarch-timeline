import { useEffect, useState } from "react";
import { Button } from "@openmarch/ui";
import {
    fieldInputLogText,
    logFieldInput,
    loseFieldContext,
    requestFieldRebuild,
    useFieldInputDebug,
} from "@/field/debug/fieldInputDebug";

/** How long a test waits, for a drag to be started before it runs */
const TEST_DELAY_MS = 3000;
/** How long the banner shows a cancel */
const BANNER_MS = 6000;

/**
 * Logs what happens to the window around the field that could end a drag: focus, the page
 * hidden, and the display it's on (its scale and size).
 */
function useWindowWatch() {
    useEffect(() => {
        const blur = () => logFieldInput("window", "lost focus");
        const focus = () => logFieldInput("window", "got focus");
        const visibility = () =>
            logFieldInput("window", `page ${document.visibilityState}`);
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const resize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(
                () =>
                    logFieldInput(
                        "window",
                        `size ${window.innerWidth}×${window.innerHeight}, screen ${window.screen.width}×${window.screen.height}`,
                    ),
                300,
            );
        };
        // The display's scale changes when the window moves to a screen with another one
        let scaleQuery: MediaQueryList | null = null;
        const watchScale = () => {
            scaleQuery?.removeEventListener("change", scaleChanged);
            scaleQuery = window.matchMedia(
                `(resolution: ${window.devicePixelRatio}dppx)`,
            );
            scaleQuery.addEventListener("change", scaleChanged);
        };
        function scaleChanged() {
            logFieldInput(
                "window",
                `display scale now ${window.devicePixelRatio}`,
            );
            watchScale();
        }
        logFieldInput(
            "window",
            `display scale ${window.devicePixelRatio}, screen ${window.screen.width}×${window.screen.height}`,
        );
        watchScale();
        window.addEventListener("blur", blur);
        window.addEventListener("focus", focus);
        window.addEventListener("resize", resize);
        document.addEventListener("visibilitychange", visibility);
        return () => {
            clearTimeout(resizeTimer);
            scaleQuery?.removeEventListener("change", scaleChanged);
            window.removeEventListener("blur", blur);
            window.removeEventListener("focus", focus);
            window.removeEventListener("resize", resize);
            document.removeEventListener("visibilitychange", visibility);
        };
    }, []);
}

/** Ticks while `until` is ahead, for a countdown */
function useNow(until: number | null) {
    const [now, setNow] = useState(() => performance.now());
    useEffect(() => {
        if (until === null) return;
        const timer = setInterval(() => setNow(performance.now()), 100);
        return () => clearInterval(timer);
    }, [until]);
    return now;
}

/**
 * The field input log (`?debugInput`), over the field's corner: the last things the pointer
 * did, a banner when a drag was undone and why, and tests that rebuild the field's canvas or
 * lose its GPU context a few seconds on, to see what that does to a drag under way.
 */
export function FieldInputDebugPanel() {
    const enabled = useFieldInputDebug((s) => s.enabled);
    return enabled ? <Panel /> : null;
}

function Panel() {
    useWindowWatch();
    const entries = useFieldInputDebug((s) => s.entries);
    const lastCancel = useFieldInputDebug((s) => s.lastCancel);
    const [open, setOpen] = useState(true);
    const [pending, setPending] = useState<{
        label: string;
        at: number;
    } | null>(null);
    const [copied, setCopied] = useState(false);
    const now = useNow(
        pending?.at ?? (lastCancel ? lastCancel.t + BANNER_MS : null),
    );

    const later = (label: string, run: () => void) => {
        const at = performance.now() + TEST_DELAY_MS;
        setPending({ label, at });
        logFieldInput("test", `${label} in ${TEST_DELAY_MS / 1000} s`);
        setTimeout(() => {
            setPending(null);
            run();
        }, TEST_DELAY_MS);
    };
    const copy = () => {
        void navigator.clipboard
            ?.writeText(fieldInputLogText())
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
    };

    const banner =
        lastCancel && now - lastCancel.t < BANNER_MS ? lastCancel : null;
    const first = entries[0]?.t ?? 0;

    return (
        <div
            className="rounded-6 border-stroke bg-modal shadow-modal text-text text-sub pointer-events-auto fixed bottom-12 left-12 z-50 flex w-[380px] max-w-[calc(100vw-24px)] flex-col gap-6 border p-8"
            data-testid="fieldInputDebug"
        >
            {banner && (
                <div className="rounded-6 bg-red px-8 py-4 text-white">
                    Drag undone: {banner.detail}
                </div>
            )}
            {pending && (
                <div className="rounded-6 bg-accent px-8 py-4 text-white">
                    {pending.label} in{" "}
                    {Math.max(0, (pending.at - now) / 1000).toFixed(1)} s: start
                    a drag now
                </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
                <span className="mr-auto font-medium">Field input log</span>
                <Button
                    size="compact"
                    variant="secondary"
                    disabled={pending !== null}
                    onClick={() =>
                        later("Rebuilding the field", requestFieldRebuild)
                    }
                >
                    Rebuild in 3 s
                </Button>
                <Button
                    size="compact"
                    variant="secondary"
                    disabled={pending !== null}
                    onClick={() =>
                        later("Losing the GPU", () => loseFieldContext(1000))
                    }
                >
                    Lose GPU in 3 s
                </Button>
                <Button size="compact" variant="secondary" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                    size="compact"
                    variant="ghost"
                    onClick={() =>
                        useFieldInputDebug.setState({
                            entries: [],
                            lastCancel: null,
                        })
                    }
                >
                    Clear
                </Button>
                <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => setOpen((o) => !o)}
                >
                    {open ? "Hide" : "Show"}
                </Button>
            </div>
            {open && (
                <ol className="max-h-[40vh] overflow-y-auto font-mono whitespace-pre-wrap">
                    {entries
                        .slice()
                        .reverse()
                        .map((e, i) => (
                            <li
                                key={`${e.t}-${i}`}
                                className={e.cancelled ? "text-red" : undefined}
                            >
                                {((e.t - first) / 1000).toFixed(2)}s {e.kind}{" "}
                                <span className="text-text-subtitle">
                                    {e.detail}
                                </span>
                            </li>
                        ))}
                </ol>
            )}
        </div>
    );
}
