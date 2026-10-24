import { useRef } from "react";
import { canShowPath } from "@/timeline/stepSizeWarning";
import { useTimelineResolverStore } from "./timelineStore";
import {
    pathsIntoPage,
    type PathPage,
    type TimelinePath,
} from "./timelinePaths";

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

const NO_PATHS: ReadonlyMap<number, TimelinePath> = new Map();

type Paths = ReadonlyMap<number, TimelinePath>;

/**
 * `compute()` kept until one of `deps` changes, like `useMemo`, except that while `active` is
 * false it neither computes nor forgets: it returns the last value. Playing turns `active` off,
 * so pressing Play and then Stop on the same page reuses the samples instead of resampling every
 * marcher's path twice.
 */
function useSamplesWhileActive(
    active: boolean,
    compute: () => Paths,
    deps: readonly unknown[],
): Paths {
    const cache = useRef<{ deps: readonly unknown[]; paths: Paths } | null>(
        null,
    );
    const cached = cache.current;
    if (!active) return cached?.paths ?? NO_PATHS;
    if (
        cached &&
        cached.deps.length === deps.length &&
        cached.deps.every((d, i) => Object.is(d, deps[i]))
    )
        return cached.paths;
    const paths = compute();
    cache.current = { deps, paths };
    return paths;
}

/** The selected page's moves out, as `useTimelinePathSamples` keeps them. */
export interface TimelinePathSamples {
    /** Each marcher's move into the next page */
    readonly nextPaths: Paths;
}

/**
 * The selected page's next paths from the resolver (docs/timeline/phases/07-page-parity.md
 * P7.10): the move out of the selected page, sampled between page end beats. Where marchers came
 * from is start flag positions' (`useStartFlagOverlay`, fork #331), which replaced previous paths.
 *
 * Cost: the samples are kept per resolver version and page pair, so toggles and visual changes
 * don't resample, and neither do Play and Stop; paths that can't show (the toggle off and no
 * forced warning) aren't sampled; nothing is sampled while playing or while `enabled` is false,
 * and the last samples are returned instead.
 */
export function useTimelinePathSamples({
    enabled,
    isPlaying,
    selectedPage,
    pages,
    marcherIds,
    nextPathsEnabled,
    stepSizeWarningsEnabled,
}: {
    enabled: boolean;
    isPlaying: boolean;
    selectedPage: PathRenderPage | null;
    pages: readonly PathRenderPage[];
    marcherIds: readonly number[] | undefined;
    nextPathsEnabled: boolean;
    stepSizeWarningsEnabled: boolean;
}): TimelinePathSamples & { readonly active: boolean } {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const active = enabled && !isPlaying && resolver !== null;

    const nextPage = selectedPage
        ? findPage(pages, selectedPage.nextPageId)
        : null;
    const sampleOut = canShowPath({
        pathEnabled: nextPathsEnabled,
        allowForceShow: true,
        warningsEnabled: stepSizeWarningsEnabled,
    });

    const nextPaths = useSamplesWhileActive(
        active,
        () =>
            sampleOut && marcherIds
                ? pathsIntoPage(resolver!, marcherIds, nextPage, selectedPage)
                : NO_PATHS,
        [sampleOut, resolver, version, marcherIds, selectedPage, nextPage],
    );
    return { nextPaths, active };
}
