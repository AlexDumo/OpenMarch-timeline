import { create } from "zustand";
import { syncFromStorage } from "@/stores/syncFromStorage";

export type FocusableComponents = "canvas" | "timeline";
export interface UiSettings {
    lockX: boolean;
    lockY: boolean;
    isPlaying: boolean;
    /** Whether to show the full database path in the title bar */
    showFullDatabasePath: boolean;
    /** Boolean to view previous page's paths/dots */
    previousPaths: boolean;
    /** Boolean to view next page's paths/dots */
    nextPaths: boolean;
    /** Boolean to force-show over-threshold paths and apply step-size warning styling */
    stepSizeWarnings: boolean;
    /** Boolean to show collision markers on the canvas */
    showCollisions: boolean;
    /** Boolean to view lines for every step on the field */
    gridLines: boolean;
    /** Boolean to view lines for every four steps on the field */
    halfLines: boolean;
    /** The number of pixels per second in the timeline */
    timelinePixelsPerSecond: number;
    /** The timeline-mode timeline's zoom, in pixels per beat (UI-12: remembered) */
    timelinePixelsPerBeat: number;
    /** Whether the timeline-mode timeline is drawn as its compact strip (UI-12) */
    timelineCompact: boolean;
    /** Whether the timeline was fitted to the show, so the next show opens fitted (UI-12) */
    timelineZoomFitted: boolean;
    /** The current audio volume percentage for timeline playback */
    audioVolume: number;
    /** Whether all app audio is muted */
    audioMuted: boolean;
    /** The component that is currently focussed */
    focussedComponent: FocusableComponents;
    /** Mouse settings */
    mouseSettings: {
        /** Whether to enable trackpad mode (specific handling for macOS trackpads) */
        trackpadMode: boolean;
        /** Trackpad wheel pan sensitivity (0.1-3.0) */
        trackpadPanSensitivity: number;
        /** Zoom sensitivity multiplier. Default: 1.0 (100%). Range 0.5-4.0. */
        zoomSensitivity: number;
    };
    coordinateRounding?: {
        /** In steps, the closest step to round to on the X-axis, offset on the nearestXSteps */
        nearestXSteps?: number;
        /** In steps, the offset from the center-front point to round to on the X-axis */
        referencePointX?: number;
        /** In steps, the closest step to round to on the Y-axis, offset on the nearestYSteps */
        nearestYSteps?: number;
        /** In steps, the offset from the center-front point to round to on the Y-axis */
        referencePointY?: number;
    };
    /**
     * Marcher labels on the field: full drill numbers, numbers only, or `auto` (numbers only
     * when zoomed out so far that full ones at 2 steps apart would overlap)
     */
    marcherLabels?: MarcherLabelForm;
    /** Marcher labels' size on the field and in the Shape preview */
    marcherLabelSize?: MarcherLabelSize;
    /** Marcher labels above their dots, or beside them (to the right) */
    marcherLabelPosition?: "above" | "beside";
    /** What the Shape tool's preview shows; see `ShapePreviewView` */
    shapePreview?: Partial<ShapePreviewView>;
    /** Whether to enable Tolgee In-Context Translating */
    tolgeeDevTools?: boolean;
    /** Tolgee API Key for In-Context Translating */
    tolgeeApiKey?: string;
}

export type MarcherLabelForm = "auto" | "names" | "numbers";
export type MarcherLabelSize = "small" | "normal" | "large";

/** How much each label size scales the labels' normal size */
export const LABEL_SIZE_SCALE: Record<MarcherLabelSize, number> = {
    small: 0.7,
    normal: 1,
    large: 1.4,
};

/** The Shape tool's view options. `auto` picks by the band's size and spacing */
export interface ShapePreviewView {
    /** Walks drawn: every one, only those with a problem, or none (pointing still shows one) */
    paths: "auto" | "all" | "problems" | "collisions" | "none";
    /** Labels on the new spots and where marchers start */
    labels: "auto" | "names" | "numbers" | "none";
    /** The shape being replaced: `auto` shows it until the new one is edited */
    oldShape: "auto" | "show" | "hide";
    /** Where marchers start, and their walks: faint, or drawn strongly (easier on the grid) */
    starts: "auto" | "faint" | "strong" | "off";
    /** Working: every mark; Show: only the marchers where they'll stand, as the show will look */
    look: "working" | "walks" | "show";
    /** Handles away from the pointer: faded, hidden, or always shown */
    handles: "fade" | "hide" | "show";
}

export const defaultShapePreviewView: ShapePreviewView = {
    paths: "auto",
    labels: "auto",
    oldShape: "auto",
    starts: "auto",
    look: "working",
    handles: "fade",
};

// Default settings that will be used if no localStorage data exists
export const defaultSettings: UiSettings = {
    isPlaying: false,
    lockX: false,
    lockY: false,
    showFullDatabasePath: false,
    previousPaths: false,
    nextPaths: false,
    stepSizeWarnings: false,
    showCollisions: false,
    gridLines: true,
    halfLines: true,
    timelinePixelsPerSecond: 40,
    timelinePixelsPerBeat: 16,
    timelineCompact: false,
    timelineZoomFitted: false,
    audioVolume: 100,
    audioMuted: false,
    focussedComponent: "canvas",
    mouseSettings: {
        trackpadMode: true,
        trackpadPanSensitivity: 0.5,
        zoomSensitivity: 1.0,
    },
    coordinateRounding: {
        nearestXSteps: 0,
        referencePointX: undefined,
        nearestYSteps: 0,
        referencePointY: undefined,
    },
    marcherLabels: "auto",
    tolgeeDevTools: false,
};

export const UI_SETTINGS_STORAGE_KEY = "openmarch:uiSettings";

const clampZoomSensitivity = (value: number): number =>
    Math.min(4.0, Math.max(0.5, value));

// Helper function to parse settings from a JSON string
// Throws on bad JSON or invalid structure
const parseSettings = (raw: string): UiSettings => {
    const parsed = JSON.parse(raw) as UiSettings;
    const mergedMouseSettings = {
        ...defaultSettings.mouseSettings,
        ...parsed.mouseSettings,
    };
    if (mergedMouseSettings.zoomSensitivity !== undefined) {
        mergedMouseSettings.zoomSensitivity = clampZoomSensitivity(
            mergedMouseSettings.zoomSensitivity,
        );
    }
    // Merge with default settings to ensure all properties exist
    // Deep merge nested objects to preserve new properties in defaults
    return {
        ...defaultSettings,
        ...parsed,
        mouseSettings: mergedMouseSettings,
        coordinateRounding: parsed.coordinateRounding
            ? {
                  ...defaultSettings.coordinateRounding,
                  ...parsed.coordinateRounding,
              }
            : defaultSettings.coordinateRounding,
    };
};

// Helper function to load settings from localStorage
const loadSettings = (): UiSettings => {
    try {
        const stored = localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
        return stored ? parseSettings(stored) : defaultSettings;
    } catch (error) {
        console.error("Failed to load UI settings from localStorage:", error);
        return defaultSettings;
    }
};

// Helper function to save settings to localStorage
const saveSettings = (settings: UiSettings): void => {
    try {
        localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error("Failed to save UI settings to localStorage:", error);
    }
};

interface UiSettingsStoreState {
    uiSettings: UiSettings;
}
interface UiSettingsStoreActions {
    fetchUiSettings: () => void;
    setUiSettings: (uiSettings: UiSettings, type?: keyof UiSettings) => void;
    setPixelsPerSecond: (pixelsPerSecond: number) => void;
    setTimelinePixelsPerBeat: (pixelsPerBeat: number) => void;
    setTimelineZoomFitted: (fitted: boolean) => void;
    /** Turns the compact timeline on or off (`!timelineCompact` without an argument) */
    setTimelineCompact: (compact?: boolean) => void;
    toggleAudioMute: () => void;
    setAudioVolume: (volume: number) => void;
}
interface UiSettingsStoreInterface
    extends UiSettingsStoreState, UiSettingsStoreActions {}

export const useUiSettingsStore = create<UiSettingsStoreInterface>(
    (set, get) => ({
        uiSettings: loadSettings(),

        fetchUiSettings: () => {
            const currentSettings = get().uiSettings;
            const newSettings = {
                ...currentSettings,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },

        setUiSettings: (newUiSettings, type) => {
            const uiSettings = { ...newUiSettings };

            if (uiSettings.mouseSettings?.zoomSensitivity !== undefined) {
                uiSettings.mouseSettings.zoomSensitivity = clampZoomSensitivity(
                    uiSettings.mouseSettings.zoomSensitivity,
                );
            }

            if (uiSettings.lockX && type === "lockX") {
                uiSettings.lockY = false;
            }

            if (uiSettings.lockY && type === "lockY") {
                uiSettings.lockX = false;
            }

            // Disable collisions for now
            uiSettings.showCollisions = false;

            set({ uiSettings: uiSettings });
            saveSettings(uiSettings);
        },

        setPixelsPerSecond: (pixelsPerSecond: number) =>
            setSetting("timelinePixelsPerSecond", pixelsPerSecond),
        setTimelinePixelsPerBeat: (pixelsPerBeat: number) =>
            setSetting("timelinePixelsPerBeat", pixelsPerBeat),
        setTimelineZoomFitted: (fitted: boolean) =>
            setSetting("timelineZoomFitted", fitted),
        setTimelineCompact: (compact?: boolean) =>
            setSetting(
                "timelineCompact",
                compact ?? !get().uiSettings.timelineCompact,
            ),
        toggleAudioMute: () => {
            const current = get().uiSettings;
            const newSettings = {
                ...current,
                audioMuted: !current.audioMuted,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
        setAudioVolume: (volume: number) => {
            const clampedVolume = Math.min(100, Math.max(0, volume));
            const current = get().uiSettings;
            const newSettings = {
                ...current,
                audioVolume: clampedVolume,
                audioMuted: clampedVolume === 0 ? true : current.audioMuted,
            };
            if (clampedVolume > 0 && current.audioMuted) {
                newSettings.audioMuted = false;
            }
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
    }),
);

syncFromStorage(UI_SETTINGS_STORAGE_KEY, parseSettings, (uiSettings) =>
    useUiSettingsStore.setState({ uiSettings }),
);
/**
 * Sets one setting and saves it. An unchanged value keeps the settings object, so nothing
 * re-renders and nothing is written (the timeline saves its zoom and fit after every gesture).
 */
function setSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]) {
    const current = useUiSettingsStore.getState().uiSettings;
    if (current[key] === value) return;
    const newSettings = { ...current, [key]: value };
    useUiSettingsStore.setState({ uiSettings: newSettings });
    saveSettings(newSettings);
}
