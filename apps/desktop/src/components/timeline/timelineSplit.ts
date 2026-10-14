/** The timeline's height against the canvas: the defaults, the clamp and the keyboard step. */

/** A bit taller than the content-sized timeline it replaces */
export const DEFAULT_TIMELINE_HEIGHT = 260;
export const MIN_TIMELINE_HEIGHT = 120;
export const MIN_CANVAS_HEIGHT = 200;
export const TIMELINE_SPLIT_KEY_STEP = 16;
/** Room taken by the splitter and the gaps around it */
export const TIMELINE_SPLIT_GUTTER = 16;

/**
 * Keeps the timeline at least `MIN_TIMELINE_HEIGHT` tall and leaves the canvas at least
 * `MIN_CANVAS_HEIGHT`. `available` is the workspace height the toolbar, canvas and timeline
 * share; in a window too short for both minimums the timeline's minimum wins.
 */
export function clampTimelineHeight(height: number, available: number): number {
    const max = Math.max(
        MIN_TIMELINE_HEIGHT,
        available - MIN_CANVAS_HEIGHT - TIMELINE_SPLIT_GUTTER,
    );
    const value = Number.isFinite(height) ? height : DEFAULT_TIMELINE_HEIGHT;
    return Math.round(Math.min(max, Math.max(MIN_TIMELINE_HEIGHT, value)));
}

/** A saved height from storage, or the default when it isn't a usable number */
export function parseTimelineHeight(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_TIMELINE_HEIGHT;
}
