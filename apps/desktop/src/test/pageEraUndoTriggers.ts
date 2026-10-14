import { createExistingUndoTriggers } from "@/db-functions/historyTriggers";
import type { DbConnection } from "@/db-functions/types";

/**
 * Creates the undo triggers of the history tables a page-era file has. Such a file stops before
 * the timeline-only migrations, so tables added after them (the shape recipes) aren't there yet:
 * the conversion adds them and their triggers.
 */
export async function createPageEraUndoTriggers(db: DbConnection) {
    await createExistingUndoTriggers(db);
}
