import { useEffect, useMemo } from "react";
import type { FieldProperties } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { canShowPath } from "@/global/classes/canvasObjects/stepSizeWarning";
import type { MarcherVisualMap } from "@/hooks/queries";
import type { TimelineEditSelection } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "./timelineStore";
import { pageFlags, type FlagPage } from "./timelinePlayhead";
import { pathsBetweenBeats, type TimelinePath } from "./timelinePaths";

/** A span of spec beats a path is sampled over, `start` to `end`. */
export interface PathBeatRange {
    readonly start: number;
    readonly end: number;
}

/** What the previous and next paths cover; `null` for a side with nothing to draw. */
export interface TimelinePathRanges {
    readonly previous: PathBeatRange | null;
    readonly next: PathBeatRange | null;
}

const NO_RANGES: TimelinePathRanges = { previous: null, next: null };

/**
 * The previous and next paths in timeline mode (docs/timeline/ui.md UI-9 Page-relative tools,
 * P8.12): with a timeline (a range) selected, the previous path runs from the positions at its
 * start to those at its end, and the next path from its end to the next flag after it (none past
 * the last flag). With home or nothing selected, there are no paths.
 */
export function timelinePathRanges(
    selection: TimelineEditSelection,
    pages: readonly FlagPage[],
): TimelinePathRanges {
    if (selection.kind !== "range") return NO_RANGES;
    const nextFlag = pageFlags(pages).find((f) => f.flag > selection.end);
    return {
        previous: { start: selection.start, end: selection.end },
        next: nextFlag ? { start: selection.end, end: nextFlag.flag } : null,
    };
}

const NO_PATHS: ReadonlyMap<number, TimelinePath> = new Map();

/**
 * Draws the path visuals from the resolver in timeline mode
 * (docs/timeline/phases/07-page-parity.md P7.10), over the spans `timelinePathRanges` gives: the
 * move through the selected timeline and the move after it to the next flag, as curves sampled
 * between those beats, with midsets and step-size warnings from the same samples. Replaces the
 * page-mode effect in `Canvas.tsx`, which draws straight lines from `marcher_pages`.
 *
 * Cost: the samples are kept per resolver version and span, so toggles and visual changes redraw
 * without resampling; a side that can't show (its toggle off and no forced warning) isn't
 * sampled; nothing is sampled or drawn while playing, as with `useTimelineStaticRender`.
 *
 * Does nothing while `enabled` is false (the flag is off, or the resolver isn't ready yet, when
 * the page-mode paths stand in, as the marchers do). When it turns false, the curved paths are
 * removed so the page-mode effect's straight paths are the only ones left.
 */
// eslint-disable-next-line max-lines-per-function
export function useTimelinePathRender({
    canvas,
    enabled,
    isPlaying,
    ranges,
    marcherIds,
    marcherVisuals,
    fieldProperties,
    previousPathsEnabled,
    nextPathsEnabled,
    stepSizeWarningsEnabled,
}: {
    canvas: OpenMarchCanvas | null;
    enabled: boolean;
    isPlaying: boolean;
    ranges: TimelinePathRanges;
    marcherIds: readonly number[] | undefined;
    marcherVisuals: MarcherVisualMap | null | undefined;
    fieldProperties: FieldProperties | undefined;
    previousPathsEnabled: boolean;
    nextPathsEnabled: boolean;
    stepSizeWarningsEnabled: boolean;
}): void {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const active = enabled && !isPlaying && resolver !== null;

    const previousStart = ranges.previous?.start ?? null;
    const previousEnd = ranges.previous?.end ?? null;
    const nextStart = ranges.next?.start ?? null;
    const nextEnd = ranges.next?.end ?? null;
    const sampleInto = canShowPath({
        pathEnabled: previousPathsEnabled,
        allowForceShow: false,
        warningsEnabled: stepSizeWarningsEnabled,
    });
    const sampleOut = canShowPath({
        pathEnabled: nextPathsEnabled,
        allowForceShow: true,
        warningsEnabled: stepSizeWarningsEnabled,
    });

    const previousPaths = useMemo(
        () =>
            active &&
            sampleInto &&
            marcherIds &&
            previousStart !== null &&
            previousEnd !== null
                ? pathsBetweenBeats(
                      resolver!,
                      marcherIds,
                      previousStart,
                      previousEnd,
                  )
                : NO_PATHS,
        // `version` changes whenever the resolver's answers may have
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            active,
            sampleInto,
            resolver,
            version,
            marcherIds,
            previousStart,
            previousEnd,
        ],
    );
    const nextPaths = useMemo(
        () =>
            active &&
            sampleOut &&
            marcherIds &&
            nextStart !== null &&
            nextEnd !== null
                ? pathsBetweenBeats(resolver!, marcherIds, nextStart, nextEnd)
                : NO_PATHS,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [active, sampleOut, resolver, version, marcherIds, nextStart, nextEnd],
    );

    useEffect(() => {
        if (!canvas) return;
        if (!enabled) {
            canvas.removeTimelinePathways();
            return;
        }
        if (
            !active ||
            !marcherIds ||
            marcherVisuals == null ||
            !fieldProperties
        )
            return;

        // With no timeline selected the maps are empty, which clears the paths
        canvas.renderTimelinePathVisuals({
            marcherVisuals,
            marcherIds,
            previousPaths,
            nextPaths,
            previousPathsEnabled,
            nextPathsEnabled,
            stepSizeWarningsEnabled,
            fieldProperties,
        });
        canvas.sendCanvasMarchersToFront();
        canvas.requestRenderAll();
    }, [
        canvas,
        enabled,
        active,
        marcherIds,
        marcherVisuals,
        fieldProperties,
        previousPaths,
        nextPaths,
        previousPathsEnabled,
        nextPathsEnabled,
        stepSizeWarningsEnabled,
    ]);
}
