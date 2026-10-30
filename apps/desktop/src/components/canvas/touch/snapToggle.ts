import type { SnapToggle } from "./TouchModifierButtons";

/**
 * The Snap toggle for the touch pill's magnet, or undefined while the app has none.
 *
 * TODO(#511, modifiers/host-5): once the Snap toggle lands, return
 * `{ on: uiSettings.snap, toggle: () => setSnap() }` from `useUiSettingsStore`; the magnet shows
 * from then on.
 */
export function useSnapToggle(): SnapToggle | undefined {
    return undefined;
}
