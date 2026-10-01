import OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import Page from "@/global/classes/Page";
import {
    shapePagesQueryByPageIdOptions,
    shapePageMarchersQueryByPageIdOptions,
} from "@/hooks/queries";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Draws the selected page's page-era shapes (`MarcherShape`s from `shape_pages`).
 *
 * In timeline mode (P7.11) it draws none and reads none: shape pages are frozen page-era rows
 * that no longer say where marchers are, and their edits would write `marcher_pages`. Any shapes
 * drawn before the flag turned on are removed. Timeline mode draws the spec shape picked in the
 * inspector instead (`useTimelineShapeCanvas`).
 */
export const useRenderMarcherShapes = ({
    canvas,
    selectedPage,
    isPlaying,
    timelineMode = false,
}: {
    canvas: OpenMarchCanvas | null;
    selectedPage: Page | null;
    isPlaying: boolean;
    timelineMode?: boolean;
}) => {
    const pageId = timelineMode ? null : (selectedPage?.id ?? null);
    const { data: shapePagesOnSelectedPage } = useQuery(
        shapePagesQueryByPageIdOptions(pageId),
    );
    const { data: shapePageMarchersOnSelectedPage } = useQuery(
        shapePageMarchersQueryByPageIdOptions(pageId),
    );

    useEffect(() => {
        if (canvas && timelineMode && canvas.marcherShapes.length > 0)
            void canvas.renderMarcherShapes({ shapePages: [] });
    }, [canvas, timelineMode]);

    // Update/render the MarcherShapes when the selected page or the ShapePages change
    // and the animation is not playing.
    useEffect(() => {
        if (canvas && !timelineMode && shapePagesOnSelectedPage && !isPlaying) {
            void canvas.renderMarcherShapes({
                shapePages: shapePagesOnSelectedPage,
            });
        }
    }, [
        canvas,
        selectedPage,
        isPlaying,
        timelineMode,
        shapePagesOnSelectedPage,
        shapePageMarchersOnSelectedPage,
    ]);
};
