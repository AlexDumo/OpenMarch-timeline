/**
 * The woodwinds' instruments (docs/3d/instruments.md §3). Instrument frame per model is documented
 * on the builder. Pure: no three.js.
 */
import type {
    Detail,
    InstrumentModel,
    ModelOptions,
    WoodwindModelId,
} from "./model";

// Filled in by the woodwinds/battery/guard tasks; an empty model draws nothing.
export function woodwindModel(
    id: WoodwindModelId,
    detail: Detail = "high",
    options: ModelOptions = {},
): InstrumentModel {
    void detail;
    return {
        id,
        options,
        pieces: [],
        leftGrip: [0, 0, 0],
        mouthpiece: [0, 0, 0],
    };
}
