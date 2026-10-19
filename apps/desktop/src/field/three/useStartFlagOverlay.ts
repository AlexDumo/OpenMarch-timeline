import { useMemo, useRef } from "react";
import type { FieldProperties, Resolver } from "@openmarch/core";
import { useStartFlagLevelsInEffect } from "@/stores/StartFlagKeyStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useIsVisualsView } from "@/stores/WorkspaceViewStore";
import {
    startFlagLevelsDrawAnything,
    type StartFlagLevels,
} from "@/timeline/startFlagLevels";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    planStartFlagOverlay,
    type StartFlagOverlay,
} from "@/field/startFlagOverlay";
import type { DotPlan, StrokePlan } from "@/field/timelineOverlays";

/** One marcher's share of the overlay: its dot, and its route when its path is drawn. */
type Piece = {
    readonly dots: readonly DotPlan[];
    readonly strokes: readonly StrokePlan[];
};

const NO_SELECTION: ReadonlySet<number> = new Set();
const DOT_ONLY: StartFlagLevels = { dots: "all", paths: "off" };
const DOT_AND_PATH: StartFlagLevels = { dots: "all", paths: "all" };

const sameDeps = (a: readonly unknown[], b: readonly unknown[] | null) =>
    b !== null &&
    a.length === b.length &&
    a.every((d, i) => Object.is(d, b[i]));

/** Whether a level draws for this marcher. */
const draws = (
    level: StartFlagLevels["dots"],
    marcherId: number,
    selected: ReadonlySet<number>,
) => level === "all" || (level === "selected" && selected.has(marcherId));

/**
 * Each marcher's dot (and route) kept per resolver version, window and warnings, so changing the
 * selection or the levels only samples the marchers that weren't sampled yet.
 */
class StartFlagPieces {
    private context: readonly unknown[] | null = null;
    private readonly pieces = new Map<string, Piece>();

    plan(input: {
        resolver: Resolver;
        version: number;
        marcherIds: readonly number[];
        selectedIds: ReadonlySet<number>;
        fromBeat: number;
        toBeat: number;
        levels: StartFlagLevels;
        stepSizeWarnings: boolean;
        fieldProperties: FieldProperties;
    }): StartFlagOverlay {
        const context = [
            input.resolver,
            input.version,
            input.fromBeat,
            input.toBeat,
            input.stepSizeWarnings,
            input.fieldProperties,
        ];
        if (!sameDeps(context, this.context)) {
            this.pieces.clear();
            this.context = context;
        }
        const dots: DotPlan[] = [];
        const strokes: StrokePlan[] = [];
        for (const marcherId of input.marcherIds) {
            if (!draws(input.levels.dots, marcherId, input.selectedIds))
                continue;
            // Paths are never drawn wider than dots
            const path = draws(
                input.levels.paths,
                marcherId,
                input.selectedIds,
            );
            const key = `${path ? "path" : "dot"}:${marcherId}`;
            let piece = this.pieces.get(key);
            if (!piece) {
                const plan = planStartFlagOverlay({
                    ...input,
                    marcherIds: [marcherId],
                    selectedIds: NO_SELECTION,
                    levels: path ? DOT_AND_PATH : DOT_ONLY,
                });
                piece = { dots: plan.dots.dots, strokes: plan.paths.strokes };
                this.pieces.set(key, piece);
            }
            dots.push(...piece.dots);
            strokes.push(...piece.strokes);
        }
        return {
            dots: { units: "field", strokes: [], dots, labels: [] },
            paths: { units: "screen", strokes, dots: [], labels: [] },
        };
    }
}

/**
 * Start flag positions on the field (fork #331): the dots and paths plans for the edit window
 * [S, P) at the levels in effect (`useStartFlagLevelsInEffect`), or `null` when nothing is drawn:
 * every level off, isolating (isolation draws its own route and ghosts), the Visuals workspace,
 * at home, or before the resolver is ready.
 *
 * Cost: nothing is sampled while the levels are off. Each marcher's dot and route are kept per
 * resolver version, window and step-size warnings, so selection and level changes only sample
 * marchers not sampled yet. Nothing is sampled while playing: the last plans stay, at the start
 * flag, as marchers leave it.
 */
export function useStartFlagOverlay({
    enabled,
    isPlaying,
    marcherIds,
    selectedIds,
    fieldProperties,
}: {
    /** The resolver is ready */
    enabled: boolean;
    isPlaying: boolean;
    marcherIds: readonly number[] | undefined;
    selectedIds: readonly number[];
    fieldProperties: FieldProperties | undefined;
}): StartFlagOverlay | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const selection = useTimelineSelectionStore((s) => s.selection);
    const isolating = useTimelineSelectionStore((s) => s.isolation !== null);
    const visuals = useIsVisualsView();
    const levels = useStartFlagLevelsInEffect();
    const stepSizeWarnings = useUiSettingsStore(
        (s) => s.uiSettings.stepSizeWarnings,
    );
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const pieces = useMemo(() => new StartFlagPieces(), []);
    const last = useRef<StartFlagOverlay | null>(null);

    const shown =
        enabled &&
        !isolating &&
        !visuals &&
        startFlagLevelsDrawAnything(levels) &&
        selection.kind === "range" &&
        resolver !== null &&
        marcherIds !== undefined &&
        fieldProperties !== undefined;
    const fromBeat = selection.kind === "range" ? selection.start : 0;
    const toBeat = selection.kind === "range" ? selection.end : 0;

    const plan = useMemo(
        () =>
            shown && !isPlaying
                ? pieces.plan({
                      resolver: resolver!,
                      version,
                      marcherIds: marcherIds!,
                      selectedIds: selected,
                      fromBeat,
                      toBeat,
                      levels,
                      stepSizeWarnings,
                      fieldProperties: fieldProperties!,
                  })
                : null,
        [
            shown,
            isPlaying,
            pieces,
            resolver,
            version,
            marcherIds,
            selected,
            fromBeat,
            toBeat,
            levels,
            stepSizeWarnings,
            fieldProperties,
        ],
    );
    if (!shown) {
        last.current = null;
        return null;
    }
    // While playing the plans from before Play stay
    if (isPlaying) return last.current;
    last.current = plan;
    return plan;
}
