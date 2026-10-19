/**
 * The holds the window's horn state preview offers (docs/3d/instruments.md
 * §5). The show's Horn/Equipment cues decide the hold; the preview, never
 * saved, only checks the poses (`performers/previewOverrides.ts`).
 */
import { HOLD_STATES, type HoldState } from "@/view3d/core/instruments/holds";

export { HOLD_STATES, type HoldState };

export function parseHornState(value: unknown): HoldState {
    return HOLD_STATES.includes(value as HoldState)
        ? (value as HoldState)
        : "up";
}
