import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { allMarchersQueryOptions } from "@/hooks/queries";
import type {
    NeighborPageDirection,
    NeighborPageScope,
} from "@/utilities/setMarchersToNeighborPage";
import {
    clearEveryoneFollowingLabel,
    clearEveryoneLabel,
    clearPageFollowBackReader,
    clearPageLabel,
    clearPageScopedLabel,
    copyFromNextPageLabel,
    useClearPagePage,
} from "@/timeline/timelineClearPage";
import { holdTerm } from "@/timeline/holdTerms";
import { holdActionOptions, useHoldCommands } from "@/timeline/useHoldCommands";
import { useNeighborPageCommand } from "@/timeline/useNeighborPageCommand";
import type { HoldEntryState } from "@/timeline/holdMenuState";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

/**
 * "Set all or selected marchers to the previous or next page" (`setMarchersToNeighborPage`, P7.6).
 * Previous page is **Clear this page**: for the selection, it's off where every selected marcher
 * is already Not defined, when it shows checked, as the hold commands are (`useHoldCommands`). On
 * the first page it still runs and says there's no previous page.
 */
export function useBatchEditActionHandlers() {
    const { selectedPage, ready, selectedMarchers } = useEditorReadiness();
    const { pages } = useTimingObjects()!;
    // "All" means the performers: props and equipment stay put
    const { data: performers } = useQuery(allMarchersQueryOptions());
    const neighborPage = useNeighborPageCommand();
    // While playing the selected page stays behind the playhead, so these would write to the wrong one
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const enabled = ready && !!pages && pages.length > 0 && !isPlaying;
    const hasSelection = enabled && selectedMarchers.length > 0;
    // Until the performers load, "all" would take in props and equipment too
    const hasPerformers = enabled && performers !== undefined;
    const idsKey = selectedMarchers.map((m) => m.id).join(",");
    const marcherIds = useMemo(
        () => (idsKey === "" ? [] : idsKey.split(",").map(Number)),
        [idsKey],
    );
    const clearEntry = useHoldCommands(pages, marcherIds, undefined).entriesOn(
        selectedPage?.id,
    )?.clearThisPage;

    const run = (
        direction: NeighborPageDirection,
        scope: NeighborPageScope,
        followBack = false,
    ) =>
        neighborPage({
            direction,
            scope,
            selectedPage: selectedPage!,
            selectedMarcherIds: selectedMarchers.map((m) => m.id),
            followBack,
            performerIds: performers?.map((m) => m.id),
        });

    useClearPageActionHandlers({
        run: (scope, followBack) => run("previous", scope, followBack),
        enabled: hasPerformers,
        hasSelection,
        selectedPage,
        selectedIds: marcherIds,
        performers,
        clearEntry,
    });
    useActionHandler("setAllMarchersToNextPage", () => run("next", "all"), {
        enabled: hasPerformers,
    });
    useActionHandler(
        "setSelectedMarchersToNextPage",
        () => run("next", "selected"),
        {
            enabled: hasSelection,
            menuLabel: () => copyFromNextPageLabel(),
        },
    );
}

/** The field menu's words for Clear: its heading says who for a selection, the entry for everyone */
function useClearMenuLabels(
    selectedPage: { readonly name: string } | null,
    clearPage: ReturnType<typeof useClearPagePage>,
    performerIds: readonly number[],
) {
    const read = useMemo(
        () => clearPageFollowBackReader(undefined, clearEveryoneFollowingLabel),
        [],
    );
    return {
        clearSelected: () =>
            clearPage
                ? clearPageLabel(clearPage.name)
                : holdTerm("clearThisPage"),
        clearEveryone: () =>
            selectedPage
                ? clearEveryoneLabel(selectedPage.name)
                : holdTerm("clearThisPage"),
        everyoneFollowBack: () => read(clearPage, performerIds) ?? undefined,
    };
}

/**
 * Clear this page's four actions (#573): **Clear Page N** for all or the selected marchers, named
 * for the selected page in the palette, and **Clear Page N, Pages N–M follow back**, on only when
 * a later page would follow back. Their labels are read only when asked; the follow-back check
 * runs only for the follow-back actions (`clearPageFollowBackReader`).
 */
function useClearPageActionHandlers({
    run,
    enabled,
    hasSelection,
    selectedPage,
    selectedIds,
    performers,
    clearEntry,
}: {
    run: (scope: NeighborPageScope, followBack: boolean) => void;
    enabled: boolean;
    hasSelection: boolean;
    selectedPage: Parameters<typeof useClearPagePage>[0];
    /** The selected marchers, stable while the selection is */
    selectedIds: readonly number[];
    performers: readonly { readonly id: number }[] | undefined;
    /** Clear this page's entry for the selection on the selected page (`useHoldCommands`) */
    clearEntry: HoldEntryState | undefined;
}) {
    const performerIds = useMemo(
        () => (performers ?? []).map((m) => m.id),
        [performers],
    );
    const clearPage = useClearPagePage(selectedPage);
    // The plain labels only name the page; the follow-back check runs only for the follow-back
    // actions, when the palette asks, and once for both of an action's reads
    const plain = (scope: "all" | "selected") =>
        clearPage
            ? clearPageScopedLabel(clearPageLabel(clearPage.name), scope)
            : undefined;
    const readFollowBack = useMemo(() => clearPageFollowBackReader(), []);
    const menu = useClearMenuLabels(selectedPage, clearPage, performerIds);
    const all = () => readFollowBack(clearPage, performerIds);
    const selected = () => readFollowBack(clearPage, selectedIds);
    useActionHandler("setAllMarchersToPreviousPage", () => run("all", false), {
        enabled,
        label: () => plain("all"),
        menuLabel: menu.clearEveryone,
    });
    useActionHandler(
        "setSelectedMarchersToPreviousPage",
        () => run("selected", false),
        {
            enabled:
                hasSelection &&
                (clearEntry === undefined || clearEntry.changes > 0),
            ...holdActionOptions(clearEntry),
            label: () => plain("selected"),
            menuLabel: menu.clearSelected,
        },
    );
    useActionHandler(
        "setAllMarchersToPreviousPageAndFollowing",
        () => run("all", true),
        {
            enabled: () => enabled && all() !== null,
            label: () => {
                const followBack = all();
                return followBack
                    ? clearPageScopedLabel(followBack, "all")
                    : undefined;
            },
            menuLabel: menu.everyoneFollowBack,
        },
    );
    useActionHandler(
        "setSelectedMarchersToPreviousPageAndFollowing",
        () => run("selected", true),
        {
            enabled: () => hasSelection && selected() !== null,
            label: () => {
                const followBack = selected();
                return followBack
                    ? clearPageScopedLabel(followBack, "selected")
                    : undefined;
            },
            menuLabel: () => selected() ?? undefined,
        },
    );
}
