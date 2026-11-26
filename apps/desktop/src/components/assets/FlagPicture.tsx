import { useQuery } from "@tanstack/react-query";
import { FlagIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { showAssetBlobCache } from "@/hooks/queries/useShowAssets";
import { useBytesUrl } from "@/components/items/modelImport/ModelImportReview";

/**
 * A show flag's picture (`flagPicture.ts`, fork #985): its silk cut to shape and painted, on a
 * pole. The Flag icon stands in while it loads, or for a flag stored without one.
 */
export function FlagPicture({
    hash,
    className,
}: {
    /** The picture's blob hash (`ShowFlag.thumbnail`) */
    hash: string | undefined;
    className?: string;
}) {
    const { data: png } = useQuery({
        queryKey: ["show_asset_blob", hash],
        queryFn: async () =>
            (hash ? await showAssetBlobCache.get(hash) : undefined) ?? null,
        enabled: !!hash,
        staleTime: Infinity,
    });
    const url = useBytesUrl(png ?? undefined, "image/png");
    return (
        <span
            className={clsx(
                "flex shrink-0 items-center justify-center",
                className,
            )}
            aria-hidden
        >
            {url ? (
                <img
                    src={url}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-contain"
                />
            ) : (
                <FlagIcon size={14} />
            )}
        </span>
    );
}
