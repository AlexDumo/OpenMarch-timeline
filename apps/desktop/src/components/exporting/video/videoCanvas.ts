import Marcher from "@/global/classes/Marcher";
import Page from "@/global/classes/Page";
import { FieldProperties } from "@openmarch/core";
import OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { defaultSettings } from "@/stores/UiSettingsStore";
import CanvasMarcher from "@/global/classes/canvasObjects/CanvasMarcher";
import { ReadableCoords } from "@/global/classes/ReadableCoords";
import { SectionAppearance } from "@/db-functions";
import { getFieldPropertiesImage } from "../utils/svg-generator";
import type { MarcherAppearancesByPageId } from "../utils/exportAppearances";

/**
 * The off-screen Fabric canvas the video export draws its frames on. Drill charts no longer use
 * a canvas (#206); the video export moves off Fabric with the field renderer (#207).
 */

const SectionAppearanceBySection = (
    sectionAppearances: SectionAppearance[] | undefined,
): Map<string, SectionAppearance> => {
    return sectionAppearances
        ? new Map(
              sectionAppearances.map((sectionAppearance) => [
                  sectionAppearance.section,
                  sectionAppearance,
              ]),
          )
        : new Map();
};

export const initializeCanvasForRendering = async (args: {
    fieldProperties: FieldProperties;
    sortedPages: Page[];
    marchers: Marcher[];
    sectionAppearances?: SectionAppearance[];
    backgroundImage?: HTMLImageElement;
    gridLines?: boolean;
    halfLines?: boolean;
    svgMargin?: number;
}): Promise<{
    canvas: OpenMarchCanvas;
    // viewBox: fabric.IViewBox;
    canvasMarchersById: Record<number, CanvasMarcher>;
}> => {
    const {
        fieldProperties,
        sortedPages,
        marchers,
        sectionAppearances,
        backgroundImage,
        gridLines = true,
        halfLines = true,
        svgMargin = 40,
    } = args;

    const canvasElement = document.createElement("canvas");
    const canvas = new OpenMarchCanvas({
        canvasRef: canvasElement,
        fieldProperties,
        uiSettings: {
            ...defaultSettings,
            gridLines,
            halfLines,
        },
        currentPage: sortedPages[0],
        isGeneratingSVG: true,
    });

    canvas.setWidth(fieldProperties!.width + svgMargin * 2);
    canvas.setHeight(fieldProperties!.height + svgMargin * 2);
    canvas.viewportTransform = [1, 0, 0, 1, svgMargin, svgMargin];

    // Add the background image
    await canvas.refreshBackgroundImage(true, backgroundImage);

    CanvasMarcher.theme = fieldProperties.theme;

    const sectionAppearanceBySection =
        SectionAppearanceBySection(sectionAppearances);

    const canvasMarchersById: Record<number, CanvasMarcher> = {};
    // Add every marcher
    for (const marcher of marchers) {
        const sectionAppearance = sectionAppearanceBySection.get(
            marcher.section,
        );
        const canvasMarcher = new CanvasMarcher({
            marcher,
            coordinate: { x: 0, y: 0 }, // dummy coordinate, will be set later
            appearances: sectionAppearance,
        });
        canvasMarchersById[marcher.id] = canvasMarcher;
        // Add the marcher to the canvas
        canvas.add(canvasMarcher);
        canvas.add(canvasMarcher.textLabel);
    }
    ReadableCoords.setFieldProperties(fieldProperties);

    // const viewBox = _calculateViewBox(canvas);

    return { canvas, canvasMarchersById };
};

export function applyMarcherAppearancesForPage({
    pageId,
    marcherAppearancesByPageId,
    canvasMarchersById,
    fieldProperties,
}: {
    pageId: number;
    marcherAppearancesByPageId: MarcherAppearancesByPageId;
    canvasMarchersById: Record<number, CanvasMarcher>;
    fieldProperties: FieldProperties;
}) {
    const appearancesByMarcherId = marcherAppearancesByPageId.get(pageId);
    if (!appearancesByMarcherId) return;

    const labelColor = fieldProperties.theme.defaultMarcher.label;
    for (const [marcherId, appearances] of Object.entries(
        appearancesByMarcherId,
    )) {
        const canvasMarcher = canvasMarchersById[Number(marcherId)];
        if (!canvasMarcher) continue;
        canvasMarcher.setAppearance(
            appearances,
            { requestRenderAll: false },
            labelColor,
        );
    }
}

export const getFieldPropertiesImageElement = async (): Promise<
    HTMLImageElement | undefined
> => {
    const backgroundImage = await getFieldPropertiesImage();

    if (backgroundImage === null) {
        return;
    }
    const base64 = btoa(
        Array.from(backgroundImage)
            .map((byte) => String.fromCharCode(byte))
            .join(""),
    );

    const img = new Image();
    // Determine the MIME type (assume PNG, but you could detect it from the file header)
    // Common image formats: image/png, image/jpeg, image/gif
    const mimeType = "image/png"; // Adjust if you know the actual format
    img.src = `data:${mimeType};base64,${base64}`;

    return img;
};
