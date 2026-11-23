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
    EXACT_DEFAULT_TOLERANCE,
    TICKS_PER_BEAT,
    createExactPathConverter,
    retimeExactPath,
    type ExactMove,
    type ExactPath,
    type ExactPathConverter,
    type ExactShape,
    type FieldProperties,
    type Resolver,
    type TimelineSnapshot,
} from "@openmarch/core";
import {
    checkExactPath,
    type ExactPath as OmExactPath,
    type ExactPathEntry,
    type ExactShape as OmExactShape,
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

/**
 * The field's mapping from canvas pixels to `.om` steps: the canvas's left edge is the field's
 * leftmost x checkpoint and its top the field's back, so the center is half the width in and the
 * front sideline the field's depth down.
 */
export function stepAxesOf(fieldProperties: FieldProperties): StepAxes {
    const xs = fieldProperties.xCheckpoints.map((c) => c.stepsFromCenterFront);
    const ys = fieldProperties.yCheckpoints.map((c) => c.stepsFromCenterFront);
    const { pixelsPerStep } = fieldProperties;
    return {
        centerXPixels:
            ((Math.max(...xs) - Math.min(...xs)) / 2) * pixelsPerStep,
        fieldHeightSteps: Math.abs(Math.max(...ys) - Math.min(...ys)),
        pixelsPerStep,
    };
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

/**
 * The converter's tolerance (EP-C4) for this field: its default, 1/100 of an 8-to-5 step, or
 * 1/100 of the show's own step when that is smaller, so every path is within 1/100 of a step.
 */
export const exactToleranceFor = (axes: StepAxes) =>
    Math.min(EXACT_DEFAULT_TOLERANCE, axes.pixelsPerStep / 100);

/**
 * Why a converted path can't go in the file, or null when it can. A path shorter than the
 * schema's minimum in steps (EP-6) goes nowhere: leaving it out holds the marcher still, which
 * is what it does (the converter's minimum is in canvas pixels, so a tiny walk can pass it).
 */
function refusal(entry: ExactPathEntry): "too short" | string | null {
    const problems = checkExactPath(entry.path);
    if (problems.length === 0) return null;
    if (problems.every((p) => p.rule === "EP-6")) return "too short";
    return problems.map((p) => `${p.rule}: ${p.message}`).join("; ");
}

/** How long converting may hold the main thread before it yields, in milliseconds. */
const CONVERT_SLICE_MS = 8;

const yieldToEventLoop = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface ExportExactPathsOptions {
    /** A stand-in converter, for tests */
    makeConverter?: (
        host: TimelineSnapshot,
        resolver: ExactPathSource["resolver"],
        options: { tolerance: number },
    ) => ExactPathConverter;
}

/**
 * The `.om` file's `exactPaths` (spec M.7): every move of `marcherIds` converted (EP-C), in
 * steps, placed in the show and checked against the file's rules. It yields to the event loop
 * every few milliseconds, between moves, so a large show doesn't freeze the UI.
 *
 * A marcher whose walk can't be converted, or whose path the file would refuse, gets no exact
 * paths: the file then gives it straight lines between sets, as before exact paths, and the
 * rest of the show still exports. Leaving out only the move that failed would make a reader hold
 * the marcher still through it instead (EP-R2).
 */
export async function exportExactPaths(
    { host, resolver }: ExactPathSource,
    marcherIds: readonly number[],
    axes: StepAxes,
    { makeConverter = createExactPathConverter }: ExportExactPathsOptions = {},
): Promise<ExactPathEntry[]> {
    const converter = makeConverter(host, resolver, {
        tolerance: exactToleranceFor(axes),
    });
    const out: ExactPathEntry[] = [];
    let sliceStart = performance.now();
    for (const marcherId of marcherIds) {
        const mine: ExactPathEntry[] = [];
        try {
            for (const move of converter.movesOf(marcherId)) {
                const entry = exactPathEntryOf(move, axes);
                const why = entry && refusal(entry);
                if (entry && !why) mine.push(entry);
                else if (why && why !== "too short")
                    throw new Error(
                        `its move at beat ${move.start} breaks the file's rules (${why})`,
                    );
                if (performance.now() - sliceStart > CONVERT_SLICE_MS) {
                    await yieldToEventLoop();
                    sliceStart = performance.now();
                }
            }
        } catch (error) {
            console.error(
                `Couldn't write marcher ${marcherId}'s walk as exact paths; the file gives straight lines between sets for this marcher`,
                error,
            );
            continue;
        }
        out.push(...mine);
    }
    return out;
}
