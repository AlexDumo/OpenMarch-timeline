import { create } from "zustand";

export type FocusableComponents = "canvas" | "timeline";

/**
 * Tempo lab: experimental tempo features the owner can turn on to compare options
 * (docs/tempo/README.md). Each is off by default. Per user, not per file.
 */
export interface TempoLabFlags {
    /** Align view: counts drawn over the real waveform on a seconds axis; drag a flag onto the music */
    alignView: boolean;
    /** Tap the beat: a few taps set the tempo and where count 1 starts */
    tapTheBeat: boolean;
    /** Punch-in tap: T taps page starts or counts while playing */
    punchInTap: boolean;
    /** When punch-in taps are written: on stop, or kept as drafts until Enter */
    tapApply: "stop" | "drafts";
    /** What a punch-in tap marks: page starts or every count */
    tapUnit: "page" | "count";
    /** Tempo map: a table of tempo marks at measures */
    tempoMap: boolean;
    /** Drags and taps snap to attacks found in the music */
    snapToAttacks: boolean;
    /** Edits that add or remove counts ask what the drill should do, with a preview */
    drillChoices: boolean;
}

export const defaultTempoLab: TempoLabFlags = {
    alignView: false,
    tapTheBeat: false,
    punchInTap: false,
    tapApply: "stop",
    tapUnit: "page",
    tempoMap: false,
    snapToAttacks: false,
    drillChoices: false,
};

const TEMPO_LAB_CHOICES: {
    [K in keyof TempoLabFlags]: readonly TempoLabFlags[K][];
} = {
    alignView: [false, true],
    tapTheBeat: [false, true],
    punchInTap: [false, true],
    tapApply: ["stop", "drafts"],
    tapUnit: ["page", "count"],
    tempoMap: [false, true],
    snapToAttacks: [false, true],
    drillChoices: [false, true],
};

/**
 * The tempo lab flags from stored settings: each known flag with an allowed value is kept, and
 * anything else (missing, renamed or of the wrong type) falls back to its default.
 */
export function mergeTempoLab(stored: unknown): TempoLabFlags {
    const out: Record<string, unknown> = { ...defaultTempoLab };
    if (stored && typeof stored === "object")
        for (const [key, choices] of Object.entries(TEMPO_LAB_CHOICES)) {
            const value = (stored as Record<string, unknown>)[key];
            if ((choices as readonly unknown[]).includes(value))
                out[key] = value;
        }
    return out as unknown as TempoLabFlags;
}
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
    /** Whether to enable Tolgee In-Context Translating */
    tolgeeDevTools?: boolean;
    /** Tolgee API Key for In-Context Translating */
    tolgeeApiKey?: string;
    /** Experimental tempo features (Tempo lab) */
    tempoLab: TempoLabFlags;
}

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
    tolgeeDevTools: false,
    tempoLab: defaultTempoLab,
};

const STORAGE_KEY = "openmarch:uiSettings";

const clampZoomSensitivity = (value: number): number =>
    Math.min(4.0, Math.max(0.5, value));

// Helper function to load settings from localStorage
const loadSettings = (): UiSettings => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return defaultSettings;

        const parsed = JSON.parse(stored) as UiSettings;
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
            tempoLab: mergeTempoLab(parsed.tempoLab),
        };
    } catch (error) {
        console.error("Failed to load UI settings from localStorage:", error);
        return defaultSettings;
    }
};

// Helper function to save settings to localStorage
const saveSettings = (settings: UiSettings): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
    /** Sets one Tempo lab flag */
    setTempoLabFlag: <K extends keyof TempoLabFlags>(
        flag: K,
        value: TempoLabFlags[K],
    ) => void;
}
interface UiSettingsStoreInterface
    extends UiSettingsStoreState, UiSettingsStoreActions {}

export const useUiSettingsStore = create<UiSettingsStoreInterface>(
    // eslint-disable-next-line max-lines-per-function
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

        setPixelsPerSecond: (pixelsPerSecond: number) => {
            const newSettings = {
                ...get().uiSettings,
                timelinePixelsPerSecond: pixelsPerSecond,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
        setTimelinePixelsPerBeat: (pixelsPerBeat: number) => {
            const newSettings = {
                ...get().uiSettings,
                timelinePixelsPerBeat: pixelsPerBeat,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
        setTimelineZoomFitted: (fitted: boolean) => {
            const newSettings = {
                ...get().uiSettings,
                timelineZoomFitted: fitted,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
        setTimelineCompact: (compact?: boolean) => {
            const current = get().uiSettings;
            const newSettings = {
                ...current,
                timelineCompact: compact ?? !current.timelineCompact,
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
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
        setTempoLabFlag: (flag, value) => {
            const current = get().uiSettings;
            const newSettings = {
                ...current,
                tempoLab: { ...current.tempoLab, [flag]: value },
            };
            set({ uiSettings: newSettings });
            saveSettings(newSettings);
        },
    }),
);

/** One Tempo lab flag, re-rendering only when it changes. */
export const useTempoLabFlag = <K extends keyof TempoLabFlags>(
    flag: K,
): TempoLabFlags[K] => useUiSettingsStore((s) => s.uiSettings.tempoLab[flag]);
