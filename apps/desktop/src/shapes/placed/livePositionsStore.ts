import { create } from "zustand";
import type { XY } from "../types";

/**
 * Where the field draws marchers other than where the show has them (#1236): those dragged,
 * turned or scaled and not yet let go, a rotation typed in the inspector and not yet saved, and
 * drops still saving. Placed shapes' outlines and joints follow them (`PlacedBoxesOverlay`), so a
 * figure turned or scaled shows its shapes going with it. Null with none.
 */
export const useLivePositionsStore = create<{
    positions: ReadonlyMap<number, XY> | null;
}>(() => ({ positions: null }));

export const setLivePositions = (
    positions: ReadonlyMap<number, XY> | null,
): void =>
    useLivePositionsStore.setState({
        positions: positions && positions.size > 0 ? positions : null,
    });
