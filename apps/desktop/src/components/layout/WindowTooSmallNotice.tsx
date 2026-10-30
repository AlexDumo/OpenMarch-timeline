import { useEffect, useState } from "react";
import { T, useTolgee } from "@tolgee/react";
import { ArrowsOutIcon } from "@phosphor-icons/react";
import { isTextEntry } from "@/hooks/useOnScreenKeyboard";
import Keycaps from "@/components/ui/Keycaps";
import { formatBindingKeys } from "@/shortcuts/bindings";
import { isMacPlatform } from "@/shortcuts/platform";
import { isWebBuild } from "@/utilities/webBuild";
import {
    isWindowTooSmall,
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
} from "@/utilities/windowTooSmall";

/** How long the window stays too small before the notice shows, so a resize
 * or a tablet turning doesn't flash it. */
const SHOW_DELAY_MS = 300;

/**
 * Covers the app while the window is too small to edit in, and says how to
 * make room. The app stays mounted underneath, so nothing is lost and it
 * comes straight back when the window grows.
 */
export default function WindowTooSmallNotice({
    size,
}: {
    size: { width: number; height: number };
}) {
    const { t } = useTolgee(["language"]);
    // An on-screen keyboard may shrink the window while typing
    const tooSmall =
        isWindowTooSmall(size.width, size.height) &&
        !isTextEntry(document.activeElement);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (!tooSmall) {
            setShown(false);
            return;
        }
        const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS);
        return () => clearTimeout(timer);
    }, [tooSmall]);

    if (!shown) return null;

    // The View menu's Zoom Out (electron/main/application-menu.ts)
    const zoomOut = formatBindingKeys("$mod+Minus", isMacPlatform());
    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="window-too-small-title"
            aria-describedby="window-too-small-body"
            data-testid="window-too-small"
            className="bg-bg-1 text-text fixed inset-0 z-[1000] flex items-center justify-center overflow-auto p-24 font-sans"
        >
            <div className="flex max-w-[26rem] flex-col items-center gap-12 text-center">
                <ArrowsOutIcon size={40} className="text-accent" />
                <h1 id="window-too-small-title" className="text-h4">
                    {t("layout.windowTooSmall.title")}
                </h1>
                <p id="window-too-small-body" className="text-body">
                    {t("layout.windowTooSmall.body", {
                        minWidth: MIN_WINDOW_WIDTH,
                        minHeight: MIN_WINDOW_HEIGHT,
                    })}
                </p>
                <p className="text-body text-text-subtitle">
                    <T
                        keyName={
                            isWebBuild
                                ? "layout.windowTooSmall.hintWeb"
                                : "layout.windowTooSmall.hintDesktop"
                        }
                        params={{ keys: () => <Keycaps keys={zoomOut} /> }}
                    />
                </p>
                <p className="text-sub text-text-subtitle">
                    {t("layout.windowTooSmall.current", {
                        width: size.width,
                        height: size.height,
                    })}
                </p>
            </div>
        </div>
    );
}
