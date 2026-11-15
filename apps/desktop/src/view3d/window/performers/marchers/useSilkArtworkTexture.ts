/**
 * The show's silk Artwork as the silks' texture (fork #973): reads the row
 * the venue settings name, decodes the PNG, and hands it to every silk
 * material (`setSilkArtwork`), with the trim's place in the image for the
 * show's silk shape. Returns whether Artwork is on the silks, so the looks
 * mark their silks for it only once it can be drawn.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as THREE from "three";
import { silkArtworkQueryOptions } from "@/hooks/queries/useSilkArtwork";
import {
    SILK_ARTWORK_MAX_PX,
    silkArtworkTrimRect,
} from "@/view3d/core/silkArtwork";
import { silkShapeSurface } from "@/view3d/core/artworkTemplates/surfaces";
import { silkShape, type SilkShapeId } from "@/view3d/core/sizes/silkShapes";
import { requestDraw } from "../../drawWake";
import { setSilkArtwork } from "./silkSet";

export function useSilkArtworkTexture(
    id: number | undefined,
    shape: SilkShapeId,
): boolean {
    const { data: row } = useQuery(silkArtworkQueryOptions(id));
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!row) {
            setSilkArtwork(null);
            setShown(false);
            return;
        }
        let cancelled = false;
        let texture: THREE.Texture | null = null;
        const scale = Math.min(
            1,
            SILK_ARTWORK_MAX_PX / Math.max(row.width, row.height),
        );
        void createImageBitmap(
            new Blob([row.data as Uint8Array<ArrayBuffer>], {
                type: "image/png",
            }),
            {
                // three doesn't flip an ImageBitmap: flip it here, so its top
                // row is at v = 1 as the silk shader expects
                imageOrientation: "flipY",
                premultiplyAlpha: "none",
                ...(scale < 1
                    ? {
                          resizeWidth: Math.max(
                              1,
                              Math.round(row.width * scale),
                          ),
                          resizeHeight: Math.max(
                              1,
                              Math.round(row.height * scale),
                          ),
                          resizeQuality: "high" as const,
                      }
                    : {}),
            },
        )
            .then((bitmap) => {
                if (cancelled) {
                    bitmap.close();
                    return;
                }
                texture = new THREE.Texture(bitmap);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = 4;
                texture.needsUpdate = true;
                setSilkArtwork(
                    texture,
                    silkArtworkTrimRect(
                        row.width,
                        row.height,
                        silkShapeSurface(silkShape(shape)),
                    ),
                );
                setShown(true);
                requestDraw(600);
            })
            .catch((error: unknown) => {
                console.warn("3D View: couldn't read the silk Artwork", error);
                setSilkArtwork(null);
                setShown(false);
            });
        return () => {
            cancelled = true;
            if (texture) {
                setSilkArtwork(null);
                (texture.image as ImageBitmap | undefined)?.close?.();
                texture.dispose();
            }
        };
    }, [row, shape]);
    return shown;
}
