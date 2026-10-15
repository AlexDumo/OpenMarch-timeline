import { useCanvasStore } from "@/stores/CanvasStore";
import { useCollisionStore } from "@/stores/CollisionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { fieldRenderer } from "./fieldRenderer";
import { collisionsView } from "./timelineOverlays";
import { useFieldViewStore } from "./three/fieldView";

/**
 * "Zoom to collisions" on whichever field is on screen. Fabric frames its
 * collision markers (`CanvasStore.zoomToCollisions`); the new field frames the
 * same collisions the same way (`collisionsView`, fork #201), while it draws
 * them: the Show collisions setting on, and not playing (Fabric removes its
 * markers during playback, so its zoom then does nothing).
 */
export function zoomToCollisions(isPlaying: boolean): void {
    if (fieldRenderer() !== "three") {
        useCanvasStore.getState().zoomToCollisions();
        return;
    }
    if (isPlaying || !useUiSettingsStore.getState().uiSettings.showCollisions)
        return;
    const { width, height } = useFieldViewStore.getState();
    const view = collisionsView(
        useCollisionStore.getState().currentCollisions,
        width,
        height,
    );
    if (view) useFieldViewStore.setState(view);
}
