/**
 * Set order's sweep and the order line's look (pathways step 4g, DL-27, DL-30), pure: who a drag
 * through the line picks up and in what order, the order kept when the drag ends, and the color
 * of the line at each marcher (its widths are `orderLineGeometry`'s).
 */

export type XY = { readonly x: number; readonly y: number };

/** How near the pointer counts as passing a marcher, at least, in screen pixels: zoomed out it still works */
export const SWEEP_MIN_PX = 10;

/**
 * How near the pointer must pass a marcher for it to join, in field units: half a step, or
 * {@link SWEEP_MIN_PX} on screen when that's more (zoomed out)
 *
 * @param pixelsPerStep field units in one step
 * @param zoom screen pixels per field unit
 */
export function sweepTolerance(pixelsPerStep: number, zoom: number): number {
    return Math.max(pixelsPerStep / 2, SWEEP_MIN_PX / Math.max(zoom, 1e-9));
}

/** Where along `from`→`to` the point `p` is nearest (0 to 1), and how far it is from there */
function nearestOnSegment(
    from: XY,
    to: XY,
    p: XY,
): { t: number; distance: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length2 = dx * dx + dy * dy;
    const t =
        length2 === 0
            ? 0
            : Math.min(
                  1,
                  Math.max(
                      0,
                      ((p.x - from.x) * dx + (p.y - from.y) * dy) / length2,
                  ),
              );
    return {
        t,
        distance: Math.hypot(p.x - (from.x + t * dx), p.y - (from.y + t * dy)),
    };
}

/**
 * The marchers picked once the pointer went from `from` to `to` (a press is `from` = `to`): those
 * already `picked`, then each of `candidates` the way passed within `tolerance` of, in the order it
 * passed them. A marcher passed twice stays where it first joined.
 */
export function sweepThrough({
    picked,
    from,
    to,
    candidates,
    tolerance,
}: {
    picked: readonly number[];
    from: XY;
    to: XY;
    candidates: ReadonlyMap<number, XY>;
    tolerance: number;
}): number[] {
    const already = new Set(picked);
    const passed: { id: number; t: number; distance: number }[] = [];
    for (const [id, at] of candidates) {
        if (already.has(id)) continue;
        const near = nearestOnSegment(from, to, at);
        if (near.distance <= tolerance) passed.push({ id, ...near });
    }
    // Along the way; two passed at the same point, the nearer first
    passed.sort((a, b) => a.t - b.t || a.distance - b.distance || a.id - b.id);
    return passed.length === 0
        ? [...picked]
        : [...picked, ...passed.map((p) => p.id)];
}

/**
 * The order kept when Set order ends: the marchers `picked`, then the other `selected` ones (those
 * skipped) in the order they had (`before`, the order shown when the mode opened), then anyone
 * neither names, by id
 */
export function orderAfterSweep({
    picked,
    before,
    selected,
}: {
    picked: readonly number[];
    before: readonly number[] | null;
    selected: readonly number[];
}): number[] {
    const chosen = new Set(selected);
    const out = picked.filter((id) => chosen.has(id));
    const placed = new Set(out);
    for (const id of before ?? [])
        if (chosen.has(id) && !placed.has(id)) {
            out.push(id);
            placed.add(id);
        }
    for (const id of [...chosen].sort((a, b) => a - b))
        if (!placed.has(id)) {
            out.push(id);
            placed.add(id);
        }
    return out;
}

// ---------------------------------------------------------------------------
// The order line's look (DL-30)
// ---------------------------------------------------------------------------

/** The leader's color: sky blue (from a palette made for color-blind readers), readable for color-blind users and light in grey */
export const ORDER_LEADER_COLOR = "#56B4E9";
/** The tail's color: deep red (ColorBrewer RdBu), dark in grey, so lightness alone carries the order */
export const ORDER_TAIL_COLOR = "#B2182B";
/** The thin dark halo under the line, so it reads on green turf and on a white field */
export const ORDER_HALO_COLOR = "rgba(15, 23, 42, 0.6)";

type Lab = readonly [number, number, number];

const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToOkLab(hex: string): Lab {
    const n = Number.parseInt(hex.slice(1), 16);
    const r = toLinear(((n >> 16) & 255) / 255);
    const g = toLinear(((n >> 8) & 255) / 255);
    const b = toLinear((n & 255) / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

function okLabToHex([L, A, B]: Lab): string {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return `#${rgb
        .map((c) =>
            Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

const LEADER_LAB = hexToOkLab(ORDER_LEADER_COLOR);
const TAIL_LAB = hexToOkLab(ORDER_TAIL_COLOR);

/**
 * The line's color `t` of the way from the leader (0) to the tail (1), blended in OKLab so the
 * middle stays clean rather than going muddy
 */
export function orderColorAt(t: number): string {
    const u = Math.min(1, Math.max(0, t));
    return okLabToHex([
        LEADER_LAB[0] + (TAIL_LAB[0] - LEADER_LAB[0]) * u,
        LEADER_LAB[1] + (TAIL_LAB[1] - LEADER_LAB[1]) * u,
        LEADER_LAB[2] + (TAIL_LAB[2] - LEADER_LAB[2]) * u,
    ]);
}

/** How far along the line marcher `i` of `count` is, 0 at the leader and 1 at the tail */
export const orderFraction = (i: number, count: number): number =>
    count <= 1 ? 0 : i / (count - 1);
