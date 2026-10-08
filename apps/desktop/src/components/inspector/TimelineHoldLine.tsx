import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
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
 * "Moves here" or "Holding since Page X", where the selected marchers agree; nothing when they
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
                className="text-sub text-text/60 px-6"
                data-testid="timeline-hold-line"
            >
                {t("inspector.marcher.timeline.movesHere", {
                    defaultValue: "Moves here",
                })}
            </p>
        );
    const { page } = state;
    return (
        <p className="text-sub text-text/60 px-6">
            <button
                type="button"
                className="hover:underline"
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
                {t("inspector.marcher.timeline.holdingSince", {
                    defaultValue: "Holding since Page {page}",
                    page: page.name,
                })}
            </button>
        </p>
    );
}

/**
 * The marcher inspector's quiet line for the selected marchers (UI-15): whether they move on the
 * current page or hold there, with a jump to the page they hold from. Only in timeline mode.
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
