import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTolgee } from "@tolgee/react";
import { useTimingObjects } from "@/hooks";
import {
    allMarchersQueryOptions,
    moveMarchersToNeighborPageMutationOptions,
} from "@/hooks/queries";
import {
    setMarchersToNeighborPage,
    type NeighborPageDirection,
    type NeighborPageScope,
} from "@/utilities/setMarchersToNeighborPage";
import {
    clearPageScopedLabel,
    clearPageLabelsNow,
    useClearPagePage,
} from "@/timeline/timelineClearPage";
import { useActionHandler } from "../useActionHandler";
import { useEditorReadiness } from "./useEditorReadiness";

/** Clear this page's partial result is a quiet message, not a warning (#573) */
const clearPageNotify = {
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    note: (message: string) => toast.message(message),
};

/** "Set all or selected marchers to the previous or next page" (`setMarchersToNeighborPage`, P7.6). */
export function useBatchEditActionHandlers() {
    const { t } = useTolgee();
    const { selectedPage, ready, selectedMarchers } = useEditorReadiness();
    const { pages } = useTimingObjects()!;
    // "All" means the performers: props and equipment stay put
    const { data: performers } = useQuery(allMarchersQueryOptions());
    // Writes over the selected page's box (P7.6)
    const { mutateAsync: moveMarchersToNeighborPageAsync } = useMutation(
        moveMarchersToNeighborPageMutationOptions(),
    );
    const enabled = ready && !!pages && pages.length > 0;
    const hasSelection = enabled && selectedMarchers.length > 0;

    const run = (
        direction: NeighborPageDirection,
        scope: NeighborPageScope,
        followBack = false,
    ) =>
        void setMarchersToNeighborPage({
            direction,
            scope,
            selectedPage: selectedPage!,
            pages,
            selectedMarcherIds: selectedMarchers.map((m) => m.id),
            followBack,
            performerIds: performers?.map((m) => m.id),
            writeTimeline: moveMarchersToNeighborPageAsync,
            notify: clearPageNotify,
            t: (key, params) => t(key, params),
        });

    useClearPageActionHandlers({
        run: (scope, followBack) => run("previous", scope, followBack),
        enabled,
        hasSelection,
        selectedPage,
        selectedMarchers,
        performers,
    });
    useActionHandler("setAllMarchersToNextPage", () => run("next", "all"), {
        enabled,
    });
    useActionHandler(
        "setSelectedMarchersToNextPage",
        () => run("next", "selected"),
        { enabled: hasSelection },
    );
}

/**
 * Clear this page's four actions (#573): **Clear Page N** for all or the selected marchers, named
 * for the selected page in the palette, and **Clear Page N, Pages N–M follow back**, on only when
 * a later page would follow back. Their labels are read only when asked (`clearPageLabelsNow`).
 */
function useClearPageActionHandlers({
    run,
    enabled,
    hasSelection,
    selectedPage,
    selectedMarchers,
    performers,
}: {
    run: (scope: NeighborPageScope, followBack: boolean) => void;
    enabled: boolean;
    hasSelection: boolean;
    selectedPage: Parameters<typeof useClearPagePage>[0];
    selectedMarchers: readonly { readonly id: number }[];
    performers: readonly { readonly id: number }[] | undefined;
}) {
    const selectedIds = useMemo(
        () => selectedMarchers.map((m) => m.id),
        [selectedMarchers],
    );
    const performerIds = useMemo(
        () => (performers ?? []).map((m) => m.id),
        [performers],
    );
    const clearPage = useClearPagePage(selectedPage);
    // Read when the palette asks, so the follow-back check doesn't run on every edit
    const all = () => clearPageLabelsNow(clearPage, performerIds);
    const selected = () => clearPageLabelsNow(clearPage, selectedIds);
    useActionHandler("setAllMarchersToPreviousPage", () => run("all", false), {
        enabled,
        label: () => {
            const labels = all();
            return labels
                ? clearPageScopedLabel(labels.clear, "all")
                : undefined;
        },
    });
    useActionHandler(
        "setSelectedMarchersToPreviousPage",
        () => run("selected", false),
        {
            enabled: hasSelection,
            label: () => {
                const labels = selected();
                return labels
                    ? clearPageScopedLabel(labels.clear, "selected")
                    : undefined;
            },
        },
    );
    useActionHandler(
        "setAllMarchersToPreviousPageAndFollowing",
        () => run("all", true),
        {
            enabled: () => enabled && !!all()?.followBack,
            label: () => {
                const followBack = all()?.followBack;
                return followBack
                    ? clearPageScopedLabel(followBack, "all")
                    : undefined;
            },
        },
    );
    useActionHandler(
        "setSelectedMarchersToPreviousPageAndFollowing",
        () => run("selected", true),
        {
            enabled: () => hasSelection && !!selected()?.followBack,
            label: () => {
                const followBack = selected()?.followBack;
                return followBack
                    ? clearPageScopedLabel(followBack, "selected")
                    : undefined;
            },
        },
    );
}
