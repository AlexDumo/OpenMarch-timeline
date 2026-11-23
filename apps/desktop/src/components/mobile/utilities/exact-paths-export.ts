/**
 * Exact paths in the `.om` export (spec Appendix M.7, ADR 0018 step 5): each marcher's real walk
 * during each move, curves included, so a reader can play the show as OpenMarch does instead of
 * drawing straight lines between sets.
 *
 * The converter (`exactPathsOf`, EP-C) gives paths in field units with y down and ticks from the
 * move's start. The file wants steps on the `.om` axes (x from the center, y from the front
 * sideline toward the back) and ticks from the start of the show.
 */
import {
    TICKS_PER_BEAT,
    createExactPathConverter,
    retimeExactPath,
    type ExactMove,
    type ExactPath,
    type ExactPathConverter,
    type ExactShape,
    type Resolver,
    type TimelineSnapshot,
} from "@openmarch/core";
import type {
    ExactPath as OmExactPath,
    ExactPathEntry,
    ExactShape as OmExactShape,
} from "@openmarch/schema";

type XY = readonly [number, number];

/** How canvas pixels map to `.om` steps (the same mapping as the export's coordinates). */
export interface StepAxes {
    /** The canvas x of the field's center */
    centerXPixels: number;
    /** The field's depth in steps: the front sideline's y in steps from the top of the canvas */
    fieldHeightSteps: number;
    pixelsPerStep: number;
}

/** A canvas point in `.om` steps: x from the center, y from the front sideline toward the back. */
export function toSteps(
    axes: StepAxes,
    x: number,
    y: number,
): [number, number] {
    return [
        (x - axes.centerXPixels) / axes.pixelsPerStep,
        axes.fieldHeightSteps - y / axes.pixelsPerStep,
    ];
}

/**
 * An exact path in `.om` steps. Every point maps as the coordinates do. Flipping y mirrors which
 * side an arc bows to, so each `bend` is negated (EP-3). Keys are unchanged: a place is a share
 * of its piece, which a uniform scale keeps.
 */
export function exactPathInSteps(path: ExactPath, axes: StepAxes): OmExactPath {
    const p = (xy: XY) => toSteps(axes, xy[0], xy[1]);
    const shape = (s: ExactShape): OmExactShape => {
        switch (s.kind) {
            case "points":
                return { kind: "points", points: s.points.map(p) };
            case "arc":
                return { kind: "arc", to: p(s.to), bend: -s.bend };
            case "cubic":
                return { kind: "cubic", c1: p(s.c1), c2: p(s.c2), to: p(s.to) };
        }
    };
    return {
        v: 1,
        from: p(path.from),
        shapes: path.shapes.map(shape),
        keys: path.keys.map((k) => ({ tick: k.tick, u: k.u })),
    };
}

/** A beat on the show's tick scale (`startBeatIndex` × 480), rounded to a whole tick. */
const tickOfBeat = (beat: number) => Math.round(beat * TICKS_PER_BEAT);

/**
 * One converted move placed in the show (EP-P1, EP-P2): `startTick` and `endTick` are its
 * span's start and end beats on the show's tick scale. Both are rounded the same way, so a move
 * that ends on the beat the next one starts shares its tick (EP-P3). When rounding changes the
 * move's length, its keys are stretched to fit (EP-T's retime). Null for a move shorter than a tick.
 */
export function exactPathEntryOf(
    move: ExactMove,
    axes: StepAxes,
): ExactPathEntry | null {
    const startTick = tickOfBeat(move.start);
    const endTick = tickOfBeat(move.end);
    if (startTick < 0 || !(endTick > startTick)) return null;
    const keys = move.path.keys;
    const length = keys[keys.length - 1]!.tick;
    const path =
        length === endTick - startTick
            ? move.path
            : retimeExactPath(move.path, endTick - startTick);
    return {
        marcherId: String(move.marcherId),
        startTick,
        endTick,
        path: exactPathInSteps(path, axes),
    };
}

/** What converting needs: the tables the resolver was built from, and the resolver. */
export interface ExactPathSource {
    host: TimelineSnapshot;
    resolver: Pick<Resolver, "spanInfos" | "positionAt" | "ftlEntry">;
}

/** How long converting may hold the main thread before it yields, in milliseconds. */
const CONVERT_SLICE_MS = 8;

const yieldToEventLoop = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Every move of `marcherIds` as exact paths (EP-C), one marcher at a time, yielding to the event
 * loop every few milliseconds so a large show doesn't freeze the UI. A marcher whose walk can't
 * be converted gets none: the file then gives it straight lines between sets, as before exact
 * paths. Leaving out only the move that failed would make a reader hold the marcher still
 * through it instead (EP-R2).
 */
export async function convertExactMoves(
    { host, resolver }: ExactPathSource,
    marcherIds: readonly number[],
    makeConverter: (
        host: TimelineSnapshot,
        resolver: ExactPathSource["resolver"],
    ) => ExactPathConverter = createExactPathConverter,
): Promise<ExactMove[]> {
    const converter = makeConverter(host, resolver);
    const out: ExactMove[] = [];
    let sliceStart = performance.now();
    for (const marcherId of marcherIds) {
        try {
            out.push(...converter.movesOf(marcherId));
        } catch (error) {
            console.error(
                `Couldn't convert marcher ${marcherId}'s walk to exact paths; the file gives straight lines between sets for this marcher`,
                error,
            );
        }
        if (performance.now() - sliceStart > CONVERT_SLICE_MS) {
            await yieldToEventLoop();
            sliceStart = performance.now();
        }
    }
    return out;
}

/** The `.om` file's `exactPaths`: every converted move in steps, placed in the show. */
export function buildExactPathEntries(
    moves: readonly ExactMove[],
    axes: StepAxes,
): ExactPathEntry[] {
    const out: ExactPathEntry[] = [];
    for (const move of moves) {
        const entry = exactPathEntryOf(move, axes);
        if (entry) out.push(entry);
    }
    return out;
}
