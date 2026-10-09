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

/**
 * Flute: horizontal to the player's right at the lips, angled a little
 * forward and down. Both hands sit under the tube, wrists below it, the
 * fingers wrapping up and over onto the keys: the left hand by the face (its
 * forearm across the chest, the elbow in front), the right hand further out
 * with the elbow down and out.
 */
const FLUTE: Record<HoldState, Hold> = {
    up: {
        family: "flute",
        state: "up",
        // horizontal to the right, lips at the head joint, keys toward the front
        right: {
            elbow: [-0.297, 1.225, 0.003],
            wrist: [-0.4, 1.38, 0.19],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.067, 1.352, 0.157],
            wrist: [-0.19, 1.41, 0.15],
            fingers: unit([-0.1, 0.9, 0.42]),
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
            elbow: [-0.324, 1.253, 0.04],
            wrist: [-0.4, 1.44, 0.21],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.059, 1.382, 0.156],
            wrist: [-0.19, 1.47, 0.17],
            fingers: unit([-0.1, 0.9, 0.42]),
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
            elbow: [-0.324, 1.253, 0.04],
            wrist: [-0.4, 1.44, 0.21],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.059, 1.382, 0.156],
            wrist: [-0.19, 1.47, 0.17],
            fingers: unit([-0.1, 0.9, 0.42]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
};

/**
 * Piccolo: the flute's hold with both hands brought in to the short body
 * (0.32 m against the flute's 0.67): the left hand 0.12 m along it, the
 * right 0.24 m.
 */
const PICCOLO: Record<HoldState, Hold> = {
    up: {
        family: "piccolo",
        state: "up",
        // the flute's line, hands close together
        right: {
            elbow: [-0.275, 1.214, -0.027],
            wrist: [-0.23, 1.4, 0.155],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.133, 1.332, 0.183],
            wrist: [-0.11, 1.42, 0.13],
            fingers: unit([-0.1, 0.9, 0.42]),
        },
        instrument: {
            origin: [0, 1.56, 0.12],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
    carry: {
        family: "piccolo",
        state: "carry",
        // the head joint raised: the embouchure hole at eye level
        right: {
            elbow: [-0.298, 1.236, 0.053],
            wrist: [-0.23, 1.46, 0.175],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.121, 1.358, 0.186],
            wrist: [-0.11, 1.48, 0.15],
            fingers: unit([-0.1, 0.9, 0.42]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
    trail: {
        family: "piccolo",
        state: "trail",
        // the head joint raised: the embouchure hole at eye level
        right: {
            elbow: [-0.298, 1.236, 0.053],
            wrist: [-0.23, 1.46, 0.175],
            fingers: unit([0.05, 0.9, 0.42]),
        },
        left: {
            elbow: [0.121, 1.358, 0.186],
            wrist: [-0.11, 1.48, 0.15],
            fingers: unit([-0.1, 0.9, 0.42]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [-0.968, -0.151, 0.202],
            capsAxis: [0.2, 0.031, 0.979],
        },
    },
};

/**
 * Clarinet: down the center line from the mouth. The hands wrap the joints
 * from the sides, fingers across the front onto the holes, thumbs behind:
 * left hand on the upper joint, right on the lower, elbows a little out.
 */
const CLARINET: Record<HoldState, Hold> = {
    up: {
        family: "clarinet",
        state: "up",
        // angled 28 degrees out; left hand upper joint, right hand lower
        right: {
            elbow: [-0.246, 1.239, 0.11],
            wrist: [-0.075, 1.15, 0.29],
            fingers: unit([0.8, -0.2, 0.55]),
        },
        left: {
            elbow: [0.308, 1.261, 0.087],
            wrist: [0.075, 1.33, 0.19],
            fingers: unit([-0.8, -0.2, 0.55]),
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
        // nearly vertical, ligature at eye level, tipped out to clear the chest
        right: {
            elbow: [-0.295, 1.244, 0.076],
            wrist: [-0.075, 1.22, 0.22],
            fingers: unit([0.8, -0.2, 0.55]),
        },
        left: {
            elbow: [0.304, 1.288, 0.121],
            wrist: [0.075, 1.41, 0.17],
            fingers: unit([-0.8, -0.2, 0.55]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.0, -0.97, 0.25],
            capsAxis: [0.0, 0.25, 0.97],
        },
    },
    trail: {
        family: "clarinet",
        state: "trail",
        // nearly vertical, ligature at eye level, tipped out to clear the chest
        right: {
            elbow: [-0.295, 1.244, 0.076],
            wrist: [-0.075, 1.22, 0.22],
            fingers: unit([0.8, -0.2, 0.55]),
        },
        left: {
            elbow: [0.304, 1.288, 0.121],
            wrist: [0.075, 1.41, 0.17],
            fingers: unit([-0.8, -0.2, 0.55]),
        },
        instrument: {
            origin: [0, 1.62, 0.14],
            bellAxis: [0.0, -0.97, 0.25],
            capsAxis: [0.0, 0.25, 0.97],
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
        // matched grip: hands just behind the back rim, palms down, sticks angled in to meet near the center a little above the head
        right: {
            elbow: [-0.281, 1.227, -0.066],
            wrist: [-0.209, 1.068, 0.132],
            fingers: unit([0.563, 0.032, 0.826]),
        },
        left: {
            elbow: [0.281, 1.227, -0.066],
            wrist: [0.209, 1.068, 0.132],
            fingers: unit([-0.563, 0.032, 0.826]),
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
        // matched grip: hands just behind the back rim, palms down, sticks angled in to meet near the center a little above the head
        right: {
            elbow: [-0.281, 1.227, -0.066],
            wrist: [-0.209, 1.068, 0.132],
            fingers: unit([0.563, 0.032, 0.826]),
        },
        left: {
            elbow: [0.281, 1.227, -0.066],
            wrist: [0.209, 1.068, 0.132],
            fingers: unit([-0.563, 0.032, 0.826]),
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
        // matched grip: hands just behind the back rim, palms down, sticks angled in to meet near the center a little above the head
        right: {
            elbow: [-0.281, 1.227, -0.066],
            wrist: [-0.209, 1.068, 0.132],
            fingers: unit([0.563, 0.032, 0.826]),
        },
        left: {
            elbow: [0.281, 1.227, -0.066],
            wrist: [0.209, 1.068, 0.132],
            fingers: unit([-0.563, 0.032, 0.826]),
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
        // matched grip, wider than the snare: each hand behind one of the two front drums (1 on the left, 2 on the right), reaching over the shots to that drum's head
        right: {
            elbow: [-0.273, 1.212, -0.003],
            wrist: [-0.286, 1.088, 0.23],
            fingers: unit([0.511, -0.12, 0.851]),
        },
        left: {
            elbow: [0.273, 1.212, -0.003],
            wrist: [0.286, 1.088, 0.23],
            fingers: unit([-0.511, -0.12, 0.851]),
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
        // matched grip, wider than the snare: each hand behind one of the two front drums (1 on the left, 2 on the right), reaching over the shots to that drum's head
        right: {
            elbow: [-0.273, 1.212, -0.003],
            wrist: [-0.286, 1.088, 0.23],
            fingers: unit([0.511, -0.12, 0.851]),
        },
        left: {
            elbow: [0.273, 1.212, -0.003],
            wrist: [0.286, 1.088, 0.23],
            fingers: unit([-0.511, -0.12, 0.851]),
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
        // matched grip, wider than the snare: each hand behind one of the two front drums (1 on the left, 2 on the right), reaching over the shots to that drum's head
        right: {
            elbow: [-0.273, 1.212, -0.003],
            wrist: [-0.286, 1.088, 0.23],
            fingers: unit([0.511, -0.12, 0.851]),
        },
        left: {
            elbow: [0.273, 1.212, -0.003],
            wrist: [0.286, 1.088, 0.23],
            fingers: unit([-0.511, -0.12, 0.851]),
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
        // the drum high on the carrier; upper arms down, forearms forward at the hips, the hands beside the heads below the center, mallets angled up and forward
        right: {
            elbow: [-0.238, 1.199, 0.006],
            wrist: [-0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
        },
        left: {
            elbow: [0.238, 1.199, 0.006],
            wrist: [0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
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
        // the drum high on the carrier; upper arms down, forearms forward at the hips, the hands beside the heads below the center, mallets angled up and forward
        right: {
            elbow: [-0.238, 1.199, 0.006],
            wrist: [-0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
        },
        left: {
            elbow: [0.238, 1.199, 0.006],
            wrist: [0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
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
        // the drum high on the carrier; upper arms down, forearms forward at the hips, the hands beside the heads below the center, mallets angled up and forward
        right: {
            elbow: [-0.238, 1.199, 0.006],
            wrist: [-0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
        },
        left: {
            elbow: [0.238, 1.199, 0.006],
            wrist: [0.25, 1.06, 0.23],
            fingers: unit([0, 0.3, 0.95]),
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
