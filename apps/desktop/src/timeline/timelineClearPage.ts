import { useMemo } from "react";
import { toast } from "sonner";
import type { Resolver } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import type Page from "@/global/classes/Page";
import type { TimelineClearPageMenu } from "@/components/timeline/TimelineRangeMenu";
import {
    setMarchersToNeighborPage,
    type NeighborPageScope,
} from "@/utilities/setMarchersToNeighborPage";
import { samePosition } from "@/db-functions/timelineMoves";
import {
    useTimelineSelectionStore,
    type PageBox,
} from "@/stores/TimelineSelectionStore";
import { pageEndBeat } from "./timelineCanvas";
import { followingPages, pageKeepStates } from "./timelineKeepLater";
import { keepPagesOfBoxes } from "./timelineOnlyThisPage";
import type { PageBoxRange } from "./timelinePageBoxState";
import { resolverSpans, useTimelineResolverStore } from "./timelineStore";
import { moveMarchersAndOfferFollowUp } from "./timelineMoveThemToo";
import { toastTimelineError } from "./timelineErrorMessages";

/**
 * **Clear Page N** and **Clear Page N, Pages N–M follow back** (#573), worded as Remove keyframe's
 * pair (`timelineUnset.ts`). Clear this page takes the marchers out of every move over the page,
 * so it is Not set; the later pages that showed its spot either keep where they were (the first
 * item: the next page gets a move of its own) or follow back to the page before (the second). The
 * second is offered only when some later page really takes the page's spot
 * (`clearFollowingPages`); otherwise the two would do the same.
 */

/** A translate function, as Tolgee's `t` with a default value. */
type Translate = (
    key: string,
    defaultValue: string,
    params?: Record<string, string>,
) => string;

const tolgeeTranslate: Translate = (key, defaultValue, params) =>
    tolgee.t(key, defaultValue, params);

/**
 * The later pages that would follow back if `marcherIds` were cleared from the page box `box`, in
 * page order, or null when none would. A marcher counts when it has a move of its own over the
 * page that leaves it somewhere else than where the page starts (so the clear moves it), and the
 * pages after are the run of boxes it follows into with no move of its own (`followingPages`).
 */
export function clearFollowingPages({
    resolver,
    boxes,
    marcherIds,
    box,
}: {
    resolver: Resolver | null;
    boxes: readonly PageBox[];
    marcherIds: readonly number[];
    box: PageBoxRange;
}): string[] | null {
    if (!resolver || marcherIds.length === 0) return null;
    const pages = keepPagesOfBoxes(boxes);
    const page = pages.find(
        (p) => p.range?.start === box.start && p.flag === box.end,
    );
    if (!page) return null;
    const spansOf = (id: number) => resolverSpans(resolver, id);
    const cleared = marcherIds.filter(
        (id) =>
            spansOf(id).some(
                (s) =>
                    s.kind !== "hold" && s.start < box.end && s.end > box.start,
            ) &&
            !samePosition(
                resolver.positionAt(id, box.end),
                resolver.positionAt(id, box.start),
            ),
    );
    if (cleared.length === 0) return null;
    const states = pageKeepStates({ pages, marcherIds: cleared, spansOf });
    return followingPages(states, page.id)?.names ?? null;
}

/** "Clear Page 3" */
export function clearPageLabel(
    page: string,
    translate: Translate = tolgeeTranslate,
): string {
    return translate("actions.batchEdit.clearPage", "Clear Page {page}", {
        page,
    });
}

/** "Clear Page 3, Page 4 follows back" or "Clear Page 3, Pages 4–6 follow back" */
export function clearPageFollowingLabel(
    page: string,
    following: readonly string[],
    translate: Translate = tolgeeTranslate,
): string {
    const first = following[0] ?? "";
    const last = following[following.length - 1] ?? first;
    return first === last
        ? translate(
              "actions.batchEdit.clearPageAndPage",
              "Clear Page {page}, Page {next} follows back",
              { page, next: first },
          )
        : translate(
              "actions.batchEdit.clearPageAndPages",
              "Clear Page {page}, Pages {first}–{last} follow back",
              { page, first, last },
          );
}

/** A menu label for the command palette, saying who it acts on: "Clear Page 3 (selected)". */
export function clearPageScopedLabel(
    label: string,
    scope: "all" | "selected",
    translate: Translate = tolgeeTranslate,
): string {
    return scope === "all"
        ? translate(
              "actions.batchEdit.forAllMarchers",
              "{label} (all marchers)",
              {
                  label,
              },
          )
        : translate("actions.batchEdit.forSelected", "{label} (selected)", {
              label,
          });
}

/** The two items' labels for one page and some marchers. */
export interface ClearPageLabels {
    /** "Clear Page 3" */
    readonly clear: string;
    /** "Clear Page 3, Pages 4–6 follow back", or null when no later page would follow back */
    readonly followBack: string | null;
}

/**
 * The labels for clearing `marcherIds` from `page` (its name and box), kept current with the show;
 * null without a page box (the first page).
 */
export function useClearPageLabels(
    page: ClearPagePage | null,
    marcherIds: readonly number[],
): ClearPageLabels | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const boxes = useTimelineSelectionStore((s) => s.pageBoxes);
    const name = page?.name;
    const start = page?.box.start;
    const end = page?.box.end;
    return useMemo(() => {
        void version; // a new version means new spans
        if (name === undefined || start === undefined || end === undefined)
            return null;
        const following = clearFollowingPages({
            resolver,
            boxes,
            marcherIds,
            box: { start, end },
        });
        return {
            clear: clearPageLabel(name),
            followBack: following
                ? clearPageFollowingLabel(name, following)
                : null,
        };
    }, [resolver, version, boxes, marcherIds, name, start, end]);
}

/** The page Clear this page acts on, as `useClearPageLabels` reads it. */
export interface ClearPagePage {
    readonly name: string;
    readonly box: PageBoxRange;
}

/**
 * `page`'s name and box, stable while they are; null for the first page (it has no box) or none.
 */
export function useClearPagePage(
    page: {
        readonly name: string;
        readonly previousPageId: number | null;
        readonly beats: readonly { readonly index: number }[];
    } | null,
): ClearPagePage | null {
    const name = page?.name;
    const start =
        page && page.previousPageId !== null ? page.beats[0]?.index : undefined;
    const end = start === undefined || !page ? undefined : pageEndBeat(page);
    return useMemo(
        () =>
            name === undefined || start === undefined || end === undefined
                ? null
                : { name, box: { start, end } },
        [name, start, end],
    );
}

/**
 * The page box menu's **Clear Page N** entries (#573), next to Set as shown and Hold from previous
 * page: for the selected marchers, or every performer when none is selected (then the label says
 * so). The labels are read when the menu opens, from the resolver as it is then. Each runs the
 * same command as the Alignment tab and inspector items, on the right-clicked page.
 *
 * @param run the command, for tests; defaults to `clearPageOn`
 */
export function clearPageMenu({
    pages,
    selectedIds,
    performerIds,
    run = clearPageOn,
}: {
    pages: readonly Page[];
    selectedIds: readonly number[];
    performerIds: readonly number[];
    run?: (args: ClearPageArgs) => Promise<unknown>;
}): TimelineClearPageMenu {
    const scope = selectedIds.length > 0 ? "selected" : "all";
    const marcherIds = scope === "selected" ? selectedIds : performerIds;
    const pageOf = (pageId: string | number) =>
        pages.find((p) => String(p.id) === String(pageId));
    return {
        labelsFor: (pageId) => {
            const page = pageOf(pageId);
            const first = page?.beats[0];
            if (!page || page.previousPageId === null || !first)
                return undefined;
            const following = clearFollowingPages({
                resolver: useTimelineResolverStore.getState().resolver,
                boxes: useTimelineSelectionStore.getState().pageBoxes,
                marcherIds,
                box: { start: first.index, end: pageEndBeat(page) },
            });
            const say = (label: string) =>
                scope === "all" ? clearPageScopedLabel(label, "all") : label;
            return {
                clear: say(clearPageLabel(page.name)),
                followBack: following
                    ? say(clearPageFollowingLabel(page.name, following))
                    : null,
            };
        },
        onClear: (pageId, followBack) => {
            const page = pageOf(pageId);
            if (!page) return;
            void run({ page, pages, scope, marcherIds, followBack });
        },
    };
}

/** What `clearPageOn` clears. */
export interface ClearPageArgs {
    page: Page;
    pages: readonly Page[];
    scope: NeighborPageScope;
    marcherIds: readonly number[];
    followBack: boolean;
}

/**
 * Clear this page for `marcherIds` on `page` (`setMarchersToNeighborPage`), as the batch-edit
 * actions run it: no message when everyone was cleared, a quiet one for a partial result, and a
 * refusal's toast.
 */
export function clearPageOn({
    page,
    pages,
    scope,
    marcherIds,
    followBack,
}: ClearPageArgs): Promise<number | null> {
    return setMarchersToNeighborPage({
        direction: "previous",
        scope,
        selectedPage: page,
        pages: [...pages],
        selectedMarcherIds: marcherIds,
        performerIds: marcherIds,
        followBack,
        writeTimeline: (request) =>
            moveMarchersAndOfferFollowUp(request).catch((e: unknown) => {
                toastTimelineError(e, "Error clearing the page");
                throw e;
            }),
        notify: {
            success: (message) => toast.success(message),
            error: (message) => toast.error(message),
            note: (message) => toast.message(message),
        },
        t: (key, params) => tolgee.t(key, params as never),
    });
}
