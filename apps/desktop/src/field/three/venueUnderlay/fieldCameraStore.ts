import { create } from "zustand";
import type { View3dCameraPose } from "@/view3d/sync/protocol";

/**
 * The 3D View's camera as the 2D field shows it (#1207): the window's latest
 * pose, or the one the viewer is dragging on the field (the window's own
 * reports wait until the drag ends, so the marker doesn't jump back).
 */
export interface FieldCameraState {
    pose: View3dCameraPose | null;
    dragging: boolean;
}

export const useFieldCameraStore = create<FieldCameraState>(() => ({
    pose: null,
    dragging: false,
}));
