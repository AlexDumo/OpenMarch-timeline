/**
 * The flats wear the marchers show: the wanted one once its art is composed, and until then the
 * one they showed before (step 5 of fork #1257). A mode switch, or any edit that changes the
 * band's pack, swaps the art and the palette together: the marchers never show the new colors on
 * the old art, or the bare palette.
 *
 * It composes (acquires) the wanted wear's atlases for the body types that wear flats now, then
 * hands the wear on and lets go: `useMarcherFlats` acquires the same atlases at once, and the
 * atlas cache keeps a released atlas a moment, so nothing composes twice. The first wear, a
 * change to no wear, and a change with nobody wearing flats pass straight through. A compose that
 * fails hands the wear on anyway, so the colors never get stuck.
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
        let held = true;
        const letGo = () => {
            if (!held) return;
            held = false;
            for (const body of list) cache.release(wanted.key, body, dpi);
        };
        const done = list.map((body) => cache.acquire(wanted.key, body, dpi));
        void Promise.allSettled(done).then(() => {
            if (!live) return;
            setSettled(wanted);
            // the marchers acquire the same atlases as they take the wear; the cache keeps a
            // released atlas a moment, so it's still there
            letGo();
        });
        return () => {
            live = false;
            letGo();
        };
        // `settled` changes only to `wanted`, which ends the hold
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted, bodies, dpi, cache]);
    return settled;
}
