import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { withTimelinePageRipple } from "@/db-functions/timelineRipple";
import {
    checkAndDrainTimelineChangesInTransaction,
    DbTransaction,
    FIRST_BEAT_ID,
    transactionWithHistory,
    withTimelineWriteLock,
} from "@/db-functions";
import {
    createBeatsInTransaction,
    deleteBeatsInTransaction,
} from "@/db-functions";
import {
    createMeasuresInTransaction,
    deleteMeasuresInTransaction,
} from "@/db-functions";
import { updatePagesInTransaction } from "@/db-functions";
import { db } from "@/global/database/db";
import { useMutation } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import {
    Measure as ParserMeasure,
    MusicXmlParseResult,
    extractXmlFromMxlFile,
    parseMusicXmlWithReport,
} from "@openmarch/musicxml-parser";
import { DatabaseBeat, NewBeatArgs } from "@/db-functions";
import { NewMeasureArgs } from "@/db-functions";
import { ModifiedPageArgs } from "@/db-functions";
import Page from "@/global/classes/Page";
import Measure from "@/global/classes/Measure";
import Beat from "@/global/classes/Beat";
import { useTimingObjects } from "@/hooks";
import { workspaceSettingsSchema } from "@/settings/workspaceSettings";
import { updateWorkspaceSettingsWithHistoryInTransaction } from "@/db-functions/workspaceSettings";
import { timelineErrorMessage } from "@/timeline/timelineErrorMessages";
import { firstMeasureNumber } from "./musicXmlPreview";

// Types and interfaces
export type MusicXmlImportData = {
    fileName: string;
    /** The parsed file, as the preview showed it */
    report: MusicXmlParseResult;
    allPages: Page[];
    measures: Measure[];
    allBeats: Beat[];
};

export type ImportResult = {
    success: boolean;
    message: string;
};

/** Reads and parses a .musicxml, .xml or .mxl file, without writing anything. */
export async function readMusicXmlFile(
    file: File,
): Promise<MusicXmlParseResult> {
    const xmlText = file.name.endsWith(".mxl")
        ? await extractXmlFromMxlFile(await file.arrayBuffer())
        : await file.text();
    return parseMusicXmlWithReport(xmlText);
}

// generates standard 120bpm 4/4 measures
function generateStandardMeasures(count: number): ParserMeasure[] {
    const measures: ParserMeasure[] = [];
    for (let i = 0; i < count; i++) {
        measures.push({
            number: i + 1,
            rehearsalMark: undefined,
            notes: undefined,
            beats: Array.from({ length: 4 }, () => ({
                duration: 0.5, // 120bpm
                notes: undefined,
            })),
        });
    }
    return measures;
}

/**
 * Numbers the show's measures from the file's first measure number (0 for a pickup), so the
 * measure row reads like the score. Recorded in the import's undo entry.
 */
async function setMeasureNumberOffsetInTransaction(
    tx: DbTransaction,
    first: number | undefined,
) {
    if (first === undefined) return;
    const row = await tx.query.workspace_settings.findFirst();
    if (row) {
        const parsed = (() => {
            try {
                return workspaceSettingsSchema.safeParse(
                    JSON.parse(row.json_data),
                );
            } catch {
                return undefined;
            }
        })();
        // Leave a row the app can't read alone, and skip a write that changes nothing
        if (!parsed?.success || parsed.data.measurementOffset === first) return;
    }
    await updateWorkspaceSettingsWithHistoryInTransaction({
        tx,
        update: (settings) => ({ ...settings, measurementOffset: first }),
    });
}

/**
 * Writes a parsed file: replaces every measure and beat, and moves page N to measure N. Call
 * inside `withTimelinePageRipple`.
 */
// eslint-disable-next-line max-lines-per-function
async function importParsedInTransaction(
    tx: DbTransaction,
    data: MusicXmlImportData,
): Promise<ImportResult> {
    const { fileName, report, allPages, measures, allBeats } = data;
    let parsedMeasures: ParserMeasure[] = report.measures;

    // Get page count
    if (!allPages) throw new Error("Failed to fetch pages");
    const pageCount = allPages.length;

    // Add standard measures if more pages than measures
    if (parsedMeasures.length < pageCount) {
        parsedMeasures = [
            ...parsedMeasures,
            ...generateStandardMeasures(pageCount - parsedMeasures.length),
        ];
    }

    // Delete existing measures
    if (measures.length > 0) {
        await deleteMeasuresInTransaction({
            tx,
            itemIds: new Set(measures.map((m) => m.id)),
        });
    }

    // Prepare new beats and store their grouping to measures
    let beatPosition = 0;
    const measureStartBeatPositions: number[] = [];
    const newBeats: NewBeatArgs[] = parsedMeasures.flatMap((measure) => {
        measureStartBeatPositions.push(beatPosition);
        return measure.beats.map((beat) => ({
            position: beatPosition++,
            duration: beat.duration,
            include_in_measure: true,
            notes: beat.notes,
        }));
    });

    // Insert new beats
    const dbBeats = await createBeatsInTransaction({
        tx,
        newBeats,
        startingPosition: 0,
    });

    // Insert new measures with their new start beats
    const newMeasures: NewMeasureArgs[] = parsedMeasures.map((measure, i) => ({
        start_beat: dbBeats[measureStartBeatPositions[i]].id,
        rehearsal_mark: measure.rehearsalMark,
        notes: measure.notes,
    }));
    await createMeasuresInTransaction({
        tx,
        newItems: newMeasures,
    });

    // Reassign start_beat for all pages to new measures
    const modifiedPagesArgs: ModifiedPageArgs[] = allPages.map(
        (page: Page, idx: number) => {
            const measureIdx =
                idx < measureStartBeatPositions.length
                    ? idx
                    : measureStartBeatPositions.length - 1;
            return {
                id: page.id,
                start_beat: dbBeats[measureStartBeatPositions[measureIdx]].id,
            };
        },
    );
    if (modifiedPagesArgs.length > 0) {
        await updatePagesInTransaction({
            tx,
            modifiedPages: modifiedPagesArgs,
        });
    }

    // Delete old beats now that they are not referenced
    const newBeatIds = new Set(dbBeats.map((b: DatabaseBeat) => b.id));
    const unusedBeats = allBeats.filter(
        (b) => !newBeatIds.has(b.id) && b.id !== FIRST_BEAT_ID,
    );
    if (unusedBeats.length > 0) {
        await deleteBeatsInTransaction({
            tx,
            beatIds: new Set(unusedBeats.map((b) => b.id)),
        });
    }

    await setMeasureNumberOffsetInTransaction(tx, firstMeasureNumber(report));

    return {
        success: true,
        message: tolgee.t("music.importSuccess", { fileName }),
    };
}

// Database operation functions (private, prefixed with _)
export const _importMusicXmlFile = async ({
    data,
}: {
    data: MusicXmlImportData;
}): Promise<ImportResult> =>
    await transactionWithHistory(
        db,
        "importMusicXmlFile",
        async (tx) =>
            await withTimelinePageRipple(tx, () =>
                importParsedInTransaction(tx, data),
            ),
    );

/** Thrown at the end of a dry run to roll it back. */
class DryRunRollback extends Error {
    constructor() {
        super("MusicXML import dry run");
        this.name = "DryRunRollback";
    }
}

export type DryRunResult = { ok: true } | { ok: false; message: string };

/**
 * Runs the import, with the timeline ripple and the commit-time checks, in a transaction that is
 * always rolled back. Says whether the real import would go through, and if not, why, in the
 * same words the timeline uses for its refusals. Nothing is written and no undo entry is made.
 */
export const _dryRunMusicXmlImport = async ({
    data,
}: {
    data: MusicXmlImportData;
}): Promise<DryRunResult> => {
    try {
        await withTimelineWriteLock(() =>
            db.transaction(async (tx) => {
                await withTimelinePageRipple(tx, () =>
                    importParsedInTransaction(tx, data),
                );
                await checkAndDrainTimelineChangesInTransaction(tx);
                throw new DryRunRollback();
            }),
        );
    } catch (error) {
        if (error instanceof DryRunRollback) return { ok: true };
        console.warn("MusicXML import dry run refused:", error);
        return {
            ok: false,
            message: timelineErrorMessage(error, {
                fallback:
                    error instanceof Error && error.message
                        ? error.message
                        : tolgee.t("music.importError"),
            }),
        };
    }
    return { ok: true };
};

// React Query mutation hooks
/**
 * @param mutationFn - The mutation function to run
 * @param errorKey - The tolgee key to display on error (create one if it doesn't exist)
 * @param successKey - Optional, the tolgee key to display on success
 */
const useMusicXmlMutation = <TArgs>(
    mutationFn: (args: TArgs) => Promise<ImportResult>,
    errorKey: string,
    successKey?: string,
) => {
    const { fetchTimingObjects } = useTimingObjects();
    return useMutation({
        mutationFn,
        onSuccess: async () => {
            // This happens twice to bypass the errors. There's likely a better solution
            await fetchTimingObjects();
            await fetchTimingObjects();
            if (successKey) {
                tolgee.t(successKey);
            }
        },
        onError: (error) => {
            toastTimelineError(error, tolgee.t(errorKey));
        },
    });
};

// Public mutation hooks
export const useImportMusicXml = () => {
    return useMusicXmlMutation(
        (data: MusicXmlImportData) => _importMusicXmlFile({ data }),
        "music.importError",
    );
};
