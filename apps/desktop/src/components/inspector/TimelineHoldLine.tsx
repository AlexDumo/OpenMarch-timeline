import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    marcherHoldState,
    sharedHoldState,
    type HoldState,
    type NamedFlag,
} from "@/timeline/timelineHoldState";
import { pageFlags } from "@/timeline/timelinePlayhead";
import {
    resolverSpans,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";

/**
 * The selection's state on the current page, in timeline mode (docs/timeline/ui.md UI-15):
 * "Moves on this page" or "Hold from Page X", where the selected marchers agree; nothing when they
 * don't. The current page is the selected page, which follows the paused playhead
 * (`useTimelinePageBridge`).
 */
export function useSelectionHoldState(
    marcherIds: readonly number[],
): HoldState | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const { pages } = useTimingObjects()!;
    const { selectedPage } = useSelectedPage()!;
    return useMemo(() => {
        void version; // a new version means new spans
        if (!resolver || !selectedPage || marcherIds.length === 0) return null;
        const all = pageFlags(pages);
        const current = all.find((f) => f.page.id === selectedPage.id);
        if (!current) return null;
        const flags: NamedFlag[] = all.map((f) => ({
            beat: f.flag,
            name: f.page.name,
        }));
        return sharedHoldState(
            marcherIds.map((id) =>
                marcherHoldState(
                    resolverSpans(resolver, id),
                    current.flag,
                    flags,
                ),
            ),
        );
    }, [resolver, version, pages, selectedPage, marcherIds]);
}

function TimelineHoldLineContent({
    marcherIds,
}: {
    marcherIds: readonly number[];
}) {
    const { t } = useTranslate();
    const state = useSelectionHoldState(marcherIds);
    if (!state) return null;
    if (state.kind === "movesHere")
        return (
            <p
                className="text-body text-text px-6 leading-none"
                data-testid="timeline-hold-line"
            >
                {t("inspector.marcher.timeline.movesOnThisPage", {
                    defaultValue: "Moves on this page",
                })}
            </p>
        );
    const { page } = state;
    return (
        <p className="px-6 leading-none">
            <button
                type="button"
                className="text-body text-text decoration-text/40 hover:decoration-text focus-visible:ring-accent rounded-6 inline-flex items-center gap-4 leading-none underline underline-offset-4 focus-visible:ring focus-visible:outline-none"
                data-testid="timeline-hold-line"
                title={t("inspector.marcher.timeline.goToPage", {
                    defaultValue: "Go to Page {page}",
                    page: page.name,
                })}
                // The go-to-page navigation: the playhead to the page's flag
                onClick={() =>
                    useTimelineSelectionStore.getState().seek(page.beat)
                }
            >
                {t("inspector.marcher.timeline.holdFrom", {
                    defaultValue: "Hold from Page {page}",
                    page: page.name,
                })}
                <ArrowRightIcon size={14} aria-hidden />
            </button>
        </p>
    );
}

/**
 * The marcher inspector's line for the selected marchers (UI-15), under Step Size: whether they
 * move on the current page or hold there, with a link to the page they hold from
 * (defined-coordinates 08: readable, and visibly a link). Only in timeline mode.
 */
export default function TimelineHoldLine({
    marcherIds,
}: {
    marcherIds: readonly number[];
}) {
    const timelineMode = useTimelineMode();
    if (!timelineMode) return null;
    return <TimelineHoldLineContent marcherIds={marcherIds} />;
}
