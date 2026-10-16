/**
 * Reads and edits the show's camera list for the current venue
 * (`core/cameraList.ts`). Edits go to the editor like every venue change, so
 * they are saved with the show and undo from the editor.
 */
import { useCallback } from "react";
import { useTranslate } from "@tolgee/react";
import {
    defaultCameraList,
    editCameraList,
    MAX_CAMERAS,
    newCameraId,
    newCameraName,
    type CameraListEdit,
    type SavedCamera,
    type ViewCamera,
} from "@/view3d/core/cameraList";
import { savedCamerasForKit } from "@/view3d/core/venueSettings";
import { useCameraStore } from "../camera/cameraStore";
import { useView3dSceneStore } from "../sceneStore";
import { useVenueRequest } from "./VenueControls";

export interface CameraList {
    /** The listed cameras, in menu order. */
    cameras: ViewCamera[];
    /** True when the show has its own list for this venue. */
    customized: boolean;
    /** How many cameras the venue has by default. */
    defaultCount: number;
    /** False until the venue has loaded and built. */
    ready: boolean;
    /** True when no more cameras fit. */
    full: boolean;
    /** The name shown for a camera. */
    label: (camera: ViewCamera) => string;
    edit: (edit: Exclude<CameraListEdit, { kind: "add" }>) => void;
    /** Saves the current view as a new camera; returns its id. */
    addCurrentView: () => string | null;
    /** Moves a camera to the current view. */
    setToCurrentView: (id: string) => void;
    /** Back to the venue's default cameras. */
    reset: () => void;
}

export function useCameraList(): CameraList {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    const kit = useView3dSceneStore((s) => s.kit);
    const kitId = useView3dSceneStore((s) => s.kitId);
    const cameras = useView3dSceneStore((s) => s.cameras);
    const customized = useView3dSceneStore((s) => s.camerasCustomized);
    const ready = !!settings && !!kit && kitId === settings.kit;

    const label = useCallback(
        (camera: ViewCamera) => camera.name ?? t(camera.labelKey),
        [t],
    );

    /** The list to edit: the show's own, or the defaults as a starting point. */
    const currentList = (): SavedCamera[] | null => {
        if (!settings || !kit || kitId !== settings.kit) return null;
        return (
            savedCamerasForKit(settings, settings.kit) ??
            defaultCameraList(kit.cameras)
        );
    };
    const save = (list: SavedCamera[]) => {
        if (!settings) return;
        request({ kind: "cameras", kit: settings.kit, list });
    };
    const labelOf = (entry: SavedCamera) => {
        const shown = cameras.find((camera) => camera.id === entry.id);
        return shown ? label(shown) : entry.id;
    };

    const edit: CameraList["edit"] = (change) => {
        const list = currentList();
        if (list) save(editCameraList(list, change, labelOf));
    };

    const addCurrentView = () => {
        const list = currentList();
        const pose = useCameraStore.getState().currentPose();
        if (!list || !pose || list.length >= MAX_CAMERAS) return null;
        const id = newCameraId(list);
        const name = newCameraName(
            cameras.map(label),
            t("view3d.cameras.newName"),
        );
        save(editCameraList(list, { kind: "add", id, name, pose }));
        useCameraStore.getState().markActive(id);
        return id;
    };

    const setToCurrentView = (id: string) => {
        const pose = useCameraStore.getState().currentPose();
        if (!pose) return;
        edit({ kind: "setView", id, pose });
        useCameraStore.getState().markActive(id);
    };

    const reset = () => {
        if (settings)
            request({ kind: "cameras", kit: settings.kit, list: undefined });
    };

    return {
        cameras,
        customized,
        defaultCount: kit?.cameras.length ?? 0,
        ready,
        full: cameras.length >= MAX_CAMERAS,
        label,
        edit,
        addCurrentView,
        setToCurrentView,
        reset,
    };
}
