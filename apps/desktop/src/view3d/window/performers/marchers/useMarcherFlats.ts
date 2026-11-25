/**
 * The flats art for the marchers that wear it (docs/3d/uniform-artwork.md):
 * one atlas per (artwork, body type) in use, and each body type's lookup
 * table. Empty until they are ready, so the marchers show their palette
 * first and their art once it's composed.
 *
 * When the art changes (an item moved, fork #1258), the last set stays on
 * the marchers until the new one is composed, so editing never flashes the
 * palette; its atlases are let go of only then.
 *
 * A set whose atlases are composed already is drawn in the render that asks
 * for it (`peekFlatsResources`), before anything holds it for the marchers.
 * The hold is taken in a layout effect, in that same commit, so a dispose
 * timer from an earlier release (an A → none → A switch, which
 * `useSettledFlatsWear` passes straight through) can't free it mid-draw
 * before a passive effect would have run.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    flatsDpi,
    isUniformPackValue,
    type FlatsArtworkKey,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import { packPagePlan } from "@/view3d/window/uniformPack/packPage";
import type { BodyType } from "@/view3d/core/marchers/looks";
import {
    acquireFlats,
    loadFlatsGeometry,
    loadFlatsLut,
    peekFlatsResources,
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
    /**
     * A saved pack's art didn't compose (`noteUniformPackDamaged` decides whether the failure
     * was the pack's own, so the settings and picker say its art is damaged)
     */
    onDamaged?: (pack: UniformPackValue, error: unknown) => void,
): FlatsResources {
    const onDamagedRef = useRef(onDamaged);
    onDamagedRef.current = onDamaged;
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
    /** Every acquired set not yet let go of: the one shown, and any being composed */
    const held = useRef(new Map<string, () => void>());
    /** The set on the marchers now, `<wantedKey>#<dpi>` (set below, as rendered) */
    const shownKey = useRef<string | null>(null);
    useEffect(() => {
        const sets = held.current;
        return () => {
            for (const release of sets.values()) release();
            sets.clear();
        };
    }, []);
    // a layout effect: the hold on a set drawn from `composed` starts in the commit that draws it
    useLayoutEffect(() => {
        if (!wantedKey) {
            // back to presets: let go of the last set (its atlases free once unused)
            setReady(null);
            for (const release of held.current.values()) release();
            held.current.clear();
            return;
        }
        let live = true;
        const dpi = flatsDpi(quality);
        const setKey = `${wantedKey}#${dpi}`;
        const pairs = wantedKey
            .split(",")
            .map((k) => k.split("|") as [FlatsArtworkKey, BodyType]);
        const release = () => {
            for (const [id, body] of pairs) releaseFlats(id, body, dpi);
        };
        // acquired once per set, even if this effect runs again for it
        held.current.get(setKey)?.();
        held.current.set(setKey, release);
        const t0 = performance.now();
        Promise.all(
            pairs.map(async ([id, body]) => {
                const [atlas, lut, { layout }] = await Promise.all([
                    acquireFlats(id, body, dpi).catch((error: unknown) => {
                        // a saved pack whose image the worker refused: the settings, the
                        // picker and Assets say its art is damaged (a draft's is its editor's)
                        if (isUniformPackValue(id)) {
                            const plan = packPagePlan(id);
                            if (!plan.draft)
                                onDamagedRef.current?.(plan.pack, error);
                        }
                        throw error;
                    }),
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
                // the new set is on the marchers: let go of every older one
                for (const [k, r] of held.current)
                    if (k !== setKey) {
                        r();
                        held.current.delete(k);
                    }
            })
            .catch((e: unknown) => {
                // eslint-disable-next-line no-console -- the palette stays; say why
                console.error("3D View: could not compose the uniform art", e);
            });
        return () => {
            live = false;
            // a set that was never shown goes now; the shown one waits for its successor
            if (
                held.current.get(setKey) === release &&
                shownKey.current !== setKey
            ) {
                release();
                held.current.delete(setKey);
            }
        };
    }, [wantedKey, quality]);
    const transition = useMemo(
        () =>
            ready && ready.quality === quality && ready.key !== wantedKey
                ? stillShown(ready.map, wantedKey)
                : null,
        [ready, quality, wantedKey],
    );
    // a set whose atlases are all composed already (a wear that waited for them, fork #1257
    // step 5) goes on the marchers in this render, with its palette: no frames of the new
    // colors on the old art while the effect above resolves them
    const composed = useMemo(() => {
        if (!wantedKey) return null;
        if (ready && ready.key === wantedKey && ready.quality === quality)
            return null;
        const dpi = flatsDpi(quality);
        const out = new Map<string, FlatsResourceValue>();
        for (const key of wantedKey.split(",")) {
            const [id, body] = key.split("|") as [FlatsArtworkKey, BodyType];
            const r = peekFlatsResources(id, body, dpi);
            if (!r) return null;
            out.set(key, r);
        }
        return out as FlatsResources;
    }, [wantedKey, quality, ready]);
    const dpi = flatsDpi(quality);
    if (!wantedKey) {
        shownKey.current = null;
        return NONE;
    }
    if (ready && ready.key === wantedKey && ready.quality === quality) {
        shownKey.current = `${wantedKey}#${dpi}`;
        return ready.map;
    }
    if (composed) {
        // drawn now: its hold lasts until a successor is on the marchers
        shownKey.current = `${wantedKey}#${dpi}`;
        return composed;
    }
    // composing a change: the previous art stays until the new one is ready
    shownKey.current = ready ? `${ready.key}#${flatsDpi(ready.quality)}` : null;
    return transition ?? NONE;
}

/**
 * The previous set's art under the keys `wantedKey` asks for, so the marchers
 * keep it while the new art composes: the same artwork's entry, or else the
 * same body type's when the previous set had one artwork.
 */
export function stillShown(
    previous: FlatsResources,
    wantedKey: string,
): FlatsResources {
    const byBody = new Map<string, FlatsResourceValue>();
    const ids = new Set<string>();
    for (const [key, value] of previous) {
        const [id, body] = key.split("|");
        ids.add(id);
        byBody.set(body, value);
    }
    const out = new Map<string, FlatsResourceValue>();
    for (const key of wantedKey.split(",")) {
        const [, body] = key.split("|");
        const value =
            previous.get(key) ??
            (ids.size === 1 ? byBody.get(body) : undefined);
        if (value) out.set(key, value);
    }
    return out;
}

type FlatsResourceValue =
    FlatsResources extends ReadonlyMap<string, infer V> ? V : never;
