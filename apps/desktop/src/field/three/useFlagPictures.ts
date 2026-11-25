import { useEffect, useState } from "react";
import { useShowFlags } from "@/hooks/queries/useShowFlags";
import { showAssetBlobCache } from "@/hooks/queries/useShowAssets";
import { drawPictureAtlas, type PictureAtlas } from "./iconBatch";

/**
 * The show's flags' pictures in one texture (fork #985), for the 2D field's equipment icons:
 * drawn again only when a flag is added or removed, and only while `wanted` (icons are on). Null
 * until drawn, and for a show without flags; its icons are the Flag icon until then.
 */
export function useFlagPictures(wanted: boolean): PictureAtlas | null {
    const flags = useShowFlags(wanted);
    const key = wanted
        ? flags
              .filter((f) => f.thumbnail)
              .map((f) => `${f.value}|${f.thumbnail}`)
              .join(",")
        : "";
    const [drawn, setDrawn] = useState<{
        key: string;
        atlas: PictureAtlas | null;
    } | null>(null);
    useEffect(() => {
        if (!key) return;
        let live = true;
        let made: PictureAtlas | null = null;
        const entries = key.split(",").map((entry) => {
            const at = entry.lastIndexOf("|");
            return { value: entry.slice(0, at), hash: entry.slice(at + 1) };
        });
        void (async () => {
            const pictures = await Promise.all(
                entries.map(async ({ value, hash }) => ({
                    value,
                    png: await showAssetBlobCache.get(hash),
                })),
            );
            made = await drawPictureAtlas(
                pictures.flatMap(({ value, png }) =>
                    png ? [{ value, png }] : [],
                ),
            );
            if (live) setDrawn({ key, atlas: made });
            else made?.texture.dispose();
        })().catch((error: unknown) =>
            console.warn("The field's flag pictures couldn't be drawn", error),
        );
        return () => {
            live = false;
            // after the icons' next layout has moved them to the new pictures, so the field never
            // draws with a texture that's gone
            const old = made;
            if (old)
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => old.texture.dispose()),
                );
        };
    }, [key]);
    return key && drawn?.key === key ? drawn.atlas : null;
}
