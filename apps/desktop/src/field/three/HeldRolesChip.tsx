import { useTranslate } from "@tolgee/react";
import { isMacPlatform } from "@/shortcuts/platform";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useGestureChipStore } from "@/input/gestureChipStore";
import { gestureChipSegments, shouldShowGestureChip } from "./heldRoleChipText";

const OFFSET_X = 16;
const OFFSET_Y = 18;

/** A small readout near the cursor: held modifier roles and Snap off while a field drag runs. */
export default function HeldRolesChip() {
    const { t } = useTranslate();
    const { active, roles, constrainWord, screen } = useGestureChipStore();
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const snapOn = useUiSettingsStore((state) => state.uiSettings.snap);
    if (!shouldShowGestureChip(active, roles, snapOn, isPlaying) || !screen) {
        return null;
    }
    const text = gestureChipSegments(
        roles,
        constrainWord,
        snapOn,
        isMacPlatform(),
        t,
    ).join(" · ");
    return (
        <div
            className="rounded-6 bg-modal text-sub text-text shadow-modal pointer-events-none absolute z-20 px-8 py-4 whitespace-nowrap"
            style={{
                left: screen.x + OFFSET_X,
                top: screen.y + OFFSET_Y,
                fontSize: 12,
            }}
            data-testid="heldRolesChip"
        >
            {text}
        </div>
    );
}
