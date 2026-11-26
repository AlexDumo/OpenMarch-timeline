import { runAction } from "@/shortcuts/registry";

/** Where the settings remember the section last shown (read by `sections.ts`) */
export const SETTINGS_SECTION_STORAGE_KEY = "openmarch:settingsSection";

/**
 * Opens Settings at one section, as a link such as Show on field's "Settings › Field" does: the
 * section is remembered first, so a window that opens shows it, and one already open switches
 * to it (`SettingsBody` follows the key). Through the Settings action, so it opens wherever
 * that does (its own window, or the web editor's sheet).
 */
export function openSettingsAt(section: string): void {
    try {
        localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
    } catch {
        // Remembering the section is a convenience only
    }
    runAction("openSettings");
}
