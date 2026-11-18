/**
 * Moves the camera with a followed performer (`followStore.ts`). It owns no
 * React and no DOM; `CameraRig.tsx` tells it when the store changes, feeds it
 * point-of-view input, and calls `apply` every frame and again whenever the
 * performers move (`performerTrack.ts`).
 *
 * - Third person: the camera flies behind the performer, then the whole
 *   orbit moves with them, so the viewer's orbit and zoom carry on around
 *   them. With `turnWithPerformer`, the orbit also swings round as they turn
 *   (eased), keeping the angle the viewer orbited to, like a game's camera.
 * - Point of view: the camera flies into their eyes, then looks where they
 *   face, turning with them, offset by where the viewer has looked (drag) and
 *   zoomed (field of view). With `showOwnBody` the eye sits inside their head
 *   and their arms and instrument show in front; without, their body is left
 *   out of the picture.
 * - Back out of the point of view: the camera flies out behind them and a
 *   left-out body comes back once it has.
 */
import type { Camera, Vector3Tuple } from "three";
import { ORBIT_PER_PX, SEAT_FOV_DEG, ZOOM_PER_WHEEL } from "./rigMath";
import type { RigController } from "./rigController";
import {
    angleDelta,
    clampPitch,
    easeAngle,
    POV_DEFAULT_PITCH,
    POV_FOV_DEG,
    POV_FOV_MAX,
    POV_FOV_MIN,
    povPose,
    thirdPersonPose,
    type PerformerPose,
    type PovLook,
} from "./followMath";
import type { Follow } from "./followStore";

/** The point of view turns with the performer with this half-life (ms). */
export const POV_TURN_HALF_LIFE_MS = 150;
/** The third-person camera swings round behind a turning performer with this half-life (ms). */
export const CHASE_TURN_HALF_LIFE_MS = 300;
/**
 * The longest step a turn eases by in one frame (ms), so a frame drawn after
 * a pause carries on the turn instead of finishing it in one jump.
 */
export const MAX_EASE_STEP_MS = 100;
/** A turn this close to the performer's heading (radians) has finished. */
const TURN_DONE = 1e-3;

export interface FollowHooks {
    /** Where the performer stands now; false when they aren't drawn. */
    poseInto: (marcherId: number, out: PerformerPose) => boolean;
    /** Whose body to leave out of the picture, or null. */
    setHidden: (marcherId: number | null) => void;
    /** True when the viewer prefers reduced motion: jump instead of flying. */
    instant: () => boolean;
    /** Whether the third-person camera swings round as the performer turns. */
    turnWithPerformer: () => boolean;
    /** Whether the point of view shows the performer's own arms and instrument. */
    showOwnBody: () => boolean;
}

export class FollowController {
    /** Who the camera follows now, as last applied; null for nobody. */
    private following: Follow | null = null;
    /** The performer's spot at the last `apply`, which the view moves on from. */
    private anchor: Vector3Tuple | null = null;
    /** True once the camera has landed in the performer's eyes. */
    private inEyes = false;
    private look: PovLook = { yaw: 0, pitch: POV_DEFAULT_PITCH };
    private fovDeg = POV_FOV_DEG;
    private heading = Number.NaN;
    /** The heading the third-person orbit is turned to, eased toward the performer's. */
    private chase = Number.NaN;
    private lastMs: number | null = null;
    /** Changes with every move, so a stale landing does nothing. */
    private generation = 0;
    private readonly pose: PerformerPose = {
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        height: 0,
        eye: [0, 0, 0],
        hasEye: false,
    };

    constructor(
        private readonly rig: RigController,
        private readonly camera: Camera,
        private readonly hooks: FollowHooks,
    ) {}

    /** True while following someone. */
    get active(): boolean {
        return this.following !== null;
    }

    /** True while looking out of a performer's eyes, landed or on the way. */
    get pov(): boolean {
        return this.following?.mode === "pov";
    }

    /**
     * True while the view is still turning toward where the performer faces,
     * so the window keeps drawing until the turn finishes.
     */
    get easing(): boolean {
        const following = this.following;
        if (!following) return false;
        const facing = this.pose.heading;
        if (following.mode === "pov")
            return (
                this.inEyes &&
                Math.abs(angleDelta(this.heading, facing)) > TURN_DONE
            );
        return (
            this.hooks.turnWithPerformer() &&
            !this.rig.flying &&
            Math.abs(angleDelta(this.chase, facing)) > TURN_DONE
        );
    }

    /**
     * Stops following without moving the camera, for something else that
     * takes it over (a seat, a camera, the Director, a new venue).
     */
    release() {
        this.generation++;
        this.following = null;
        this.anchor = null;
        this.inEyes = false;
        this.hooks.setHidden(null);
    }

    /**
     * Goes to `next` from whatever it follows now. False when the performer
     * isn't drawn, so there is nobody to fly to.
     */
    change(next: Follow | null, nowMs: number): boolean {
        const prev = this.following;
        if (prev?.marcherId === next?.marcherId && prev?.mode === next?.mode)
            return true;
        const generation = ++this.generation;
        const pose = this.pose;
        const found =
            next !== null && this.hooks.poseInto(next.marcherId, pose);
        if (next === null || !found) {
            const wasPov = prev?.mode === "pov";
            this.following = null;
            this.anchor = null;
            this.inEyes = false;
            // Out of someone's eyes, back up behind them before the body
            // comes back.
            if (wasPov && prev && this.hooks.poseInto(prev.marcherId, pose)) {
                const view = thirdPersonPose(pose);
                this.rig.flyTo(view.position, view.target, {
                    nowMs,
                    instant: this.hooks.instant(),
                    fovDeg: SEAT_FOV_DEG,
                    onArrive: () => {
                        if (generation === this.generation)
                            this.hooks.setHidden(null);
                    },
                });
            } else this.hooks.setHidden(null);
            return next === null;
        }

        this.following = next;
        this.anchor = [pose.x, pose.y, pose.z];
        this.inEyes = false;
        this.lastMs = null;
        if (next.mode === "pov") {
            this.look = { yaw: 0, pitch: POV_DEFAULT_PITCH };
            this.fovDeg = POV_FOV_DEG;
            this.heading = pose.heading;
            this.hideForEyes(next.marcherId);
            const view = povPose(pose, this.look, this.hooks.showOwnBody());
            this.rig.flyTo(view.position, view.target, {
                nowMs,
                instant: this.hooks.instant(),
                fovDeg: this.fovDeg,
                onArrive: () => {
                    if (generation === this.generation) this.inEyes = true;
                },
            });
            return true;
        }
        this.chase = pose.heading;
        // Out of anyone's eyes, a body left out comes back once the camera
        // is out of their head.
        const leavingEyes = prev?.mode === "pov";
        if (!leavingEyes) this.hooks.setHidden(null);
        const view = thirdPersonPose(pose);
        this.rig.flyTo(view.position, view.target, {
            nowMs,
            instant: this.hooks.instant(),
            fovDeg: SEAT_FOV_DEG,
            onArrive: () => {
                if (leavingEyes && generation === this.generation)
                    this.hooks.setHidden(null);
            },
        });
        return true;
    }

    /**
     * Keeps the view on the performer for this frame. Call it every frame
     * before the rig's own update, and again after the performers move.
     */
    apply(nowMs: number) {
        const following = this.following;
        if (!following) return;
        const pose = this.pose;
        if (!this.hooks.poseInto(following.marcherId, pose)) return;
        const dt =
            this.lastMs === null
                ? 0
                : Math.min(MAX_EASE_STEP_MS, Math.max(0, nowMs - this.lastMs));
        this.lastMs = nowMs;
        if (following.mode === "pov") this.hideForEyes(following.marcherId);
        if (this.inEyes) {
            this.heading = easeAngle(
                this.heading,
                pose.heading,
                dt,
                POV_TURN_HALF_LIFE_MS,
            );
            this.place();
            return;
        }
        const anchor = this.anchor;
        if (anchor) {
            this.rig.shift(
                pose.x - anchor[0],
                pose.y - anchor[1],
                pose.z - anchor[2],
            );
            anchor[0] = pose.x;
            anchor[1] = pose.y;
            anchor[2] = pose.z;
        }
        // On the way into the eyes, the view keeps the heading it set out
        // for; after landing it turns to where they face now.
        if (following.mode !== "third") return;
        if (!this.hooks.turnWithPerformer()) {
            this.chase = pose.heading;
        } else if (!this.rig.flying) {
            // In flight the orbit keeps the heading it set out for; after
            // landing it swings round to where they face now.
            const next = easeAngle(
                this.chase,
                pose.heading,
                dt,
                CHASE_TURN_HALF_LIFE_MS,
            );
            this.rig.turn(angleDelta(this.chase, next));
            this.chase = next;
        }
    }

    /**
     * A drag in the point of view, by pixels: grabs the world, so dragging
     * right looks left and dragging down looks up. False before the camera
     * has landed in the performer's eyes.
     */
    lookDrag(dxPx: number, dyPx: number): boolean {
        if (!this.inEyes) return false;
        this.look.yaw += dxPx * ORBIT_PER_PX;
        this.look.pitch = clampPitch(this.look.pitch + dyPx * ORBIT_PER_PX);
        this.place();
        return true;
    }

    /** Zooms the point of view: `ratio` multiplies the field of view. */
    zoomRatio(ratio: number): boolean {
        if (!this.inEyes) return false;
        this.fovDeg = Math.max(
            POV_FOV_MIN,
            Math.min(POV_FOV_MAX, this.fovDeg * ratio),
        );
        this.place();
        return true;
    }

    /** Zooms the point of view by a wheel's deltaY in pixels. */
    zoomWheel(pixels: number): boolean {
        return this.zoomRatio(Math.exp(pixels * ZOOM_PER_WHEEL));
    }

    /** Leaves the performer's body out of the point of view, unless the viewer wants it. */
    private hideForEyes(marcherId: number) {
        this.hooks.setHidden(this.hooks.showOwnBody() ? null : marcherId);
    }

    /** Puts the camera in the performer's eyes, from the last pose read. */
    private place() {
        const view = povPose(
            { ...this.pose, heading: this.heading },
            this.look,
            this.hooks.showOwnBody(),
        );
        this.rig.jumpTo(view.position, view.target, this.fovDeg);
        this.camera.updateMatrixWorld();
    }
}
