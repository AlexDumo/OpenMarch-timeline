/**
 * Which clip each 3D View marcher plays on each count, and where its body is
 * (ADR 0002 D-7; om-pose `docs/openmarch-3d.md`, "Driving clips from drill").
 *
 * The planner doesn't know about pages. For every count it looks at how far
 * the marcher's dot moves during that count and in which direction:
 *
 * - no travel: a rest count, `marktime` while any marcher moves on that
 *   count, `attention` while the whole band holds;
 * - travel: a step along that count's own vector. The family and leg turn
 *   come from `pickDirection`, the two sizes and weight from `pickBlend`.
 *   A curved path is a new vector every count.
 *
 * From the sequence of counts it builds clip events:
 *
 * - rest to step: `stepoff_<move>` (turned via `turnedClips`), or from mark
 *   time `change_marktime__<move>` when that clip exists;
 * - step to step: the loop, phased from its step-off; a different family or
 *   a size jump uses `change_<a>__<b>` (or `change2_`, by the loop's time on
 *   that count) when it exists, and otherwise cuts between the loops keeping
 *   the loop time (the spec's stopgap);
 * - step to rest: `halt_<move>` when the loop is at time 0, `halt2_<move>`
 *   when it is at 0.5 s (to mark time: the change clip, or a cut).
 *
 * Body placement: during loops and rests the body follows the drill; during
 * a one-count transition it moves by the clip's own root travel. Where that
 * leaves the body off the drill (the step-off covers about 0.31 m against an
 * 8-to-5 step's 0.57 m; a halt closes onto the last planted foot), the
 * landing correction spreads the difference linearly between anchors: count
 * boundaries next to a rest, where the body is exactly on its dot.
 *
 * Pure: no three.js, React or database.
 */

import {
    pickBlend,
    pickDirection,
    turnedClips,
    turnRoot,
    type ClipPair,
    type Direction,
    type Family,
    type Manifest,
    type ManifestClip,
    type Pick,
    type TurnedPair,
} from "../../vendor/om-pose/step-blend.js";
import { classSuffix, type HeightClass } from "./looks";

/** Less travel than this in a count is a rest (meters). */
export const REST_EPS = 0.01;
/** A size change bigger than this between counts is a change of move (meters per count). */
export const SIZE_JUMP = 0.05;
/** Blend weights this close to 0 or 1 play the exact size alone (0.1 mm per count at most). */
export const WEIGHT_SNAP = 1e-3;
/** Leg turns within this count as unturned, for change clips (radians). */
export const TURN_EPS = (1 * Math.PI) / 180;
/** Between rests, a landing correction anchor at least this often (counts). */
export const MAX_ANCHOR_SPAN = 16;

export interface PlanInput {
    manifest: Manifest;
    heightClass: HeightClass;
    /** Heading of the upper body, radians about +Y (0 faces the audience). */
    heading: number;
    /** Drill position at each count boundary 0..K: x, z interleaved (world meters). */
    positions: Float64Array;
    /** Tempo of each count 0..K-1. */
    bpm: Float64Array;
    /** 1 when any marcher travels during that count. */
    bandMoving: Uint8Array;
}

export type EventKind = "rest" | "loop" | "transition";

export interface PlanEvent {
    /** First count it covers; it lasts until the next event's count. */
    count: number;
    kind: EventKind;
    /** Clip names (with the height class suffix), as `bake.rows` keys. */
    clip: string;
    clip2: string | null;
    weight: number;
    legYaw: number | [number, number, number, number];
    /** The count clock value at which the clip is at its time 0. */
    phaseStart: number;
    /** Transitions: the pair whose root travel places the body. */
    root: TurnedPair | ClipPair | null;
    /**
     * Transitions: drill position at `count` plus the offset then (the body
     * is base + root(u)). Loops and rests: the offset (body - drill).
     */
    baseX: number;
    baseZ: number;
    /** The correction span this event lies in: counts a..b and the raw offsets there. */
    a: number;
    b: number;
    oaX: number;
    oaZ: number;
    obX: number;
    obZ: number;
}

export interface MarcherPlan {
    events: PlanEvent[];
    /** Count boundaries (K + 1). */
    counts: number;
}

type State =
    | { type: "attention" }
    | { type: "marktime" }
    | {
          type: "move";
          family: Family;
          dir: Direction;
          pick: Pick;
          d: number;
          dx: number;
          dz: number;
      };

const clipsOf = (m: Manifest): ManifestClip[] =>
    Array.isArray(m) ? m : m.clips;

const namesCache = new WeakMap<object, Set<string>>();
function clipNames(manifest: Manifest): Set<string> {
    const key = manifest as object;
    let names = namesCache.get(key);
    if (!names) {
        names = new Set(clipsOf(manifest).map((c) => c.name));
        namesCache.set(key, names);
    }
    return names;
}
function clipByName(manifest: Manifest, name: string): ManifestClip {
    const c = clipsOf(manifest).find((x) => x.name === name);
    if (!c) throw new Error(`planner: no clip ${name}`);
    return c;
}

/** The move's nearest exact size (its base), for change clips. */
const nearestBase = (p: Pick) => (p.weight < 0.5 ? p.baseA : p.baseB);
const isRest = (s: State) => s.type !== "move";
const restBase = (s: State) =>
    s.type === "marktime" ? "marktime" : "attention";

/** Drill sizes are never exact: play a size alone when the weight is within WEIGHT_SNAP of it. */
function snapPick(p: Pick): Pick {
    if (p.weight > 0 && p.weight < WEIGHT_SNAP)
        return {
            ...p,
            b: p.a,
            baseB: p.baseA,
            stepB: p.stepA,
            weight: 0,
            d: p.stepA,
        };
    if (p.weight > 1 - WEIGHT_SNAP && p.weight < 1)
        return {
            ...p,
            a: p.b,
            baseA: p.baseB,
            stepA: p.stepB,
            weight: 0,
            d: p.stepB,
        };
    return p;
}

/** The states of every count from the drill. */
function countStates(input: PlanInput): State[] {
    const { positions, bpm, bandMoving, manifest, heightClass, heading } =
        input;
    const K = positions.length / 2 - 1;
    const out: State[] = [];
    for (let k = 0; k < K; k++) {
        const dx = positions[(k + 1) * 2] - positions[k * 2];
        const dz = positions[(k + 1) * 2 + 1] - positions[k * 2 + 1];
        const d = Math.hypot(dx, dz);
        if (!(d > REST_EPS)) {
            out.push({ type: bandMoving[k] ? "marktime" : "attention" });
            continue;
        }
        const dir = pickDirection(heading, dx, dz);
        const family = dir.family as Family;
        const pick = snapPick(
            pickBlend(manifest, family, d, {
                height: heightClass,
                bpm: bpm[k],
            }),
        );
        out.push({ type: "move", family, dir, pick, d, dx, dz });
    }
    return out;
}

interface Draft {
    kind: EventKind;
    clip: string;
    clip2: string | null;
    weight: number;
    legYaw: number | [number, number, number, number];
    phaseStart: number;
    root: TurnedPair | ClipPair | null;
}

/** A single clip's root travel as a pair (for change and mark time clips). */
function soloPair(manifest: Manifest, name: string): ClipPair {
    const c = clipByName(manifest, name);
    return { a: name, b: null, weight: 0, clipA: c, clipB: c };
}

/** Root travel at u of a transition's count, in the marcher's frame. */
export function rootAt(
    manifest: Manifest,
    pair: TurnedPair | ClipPair,
    u: number,
): [number, number] {
    return turnRoot(manifest, pair as TurnedPair, u);
}

/** Plans one marcher's clips and body placement for the whole show. */
// eslint-disable-next-line max-lines-per-function
export function planMarcher(input: PlanInput): MarcherPlan {
    const { manifest, heightClass: h, heading, positions } = input;
    const sfx = classSuffix(h);
    const names = clipNames(manifest);
    const has = (base: string) => names.has(base + sfx);
    const states = countStates(input);
    const K = states.length;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);

    // 1. Clip drafts per count, and the raw offset (body - drill) at each boundary.
    const drafts: Draft[] = [];
    const ox = new Float64Array(K + 1);
    const oz = new Float64Array(K + 1);
    let prev: State = { type: "attention" };
    let parity = 0; // the running loop's time on this count: 0 or 1 (x 0.5 s)
    let prevYaw = 0;
    for (let k = 0; k < K; k++) {
        const s = states[k];
        // the loop's time on this count, before this count updates it
        const p = parity;
        let draft: Draft;
        const loopOf = (st: State, yaw: Draft["legYaw"]): Draft =>
            st.type === "move"
                ? {
                      kind: "loop",
                      clip: st.pick.a,
                      clip2: st.pick.weight > 0 ? st.pick.b : null,
                      weight: st.pick.weight,
                      legYaw: yaw,
                      phaseStart: k - p,
                      root: null,
                  }
                : {
                      kind: "rest",
                      clip: restBase(st) + sfx,
                      clip2: null,
                      weight: 0,
                      legYaw: 0,
                      // attention is still; only mark time's phase matters
                      phaseStart: st.type === "attention" ? 0 : k - p,
                      root: null,
                  };
        const transition = (pair: TurnedPair | ClipPair): Draft => ({
            kind: "transition",
            clip: pair.a,
            clip2: pair.b && pair.weight > 0 ? pair.b : null,
            weight: pair.b ? pair.weight : 0,
            legYaw: "legYaw" in pair ? pair.legYaw : 0,
            phaseStart: k,
            root: pair,
        });
        const change = (from: string, to: string): Draft | null => {
            const base = `${p === 0 ? "change" : "change2"}_${from}__${to}`;
            return has(base)
                ? transition(soloPair(manifest, base + sfx))
                : null;
        };
        const unturned = (st: State) =>
            st.type !== "move" || Math.abs(st.dir.legYaw) <= TURN_EPS;
        const baseOf = (st: State) =>
            st.type === "move" ? nearestBase(st.pick) : "marktime";

        if (s.type === "move") {
            if (prev.type === "attention") {
                draft = transition(
                    turnedClips(manifest, s.pick, s.dir, "stepoff"),
                );
                parity = 0; // stepoff covers this count; the loop starts at time 0 next count
                prevYaw = s.dir.legYaw;
            } else {
                const sameMove =
                    prev.type === "move" &&
                    prev.family === s.family &&
                    Math.abs(prev.d - s.d) <= SIZE_JUMP;
                if (sameMove) {
                    const yaw = s.dir.legYaw;
                    draft = loopOf(
                        s,
                        Math.abs(yaw - prevYaw) > 1e-6
                            ? [prevYaw, yaw, p / 2, p / 2 + 0.5]
                            : yaw,
                    );
                } else {
                    draft =
                        (unturned(prev) && unturned(s)
                            ? change(baseOf(prev), baseOf(s))
                            : null) ?? loopOf(s, s.dir.legYaw);
                }
                prevYaw = s.dir.legYaw;
                parity ^= 1;
            }
        } else if (prev.type === "move") {
            if (s.type === "attention") {
                draft = transition(
                    turnedClips(
                        manifest,
                        prev.pick,
                        prev.dir,
                        parity === 0 ? "halt" : "halt2",
                    ),
                );
            } else {
                draft =
                    (unturned(prev)
                        ? change(nearestBase(prev.pick), "marktime")
                        : null) ?? loopOf(s, 0);
                parity ^= 1;
            }
        } else if (prev.type === "attention" && s.type === "marktime") {
            draft = transition(soloPair(manifest, `stepoff_marktime${sfx}`));
            parity = 0;
        } else if (prev.type === "marktime" && s.type === "attention") {
            draft = transition(
                soloPair(
                    manifest,
                    `${parity === 0 ? "halt" : "halt2"}_marktime${sfx}`,
                ),
            );
        } else {
            draft = loopOf(s, 0);
            if (s.type === "marktime") parity ^= 1;
        }
        drafts.push(draft);

        // Raw offset: loops and rests keep it (they travel exactly the drill's
        // vector, or nothing); a transition moves the body by its root travel
        // while the drill moves by its own vector.
        let nx = ox[k];
        let nz = oz[k];
        if (draft.kind === "transition" && draft.root) {
            const [rx, rz] = rootAt(manifest, draft.root, 1);
            const dx = positions[(k + 1) * 2] - positions[k * 2];
            const dz = positions[(k + 1) * 2 + 1] - positions[k * 2 + 1];
            nx += rx * cos + rz * sin - dx;
            nz += -rx * sin + rz * cos - dz;
        }
        ox[k + 1] = nx;
        oz[k + 1] = nz;
        prev = s;
    }

    // 2. Anchors: boundaries next to a rest count (the body is on its dot),
    // the ends, and at least every MAX_ANCHOR_SPAN counts inside long runs
    // (between two loop counts, never across a transition).
    const anchor = new Uint8Array(K + 1);
    anchor[0] = 1;
    anchor[K] = 1;
    for (let b = 1; b < K; b++) {
        const before = drafts[b - 1];
        const after = drafts[b];
        if (
            (before.kind === "rest" && isRest(states[b - 1])) ||
            (after.kind === "rest" && isRest(states[b]))
        )
            anchor[b] = 1;
    }
    let last = 0;
    for (let b = 1; b <= K; b++) {
        if (anchor[b]) {
            last = b;
            continue;
        }
        if (
            b - last >= MAX_ANCHOR_SPAN &&
            drafts[b - 1].kind === "loop" &&
            drafts[b].kind === "loop"
        ) {
            anchor[b] = 1;
            last = b;
        }
    }

    // 3. Events: one per transition count; consecutive loop or rest counts
    // with the same clip state merge, within one anchor span.
    const events: PlanEvent[] = [];
    let a = 0;
    let b = 0;
    const nextAnchor = (from: number) => {
        let x = from + 1;
        while (x < K && !anchor[x]) x++;
        return Math.min(x, K);
    };
    b = nextAnchor(0);
    for (let k = 0; k < K; k++) {
        if (k >= b) {
            a = b;
            b = nextAnchor(b);
        }
        const d = drafts[k];
        const isTransition = d.kind === "transition";
        const lastEvent = events[events.length - 1];
        const mergeable =
            !isTransition &&
            lastEvent &&
            lastEvent.kind === d.kind &&
            lastEvent.a === a &&
            lastEvent.clip === d.clip &&
            lastEvent.clip2 === d.clip2 &&
            Math.abs(lastEvent.weight - d.weight) < 1e-6 &&
            typeof lastEvent.legYaw === "number" &&
            typeof d.legYaw === "number" &&
            Math.abs(lastEvent.legYaw - d.legYaw) < 1e-6 &&
            Math.abs(lastEvent.phaseStart - d.phaseStart) % 2 === 0 &&
            Math.abs(lastEvent.baseX - ox[k]) < 1e-9 &&
            Math.abs(lastEvent.baseZ - oz[k]) < 1e-9;
        if (mergeable) continue;
        events.push({
            count: k,
            kind: d.kind,
            clip: d.clip,
            clip2: d.clip2,
            weight: d.weight,
            legYaw: d.legYaw,
            phaseStart: d.phaseStart,
            root: d.root,
            baseX: isTransition ? positions[k * 2] + ox[k] : ox[k],
            baseZ: isTransition ? positions[k * 2 + 1] + oz[k] : oz[k],
            a,
            b,
            oaX: ox[a],
            oaZ: oz[a],
            obX: ox[b],
            obZ: oz[b],
        });
    }
    return { events, counts: K + 1 };
}

/** Index of the event covering count clock `c`, starting the search at `hint`. */
export function eventIndexAt(plan: MarcherPlan, c: number, hint = 0): number {
    const ev = plan.events;
    if (ev.length === 0) return -1;
    let i = Math.min(Math.max(hint, 0), ev.length - 1);
    if (c >= ev[i].count && (i + 1 >= ev.length || c < ev[i + 1].count))
        return i;
    // binary search: the last event with count <= c
    let lo = 0;
    let hi = ev.length - 1;
    if (c < ev[0].count) return 0;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ev[mid].count <= c) lo = mid;
        else hi = mid - 1;
    }
    i = lo;
    return i;
}

/**
 * Where the body is at count clock `c`, given the drill position then
 * (`drillX`, `drillZ`). Writes x, z into `out`.
 */
export function bodyAt(
    manifest: Manifest,
    plan: MarcherPlan,
    index: number,
    c: number,
    drillX: number,
    drillZ: number,
    heading: number,
    out: { x: number; z: number },
): void {
    const e = plan.events[index];
    if (!e) {
        out.x = drillX;
        out.z = drillZ;
        return;
    }
    const span = e.b - e.a;
    const t = span > 0 ? Math.min(Math.max((c - e.a) / span, 0), 1) : 0;
    const cx = -(e.oaX + (e.obX - e.oaX) * t);
    const cz = -(e.oaZ + (e.obZ - e.oaZ) * t);
    if (e.kind === "transition" && e.root) {
        const u = Math.min(Math.max(c - e.count, 0), 1);
        const [rx, rz] = rootAt(manifest, e.root, u);
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        out.x = e.baseX + rx * cos + rz * sin + cx;
        out.z = e.baseZ - rx * sin + rz * cos + cz;
    } else {
        out.x = drillX + e.baseX + cx;
        out.z = drillZ + e.baseZ + cz;
    }
}

/** Every clip a set of plans plays: what to bake. */
export function plannedClips(plans: Iterable<MarcherPlan>): Set<string> {
    const out = new Set<string>();
    for (const p of plans)
        for (const e of p.events) {
            out.add(e.clip);
            if (e.clip2) out.add(e.clip2);
        }
    return out;
}
