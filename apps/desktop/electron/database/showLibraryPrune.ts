import { pruneShowLibraryOnSave } from "@/db-functions/showLibrarySave";
import type { DbConnection } from "@/db-functions/types";
import { getOrm } from "./db";
import { connectToPath } from "./database.services";

/**
 * Prunes the show Library of the file at `filePath`, on its own connection
 * (C2.1: when the show closes and before Save Copy). A failure is logged and
 * never stops the close or the copy: the unpruned Versions stay, and the next
 * save tries again.
 */
export async function pruneShowLibraryAt(filePath: string): Promise<void> {
    if (!filePath) return;
    try {
        const raw = connectToPath(filePath);
        try {
            raw.prepare("PRAGMA foreign_keys = ON").run();
            const plan = await pruneShowLibraryOnSave({
                db: getOrm(raw) as unknown as DbConnection,
            });
            if (plan.items.length > 0 || plan.blobs.length > 0)
                console.log(
                    `Pruned the show Library: ${plan.items.length} Versions, ${plan.blobs.length} blobs`,
                );
        } finally {
            raw.close();
        }
    } catch (error) {
        console.error("Couldn't prune the show Library", error);
    }
}
