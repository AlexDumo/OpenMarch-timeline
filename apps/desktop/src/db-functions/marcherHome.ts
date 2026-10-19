import { eq } from "drizzle-orm";
import { validateHome, type XY } from "@openmarch/core";
import * as schema from "@om-electron/database/migrations/schema";
import { DbTransaction } from "./types";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";

export interface ModifiedMarcherHomeArgs {
    marcherId: number;
    /** The marcher's home as `[x, y]`: finite, each within [-1e6, 1e6] (I-N2) */
    home: XY;
}

/** A marcher's home as saved */
export interface UpdatedMarcherHome {
    id: number;
    home_x: number;
    home_y: number;
}

/**
 * Sets marchers' homes (`marchers.home_x`/`home_y`, C-5). Every home is validated (E-N2) before
 * the first write. The existing `marchers` history triggers make it undoable, and the timeline
 * change-log trigger logs it (spec 10.2).
 *
 * Returns each id with its new home only: the page-to-timeline conversion sets homes before the timeline-only
 * migrations run, when later `marchers` columns (such as `type`) don't exist yet.
 */
export const updateMarcherHomesInTransaction = async ({
    modifiedHomes,
    tx,
}: {
    modifiedHomes: ModifiedMarcherHomeArgs[];
    tx: DbTransaction;
}): Promise<UpdatedMarcherHome[]> => {
    for (const { home } of modifiedHomes)
        assertValid(validateHome(home), "marcher home");
    const updated: UpdatedMarcherHome[] = [];
    for (const { marcherId, home } of modifiedHomes) {
        const row = await mapDbErrors(() =>
            tx
                .update(schema.marchers)
                .set({ home_x: home[0], home_y: home[1] })
                .where(eq(schema.marchers.id, marcherId))
                .returning({
                    id: schema.marchers.id,
                    home_x: schema.marchers.home_x,
                    home_y: schema.marchers.home_y,
                })
                .get(),
        );
        if (!row) refuse(`marcher ${marcherId} does not exist`);
        updated.push(row);
    }
    return updated;
};
