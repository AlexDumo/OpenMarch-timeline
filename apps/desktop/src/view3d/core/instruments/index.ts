/**
 * Every instrument model by id (docs/3d/instruments.md §3). Sections map
 * to ids in `catalog.ts`; `instrumentModel` builds the pieces at a detail
 * level. Pure: no three.js.
 */
import { brassModel } from "./brass";
import type { Detail, InstrumentModel, ModelId } from "./model";

export type { Detail, InstrumentModel, ModelId } from "./model";

const BRASS = new Set<ModelId>([
    "trumpet",
    "mellophone",
    "baritone",
    "euphonium",
    "trombone",
    "bassTrombone",
    "contra",
]);

/**
 * The model for `id`. An id the catalog names before its model lands
 * returns no pieces, so the section draws a body and nothing in hand.
 */
export function instrumentModel(
    id: ModelId,
    detail: Detail = "high",
): InstrumentModel {
    if (BRASS.has(id))
        return brassModel(id as Parameters<typeof brassModel>[0], detail);
    return { id, pieces: [], leftGrip: [0, 0, 0], mouthpiece: [0, 0, 0] };
}
