import { create } from "zustand";
import type { XY } from "../types";

/** A shape linked to the one being dragged, as it will be on release (#1235) */
export interface FollowerPreview {
    readonly id: number;
    /** Its outline, stretched to the joint */
    readonly outline: readonly XY[];
    /** Where its marchers will stand */
    readonly spots: readonly XY[];
}

/**
 * What a drag of a selected placed shape shows about links (#1235), drawn by the placed shapes'
 * overlay: the snap ring on the end it will attach to, and the shapes linked to it following
 */
export const useLinkDragStore = create<{
    readonly ring: XY | null;
    readonly followers: readonly FollowerPreview[];
}>(() => ({ ring: null, followers: [] }));

export const clearLinkDrag = (): void => {
    const now = useLinkDragStore.getState();
    if (now.ring !== null || now.followers.length > 0)
        useLinkDragStore.setState({ ring: null, followers: [] });
};
