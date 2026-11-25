/**
 * Facing on the 2D field (fork #1316): which way each performer faces at the playhead, as the
 * pointed dot the marchers layer draws. The angle is core's `facingAt`, the compile the Facing
 * lane, the field menu and the 3D View read, so the field turns exactly when they do: linearly
 * through a turn, landing on the cue's count.
 *
 * Who shows it is the field display bar's Facing choice:
 * - "turned" (the default): performers not facing front. No point means front, which every
 *   performer faces before their first Facing cue, so a show without Facing cues looks as it did.
 * - "everyone": every performer, front included.
 * - "off": nobody.
 *
 * Pure: no React, three.js or database.
 */
import { facingAt, type CompiledCues } from "@openmarch/core";

export type FacingMarks = "turned" | "everyone" | "off";

/** The Facing choices, in the display bar's order. */
export const FACING_MARKS: readonly FacingMarks[] = [
    "turned",
    "everyone",
    "off",
];

/** Closer to front than this (degrees, either way) counts as front. */
const FRONT_EPS = 1e-6;

/**
 * The compile's count clock at spec beat `beat` (fractional while playing): beat 0 is the fixed
 * zero-length beat, so the first timed beat, count 0, starts at spec beat 1, and halfway through
 * it is 0.5. That is the 3D View's `countAt` at the same moment. Past the stored beats the clock
 * runs on a count per beat.
 *
 * @param beats the show's spec beats in order, beat 0 included
 * @param countOfBeat each timed beat's count (`ShowCues.countOfBeat`)
 */
export function cueClockAtBeat(
    beats: readonly { readonly id: number }[],
    countOfBeat: ReadonlyMap<number, number>,
    beat: number,
): number {
    if (!(beat > 0) || beats.length === 0) return 0;
    const i = Math.floor(beat);
    if (i >= beats.length) return countOfBeat.size + (beat - beats.length);
    const count = countOfBeat.get(beats[i].id);
    if (count !== undefined) return count + (beat - i);
    // A beat with no length: the next timed count starts where it is
    for (let j = i + 1; j < beats.length; j++) {
        const next = countOfBeat.get(beats[j].id);
        if (next !== undefined) return next;
    }
    return countOfBeat.size;
}

/** Whether an unwrapped angle faces front: a whole number of turns. */
export function facesFront(degrees: number): boolean {
    const turned = ((degrees % 360) + 360) % 360;
    return turned < FRONT_EPS || 360 - turned < FRONT_EPS;
}

/**
 * The facing the field shows for performer `id` at count clock `clock`, in unwrapped degrees
 * (0 front, 90 side 2), or null when it shows none.
 */
export function facingMarkAt(
    compiled: CompiledCues,
    id: number,
    clock: number,
    shown: FacingMarks,
): number | null {
    if (shown === "off") return null;
    const degrees = facingAt(compiled, id, clock);
    if (shown === "turned" && facesFront(degrees)) return null;
    return degrees;
}

/**
 * The field's direction for a facing, in field units with y toward the front sideline: 0° points
 * at the audience (down the screen), 90° at side 2 (screen right). Positive angles turn to the
 * performer's own left, anticlockwise on screen.
 */
export function facingVector(degrees: number): [x: number, y: number] {
    const r = (degrees * Math.PI) / 180;
    return [Math.sin(r), Math.cos(r)];
}

/**
 * Writes each of `ids`' facing direction at count clock `clock` into `out` (x, y per id, from
 * `facingVector`), or 0, 0 for one the field shows no facing for. `include` leaves out ids that
 * can't face (props and equipment). Returns whether anything is shown.
 */
export function writeFacingMarks({
    compiled,
    ids,
    clock,
    shown,
    include,
    out,
}: {
    compiled: CompiledCues;
    ids: readonly number[];
    clock: number;
    shown: FacingMarks;
    include: (id: number) => boolean;
    out: Float32Array;
}): boolean {
    let any = false;
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const degrees = include(id)
            ? facingMarkAt(compiled, id, clock, shown)
            : null;
        if (degrees === null) {
            out[i * 2] = 0;
            out[i * 2 + 1] = 0;
            continue;
        }
        const [x, y] = facingVector(degrees);
        out[i * 2] = x;
        out[i * 2 + 1] = y;
        any = true;
    }
    return any;
}
