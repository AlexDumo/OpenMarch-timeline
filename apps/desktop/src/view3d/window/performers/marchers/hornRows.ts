/**
 * The Horn/Equipment channel's bake rows for the window
 * (performer-behavior.md section 8.3): one hold row per hold a marcher can
 * play, and a transition row between two holds of one family. The hold's
 * arm pose is the channel's default row, so the Feet clips bake once
 * whatever the marchers carry.
 */
import type * as THREE from "three";
import type { ArmHold } from "@/view3d/render/channelBake";
import {
    hold as holdFor,
    type HoldFamily,
    type HoldState,
} from "@/view3d/core/instruments/holds";
import { poseArms } from "./armPose";
import { gripMatrix } from "./instrumentGeometry";

/** The bake row of a hold (`holdId`). */
export const holdRowName = (holdId: string) => `hold:${holdId}`;

/** The bake row of the transition from one hold state to another. */
export const transitionRowName = (
    family: HoldFamily,
    from: HoldState,
    to: HoldState,
) => `trans:${family}:${from}>${to}`;

/** The arm pose and right-hand grip of a hold, for the bake. */
export function armHold(
    skeleton: THREE.Skeleton,
    family: HoldFamily,
    state: HoldState,
): ArmHold {
    const h = holdFor(family, state);
    const pose = poseArms(skeleton, h);
    return { local: pose.local, grip: gripMatrix(skeleton, pose, h) };
}
