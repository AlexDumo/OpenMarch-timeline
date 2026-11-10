import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslate } from "@tolgee/react";
import { useTimingObjects } from "@/hooks";
import { moveMarchersToNeighborPageMutationOptions } from "@/hooks/queries";
import {
    setMarchersToNeighborPage,
    type SetMarchersToNeighborPageArgs,
} from "@/utilities/setMarchersToNeighborPage";

/** Clear this page's partial result is a quiet message, not a warning (#573) */
const clearPageNotify = {
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    note: (message: string) => toast.message(message),
};

/**
 * Runs `setMarchersToNeighborPage` on any page: the current page for the batch-edit actions, the
 * right-clicked one for the page box menu.
 */
export function useNeighborPageCommand() {
    const { t } = useTranslate();
    const { pages } = useTimingObjects()!;
    // Writes over the page's box (P7.6)
    const { mutateAsync } = useMutation(
        moveMarchersToNeighborPageMutationOptions(),
    );
    return useCallback(
        (
            args: Omit<
                SetMarchersToNeighborPageArgs,
                "pages" | "writeTimeline" | "notify" | "t"
            >,
        ) =>
            void setMarchersToNeighborPage({
                ...args,
                pages,
                writeTimeline: mutateAsync,
                notify: clearPageNotify,
                t: (key, params) => t(key, params),
            }),
        [mutateAsync, pages, t],
    );
}
