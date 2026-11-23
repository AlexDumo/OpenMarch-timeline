// cspell:ignore raycaster Panini hfov
/**
 * What the picture's lens is right now, shared by seat view
 * (`../SeatView.tsx`), which draws with it through the post pipeline, and
 * the camera rig, which turns pointer positions into rays with it.
 *
 * In seat view the canvas isn't the camera's own projection: it is the
 * Panini remap of a wider source (`core/post/panini.ts`). A ray from
 * `Raycaster.setFromCamera` would then miss what the pointer is over,
 * badly at the sides. Every pick in the window goes through
 * `setRayFromScreen` and `projectToScreen` instead, which invert the lens
 * the last frame was drawn with, in closed form. With no lens they are the
 * plain camera's.
 */
import { Vector3, type Camera, type Raycaster, type Vector2 } from "three";
import {
    screenToSource,
    sourceToScreen,
    type PaniniFrame,
} from "@/view3d/core/post/panini";
import { SEAT_VIEW_DEFAULTS } from "@/view3d/core/post/seatViewSource";

export const seatLens = {
    /**
     * The lens and extents of the last frame drawn, or null while the
     * canvas shows the camera's own projection. Seat view sets it.
     */
    frame: null as PaniniFrame | null,
    /**
     * Seat view's horizontal field of view at the current seat (the head's
     * zoom), in degrees. The rig sets it each frame.
     */
    hfovDeg: SEAT_VIEW_DEFAULTS.hfovDeg,
    /** False where the renderer can't draw seat view (no half-float targets). */
    available: true,
};

const scratch = new Vector3();

/** Points `raycaster` through a canvas point (`ndc`, -1..1) as the picture shows it. */
export function setRayFromScreen(
    raycaster: Raycaster,
    ndc: Vector2,
    camera: Camera,
): void {
    const frame = seatLens.frame;
    if (!frame) {
        raycaster.setFromCamera(ndc, camera);
        return;
    }
    const [u, v] = screenToSource(ndc.x, ndc.y, frame);
    raycaster.camera = camera;
    raycaster.ray.origin.setFromMatrixPosition(camera.matrixWorld);
    raycaster.ray.direction
        .set(u, v, -1)
        .transformDirection(camera.matrixWorld);
}

/**
 * Where on the canvas (NDC, -1..1) the picture shows a world point, or null
 * for a point behind the eye. `camera`'s world matrices must be current.
 */
export function projectToScreen(
    point: readonly [number, number, number],
    camera: Camera,
): [number, number] | null {
    const p = scratch.set(...point).applyMatrix4(camera.matrixWorldInverse);
    if (p.z >= 0) return null;
    const frame = seatLens.frame;
    if (!frame) {
        scratch.set(...point).project(camera);
        return [scratch.x, scratch.y];
    }
    return sourceToScreen(p.x / -p.z, p.y / -p.z, frame);
}

/** Radians the view turns per canvas pixel at the middle of the picture. */
export function radiansPerPixel(widthPx: number, camera: Camera): number {
    const frame = seatLens.frame;
    // On the Panini plane, as on a camera's image plane, a unit is a
    // radian at the middle.
    if (frame) return (2 * frame.halfX) / Math.max(1, widthPx);
    const fov =
        "fov" in camera && typeof camera.fov === "number" ? camera.fov : 45;
    const aspect =
        "aspect" in camera && typeof camera.aspect === "number"
            ? camera.aspect
            : 1;
    return (
        (2 * Math.tan((fov * Math.PI) / 180 / 2) * aspect) /
        Math.max(1, widthPx)
    );
}
