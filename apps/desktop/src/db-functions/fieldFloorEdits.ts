/**
 * The undoable floor edit (ADR 0002 D-23), for the editor. Kept apart from `fieldFloor.ts`,
 * which the main process shares and which can't load the history module.
 */
import type { FieldFloor } from "@openmarch/core";
import { transactionWithHistory } from "./history";
import { setFieldFloorInTransaction } from "./fieldFloor";
import type { DbConnection } from "./types";

/** Sets or clears the show's floor as one undoable edit of the field properties. */
export async function setFieldFloor({
    db,
    floor,
}: {
    db: DbConnection;
    floor: FieldFloor | null;
}): Promise<void> {
    await transactionWithHistory(db, "setFieldFloor", (tx) =>
        setFieldFloorInTransaction({ tx, floor }),
    );
}
