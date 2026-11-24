import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import { allItemsQueryOptions } from "@/hooks/queries/useItems";
import { itemLabel } from "@/components/items/ItemRows";
import tolgee from "@/global/singletons/Tolgee";

/**
 * A click on a locked item passes over it (props epic step 2), so it says why instead of doing
 * nothing (owner rule: no dead clicks): "Marimba is locked. Right-click it to unlock it." One at
 * a time, however often it's clicked.
 */
export function noticeLockedItemClick(
    queryClient: QueryClient,
    marcherId: number,
): void {
    const item = queryClient
        .getQueryData(allItemsQueryOptions().queryKey)
        ?.find((i) => i.marcher_id === marcherId);
    if (!item) return;
    toast.info(tolgee.t("field.lockedItemClicked", { name: itemLabel(item) }), {
        id: "locked-item-click",
    });
}
