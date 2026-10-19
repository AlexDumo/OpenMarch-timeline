import { useEffect, useRef, useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getFieldPropertiesImage } from "@/global/classes/FieldProperties";
import { fieldPropertiesKeys } from "@/hooks/queries/useFieldProperties";
import { DEFAULT_STALE_TIME } from "@/hooks/queries/constants";
import type { FieldImage, FieldImageSize } from "@/db-functions/fieldFloor";

/**
 * The show's field image: the floor's original for 2D and exports (`"print"`), its display
 * texture for the 3D tarp (`"display"`). The key sits under the field properties' detail key,
 * so the editor's field-properties invalidation (which follows every floor change) refreshes it
 * too.
 */
export const fieldImageQueryOptions = (use: "print" | "display" = "print") =>
    queryOptions<FieldImage | null>({
        queryKey: [...fieldPropertiesKeys.detail(), "image", use],
        queryFn: async () => (await getFieldPropertiesImage(use)) ?? null,
        staleTime: DEFAULT_STALE_TIME,
    });

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
    if (a === b) return true;
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
    return true;
}

function sameSize(a: FieldImageSize | null, b: FieldImageSize | null) {
    return (
        a === b ||
        (!!a && !!b && a.widthM === b.widthM && a.heightM === b.heightM)
    );
}

export interface FieldImageState {
    /** The decoded image, or null when the show has none (or it won't decode). */
    image: ImageBitmap | null;
    /** The floor's physical size, centered on the field; null places the image by fill or fit */
    size: FieldImageSize | null;
    /** False until the bytes are read and, if there are any, decoded. */
    loaded: boolean;
}

/**
 * The show's field image, decoded once per distinct image. Reloads that
 * return the same bytes keep the same `ImageBitmap`, so the field surface
 * doesn't rebuild for them.
 */
export function useFieldImage(
    use: "print" | "display" = "print",
): FieldImageState {
    const { data, isSuccess, isError } = useQuery(fieldImageQueryOptions(use));
    const [state, setState] = useState<FieldImageState>({
        image: null,
        size: null,
        loaded: false,
    });
    const lastBytes = useRef<Uint8Array | null | undefined>(undefined);

    useEffect(() => {
        if (isError) {
            setState({ image: null, size: null, loaded: true });
            return;
        }
        if (!isSuccess) return;
        const bytes = data?.bytes ?? null;
        const size = data?.size ?? null;
        if (
            lastBytes.current !== undefined &&
            sameBytes(lastBytes.current, bytes)
        ) {
            // Same image, perhaps at a new size: keep the bitmap
            setState((s) => (sameSize(s.size, size) ? s : { ...s, size }));
            return;
        }
        lastBytes.current = bytes;
        if (!bytes || bytes.byteLength === 0) {
            setState({ image: null, size: null, loaded: true });
            return;
        }
        let cancelled = false;
        let settled = false;
        createImageBitmap(new Blob([bytes as BlobPart]))
            .then((image) => {
                settled = true;
                if (!cancelled) setState({ image, size, loaded: true });
            })
            .catch((error: unknown) => {
                settled = true;
                console.error("Couldn't decode the field image", error);
                if (!cancelled)
                    setState({ image: null, size: null, loaded: true });
            });
        return () => {
            cancelled = true;
            // A decode cancelled before it finished must run again.
            if (!settled) lastBytes.current = undefined;
        };
    }, [data, isSuccess, isError]);

    return state;
}
