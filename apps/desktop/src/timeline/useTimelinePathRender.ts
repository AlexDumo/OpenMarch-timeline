import { useEffect } from "react";
import type { FieldProperties } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { MarcherVisualMap } from "@/hooks/queries";
import { useTimelineResolverStore } from "./timelineStore";
import { pathsIntoPage, type PathPage } from "./timelinePaths";

/** The page fields this hook reads. `Page` satisfies it. */
export interface PathRenderPage extends PathPage {
    readonly id: number;
    readonly previousPageId: number | null;
    readonly nextPageId: number | null;
}

const findPage = (
    pages: readonly PathRenderPage[],
    id: number | null,
): PathRenderPage | null => pages.find((p) => p.id === id) ?? null;

/**
 * Draws the selected page's path visuals from the resolver in timeline mode
 * (docs/timeline/phases/07-page-parity.md P7.10): the move into the selected page and the move
 * out of it, as curves sampled between page end beats, with midsets and step-size warnings from
 * the same samples. Redraws when the resolver's answers change. Replaces the page-mode effect in
 * `Canvas.tsx`, which draws straight lines from `marcher_pages`.
 *
 * Does nothing while `enabled` is false (the flag is off, or the resolver isn't ready yet, when
 * the page-mode paths stand in, as the marchers do). When it turns false, the curved paths are
 * removed so the page-mode effect's straight paths are the only ones left.
 */
export function useTimelinePathRender({
    canvas,
    enabled,
    selectedPage,
    pages,
    marcherIds,
    marcherVisuals,
    fieldProperties,
    previousPathsEnabled,
    nextPathsEnabled,
    stepSizeWarningsEnabled,
}: {
    canvas: OpenMarchCanvas | null;
    enabled: boolean;
    selectedPage: PathRenderPage | null;
    pages: readonly PathRenderPage[];
    marcherIds: readonly number[] | undefined;
    marcherVisuals: MarcherVisualMap | null | undefined;
    fieldProperties: FieldProperties | undefined;
    previousPathsEnabled: boolean;
    nextPathsEnabled: boolean;
    stepSizeWarningsEnabled: boolean;
}): void {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);

    useEffect(() => {
        if (!canvas) return;
        if (!enabled) {
            canvas.removeTimelinePathways();
            return;
        }
        if (
            !resolver ||
            !selectedPage ||
            !marcherIds ||
            marcherVisuals == null ||
            !fieldProperties
        )
            return;

        const previousPage = findPage(pages, selectedPage.previousPageId);
        const nextPage = findPage(pages, selectedPage.nextPageId);
        canvas.renderTimelinePathVisuals({
            marcherVisuals,
            marcherIds: [...marcherIds],
            previousPaths: pathsIntoPage(
                resolver,
                marcherIds,
                selectedPage,
                previousPage,
            ),
            nextPaths: pathsIntoPage(
                resolver,
                marcherIds,
                nextPage,
                selectedPage,
            ),
            currentPageCounts: selectedPage.counts,
            nextPageCounts: nextPage?.counts,
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
        resolver,
        version,
        selectedPage,
        pages,
        marcherIds,
        marcherVisuals,
        fieldProperties,
        previousPathsEnabled,
        nextPathsEnabled,
        stepSizeWarningsEnabled,
    ]);
}
