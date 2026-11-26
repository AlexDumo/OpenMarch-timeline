/**
 * The flats wear the marchers show: the wanted one once its art is composed, and until then the
 * one they showed before (step 5 of fork #1257). A mode switch, or any edit that changes the
 * band's pack, swaps the art and the palette together: the marchers never show the new colors on
 * the old art, or the bare palette.
 *
 * It composes (acquires) the wanted wear's atlases for the body types that wear flats now, then
 * hands the wear on, and holds them until the wear changes again. By then `useMarcherFlats` has
 * taken them too. Letting go as it handed the wear on left a gap with nobody holding them, and a
 * dispose timer from an earlier switch could free them in it: the marchers then showed the new
 * colors on the old art while the atlas was composed again (GPU recording, PR #1298). The first
 * wear, a change to no wear, and a change with nobody wearing flats pass straight through. A
 * compose that fails hands the wear on anyway, so the colors never get stuck.
 */
import { useEffect, useState } from "react";
import type {
    FlatsArtworkKey,
    FlatsWear,
} from "@/view3d/core/marchers/uniformArtwork";
import type { BodyType } from "@/view3d/core/marchers/looks";
import { acquireFlats, releaseFlats } from "../performers/marchers/flatsAtlas";

export interface FlatsCache {
    acquire: (
        id: FlatsArtworkKey,
        body: BodyType,
        dpi: number,
    ) => Promise<unknown>;
    release: (id: FlatsArtworkKey, body: BodyType, dpi: number) => void;
}

const ATLASES: FlatsCache = { acquire: acquireFlats, release: releaseFlats };

/**
 * @param wanted the wear the venue asks for (`useFlatsWear`)
 * @param bodies the body types (as the atlases are keyed) that wear flats now, comma-joined
 * @param dpi the atlases' resolution
 */
export function useSettledFlatsWear(
    wanted: FlatsWear | null,
    bodies: string,
    dpi: number,
    cache: FlatsCache = ATLASES,
): FlatsWear | null {
    const [settled, setSettled] = useState(wanted);
    useEffect(() => {
        if (settled === wanted) return;
        const list = bodies ? (bodies.split(",") as BodyType[]) : [];
        if (!wanted || !settled || list.length === 0) {
            setSettled(wanted);
            return;
        }
        let live = true;
        const done = list.map((body) => cache.acquire(wanted.key, body, dpi));
        void Promise.allSettled(done).then(() => {
            if (live) setSettled(wanted);
        });
        return () => {
            live = false;
            // held until the wear changes again (or the view closes): the marchers have taken
            // these atlases by then
            for (const body of list) cache.release(wanted.key, body, dpi);
        };
        // `settled` changes only to `wanted`; the hold lasts until `wanted` changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted, bodies, dpi, cache]);
    return settled;
}
