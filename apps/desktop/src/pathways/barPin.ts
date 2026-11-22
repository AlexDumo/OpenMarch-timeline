import type { XY } from "@/shapes/types";
import type { PathSession } from "./pathPenStore";

/**
 * Where the path bar stays while a path or trail is drawn (#1102). It's pinned where it first
 * appeared, so it doesn't run from the pointer on its way to Finish (sim round 3: a click meant
 * for Finish landed on the field). But a drawing that grows under it (a corner clicked past it,
 * the trail run on) would hide the work, so once the placed points change and what's drawn now
 * reaches under the pinned bar, it moves clear, to where it would go now. The pointer alone never
 * moves it: only a placed point does. Pure.
 */

/** The pinned bar: its top left in the field element's px, and the points it was pinned with */
export interface BarPin {
    readonly left: number;
    readonly top: number;
    readonly key: string;
}

/** The placed points of a drawing, as a key that changes when one is added, moved or removed */
export const placedKey = (s: PathSession): string =>
    s.points.map((p) => `${p.at.x},${p.at.y}`).join(";");

/** Room kept round the bar: a point this near its edge counts as under it */
const CLEAR_PX = 6;

/** Whether any of `points` is under the bar at `pin`, `width` × `height`, or within `CLEAR_PX` */
export function barCovers(
    pin: { left: number; top: number },
    width: number,
    height: number,
    points: readonly XY[],
): boolean {
    return points.some(
        (p) =>
            p.x >= pin.left - CLEAR_PX &&
            p.x <= pin.left + width + CLEAR_PX &&
            p.y >= pin.top - CLEAR_PX &&
            p.y <= pin.top + height + CLEAR_PX,
    );
}

/**
 * The pin after this render: kept while the placed points are the same; when they changed, moved
 * to `place` if what's drawn (`drawn`, in the field element's px) reaches under it, else kept with
 * the new key
 */
export function nextPin(
    pin: BarPin,
    key: string,
    place: { left: number; top: number },
    size: { width: number; height: number },
    drawn: readonly XY[],
): BarPin {
    if (pin.key === key) return pin;
    return barCovers(pin, size.width, size.height, drawn)
        ? { left: place.left, top: place.top, key }
        : { ...pin, key };
}
