import type { FieldProperties, Resolver } from "@openmarch/core";
import type {
    StartFlagLevel,
    StartFlagLevels,
} from "@/timeline/startFlagLevels";
import {
    evaluatePathWarning,
    STEP_SIZE_WARNING_COLOR,
    STEP_SIZE_WARNING_STROKE_WIDTH,
    WARNING_PATHWAY_DASH,
} from "@/timeline/stepSizeWarning";
import {
    PATH_DRAW_TOLERANCE,
    sampleTimelinePath,
    sampleTimelinePathStretches,
} from "@/timeline/timelinePaths";
import {
    rgbaOf,
    type DotPlan,
    type OverlayPlan,
    type Rgba,
    type StrokePlan,
} from "./timelineOverlays";

/**
 * Start flag positions (fork #331): what the field draws for where marchers are at the start
 * flag (S) and how they walk from there to the playhead (P). Renderer-independent, like the other
 * timeline overlay plans.
 */

/** Marchers are drawn with radius 5 field units; a dot is a third of that across. */
export const START_FLAG_DOT_RADIUS = 5 / 3;
/** Solid black: the field stays white in the dark theme too. */
export const START_FLAG_DOT_COLOR: Rgba = [0, 0, 0, 1];

/** A thin gray line, the same on screen at any zoom. */
export const START_FLAG_PATH_WIDTH = 1;
export const START_FLAG_PATH_COLOR: Rgba = [0.5, 0.5, 0.5, 1];

export type StartFlagOverlayInput = {
    readonly resolver: Pick<
        Resolver,
        "positionAt" | "spanInfos" | "marcherIds"
    >;
    /** The marchers on the field, in draw order */
    readonly marcherIds: readonly number[];
    /** The selected marchers, for the "selected" level */
    readonly selectedIds: ReadonlySet<number>;
    /** The start flag (S) */
    readonly fromBeat: number;
    /** The playhead (P) */
    readonly toBeat: number;
    /** The levels in effect; paths wider than dots are clamped to the dots level */
    readonly levels: StartFlagLevels;
    readonly stepSizeWarnings: boolean;
    readonly fieldProperties: FieldProperties;
};

/** Dots are in field units (they scale with the zoom), paths in screen pixels. */
export type StartFlagOverlay = {
    readonly dots: OverlayPlan;
    readonly paths: OverlayPlan;
};

/** Whether a level draws for this marcher. */
const levelDraws = (
    level: StartFlagLevel,
    marcherId: number,
    selectedIds: ReadonlySet<number>,
) => level === "all" || (level === "selected" && selectedIds.has(marcherId));

type OverlayResolver = StartFlagOverlayInput["resolver"];

/**
 * Whether the marcher's position changes anywhere in `[fromBeat, toBeat]`. Cheap for the common
 * cases: different ends, or only holds in the window; a move that comes back to where it started
 * is sampled.
 */
function movesWithin(
    resolver: OverlayResolver,
    marcherId: number,
    fromBeat: number,
    toBeat: number,
): boolean {
    const [x0, y0] = resolver.positionAt(marcherId, fromBeat);
    const [x1, y1] = resolver.positionAt(marcherId, toBeat);
    if (x0 !== x1 || y0 !== y1) return true;
    const moving = resolver
        .spanInfos(marcherId)
        .some((s) => s.kind !== "hold" && s.start < toBeat && s.end > fromBeat);
    if (!moving) return false;
    const path = sampleTimelinePath(
        resolver,
        marcherId,
        fromBeat,
        toBeat,
        PATH_DRAW_TOLERANCE,
    );
    return path !== null && path.points.length > 1;
}

const calmStroke = (points: StrokePlan["points"]): StrokePlan => ({
    points,
    color: START_FLAG_PATH_COLOR,
    width: START_FLAG_PATH_WIDTH,
    dash: null,
    round: true,
});

const warningStroke = (points: StrokePlan["points"]): StrokePlan => ({
    points,
    color: rgbaOf(STEP_SIZE_WARNING_COLOR),
    width: STEP_SIZE_WARNING_STROKE_WIDTH,
    dash: [WARNING_PATHWAY_DASH[0]!, WARNING_PATHWAY_DASH[1]!],
    round: false,
});

/** The marcher's route over the window as one gray stroke; none when it doesn't move. */
function calmRoute(input: StartFlagOverlayInput, marcherId: number) {
    const path = sampleTimelinePath(
        input.resolver,
        marcherId,
        input.fromBeat,
        input.toBeat,
        PATH_DRAW_TOLERANCE,
    );
    return path && path.points.length > 1 ? [calmStroke(path.points)] : [];
}

/**
 * The marcher's route over the window, with each stretch over the step-size threshold red and
 * dashed and the rest gray; neighboring stretches of the same kind share a stroke. None when it
 * doesn't move.
 */
function warnedRoute(
    input: StartFlagOverlayInput,
    marcherId: number,
): StrokePlan[] {
    const stretches = sampleTimelinePathStretches(
        input.resolver,
        marcherId,
        input.fromBeat,
        input.toBeat,
        PATH_DRAW_TOLERANCE,
    );
    const runs: { warning: boolean; points: { x: number; y: number }[] }[] = [];
    for (const stretch of stretches) {
        if (stretch.points.length < 2) continue;
        const warning = evaluatePathWarning({
            start: stretch.points[0]!,
            end: stretch.points[stretch.points.length - 1]!,
            distance: stretch.stride,
            counts: 1,
            fieldProperties: input.fieldProperties,
            pathEnabled: true,
            allowForceShow: false,
            warningsEnabled: true,
        }).isWarning;
        const last = runs[runs.length - 1];
        if (last && last.warning === warning)
            // Stretches meet end to end: skip the shared point
            last.points.push(...stretch.points.slice(1));
        else runs.push({ warning, points: [...stretch.points] });
    }
    return runs.map((run) =>
        run.warning ? warningStroke(run.points) : calmStroke(run.points),
    );
}

/**
 * Start flag positions over the window `[fromBeat, toBeat)`: a dot where each marcher the dots
 * level covers is at the start flag, and, for those the paths level covers too, the route it
 * walks to the playhead as the resolver samples it (curves and several moves included). Marchers
 * who don't move across the window get neither. Empty plans at home or when S isn't before P.
 */
export function planStartFlagOverlay(
    input: StartFlagOverlayInput,
): StartFlagOverlay {
    const { resolver, fromBeat, toBeat, selectedIds, levels } = input;
    const dots: DotPlan[] = [];
    // Home (beat 0) has no window, and neither does S at or past P
    if (!(fromBeat < toBeat) || toBeat <= 0) return plans(dots);
    const strokes: StrokePlan[] = [];
    for (const marcherId of input.marcherIds) {
        // A path only where its dot is drawn: paths never go wider than dots
        if (!levelDraws(levels.dots, marcherId, selectedIds)) continue;
        if (levelDraws(levels.paths, marcherId, selectedIds)) {
            const route = input.stepSizeWarnings
                ? warnedRoute(input, marcherId)
                : calmRoute(input, marcherId);
            if (route.length === 0) continue;
            strokes.push(...route);
        } else if (!movesWithin(resolver, marcherId, fromBeat, toBeat))
            continue;
        const [x, y] = resolver.positionAt(marcherId, fromBeat);
        dots.push({
            x,
            y,
            radius: START_FLAG_DOT_RADIUS,
            fill: START_FLAG_DOT_COLOR,
            stroke: null,
            strokeWidth: 0,
        });
    }
    return plans(dots, strokes);
}

const plans = (
    dots: readonly DotPlan[],
    strokes: readonly StrokePlan[] = [],
): StartFlagOverlay => ({
    dots: { units: "field", strokes: [], dots, labels: [] },
    paths: { units: "screen", strokes, dots: [], labels: [] },
});
