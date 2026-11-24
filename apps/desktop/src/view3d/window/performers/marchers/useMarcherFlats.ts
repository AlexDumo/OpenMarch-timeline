/**
 * The flats art for the marchers that wear it (docs/3d/uniform-artwork.md):
 * one atlas per (artwork, body type) in use, and each body type's lookup
 * table. Empty until they are ready, so the marchers show their palette
 * first and their art once it's composed.
 */
import { useEffect, useMemo, useState } from "react";
import {
    flatsDpi,
    type FlatsArtworkKey,
} from "@/view3d/core/marchers/uniformArtwork";
import type { BodyType } from "@/view3d/core/marchers/looks";
import {
    acquireFlats,
    loadFlatsGeometry,
    loadFlatsLut,
    releaseFlats,
} from "./flatsAtlas";
import {
    flatsBody,
    flatsResourceKey,
    type FlatsResources,
    type MarcherQuality,
    type MarcherSlotLook,
} from "./marcherBodies";

const NONE: FlatsResources = new Map();

export function useMarcherFlats(
    looks: readonly MarcherSlotLook[] | null,
    quality: MarcherQuality,
): FlatsResources {
    const wantedKey = useMemo(() => {
        const out = new Set<string>();
        for (const l of looks ?? []) {
            const id = l.uniform.options.artwork;
            if (id)
                out.add(
                    flatsResourceKey(id, flatsBody(l.body.bodyType, quality)),
                );
        }
        return [...out].sort().join(",");
    }, [looks, quality]);
    const [ready, setReady] = useState<{
        key: string;
        quality: MarcherQuality;
        map: FlatsResources;
    } | null>(null);
    useEffect(() => {
        if (!wantedKey) {
            // back to presets: let go of the last set (its atlases free once unused)
            setReady(null);
            return;
        }
        let live = true;
        const dpi = flatsDpi(quality);
        const pairs = wantedKey
            .split(",")
            .map((k) => k.split("|") as [FlatsArtworkKey, BodyType]);
        const t0 = performance.now();
        Promise.all(
            pairs.map(async ([id, body]) => {
                const [atlas, lut, { layout }] = await Promise.all([
                    acquireFlats(id, body, dpi),
                    loadFlatsLut(body),
                    loadFlatsGeometry(),
                ]);
                return [
                    flatsResourceKey(id, body),
                    { atlas, lut, layout },
                ] as const;
            }),
        )
            .then((entries) => {
                if (!live) return;
                const mb =
                    entries.reduce((s, [, r]) => s + r.atlas.bytes, 0) / 1e6;
                // eslint-disable-next-line no-console -- the atlases' memory is the cost to watch (D-19)
                console.info(
                    `3D View: ${entries.length} uniform flats atlas(es) at ${dpi} px/in, ` +
                        `${mb.toFixed(1)} MB with mipmaps, in ${(performance.now() - t0).toFixed(0)} ms`,
                );
                setReady({ key: wantedKey, quality, map: new Map(entries) });
            })
            .catch((e: unknown) => {
                // eslint-disable-next-line no-console -- the palette stays; say why
                console.error("3D View: could not compose the uniform art", e);
            });
        return () => {
            live = false;
            for (const [id, body] of pairs) releaseFlats(id, body, dpi);
        };
    }, [wantedKey, quality]);
    return ready && ready.key === wantedKey && ready.quality === quality
        ? ready.map
        : NONE;
}
