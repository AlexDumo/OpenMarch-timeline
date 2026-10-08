// Types for the vendored instanced-marchers.js (om-pose). Hand-written; keep in step with the .js.
// Only what the app uses so far; extend as it uses more.

/** Instance matrix for a marcher at field (x, z) facing `heading` (radians about +Y, 0 = +Z), at scale h. */
export function writeMatrix(
    array: ArrayLike<number> & { [i: number]: number },
    i: number,
    x: number,
    z: number,
    heading: number,
    h?: number,
): void;
