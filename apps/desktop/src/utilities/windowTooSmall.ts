/**
 * The smallest window the editor fits in. Below it the toolbar, field,
 * timeline and Inspector overlap or squeeze the field to a strip, so the app
 * says so instead (src/components/layout/WindowTooSmallNotice.tsx).
 *
 * - Width: an iPad mini in portrait (744), the narrowest screen the tablet
 *   layout supports (docs/tablet-layout.md). Phones are out of scope.
 * - Height: at 500 the field still has about 190 px above the timeline;
 *   below it, it is a sliver.
 *
 * Electron's own minimum (768 × 600, electron/main/index.ts) is above both,
 * so on the desktop app this only shows when zoomed in.
 */
export const MIN_WINDOW_WIDTH = 744;
export const MIN_WINDOW_HEIGHT = 500;

export function isWindowTooSmall(width: number, height: number): boolean {
    return width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT;
}
