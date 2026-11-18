/**
 * A prop lifted and tilted (fork #1087): the instance matrix for a prop turned by `rotation` on the
 * ground, tilted by `pitch` and `roll` in its own frame, and raised by `elevation`.
 *
 * Tilts turn about the middle of the prop's height, so a panel that tips over stays in place
 * instead of sinking into the ground. Pitch brings the prop's top toward its front (+z, the
 * audience when unturned); roll lays its top toward its right (+x). With no tilt the matrix is
 * exactly the plain turned one, so props without a tilt draw as before.
 *
 * Pure: plain numbers into a column-major 4×4 array, as three.js's `InstancedMesh` reads it.
 */

/** The yaw and tilts of one prop, in degrees */
export interface PropTurn {
    rotation: number;
    pitch: number;
    roll: number;
}

/** Whether a prop stands level: no tilt (none given counts as none), or whole turns of it */
export const isLevel = ({ pitch, roll }: { pitch?: number; roll?: number }) =>
    nearWholeTurn(pitch ?? 0) && nearWholeTurn(roll ?? 0);

const LEVEL_TOLERANCE_DEG = 0.5;
const nearWholeTurn = (deg: number) => {
    const r = ((deg % 360) + 360) % 360;
    return r < LEVEL_TOLERANCE_DEG || r > 360 - LEVEL_TOLERANCE_DEG;
};

/**
 * Writes the matrix at `index` in `out`: scale by `size` (x, y, z), tilt about `pivotY` (in the
 * scaled prop's own frame, measured up from its underside), turn, and place its underside's center
 * at (`x`, `y`, `z`).
 */
export function writePosedMatrix(
    out: Float32Array,
    index: number,
    turn: PropTurn,
    size: { x: number; y: number; z: number },
    at: { x: number; y: number; z: number },
    pivotY: number,
): void {
    const yaw = (turn.rotation * Math.PI) / 180;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const o = index * 16;
    if (turn.pitch === 0 && turn.roll === 0) {
        // The plain turn: unit x to (cos, 0, sin), unit z to (-sin, 0, cos)
        out[o] = size.x * cy;
        out[o + 1] = 0;
        out[o + 2] = size.x * sy;
        out[o + 3] = 0;
        out[o + 4] = 0;
        out[o + 5] = size.y;
        out[o + 6] = 0;
        out[o + 7] = 0;
        out[o + 8] = -size.z * sy;
        out[o + 9] = 0;
        out[o + 10] = size.z * cy;
        out[o + 11] = 0;
        out[o + 12] = at.x;
        out[o + 13] = at.y;
        out[o + 14] = at.z;
        out[o + 15] = 1;
        return;
    }
    const p = (turn.pitch * Math.PI) / 180;
    const r = (turn.roll * Math.PI) / 180;
    const cp = Math.cos(p),
        sp = Math.sin(p),
        cr = Math.cos(r),
        sr = Math.sin(r);
    // Rows of turn · pitch · roll, where pitch takes +y toward +z and roll takes +y toward +x:
    // turn = [cy 0 -sy; 0 1 0; sy 0 cy], pitch = [1 0 0; 0 cp -sp; 0 sp cp],
    // roll = [cr sr 0; -sr cr 0; 0 0 1]
    // pitch · roll
    const a00 = cr,
        a01 = sr,
        a02 = 0;
    const a10 = -cp * sr,
        a11 = cp * cr,
        a12 = -sp;
    const a20 = -sp * sr,
        a21 = sp * cr,
        a22 = cp;
    // turn · (pitch · roll)
    const m00 = cy * a00 - sy * a20,
        m01 = cy * a01 - sy * a21,
        m02 = cy * a02 - sy * a22;
    const m10 = a10,
        m11 = a11,
        m12 = a12;
    const m20 = sy * a00 + cy * a20,
        m21 = sy * a01 + cy * a21,
        m22 = sy * a02 + cy * a22;
    // Columns, scaled
    out[o] = m00 * size.x;
    out[o + 1] = m10 * size.x;
    out[o + 2] = m20 * size.x;
    out[o + 3] = 0;
    out[o + 4] = m01 * size.y;
    out[o + 5] = m11 * size.y;
    out[o + 6] = m21 * size.y;
    out[o + 7] = 0;
    out[o + 8] = m02 * size.z;
    out[o + 9] = m12 * size.z;
    out[o + 10] = m22 * size.z;
    out[o + 11] = 0;
    // The pivot stays put: at + (0, pivot, 0) - R · (0, pivot, 0)
    out[o + 12] = at.x - m01 * pivotY;
    out[o + 13] = at.y + pivotY - m11 * pivotY;
    out[o + 14] = at.z - m21 * pivotY;
    out[o + 15] = 1;
}
