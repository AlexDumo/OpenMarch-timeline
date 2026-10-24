import type { FieldProperties } from "@openmarch/core";

/**
 * Scene coordinates (ADR 0006 D-3): field pixels (`FieldProperties.PIXELS_PER_INCH`) with the
 * origin at the field's centre front point, on the 50 at the front sideline. x grows toward
 * side 2, y grows toward the audience (so everything on the field has y ≤ 0).
 */
export interface ScenePoint {
    x: number;
    y: number;
}

/** A scene point in the field's own pixel frame (origin at the back left corner) */
export const sceneToFieldPixels = (
    fp: FieldProperties,
    p: ScenePoint,
): ScenePoint => ({
    x: p.x + fp.centerFrontPoint.xPixels,
    y: p.y + fp.centerFrontPoint.yPixels,
});

/** A point in the field's pixel frame as a scene point */
export const fieldPixelsToScene = (
    fp: FieldProperties,
    p: ScenePoint,
): ScenePoint => ({
    x: p.x - fp.centerFrontPoint.xPixels,
    y: p.y - fp.centerFrontPoint.yPixels,
});

/** Steps from the centre front: x toward side 2, y toward the front, as checkpoints count */
export const sceneToSteps = (
    fp: FieldProperties,
    p: ScenePoint,
): ScenePoint => ({
    x: p.x / fp.pixelsPerStep,
    y: p.y / fp.pixelsPerStep,
});

export const stepsToScene = (
    fp: FieldProperties,
    steps: ScenePoint,
): ScenePoint => ({
    x: steps.x * fp.pixelsPerStep,
    y: steps.y * fp.pixelsPerStep,
});

/** The field's rectangle in scene units, with `margin` around it for the labels */
export function fieldSceneBounds(fp: FieldProperties, margin = 0) {
    return {
        x: -fp.centerFrontPoint.xPixels - margin,
        y: -fp.centerFrontPoint.yPixels - margin,
        width: fp.width + 2 * margin,
        height: fp.height + 2 * margin,
    };
}
