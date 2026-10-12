import { useEffect, useMemo } from "react";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    isTimelineOwnKey,
    shortcutStillRuns,
    skipsAppNudge,
} from "@/components/timeline/timelineHotkeys";
import { layerIsOpen, readShortcutContext } from "./context";
import {
    buildKeymap,
    compileKeymap,
    resolveKeyEvent,
    type ShortcutOverrides,
} from "./keymap";
import { NUDGE_ACTION_IDS, type ActionId } from "./definitions";
import { isActionEnabled, runAction } from "./registry";

const NUDGE_IDS: ReadonlySet<ActionId> = new Set(NUDGE_ACTION_IDS);

/** The single keydown listener for all app shortcuts. Mount once. Uses the saved overrides unless given some. */
export default function ShortcutDispatcher({
    overrides,
}: {
    overrides?: ShortcutOverrides;
}) {
    const savedOverrides = useShortcutOverridesStore((s) => s.overrides);
    const activeOverrides = overrides ?? savedOverrides;
    const compiled = useMemo(
        () => compileKeymap(buildKeymap(activeOverrides)),
        [activeOverrides],
    );

    useEffect(() => {
        // Read before anything handles the press: Escape closes an open menu or list (Radix),
        // and by the time the press reaches this dispatcher the layer may be gone, so the same
        // Escape would also cancel the shape tool (sims, round 7)
        let layerOpenAtPress = false;
        const onKeyDownCapture = (event: KeyboardEvent) => {
            layerOpenAtPress = event.key === "Escape" && layerIsOpen();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && layerOpenAtPress) return;
            // Space on a Shape tool control reached by keyboard presses that control, not Play
            // (sims, draw round 1: Shift+Tab to Natural, Space, and the show played). A clicked
            // control keeps Space for Play.
            const active = document.activeElement;
            if (
                event.key === " " &&
                active instanceof HTMLElement &&
                active.matches(":focus-visible") &&
                active.closest("[data-shape-ui]")
            )
                return;
            if (
                (event.defaultPrevented && !shortcutStillRuns(event)) ||
                event.isComposing
            )
                return;
            // UI-14 round-2 review: Enter and the arrows on the timeline's move controls are
            // theirs; Space still plays
            const focused = document.activeElement;
            if (isTimelineOwnKey(event, focused)) return;
            // Read the store directly rather than via a hook-driven ref: a
            // hook selector only updates on React's next render, which can
            // lag behind a keydown that arrives immediately after a state
            // change (e.g. outside of an act()-wrapped event in tests, or a
            // rapid focus switch in the app).
            const baseScope =
                useUiSettingsStore.getState().uiSettings.focussedComponent;
            const entry = resolveKeyEvent(
                event,
                compiled,
                readShortcutContext(baseScope),
                // No nudge on a timeline move control (code review)
                (id) =>
                    isActionEnabled(id) &&
                    !(NUDGE_IDS.has(id) && skipsAppNudge(event, focused)),
            );
            if (!entry) return;
            event.preventDefault();
            if (event.repeat && entry.ignoreRepeat) return;
            runAction(entry.id);
        };
        window.addEventListener("keydown", onKeyDownCapture, true);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDownCapture, true);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [compiled]);

    return null;
}
