/**
 * Re-importing a corrected MusicXML in place (Tempo lab `reimportInPlace`, E12). The plan is the
 * pure `planReimport` (`@/timeline/tempo/reimport`); this reads the show for it and writes it.
 *
 * The write keeps every beat, page and measure row: paired bars get the file's count lengths
 * through `retimeBeatsInTransaction` (duration-only, so the timeline ripple has nothing to do and
 * drill can't refuse it), measures get the file's rehearsal marks, and the first measure its
 * number. All in one transaction, so one undo entry.
 */
import { asc } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { workspaceSettingsSchema } from "@/settings/workspaceSettings";
import {
    marksAfterReimport,
    planReimport,
    reimportChangesAnything,
    syncedAfterReimport,
    type ReimportPlan,
    type ReimportScoreMeasure,
    type ReimportShow,
    type ReimportTiming,
} from "@/timeline/tempo/reimport";
import { transactionWithHistory } from "./history";
import { updateMeasuresInTransaction } from "./measures";
import {
    readCountDurationsInTransaction,
    readTempoSyncedBeatIds,
    retimeBeatsInTransaction,
} from "./tempo";
import type { DbConnection, DbTransaction } from "./types";
import { updateWorkspaceSettingsWithHistoryInTransaction } from "./workspaceSettings";

/** Reads the show's counts, measure lines, first measure number and synced counts. */
export async function readReimportShow(
    tx: DbConnection | DbTransaction,
): Promise<ReimportShow> {
    const { beatIds, durations } = await readCountDurationsInTransaction(tx);
    const ordinalOf = new Map(beatIds.map((id, i) => [id, i]));
    const rows = await tx
        .select()
        .from(schema.measures)
        .orderBy(asc(schema.measures.id))
        .all();
    const measures = rows
        .flatMap((row) => {
            const startOrdinal = ordinalOf.get(row.start_beat);
            return startOrdinal === undefined
                ? []
                : [{ id: row.id, startOrdinal, mark: row.rehearsal_mark }];
        })
        .sort((a, b) => a.startOrdinal - b.startOrdinal || a.id - b.id)
        // Two lines on one count make one measure
        .filter(
            (m, i, all) =>
                i === 0 || all[i - 1].startOrdinal !== m.startOrdinal,
        );

    const settingsRow = await tx.select().from(schema.workspace_settings).get();
    let measurementOffset = workspaceSettingsSchema.parse({}).measurementOffset;
    let tempoMapMarks: ReimportShow["tempoMapMarks"] = [];
    if (settingsRow) {
        try {
            const parsed = workspaceSettingsSchema.safeParse(
                JSON.parse(settingsRow.json_data),
            );
            if (parsed.success) {
                measurementOffset = parsed.data.measurementOffset;
                tempoMapMarks = parsed.data.tempoMapMarks ?? [];
            }
        } catch {
            // An unreadable row keeps the default numbering
        }
    }
    return {
        beatIds,
        durations,
        measures,
        measurementOffset,
        syncedBeatIds: await readTempoSyncedBeatIds(tx),
        tempoMapMarks,
    };
}

/** The plan for this show and file, as the preview shows it. */
export async function planMusicXmlReimport({
    db,
    score,
}: {
    db: DbConnection;
    score: readonly ReimportScoreMeasure[];
}): Promise<{ show: ReimportShow; plan: ReimportPlan }> {
    const show = await readReimportShow(db);
    return { show, plan: planReimport(show, score) };
}

export interface ReimportResult {
    /** False when the show already matched the file, so nothing was written */
    readonly changed: boolean;
    readonly plan: ReimportPlan;
}

/**
 * Writes the re-import inside `tx`: the plan is made again from the show as it is in the
 * transaction, so an edit made while the preview was open can't be overwritten with stale ids.
 */
export async function applyMusicXmlReimportInTransaction({
    tx,
    score,
    timing,
}: {
    tx: DbTransaction;
    score: readonly ReimportScoreMeasure[];
    timing: ReimportTiming;
}): Promise<ReimportPlan> {
    const show = await readReimportShow(tx);
    const plan = planReimport(show, score);

    if (timing === "score" && plan.retimedOrdinals.length > 0) {
        const synced = syncedAfterReimport(show, plan, timing);
        await retimeBeatsInTransaction({
            tx,
            newDurationsByBeatId: new Map(
                plan.retimedOrdinals.map((i) => [
                    show.beatIds[i],
                    plan.durations[i],
                ]),
            ),
            syncedBeatIds:
                synced.length === show.syncedBeatIds.length
                    ? undefined
                    : synced,
        });
    }

    if (plan.markChanges.length > 0)
        await updateMeasuresInTransaction({
            tx,
            modifiedItems: plan.markChanges.map((c) => ({
                id: c.measureId,
                rehearsal_mark: c.to,
            })),
        });

    const offset = plan.measurementOffset;
    const tempoMapMarks = marksAfterReimport(show, score, plan, timing);
    if (offset || tempoMapMarks)
        await updateWorkspaceSettingsWithHistoryInTransaction({
            tx,
            update: (s) => ({
                ...s,
                ...(offset ? { measurementOffset: offset.to } : {}),
                ...(tempoMapMarks ? { tempoMapMarks } : {}),
            }),
        });
    return plan;
}

/**
 * Re-imports a file in place as one undo entry. Writes nothing (and adds no undo entry) when the
 * show already matches the file.
 */
export async function applyMusicXmlReimport({
    db,
    score,
    timing,
}: {
    db: DbConnection;
    score: readonly ReimportScoreMeasure[];
    timing: ReimportTiming;
}): Promise<ReimportResult> {
    const { show, plan } = await planMusicXmlReimport({ db, score });
    if (!reimportChangesAnything(plan, timing, { show, score }))
        return { changed: false, plan };
    const written = await transactionWithHistory(db, "reimportMusicXml", (tx) =>
        applyMusicXmlReimportInTransaction({ tx, score, timing }),
    );
    return { changed: true, plan: written };
}
