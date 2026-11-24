/**
 * Facing (ADR 0015 D-3, its 2026-11-24 amendment; fork #993): the direction a performer's chest
 * and equipment point, in plain degrees. 0 is front (the audience), 90 side 2, 180 back, 270 (or
 * −90) side 1, and angles aren't wrapped: 360 is a full spin, and −270 ends where 90 does after
 * turning the other way. Positive angles turn toward the performer's left as they face front (side
 * 2 is the audience's right).
 *
 * A Facing cue's turn starts on its count and runs for its turn length in counts at an even
 * speed; with no length it's instant on its count. Each performer turns from their own angle:
 * Front, Back, Side 1 and Side 2 go to the nearest equivalent angle from it, Turn left 45° and
 * Turn right 45° from it, and Angle to exactly the angle the cue says.
 */
import type { CueSegment } from "./types";

/** The angle of Front, Back, Side 1 and Side 2, before the nearest equivalent is taken. */
const DIRECTIONS: Readonly<Record<string, number>> = {
    "builtin:facing.front": 0,
    "builtin:facing.back": 180,
    "builtin:facing.side1": 270,
    "builtin:facing.side2": 90,
};

/** The turns relative to where the performer faces. */
const TURNS: Readonly<Record<string, number>> = {
    "builtin:facing.turnLeft": 45,
    "builtin:facing.turnRight": -45,
};

/**
 * The angle equivalent to `target` (a whole number of turns away) nearest to `from`. Half a turn
 * either way is a tie, and the larger wins: a turn to the left.
 */
export function nearestEquivalentDegrees(target: number, from: number): number {
    const turns = Math.round((from - target) / 360);
    let best = target + turns * 360;
    for (const candidate of [best - 360, best + 360]) {
        const d = Math.abs(candidate - from);
        const b = Math.abs(best - from);
        if (d < b - 1e-9 || (Math.abs(d - b) <= 1e-9 && candidate > best))
            best = candidate;
    }
    return best;
}

/**
 * Where a Facing value turns a performer facing `from`: Front, Back and the sides to the nearest
 * equivalent angle, the 45° turns from it, Angle to its `degrees`. Values not offered yet
 * (direction of travel, toward a point) need the drill, so here they keep `from`.
 */
export function facingTargetDegrees(
    value: string | null,
    settings: Readonly<Record<string, unknown>>,
    from: number,
): number {
    if (value === null) return from;
    const direction = DIRECTIONS[value];
    if (direction !== undefined)
        return nearestEquivalentDegrees(direction, from);
    const turn = TURNS[value];
    if (turn !== undefined) return from + turn;
    if (value === "builtin:facing.angle") {
        const degrees = Number(settings.degrees);
        return Number.isFinite(degrees) ? degrees : from;
    }
    return from;
}

/**
 * A performer's angle at count clock `count` from their Facing segments: a turn goes at an even
 * speed from its `fromDegrees` to its `degrees`; an instant one has landed on its count. 0 before
 * any segment, and where a segment has no angle.
 */
export function facingDegreesAt(
    segments: readonly CueSegment[],
    count: number,
): number {
    let at = segments[0]?.fromDegrees ?? segments[0]?.degrees ?? 0;
    for (const seg of segments) {
        if (seg.from > count) break;
        const to = seg.degrees ?? at;
        if (seg.kind === "transition" && count < seg.to) {
            const from = seg.fromDegrees ?? at;
            const u = (count - seg.from) / (seg.to - seg.from);
            return from + (to - from) * u;
        }
        at = to;
    }
    return at;
}
