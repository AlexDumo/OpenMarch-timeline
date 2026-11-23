/**
 * PROTOTYPE: the 3D View's camera, told to the editor so the 2D field can
 * show where it is looking. A BroadcastChannel keeps the prototype out of the
 * IPC contract; both windows share the app origin (and the web build's).
 */
export const CAMERA_POSE_CHANNEL = "om-proto-view3d-camera";

export interface CameraPose {
    /** Camera position in world meters (y up, field at z <= 0). */
    position: [number, number, number];
    /** Unit view direction. */
    direction: [number, number, number];
    /** Vertical field of view in degrees. */
    fov: number;
    aspect: number;
    /** Date.now() when sent; the editor hides a stale pose. */
    at: number;
}

export function openPoseChannel(): BroadcastChannel | null {
    try {
        return typeof BroadcastChannel === "undefined"
            ? null
            : new BroadcastChannel(CAMERA_POSE_CHANNEL);
    } catch {
        return null;
    }
}
