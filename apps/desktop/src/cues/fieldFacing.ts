/**
 * Facing on the 2D field (fork #1316): which way each performer faces at the playhead, as the
 * arrow the facing arrows layer draws from their dot. The angle is core's `facingAt`, the compile
 * the Facing lane, the field menu and the 3D View read, so the field turns exactly when they do:
 * linearly through a turn, landing on the cue's count. A performer with no Facing cue faces front.
 *
 * The field display bar's Show facing toggle turns the arrows on for everyone (off by default).
 *
 * Pure: no React, three.js or database.
 */
import { facingAt, type CompiledCues } from "@openmarch/core";

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
 * `facingVector`), or 0, 0 for one `include` leaves out (props and equipment, which don't face).
 */
export function writeFacingDirections({
    compiled,
    ids,
    clock,
    include,
    out,
}: {
    compiled: CompiledCues;
    ids: readonly number[];
    clock: number;
    include: (id: number) => boolean;
    out: Float32Array;
}): void {
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!include(id)) {
            out[i * 2] = 0;
            out[i * 2 + 1] = 0;
            continue;
        }
        const [x, y] = facingVector(facingAt(compiled, id, clock));
        out[i * 2] = x;
        out[i * 2 + 1] = y;
    }
}
