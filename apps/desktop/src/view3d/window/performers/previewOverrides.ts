/**
 * The 3D window's preview overrides (performer-behavior.md section 7.5,
 * ADR 0004 build step 9): horn state, guard equipment and step-off foot.
 *
 * The show's cues and saved performer defaults decide what performers do.
 * Each override is window state only, never saved, and starts off ("follow
 * cues"). With every override off, the window draws exactly what the
 * compiled cues say:
 *
 * - the Horn/Equipment channel starts on the default hold and follows the
 *   cues ({@link windowHornEvents});
 * - the cues that fit a marcher are decided by their section's usual
 *   equipment, as in the editor's Visuals mode (`sectionCueCarry`);
 * - the step-off foot is the show's saved default, with Feet cues setting
 *   their own ({@link windowStepOffFoot}).
 *
 * Turning one on previews something the show doesn't say: a horn override
 * holds every carrier in that hold for the whole show, a guard equipment
 * override puts one piece in every guard member's hands (the drawn prop
 * only; the cues still fit by section), and a foot override replaces the
 * show's default foot for the cues that don't set one. Pure: no three.js.
 */
import type { CueSegment } from "@openmarch/core";
import type { HoldState } from "@/view3d/core/instruments/holds";
import type { GuardModelId } from "@/view3d/core/instruments/model";
import {
    planHornChannel,
    type HornEvent,
    type HornPlanOptions,
} from "@/view3d/core/marchers/hornChannel";

/** The hold before any Horn/Equipment cue (performer-behavior.md section 3, Horn / Equipment). */
export const DEFAULT_HOLD: HoldState = "up";

/** The window's horn state preview: a hold, or null to follow the cues. */
export type HornOverride = HoldState | null;

/** The window's guard equipment preview: one piece, or null for each section's own. */
export type GuardEquipmentOverride = GuardModelId | null;

/** The window's step-off foot preview, or null for the show's saved foot. */
export type StepOffFootOverride = "left" | "right" | null;

/** The hold a look carries its instrument in: the override, else the default. */
export function windowLookHold(override: HornOverride): HoldState {
    return override ?? DEFAULT_HOLD;
}

/**
 * What one carrier's Horn/Equipment channel plays over the show: the cues
 * from the default hold, or, with an override, that hold throughout.
 */
export function windowHornEvents(
    segments: readonly CueSegment[],
    override: HornOverride,
    options: Omit<HornPlanOptions, "defaultState">,
): HornEvent[] {
    if (override) return [{ from: 0, to: 0, state: override, fromState: null }];
    return planHornChannel(segments, {
        ...options,
        defaultState: DEFAULT_HOLD,
    });
}

/** The step-off foot the window compiles with: the preview, else the show's. */
export function windowStepOffFoot(
    override: StepOffFootOverride,
    showFoot: "left" | "right",
): "left" | "right" {
    return override ?? showFoot;
}
