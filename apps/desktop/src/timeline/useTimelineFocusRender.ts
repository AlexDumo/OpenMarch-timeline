import { useEffect } from "react";
import type { FieldTheme } from "@openmarch/core";
import type { DbConnection } from "@/db-functions/types";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { FocusScene } from "./timelineFocusScene";
import { ghostColorFor, useTimelineFocusScene } from "./useTimelineFocusScene";

// Moved to `useTimelineFocusScene.ts`, which both fields use; kept here so callers don't change
export {
    ghostColorFor,
    readFocusRows,
    type FocusRows,
} from "./useTimelineFocusScene";

/**
 * Draws the isolated timeline's scene (`useTimelineFocusScene`) on the Fabric canvas. The scene
 * stays while playing, so a loop over the move shows the ghosts against the moving dots.
 */
export function useTimelineFocusRender({
    canvas,
    database,
    enabled,
    theme,
}: {
    canvas: OpenMarchCanvas | null;
    database: DbConnection;
    enabled: boolean;
    theme: Pick<FieldTheme, "background"> | undefined;
}): FocusScene | null {
    const { scene, emphasis } = useTimelineFocusScene({ database, enabled });

    useEffect(() => {
        if (!canvas) return;
        if (!scene || !theme) {
            canvas.clearTimelineFocus();
            return;
        }
        canvas.renderTimelineFocus(scene, ghostColorFor(theme), emphasis);
    }, [canvas, scene, theme, emphasis]);

    useEffect(() => () => canvas?.clearTimelineFocus(), [canvas]);
    return scene;
}
