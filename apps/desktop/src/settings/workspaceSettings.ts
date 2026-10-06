import * as z from "zod";
import { MIN_TEMPO_BPM } from "@/global/classes/Beat";

export const workspaceSettingsSchema = z.object({
    defaultBeatsPerMeasure: z.int().positive().default(4),
    defaultTempo: z.float64().min(MIN_TEMPO_BPM).default(120),
    defaultNewPageCounts: z.int().positive().default(16),
    audioOffsetSeconds: z.float64().default(0),
    pageNumberOffset: z.int().default(0),
    measurementOffset: z.int().default(1),
    projectName: z.string().optional(),
    designer: z.string().optional(),
    client: z.string().optional(),
    activity: z.string().optional(),

    // Mobile export settings
    otmProductionId: z.preprocess(
        (v) => (v === "" || v === undefined ? undefined : v),
        z.optional(z.coerce.number().int().positive()),
    ),

    /**
     * Development only: drive this file's canvas from the timeline resolver instead of
     * `marcher_pages` (docs/timeline, Phase 5). Off when absent, and not shown in the settings UI.
     */
    timelineMode: z.boolean().optional(),

    /**
     * When the file was converted to timelines, or created as a timeline file (ISO time; P9.3,
     * ADR 0001 §6). Written by the main process; kept here so saving the settings keeps it. Its
     * presence is how a file reset to version 7 by an older release is recognized.
     */
    timelineConvertedAt: z.string().optional(),

    /**
     * Tempo prototype: ids of the beats (counts) the user has put on the music ("synced"). Retimes
     * re-space up to them instead of moving them. Absent means none. Written with the retime that
     * changes it, in the same undo entry (docs/tempo/adr-synced-counts.md).
     */
    tempoSyncedBeatIds: z.array(z.int().nonnegative()).optional(),

    /**
     * Tempo prototype (Tempo lab `tempoMap`): the tempo map's typed rows, by the beat id of the
     * measure they start at, with the meter and beat unit typed there (counts carry no note
     * values, so 12/8 and 4/4 at the same pulse look alike). Written with the retime that changes
     * it, in the same undo entry (docs/tempo/decisions.md TM-1).
     */
    tempoMapMarks: z
        .array(
            z.object({
                beatId: z.int().nonnegative(),
                meter: z
                    .object({
                        top: z.int().positive(),
                        bottom: z.int().positive(),
                        groups: z.array(z.int().positive()).nullable(),
                    })
                    .optional(),
                unit: z.enum(["s", "e", "de", "q", "dq", "h", "dh"]).optional(),
            }),
        )
        .optional(),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

/**
 * Default workspace settings
 */
export const defaultWorkspaceSettings: WorkspaceSettings = {
    defaultBeatsPerMeasure: 4,
    defaultTempo: 120,
    defaultNewPageCounts: 16,
    audioOffsetSeconds: 0,
    pageNumberOffset: 0,
    measurementOffset: 0,
    projectName: undefined,
    designer: undefined,
    client: undefined,
    activity: undefined,
    otmProductionId: undefined,
};

/**
 * Parses workspace settings from JSON string
 */
export function parseWorkspaceSettings(jsonData: string): WorkspaceSettings {
    try {
        const parsed = JSON.parse(jsonData);
        return workspaceSettingsSchema.parse(parsed);
    } catch (error) {
        console.warn(
            "Failed to parse workspace settings, using defaults:",
            error,
        );
        return defaultWorkspaceSettings;
    }
}

/**
 * Serializes workspace settings to JSON string
 */
export function serializeWorkspaceSettings(
    settings: WorkspaceSettings,
): string {
    return JSON.stringify(settings);
}

/**
 * Whether the timeline dev flag is on for this file. Absent means off.
 */
export function isTimelineModeEnabled(
    settings: Pick<WorkspaceSettings, "timelineMode"> | undefined,
): boolean {
    return settings?.timelineMode === true;
}
