/**
 * Arm poses for carrying an instrument (docs/3d/instruments.md §5), as
 * target points in the body's rest frame: where the elbow and wrist go and
 * which way the fingers point, for each arm, plus where the instrument sits.
 * `armPose.ts` aims the bones at these. The wrists and the "elbow out"
 * direction come from the owner's reference photos; each elbow is then the
 * point 0.205 m from the shoulder and 0.264 m from the wrist nearest that
 * direction (the arm's bone lengths), so every target is reachable. Tune
 * them here, nowhere else.
 *
 * Frame: meters, +X the performer's left, +Y up, +Z forward. Landmarks
 * (class 1.00): shoulders at (±0.185, 1.397), chest front z 0.12, chin
 * y 1.52, eye line y 1.62. Upper arm 0.205 m, forearm 0.264 m.
 * Pure: no three.js.
 */
import type { Vec3 } from "./mesh";

export type HoldState = "up" | "carry" | "trail";
export const HOLD_STATES: readonly HoldState[] = ["up", "carry", "trail"];
export type HoldFamily = "brass" | "trombone" | "contra";

export interface ArmTargets {
    elbow: Vec3;
    wrist: Vec3;
    /** Unit vector: the hand bone's +Y, wrist toward the fingertips. */
    fingers: Vec3;
}

export interface Hold {
    family: HoldFamily;
    state: HoldState;
    right: ArmTargets;
    left: ArmTargets;
    instrument: { origin: Vec3; bellAxis: Vec3; capsAxis: Vec3 };
}

export const holdId = (family: HoldFamily, state: HoldState) =>
    `${family}:${state}`;

const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

/** The brass triangle: elbows out, forearms up and in, hands at the valves. */
const BRASS: Record<HoldState, Hold> = {
    up: {
        family: "brass",
        state: "up",
        right: {
            elbow: [-0.278, 1.438, 0.173],
            wrist: [-0.06, 1.56, 0.26],
            fingers: unit([0.3, 0.2, 0.1]),
        },
        left: {
            elbow: [0.292, 1.419, 0.169],
            wrist: [0.05, 1.52, 0.2],
            fingers: unit([-0.3, 0.3, 0.15]),
        },
        instrument: {
            origin: [-0.02, 1.56, 0.3],
            bellAxis: [0, 0, 1],
            capsAxis: [0, 1, 0],
        },
    },
    carry: {
        family: "brass",
        state: "carry",
        // vertical in front of the torso, bell to the ground, mouthpiece at eye level
        right: {
            elbow: [-0.216, 1.305, 0.176],
            wrist: [-0.05, 1.5, 0.24],
            fingers: unit([0.3, 0.1, 0.0]),
        },
        left: {
            elbow: [0.224, 1.273, 0.154],
            wrist: [0.05, 1.46, 0.22],
            fingers: unit([-0.3, 0.2, 0.0]),
        },
        instrument: {
            origin: [0, 1.5, 0.26],
            bellAxis: [0, -1, 0],
            capsAxis: [0, 0, 1],
        },
    },
    trail: {
        family: "brass",
        state: "trail",
        // right arm straight down the side, bell back; left fist at the leg
        right: {
            elbow: [-0.237, 1.202, -0.041],
            wrist: [-0.27, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.27, 0.9, 0.03],
            bellAxis: [0, 0, -1],
            capsAxis: [-1, 0, 0],
        },
    },
};

/** Trombone: right hand on the slide brace, left at the bell brace; only `up` differs. */
const TROMBONE: Record<HoldState, Hold> = {
    up: {
        family: "trombone",
        state: "up",
        right: {
            elbow: [-0.21, 1.448, 0.192],
            wrist: [-0.04, 1.56, 0.36],
            fingers: unit([0.3, 0.1, 0.2]),
        },
        left: {
            elbow: [0.289, 1.441, 0.166],
            wrist: [0.06, 1.56, 0.22],
            fingers: unit([-0.3, 0.2, 0.1]),
        },
        instrument: {
            origin: [-0.02, 1.56, 0.38],
            bellAxis: [0, 0, 1],
            capsAxis: [0, 1, 0],
        },
    },
    carry: { ...BRASS.carry, family: "trombone" },
    trail: { ...BRASS.trail, family: "trombone" },
};

/**
 * Contra: the loop lies along the left shoulder behind the bell, its plane
 * outside the head (x 0.17 against a head half-width of about 0.1), the
 * bottom tube resting on the shoulder. The valves sit at chin height in
 * front, left of center: the right hand reaches across to them, the left
 * supports the bottom tube at the front.
 */
const CONTRA_UP: Hold = {
    family: "contra",
    state: "up",
    right: {
        elbow: [-0.119, 1.513, 0.151],
        wrist: [0.13, 1.6, 0.14],
        fingers: unit([0.3, 0.1, 0.0]),
    },
    left: {
        elbow: [0.334, 1.258, -0.026],
        wrist: [0.26, 1.44, 0.15],
        fingers: unit([-0.2, 0.3, 0.3]),
    },
    instrument: {
        origin: [0.15, 1.6, 0.12],
        bellAxis: [0, 0, 1],
        capsAxis: [0, 1, 0],
    },
};
const CONTRA: Record<HoldState, Hold> = {
    up: CONTRA_UP,
    carry: { ...CONTRA_UP, state: "carry" },
    trail: { ...CONTRA_UP, state: "trail" },
};

const TABLE: Record<HoldFamily, Record<HoldState, Hold>> = {
    brass: BRASS,
    trombone: TROMBONE,
    contra: CONTRA,
};

export function hold(family: HoldFamily, state: HoldState): Hold {
    return TABLE[family][state];
}
