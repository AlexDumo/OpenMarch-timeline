import { useTranslate } from "@tolgee/react";
import { isMacPlatform } from "@/shortcuts/platform";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useGestureChipStore } from "@/input/gestureChipStore";
import { gestureChipSegments } from "./heldRoleChipText";

const OFFSET_X = 16;
const OFFSET_Y = 18;

/**
 * A small readout near the cursor while a field drag runs: the held roles the drag reads, and Snap
 * off. It follows the drag's roles, not its pointer, so a drag it has nothing to say about never
 * renders it again as the pointer moves.
 */
export default function HeldRolesChip({
    belowTip = false,
}: {
    /** A drag readout (the tip) is showing; the chip sits under it there instead */
    belowTip?: boolean;
}) {
    const text = useHeldRolesChipText();
    if (belowTip || text === null) return null;
    return <ChipAtPointer text={text} />;
}

/** The chip's text for the running drag, or null when there's nothing to show */
export function useHeldRolesChipText(): string | null {
    const { t } = useTranslate();
    const active = useGestureChipStore((state) => state.active);
    const honored = useGestureChipStore((state) => state.honored);
    const roles = useGestureChipStore((state) => state.roles);
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const snapOn = useUiSettingsStore((state) => state.uiSettings.snap);
    if (!active || isPlaying) return null;
    const segments = gestureChipSegments(
        honored,
        roles,
        snapOn,
        isMacPlatform(),
        t,
    );
    return segments.length === 0 ? null : segments.join(" · ");
}

/** The chip under a drag readout, so the two stack instead of overlapping */
export function HeldRolesChipBelowTip() {
    const text = useHeldRolesChipText();
    if (text === null) return null;
    return (
        <div
            className="rounded-6 bg-modal text-sub text-text shadow-modal px-8 py-4 whitespace-nowrap"
            style={{ fontSize: 12 }}
            data-testid="heldRolesChip"
        >
            {text}
        </div>
    );
}

/** The chip itself, the only part that follows the pointer */
function ChipAtPointer({ text }: { text: string }) {
    const screen = useGestureChipStore((state) => state.screen);
    if (!screen) return null;
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
