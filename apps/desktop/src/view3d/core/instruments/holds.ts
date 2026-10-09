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
export type HoldFamily =
    | "brass"
    | "trombone"
    | "contra"
    | "flute"
    | "piccolo"
    | "clarinet"
    | "sax"
    | "snare"
    | "tenors"
    | "bass"
    | "cymbals"
    | "flag"
    | "rifle"
    | "sabre";

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

const FLUTE: Record<HoldState, Hold> = {
    up: {
        family: "flute",
        state: "up",
        // horizontal to the right, lips at the head joint, keys toward the front
        right: {
            elbow: [-0.317, 1.249, 0.048],
            wrist: [-0.42, 1.42, 0.22],
            fingers: unit([-1, -0.2, 0]),
        },
        left: {
            elbow: [0.107, 1.404, 0.184],
            wrist: [-0.13, 1.52, 0.2],
            fingers: unit([-1, -0.1, 0]),
        },
        instrument: {
            origin: [0, 1.56, 0.12],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
    carry: {
        family: "flute",
        state: "carry",
        // the head joint raised: the embouchure hole at eye level
        right: {
            elbow: [-0.336, 1.28, 0.07],
            wrist: [-0.42, 1.48, 0.22],
            fingers: unit([-1, -0.2, 0]),
        },
        left: {
            elbow: [0.103, 1.46, 0.172],
            wrist: [-0.13, 1.58, 0.2],
            fingers: unit([-1, -0.1, 0]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
    trail: {
        family: "flute",
        state: "trail",
        // the head joint raised: the embouchure hole at eye level
        right: {
            elbow: [-0.336, 1.28, 0.07],
            wrist: [-0.42, 1.48, 0.22],
            fingers: unit([-1, -0.2, 0]),
        },
        left: {
            elbow: [0.103, 1.46, 0.172],
            wrist: [-0.13, 1.58, 0.2],
            fingers: unit([-1, -0.1, 0]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
};

/**
 * Piccolo: the flute's hold with the right hand brought in to the short
 * body (0.32 m against the flute's 0.67), so it holds the tube rather than
 * the air past its end.
 */
const PICCOLO: Record<HoldState, Hold> = {
    up: {
        ...FLUTE.up,
        family: "piccolo",
        right: {
            elbow: [-0.311, 1.241, 0.039],
            wrist: [-0.232, 1.449, 0.181],
            fingers: unit([-1, -0.2, 0]),
        },
    },
    carry: {
        ...FLUTE.carry,
        family: "piccolo",
        right: {
            elbow: [-0.321, 1.277, 0.091],
            wrist: [-0.232, 1.509, 0.181],
            fingers: unit([-1, -0.2, 0]),
        },
    },
    trail: {
        ...FLUTE.trail,
        family: "piccolo",
        right: {
            elbow: [-0.321, 1.277, 0.091],
            wrist: [-0.232, 1.509, 0.181],
            fingers: unit([-1, -0.2, 0]),
        },
    },
};

const CLARINET: Record<HoldState, Hold> = {
    up: {
        family: "clarinet",
        state: "up",
        // down the center line, angled 30 degrees out; left hand upper joint, right hand lower
        right: {
            elbow: [-0.152, 1.261, 0.145],
            wrist: [-0.04, 1.121, 0.339],
            fingers: unit([0, -0.8, 0.5]),
        },
        left: {
            elbow: [0.274, 1.274, 0.132],
            wrist: [0.04, 1.33, 0.24],
            fingers: unit([0, -0.8, 0.5]),
        },
        instrument: {
            origin: [0, 1.52, 0.13],
            bellAxis: [0.0, -0.882, 0.471],
            capsAxis: [0.0, 0.471, 0.882],
        },
    },
    carry: {
        family: "clarinet",
        state: "carry",
        // vertical, ligature at eye level
        right: {
            elbow: [-0.278, 1.239, 0.087],
            wrist: [-0.04, 1.22, 0.2],
            fingers: unit([0, -1, 0]),
        },
        left: {
            elbow: [0.277, 1.312, 0.157],
            wrist: [0.04, 1.42, 0.2],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.0, -1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "clarinet",
        state: "trail",
        // vertical, ligature at eye level
        right: {
            elbow: [-0.278, 1.239, 0.087],
            wrist: [-0.04, 1.22, 0.2],
            fingers: unit([0, -1, 0]),
        },
        left: {
            elbow: [0.277, 1.312, 0.157],
            wrist: [0.04, 1.42, 0.2],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.0, -1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

/**
 * Saxes hang from the neck strap in front of the body: the neck brings the
 * body out in front of the mouth, the body runs straight down to the bow
 * at the stomach, the keys face forward and the bell sits on the player's
 * left of the body tube, its flare opening forward and up. The hands wrap
 * the body from the sides, fingers across the front: left hand on the
 * upper stack, right hand on the lower, elbows out.
 */
const SAX: Record<HoldState, Hold> = {
    up: {
        family: "sax",
        state: "up",
        // in front, straight down to the bow at the stomach; hands wrap from the sides
        right: {
            elbow: [-0.221, 1.223, 0.097],
            wrist: [-0.07, 1.08, 0.26],
            fingers: unit([0.8, -0.1, 0.6]),
        },
        left: {
            elbow: [0.263, 1.236, 0.096],
            wrist: [0.085, 1.15, 0.27],
            fingers: unit([-0.8, -0.1, 0.6]),
        },
        instrument: {
            origin: [0, 1.52, 0.13],
            bellAxis: [0.03, -0.99, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "sax",
        state: "carry",
        // the neck lifts so the ligature sits at eye level; the hands rise with it
        right: {
            elbow: [-0.268, 1.238, 0.095],
            wrist: [-0.07, 1.18, 0.26],
            fingers: unit([0.8, -0.1, 0.6]),
        },
        left: {
            elbow: [0.289, 1.257, 0.103],
            wrist: [0.085, 1.25, 0.27],
            fingers: unit([-0.8, -0.1, 0.6]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.03, -0.99, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "sax",
        state: "trail",
        // the neck lifts so the ligature sits at eye level; the hands rise with it
        right: {
            elbow: [-0.268, 1.238, 0.095],
            wrist: [-0.07, 1.18, 0.26],
            fingers: unit([0.8, -0.1, 0.6]),
        },
        left: {
            elbow: [0.289, 1.257, 0.103],
            wrist: [0.085, 1.25, 0.27],
            fingers: unit([-0.8, -0.1, 0.6]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.03, -0.99, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

const SNARE: Record<HoldState, Hold> = {
    up: {
        family: "snare",
        state: "up",
        // the drum at the waist on the carrier, its shell clear of the belly
        // plate; hands over the back of the head, the sticks angled in and
        // down so the tips meet short of the front rim without crossing
        right: {
            elbow: [-0.338, 1.261, -0.013],
            wrist: [-0.206, 1.14, 0.181],
            fingers: unit([0.512, -0.175, 0.841]),
        },
        left: {
            elbow: [0.338, 1.261, -0.013],
            wrist: [0.206, 1.14, 0.181],
            fingers: unit([-0.512, -0.175, 0.841]),
        },
        instrument: {
            origin: [0, 1.0, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "snare",
        state: "carry",
        // the drum at the waist on the carrier, its shell clear of the belly
        // plate; hands over the back of the head, the sticks angled in and
        // down so the tips meet short of the front rim without crossing
        right: {
            elbow: [-0.338, 1.261, -0.013],
            wrist: [-0.206, 1.14, 0.181],
            fingers: unit([0.512, -0.175, 0.841]),
        },
        left: {
            elbow: [0.338, 1.261, -0.013],
            wrist: [0.206, 1.14, 0.181],
            fingers: unit([-0.512, -0.175, 0.841]),
        },
        instrument: {
            origin: [0, 1.0, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "snare",
        state: "trail",
        // the drum at the waist on the carrier, its shell clear of the belly
        // plate; hands over the back of the head, the sticks angled in and
        // down so the tips meet short of the front rim without crossing
        right: {
            elbow: [-0.338, 1.261, -0.013],
            wrist: [-0.206, 1.14, 0.181],
            fingers: unit([0.512, -0.175, 0.841]),
        },
        left: {
            elbow: [0.338, 1.261, -0.013],
            wrist: [0.206, 1.14, 0.181],
            fingers: unit([-0.512, -0.175, 0.841]),
        },
        instrument: {
            origin: [0, 1.0, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

const TENORS: Record<HoldState, Hold> = {
    up: {
        family: "tenors",
        state: "up",
        // wider than the snare: each hand over the back of one of the two
        // front drums (1 on the left, 2 on the right), its stick reaching in
        // to that drum's head
        right: {
            elbow: [-0.336, 1.266, 0.041],
            wrist: [-0.276, 1.146, 0.268],
            fingers: unit([0.372, -0.255, 0.892]),
        },
        left: {
            elbow: [0.336, 1.266, 0.041],
            wrist: [0.276, 1.146, 0.268],
            fingers: unit([-0.372, -0.255, 0.892]),
        },
        instrument: {
            origin: [0, 0.98, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "tenors",
        state: "carry",
        // wider than the snare: each hand over the back of one of the two
        // front drums (1 on the left, 2 on the right), its stick reaching in
        // to that drum's head
        right: {
            elbow: [-0.336, 1.266, 0.041],
            wrist: [-0.276, 1.146, 0.268],
            fingers: unit([0.372, -0.255, 0.892]),
        },
        left: {
            elbow: [0.336, 1.266, 0.041],
            wrist: [0.276, 1.146, 0.268],
            fingers: unit([-0.372, -0.255, 0.892]),
        },
        instrument: {
            origin: [0, 0.98, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "tenors",
        state: "trail",
        // wider than the snare: each hand over the back of one of the two
        // front drums (1 on the left, 2 on the right), its stick reaching in
        // to that drum's head
        right: {
            elbow: [-0.336, 1.266, 0.041],
            wrist: [-0.276, 1.146, 0.268],
            fingers: unit([0.372, -0.255, 0.892]),
        },
        left: {
            elbow: [0.336, 1.266, 0.041],
            wrist: [0.276, 1.146, 0.268],
            fingers: unit([-0.372, -0.255, 0.892]),
        },
        instrument: {
            origin: [0, 0.98, 0.36],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

const BASS: Record<HoldState, Hold> = {
    up: {
        family: "bass",
        state: "up",
        // the drum sideways on the carrier, arms bent, the hands beside the
        // heads above and behind the drum's middle, mallets angled forward
        // and down; each size hangs where its center is a mallet away
        right: {
            elbow: [-0.292, 1.224, 0.02],
            wrist: [-0.241, 1.333, 0.255],
            fingers: unit([0.08, -0.75, 0.65]),
        },
        left: {
            elbow: [0.292, 1.224, 0.02],
            wrist: [0.241, 1.333, 0.255],
            fingers: unit([-0.08, -0.75, 0.65]),
        },
        instrument: {
            origin: [0, 1.0, 0.34],
            bellAxis: [1.0, 0.0, 0.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
    carry: {
        family: "bass",
        state: "carry",
        // the drum sideways on the carrier, arms bent, the hands beside the
        // heads above and behind the drum's middle, mallets angled forward
        // and down; each size hangs where its center is a mallet away
        right: {
            elbow: [-0.292, 1.224, 0.02],
            wrist: [-0.241, 1.333, 0.255],
            fingers: unit([0.08, -0.75, 0.65]),
        },
        left: {
            elbow: [0.292, 1.224, 0.02],
            wrist: [0.241, 1.333, 0.255],
            fingers: unit([-0.08, -0.75, 0.65]),
        },
        instrument: {
            origin: [0, 1.0, 0.34],
            bellAxis: [1.0, 0.0, 0.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
    trail: {
        family: "bass",
        state: "trail",
        // the drum sideways on the carrier, arms bent, the hands beside the
        // heads above and behind the drum's middle, mallets angled forward
        // and down; each size hangs where its center is a mallet away
        right: {
            elbow: [-0.292, 1.224, 0.02],
            wrist: [-0.241, 1.333, 0.255],
            fingers: unit([0.08, -0.75, 0.65]),
        },
        left: {
            elbow: [0.292, 1.224, 0.02],
            wrist: [0.241, 1.333, 0.255],
            fingers: unit([-0.08, -0.75, 0.65]),
        },
        instrument: {
            origin: [0, 1.0, 0.34],
            bellAxis: [1.0, 0.0, 0.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
};

const CYMBALS: Record<HoldState, Hold> = {
    up: {
        family: "cymbals",
        state: "up",
        // a pair at chest height, plates vertical
        right: {
            elbow: [-0.328, 1.281, 0.084],
            wrist: [-0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        left: {
            elbow: [0.328, 1.281, 0.084],
            wrist: [0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        instrument: {
            origin: [0, 1.2, 0.3],
            bellAxis: [0.0, 0.0, 1.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
    carry: {
        family: "cymbals",
        state: "carry",
        // a pair at chest height, plates vertical
        right: {
            elbow: [-0.328, 1.281, 0.084],
            wrist: [-0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        left: {
            elbow: [0.328, 1.281, 0.084],
            wrist: [0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        instrument: {
            origin: [0, 1.2, 0.3],
            bellAxis: [0.0, 0.0, 1.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
    trail: {
        family: "cymbals",
        state: "trail",
        // a pair at chest height, plates vertical
        right: {
            elbow: [-0.328, 1.281, 0.084],
            wrist: [-0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        left: {
            elbow: [0.328, 1.281, 0.084],
            wrist: [0.2, 1.2, 0.3],
            fingers: unit([0, 0, 1]),
        },
        instrument: {
            origin: [0, 1.2, 0.3],
            bellAxis: [0.0, 0.0, 1.0],
            capsAxis: [0.0, 1.0, 0.0],
        },
    },
};

const FLAG: Record<HoldState, Hold> = {
    up: {
        family: "flag",
        state: "up",
        // present: the pole vertical in front, right hand high, left hand low
        right: {
            elbow: [-0.289, 1.272, 0.12],
            wrist: [-0.08, 1.25, 0.28],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.15, 1.225, 0.101],
            wrist: [0.035, 1.034, 0.242],
            fingers: unit([0, 1, 0]),
        },
        instrument: {
            origin: [-0.08, 1.25, 0.28],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "flag",
        state: "carry",
        // at the right side, pole vertical, left arm down
        right: {
            elbow: [-0.306, 1.233, -0.024],
            wrist: [-0.3, 1.0, 0.1],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.3, 1.0, 0.1],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "flag",
        state: "trail",
        // at the right side, pole vertical, left arm down
        right: {
            elbow: [-0.306, 1.233, -0.024],
            wrist: [-0.3, 1.0, 0.1],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.3, 1.0, 0.1],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

const RIFLE: Record<HoldState, Hold> = {
    up: {
        family: "rifle",
        state: "up",
        // port arms: diagonal across the chest, muzzle up to the left
        right: {
            elbow: [-0.293, 1.268, 0.112],
            wrist: [-0.12, 1.2, 0.3],
            fingers: unit([0.7, 0.7, 0]),
        },
        left: {
            elbow: [0.331, 1.371, 0.136],
            wrist: [0.14, 1.45, 0.3],
            fingers: unit([-0.7, 0.7, 0]),
        },
        instrument: {
            origin: [-0.12, 1.2, 0.3],
            bellAxis: [0.6, 0.8, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "rifle",
        state: "carry",
        // right shoulder arms: the rifle vertical at the right shoulder, left arm down
        right: {
            elbow: [-0.313, 1.299, -0.131],
            wrist: [-0.25, 1.35, 0.12],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.25, 1.35, 0.12],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [1.0, 0.0, 0.0],
        },
    },
    trail: {
        family: "rifle",
        state: "trail",
        // right shoulder arms: the rifle vertical at the right shoulder, left arm down
        right: {
            elbow: [-0.313, 1.299, -0.131],
            wrist: [-0.25, 1.35, 0.12],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.25, 1.35, 0.12],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [1.0, 0.0, 0.0],
        },
    },
};

const SABRE: Record<HoldState, Hold> = {
    up: {
        family: "sabre",
        state: "up",
        // present: the blade vertical in front of the right shoulder
        right: {
            elbow: [-0.301, 1.293, 0.129],
            wrist: [-0.1, 1.3, 0.3],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.1, 1.3, 0.3],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    carry: {
        family: "sabre",
        state: "carry",
        // at the right hip, blade up along the shoulder
        right: {
            elbow: [-0.306, 1.233, -0.024],
            wrist: [-0.3, 1.0, 0.1],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.3, 1.0, 0.1],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
    trail: {
        family: "sabre",
        state: "trail",
        // at the right hip, blade up along the shoulder
        right: {
            elbow: [-0.306, 1.233, -0.024],
            wrist: [-0.3, 1.0, 0.1],
            fingers: unit([0, 1, 0]),
        },
        left: {
            elbow: [0.231, 1.202, -0.047],
            wrist: [0.25, 0.95, 0.03],
            fingers: unit([0, -1, 0]),
        },
        instrument: {
            origin: [-0.3, 1.0, 0.1],
            bellAxis: [0.0, 1.0, 0.0],
            capsAxis: [0.0, 0.0, 1.0],
        },
    },
};

const TABLE: Record<HoldFamily, Record<HoldState, Hold>> = {
    brass: BRASS,
    trombone: TROMBONE,
    contra: CONTRA,
    flute: FLUTE,
    piccolo: PICCOLO,
    clarinet: CLARINET,
    sax: SAX,
    snare: SNARE,
    tenors: TENORS,
    bass: BASS,
    cymbals: CYMBALS,
    flag: FLAG,
    rifle: RIFLE,
    sabre: SABRE,
};

export function hold(family: HoldFamily, state: HoldState): Hold {
    return TABLE[family][state];
}
