/**
 * Writes for "Tap the beat" (E6, docs/tempo/decisions.md): applying the taps, and dismissing the
 * timeline's "Counts aren't lined up with the music yet" strip for this file.
 */
import { transactionWithHistory } from "./history";
import { retimeBeatsInTransaction, type RetimeBeatsArgs } from "./tempo";
import type { DbConnection } from "./types";
import {
    getWorkspaceSettingsParsed,
    updateWorkspaceSettingsParsed,
    updateWorkspaceSettingsWithHistoryInTransaction,
} from "./workspaceSettings";

/**
 * Applies a tap-the-beat retime (`planTapTheBeat`) as one undo entry: the new durations, the audio
 * offset when count 1 moved, the synced counts it changed, and the strip's dismissal, so undoing
 * it brings the strip back with the old timing. Duration-only, so drill never refuses it.
 *
 * @returns the beat ids whose duration changed
 */
export async function applyTapTheBeat({
    db,
    ...args
}: RetimeBeatsArgs & { db: DbConnection }): Promise<number[]> {
    return await transactionWithHistory(db, "applyTapTheBeat", async (tx) => {
        const changed = await retimeBeatsInTransaction({ tx, ...args });
        await updateWorkspaceSettingsWithHistoryInTransaction({
            tx,
            update: (s) => ({ ...s, tempoLineUpDismissed: true }),
        });
        return changed;
    });
}

/**
 * Hides the line-up strip for this file. A view preference, like the zoom, so it stays out of
 * undo; an undo of an earlier tempo edit restores the settings row as it was, strip included.
 */
export async function dismissLineUpStrip({
    db,
}: {
    db: DbConnection;
}): Promise<void> {
    const settings = await getWorkspaceSettingsParsed({ db });
    if (settings.tempoLineUpDismissed) return;
    await updateWorkspaceSettingsParsed({
        db,
        settings: { ...settings, tempoLineUpDismissed: true },
    });
}
