// cspell:ignore hfov
/**
 * The camera rig's state machine (P3.2): an orbit pose around a target plus
 * an optional fly-to tween. It owns no React and no DOM; `CameraRig.tsx`
 * feeds it input and calls `update` once per frame.
 *
 * At a person's seat (`sit`), it also holds a head: in seat view a drag
 * turns it about the fixed eye (`look`) and the wheel zooms the eye's field
 * of view (`seatZoom`), both eased. Any other move or fly leaves the seat.
 */
import { PerspectiveCamera, type Camera, type Vector3Tuple } from "three";
import {
    clampLook,
    clampRadius,
    FLY_MS,
    lookAngles,
    lookDirection,
    LOOK_HALF_LIFE_MS,
    MAX_PAN,
    MAX_RADIUS,
    maxPhiAboveGround,
    MIN_EYE_Y,
    MIN_ZOOM_DISTANCE,
    nearFor,
    orbitPhi,
    ORBIT_PER_PX,
    panTarget,
    positionFromSpherical,
    SEAT_ZOOM_MIN_DEG,
    sphericalFromPose,
    tweenPose,
    zoomRadius,
    ZOOM_PER_WHEEL,
    type Spherical,
    type Tween,
} from "./rigMath";
import { damp, targetOnGround, zoomAbout, zoomRatioLimits } from "./inputMath";
import { SEAT_VIEW_DEFAULTS } from "@/view3d/core/post/seatViewPass";

/** A wheel zoom eases in with this half-life (ms): quick, but not a jump. */
export const ZOOM_HALF_LIFE_MS = 45;
/** A flung orbit coasts down with this half-life (ms). */
export const FLING_HALF_LIFE_MS = 120;
/** Drag movement within this window (ms) before release sets the fling speed. */
export const FLING_WINDOW_MS = 80;
/** Coasting stops below this speed (radians per ms). */
const FLING_STOP = 1e-6;

export interface FlyOptions {
    nowMs: number;
    /** Jump instead of flying (prefers-reduced-motion). */
    instant?: boolean;
    /** Field of view to arrive with; keeps the current one when omitted. */
    fovDeg?: number;
    /** Called once when the camera lands. */
    onArrive?: (position: Vector3Tuple) => void;
}

/** Head turns smaller than this (radians) count as arrived. */
const LOOK_STOP = 1e-4;

/** The head at a seat: a fixed eye, turned and zoomed, each easing to its goal. */
interface Head {
    eye: Vector3Tuple;
    /** The seat's facing (azimuth from +Z toward +X); yaw is measured from it. */
    facing: number;
    /** How far ahead the look-at point sits, so leaving the seat orbits about it. */
    distance: number;
    yaw: number;
    pitch: number;
    goalYaw: number;
    goalPitch: number;
    /** Seat view's horizontal field of view, degrees. */
    fov: number;
    goalFov: number;
}

interface ActiveTween {
    tween: Tween;
    startMs: number;
    fromFov: number;
    toFov: number;
    onArrive?: (position: Vector3Tuple) => void;
    /** The look-at point at the last update, so a new fly starts from it. */
    currentTarget: Vector3Tuple;
}

export class RigController {
    target: Vector3Tuple = [0, 0, 0];
    spherical: Spherical = { radius: 100, phi: 1, theta: 0 };
    private active: ActiveTween | null = null;
    private lastUpdateMs: number | null = null;
    /** Wheel zoom still to apply, as a log of the radius ratio. */
    private pendingZoom = 0;
    private zoomAnchor: Vector3Tuple | null = null;
    /** Coasting orbit speed, radians per ms. */
    private velocity = { theta: 0, phi: 0 };
    /** Recent drag steps, for the fling speed on release. */
    private samples: { t: number; theta: number; phi: number }[] = [];
    private head: Head | null = null;

    constructor(private readonly camera: Camera) {}

    /** True while the view is at a person's seat (`sit`), until it moves away. */
    get seated(): boolean {
        return this.head !== null;
    }

    /** Seat view's horizontal field of view at this seat now (degrees), eased. */
    get seatFovDeg(): number {
        return this.head?.fov ?? SEAT_VIEW_DEFAULTS.hfovDeg;
    }

    /** The head's turn from the seat's facing and its pitch from level, radians; null when not seated. */
    get look(): { yaw: number; pitch: number } | null {
        return this.head
            ? { yaw: this.head.yaw, pitch: this.head.pitch }
            : null;
    }

    /**
     * Sits at `eye` facing `target`: the head starts looking there, at seat
     * view's widest field of view. Ends any fly-to.
     */
    sit(eye: Vector3Tuple, target: Vector3Tuple) {
        this.active = null;
        this.stopMotion();
        const { azimuth, pitch } = lookAngles(eye, target);
        const start = clampLook(0, pitch).pitch;
        const fov = SEAT_VIEW_DEFAULTS.hfovDeg;
        this.head = {
            eye: [...eye],
            facing: azimuth,
            distance: Math.max(
                1,
                Math.hypot(
                    target[0] - eye[0],
                    target[1] - eye[1],
                    target[2] - eye[2],
                ),
            ),
            yaw: 0,
            pitch: start,
            goalYaw: 0,
            goalPitch: start,
            fov,
            goalFov: fov,
        };
        this.apply();
    }

    /**
     * Turns the head by `dYaw` and `dPitch` radians (positive turns left and
     * up), within the limits; it eases there. False when not seated or
     * while flying.
     */
    lookBy(dYaw: number, dPitch: number): boolean {
        const h = this.head;
        if (!h || this.active) return false;
        const next = clampLook(h.goalYaw + dYaw, h.goalPitch + dPitch);
        h.goalYaw = next.yaw;
        h.goalPitch = next.pitch;
        return true;
    }

    /**
     * Turns the head to face `point`, within the limits; it eases there.
     * False when not seated or while flying.
     */
    turnHeadTo(point: Vector3Tuple): boolean {
        const h = this.head;
        if (!h || this.active) return false;
        const { azimuth, pitch } = lookAngles(h.eye, point);
        // The shorter way round from the seat's facing.
        const yaw = Math.atan2(
            Math.sin(azimuth - h.facing),
            Math.cos(azimuth - h.facing),
        );
        const next = clampLook(yaw, pitch);
        h.goalYaw = next.yaw;
        h.goalPitch = next.pitch;
        return true;
    }

    /**
     * Zooms seat view by `ratio` (new field of view over old), between
     * `SEAT_ZOOM_MIN_DEG` and seat view's widest. False when not seated or
     * while flying.
     */
    seatZoom(ratio: number): boolean {
        const h = this.head;
        if (!h || this.active) return false;
        h.goalFov = Math.min(
            SEAT_VIEW_DEFAULTS.hfovDeg,
            Math.max(SEAT_ZOOM_MIN_DEG, h.goalFov * ratio),
        );
        return true;
    }

    get flying(): boolean {
        return this.active !== null;
    }

    /** The point the camera looks at now, mid-flight included. */
    get lookAt(): Vector3Tuple {
        return [...(this.active ? this.active.currentTarget : this.target)];
    }

    /** True while the camera moves on its own: a fly-to, an easing zoom, a coasting orbit. */
    get moving(): boolean {
        const h = this.head;
        return (
            this.active !== null ||
            (h !== null &&
                (h.goalYaw !== h.yaw ||
                    h.goalPitch !== h.pitch ||
                    h.goalFov !== h.fov)) ||
            this.pendingZoom !== 0 ||
            this.velocity.theta !== 0 ||
            this.velocity.phi !== 0
        );
    }

    /** Places the camera at once and makes the pose the orbit state. */
    jumpTo(position: Vector3Tuple, target: Vector3Tuple, fovDeg?: number) {
        this.active = null;
        this.head = null;
        this.stopMotion();
        this.setPose(position, target);
        if (fovDeg !== undefined) this.setFov(fovDeg);
        this.apply();
    }

    /** Starts a fly-to from wherever the camera is now. */
    flyTo(position: Vector3Tuple, target: Vector3Tuple, options: FlyOptions) {
        this.stopMotion();
        this.head = null;
        const p = this.camera.position;
        const fromFov = this.fov();
        this.active = {
            tween: {
                fromPosition: [p.x, p.y, p.z],
                fromTarget: this.active
                    ? [...this.active.currentTarget]
                    : [...this.target],
                toPosition: [...position],
                toTarget: [...target],
                durationMs: options.instant ? 0 : FLY_MS,
            },
            startMs: options.nowMs,
            fromFov,
            toFov: options.fovDeg ?? fromFov,
            onArrive: options.onArrive,
            currentTarget: [...this.target],
        };
    }

    /** Stops a fly-to where it is. */
    cancelFly() {
        if (!this.active) return;
        const p = this.camera.position;
        this.setPose([p.x, p.y, p.z], this.active.currentTarget);
        this.active = null;
    }

    /** Drag orbit. Returns false while flying (input is ignored then). */
    orbit(dxPx: number, dyPx: number): boolean {
        if (this.active) return false;
        this.head = null;
        const s = this.spherical;
        s.theta -= dxPx * ORBIT_PER_PX;
        s.phi = orbitPhi(
            s.phi,
            -dyPx * ORBIT_PER_PX,
            maxPhiAboveGround(s.radius, this.target[1]),
        );
        return true;
    }

    /** Drag pan in the ground plane. */
    pan(dxPx: number, dyPx: number, focus: Vector3Tuple): boolean {
        if (this.active) return false;
        this.head = null;
        this.target = panTarget(this.target, this.spherical, dxPx, dyPx, focus);
        return true;
    }

    /** Wheel zoom (`deltaY` in pixels). */
    zoomWheel(deltaY: number): boolean {
        if (this.active) return false;
        this.head = null;
        this.setRadius(zoomRadius(this.spherical.radius, deltaY));
        return true;
    }

    /** Pinch zoom: `ratio` is old finger distance over new. */
    zoomRatio(ratio: number): boolean {
        if (this.active) return false;
        this.head = null;
        this.setRadius(clampRadius(this.spherical.radius * ratio));
        return true;
    }

    /**
     * Wheel zoom toward `point` (what's under the cursor), eased over a few
     * frames by `update`. `pixels` is the wheel's deltaY in pixels.
     */
    zoomWheelAt(
        pixels: number,
        point: Vector3Tuple | null,
        nowMs: number,
    ): boolean {
        if (this.active) return false;
        this.head = null;
        void nowMs;
        this.pendingZoom += pixels * ZOOM_PER_WHEEL;
        this.zoomAnchor = point ? [...point] : null;
        return true;
    }

    /** Pinch zoom toward `point`: `ratio` is the new radius over the old. */
    zoomRatioAt(ratio: number, point: Vector3Tuple | null): boolean {
        if (this.active) return false;
        this.head = null;
        this.zoomBy(ratio, point);
        return true;
    }

    /** Drag orbit that remembers its speed, so `release` can fling it. */
    orbitDrag(dxPx: number, dyPx: number, nowMs: number): boolean {
        if (!this.orbit(dxPx, dyPx)) return false;
        this.velocity = { theta: 0, phi: 0 };
        this.samples.push({
            t: nowMs,
            theta: -dxPx * ORBIT_PER_PX,
            phi: -dyPx * ORBIT_PER_PX,
        });
        while (
            this.samples.length &&
            nowMs - this.samples[0].t > FLING_WINDOW_MS
        )
            this.samples.shift();
        return true;
    }

    /** The drag ended: coast at the speed of its last moments, if it was still moving. */
    release(nowMs: number) {
        const recent = this.samples.filter(
            (s) => nowMs - s.t <= FLING_WINDOW_MS,
        );
        this.samples = [];
        if (recent.length === 0 || this.active) return;
        // the first step covers the frame before its own timestamp
        const span = Math.max(16, nowMs - recent[0].t + 16);
        this.velocity = {
            theta: recent.reduce((n, s) => n + s.theta, 0) / span,
            phi: recent.reduce((n, s) => n + s.phi, 0) / span,
        };
    }

    /** Places the camera at the current orbit pose now, between frames (for raycasts). */
    sync() {
        if (!this.active) this.apply();
    }

    /** Stops coasting (a new press catches the camera). */
    stopMotion() {
        this.velocity = { theta: 0, phi: 0 };
        this.samples = [];
    }

    /**
     * Grab pan: the ground point that was under the pointer (`from`) moves
     * to where the pointer is now (`to`) by moving the target the other way.
     */
    grabPan(
        from: Vector3Tuple,
        to: Vector3Tuple,
        focus: Vector3Tuple,
    ): boolean {
        if (this.active) return false;
        this.head = null;
        let x = this.target[0] + from[0] - to[0];
        let z = this.target[2] + from[2] - to[2];
        const ox = x - focus[0];
        const oz = z - focus[2];
        const d = Math.hypot(ox, oz);
        if (d > MAX_PAN) {
            x = focus[0] + (ox / d) * MAX_PAN;
            z = focus[2] + (oz / d) * MAX_PAN;
        }
        this.target = [x, this.target[1], z];
        return true;
    }

    /** Moves the camera for this frame: the tween, or the orbit pose. */
    update(nowMs: number) {
        const dt =
            this.lastUpdateMs === null
                ? 0
                : Math.max(0, nowMs - this.lastUpdateMs);
        this.lastUpdateMs = nowMs;
        const a = this.active;
        if (a) {
            const pose = tweenPose(a.tween, nowMs - a.startMs);
            a.currentTarget = pose.target;
            this.camera.position.set(...pose.position);
            this.camera.lookAt(...pose.target);
            const u =
                a.tween.durationMs > 0
                    ? Math.min(1, (nowMs - a.startMs) / a.tween.durationMs)
                    : 1;
            this.setFov(a.fromFov + (a.toFov - a.fromFov) * u);
            if (pose.done) {
                this.active = null;
                this.setPose(pose.position, pose.target);
                this.apply();
                a.onArrive?.(pose.position);
            }
            this.camera.updateMatrixWorld();
            return;
        }
        if (this.head) this.easeHead(dt);
        else this.ease(dt);
        this.apply();
    }

    /** Eases the head's turn and zoom toward their goals. */
    private easeHead(dt: number) {
        const h = this.head!;
        const toward = (value: number, goal: number, stop: number) => {
            const left = damp(goal - value, dt, LOOK_HALF_LIFE_MS);
            return Math.abs(left) < stop ? goal : goal - left;
        };
        h.yaw = toward(h.yaw, h.goalYaw, LOOK_STOP);
        h.pitch = toward(h.pitch, h.goalPitch, LOOK_STOP);
        h.fov = toward(h.fov, h.goalFov, 0.01);
    }

    /** Applies this frame's share of the eased wheel zoom and the coasting orbit. */
    private ease(dt: number) {
        if (this.pendingZoom !== 0 && dt > 0) {
            let remaining = damp(this.pendingZoom, dt, ZOOM_HALF_LIFE_MS);
            if (Math.abs(remaining) < 1e-4) remaining = 0;
            const step = this.pendingZoom - remaining;
            this.pendingZoom = remaining;
            const before = this.spherical.radius;
            this.zoomBy(Math.exp(step), this.zoomAnchor);
            // at a limit the rest of the step would do nothing: drop it
            if (this.spherical.radius === before) this.pendingZoom = 0;
            if (this.pendingZoom === 0) this.zoomAnchor = null;
        }
        const v = this.velocity;
        if ((v.theta !== 0 || v.phi !== 0) && dt > 0) {
            // the distance a decaying speed covers over dt
            const k =
                (FLING_HALF_LIFE_MS / Math.LN2) *
                (1 - Math.pow(0.5, dt / FLING_HALF_LIFE_MS));
            const s = this.spherical;
            s.theta += v.theta * k;
            s.phi = orbitPhi(
                s.phi,
                v.phi * k,
                maxPhiAboveGround(s.radius, this.target[1]),
            );
            v.theta = damp(v.theta, dt, FLING_HALF_LIFE_MS);
            v.phi = damp(v.phi, dt, FLING_HALF_LIFE_MS);
            if (Math.abs(v.theta) < FLING_STOP && Math.abs(v.phi) < FLING_STOP)
                this.velocity = { theta: 0, phi: 0 };
        }
    }

    /**
     * Zooms by `ratio` (new distance over old). With a `point` (the one
     * under the cursor), the camera and the orbit target scale about it, as
     * CAD tools zoom: the view keeps its angle and the point stays where it
     * is on screen, the zoom stopping `MIN_ZOOM_DISTANCE` short of it, with
     * the eye above the ground and within `MAX_RADIUS` of the target.
     *
     * Zooming out about a point above the target (a marcher, a seat) lowers
     * the target: it slides back up the line of sight to the ground, which
     * doesn't change the view, unless that would bring it nearer than before. About a point above the eye, it lowers the
     * eye too: once the eye would reach `MIN_EYE_Y`, the rest of the zoom
     * goes straight back from the target.
     */
    private zoomBy(ratio: number, point: Vector3Tuple | null) {
        if (!point) {
            this.setRadius(clampRadius(this.spherical.radius * ratio));
            return;
        }
        const position = positionFromSpherical(this.spherical, this.target);
        const [lo, hi] = zoomRatioLimits(position, this.target, point, {
            minDistance: MIN_ZOOM_DISTANCE,
            minEyeY: MIN_EYE_Y,
            maxRadius: MAX_RADIUS,
        });
        const k = Math.min(hi, Math.max(lo, ratio));
        if (k !== 1) {
            const next = zoomAbout(position, this.target, point, k);
            const lifted = targetOnGround(next.position, next.target);
            // Seen at a shallow angle, the ground meets the line of sight
            // close to the eye: keep the sunken target rather than pull the
            // orbit center in.
            const lift =
                k > 1 &&
                Math.hypot(
                    lifted[0] - next.position[0],
                    lifted[1] - next.position[1],
                    lifted[2] - next.position[2],
                ) >= this.spherical.radius;
            this.setPose(next.position, lift ? lifted : next.target);
        }
        if (ratio > k && k >= 1)
            this.setRadius(clampRadius(this.spherical.radius * (ratio / k)));
    }

    private setRadius(radius: number) {
        const s = this.spherical;
        s.radius = radius;
        // Zooming out can push a camera that looks up under the ground.
        if (this.eyeY() < MIN_EYE_Y)
            s.phi = Math.min(
                s.phi,
                maxPhiAboveGround(s.radius, this.target[1]),
            );
    }

    private eyeY(): number {
        return positionFromSpherical(this.spherical, this.target)[1];
    }

    private setPose(position: Vector3Tuple, target: Vector3Tuple) {
        this.target = [...target];
        this.spherical = sphericalFromPose(position, target);
    }

    private apply() {
        const h = this.head;
        if (h) {
            // The eye stays put; the look-at point keeps the orbit state in
            // step, so leaving the seat orbits about what the head faced.
            const dir = lookDirection(h.facing + h.yaw, h.pitch);
            const target: Vector3Tuple = [
                h.eye[0] + dir[0] * h.distance,
                h.eye[1] + dir[1] * h.distance,
                h.eye[2] + dir[2] * h.distance,
            ];
            this.setPose(h.eye, target);
            this.camera.position.set(...h.eye);
            this.camera.lookAt(...target);
            this.camera.updateMatrixWorld();
            this.setNear(nearFor(h.distance));
            return;
        }
        const pos = positionFromSpherical(this.spherical, this.target);
        this.camera.position.set(...pos);
        this.camera.lookAt(...this.target);
        this.camera.updateMatrixWorld();
        this.setNear(nearFor(this.spherical.radius));
    }

    private setNear(near: number) {
        if (!(this.camera instanceof PerspectiveCamera)) return;
        if (Math.abs(this.camera.near - near) < 1e-6) return;
        this.camera.near = near;
        this.camera.updateProjectionMatrix();
    }

    private fov(): number {
        return this.camera instanceof PerspectiveCamera ? this.camera.fov : 45;
    }

    private setFov(fov: number) {
        if (!(this.camera instanceof PerspectiveCamera)) return;
        if (Math.abs(this.camera.fov - fov) < 1e-6) return;
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
    }
}
