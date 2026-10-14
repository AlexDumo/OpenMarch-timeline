import { useEffect, useRef } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import tolgee from "@/global/singletons/Tolgee";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { filesOf, footprintOf, ranksOf } from "../box/boxGeometry";
import { formatSteps } from "../tool/ShapeToolReadout";
import { useShapeToolStore } from "../tool/shapeToolStore";
import PlacedBoxLayer, { type PlacedBoxDrawing } from "./PlacedBoxLayer";
import type { PlacedBox } from "./placedBox";
import {
    invalidatePlacedBoxes,
    placedBoxesAt,
    usePlacedBoxStore,
} from "./placedBoxStore";

/** "Box 5 × 4 · 2 steps", or "· 2 × 1½ steps" when the intervals differ */
export function boxLabel(box: PlacedBox, stepPx: number): string {
    const across = formatSteps(box.params.across / stepPx);
    const deep = formatSteps(box.params.deep / stepPx);
    return tolgee.t(
        "shapes.box.label",
        "Box {files} × {ranks} · {interval} steps",
        {
            files: filesOf(box.params),
            ranks: ranksOf(box.params, box.spots),
            interval: across === deep ? across : `${across} × ${deep}`,
        },
    );
}

/**
 * Shows placed boxes on the field (docs/timeline/research/shapes/07-placed-boxes.md), by the View
 * tab's **Shapes** setting: while any member is selected (the default), always, or never. Hidden
 * during playback and while the Shape tool is open, which draws its own.
 */
export function usePlacedBoxesCanvas({
    canvas,
    isPlaying,
    theme,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
    theme?: FieldTheme;
}): void {
    const mode = useUiSettingsStore((s) => s.uiSettings.shapes ?? "selected");
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = useTimelineSelectionStore(displayedBeat);
    const timelines = useTimelineSelectionStore((s) => s.storedTimelines);
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const selected = useSelectedMarchers()?.selectedMarchers;
    const layerRef = useRef<PlacedBoxLayer | null>(null);

    // The recipes change with the show: every resolver change re-reads them (undo, redo, edits)
    useEffect(() => {
        if (canvas) invalidatePlacedBoxes();
    }, [canvas, version]);

    useEffect(() => {
        if (!canvas) return;
        const layer = new PlacedBoxLayer(
            canvas,
            rgbaToString(canvas.fieldProperties.theme.shape),
        );
        layerRef.current = layer;
        return () => {
            layerRef.current = null;
            layer.dispose();
        };
    }, [canvas]);

    useEffect(() => {
        if (theme) layerRef.current?.setColor(rgbaToString(theme.shape));
    }, [theme]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer || !canvas) return;
        if (mode === "off" || isPlaying || toolOpen) {
            layer.draw([]);
            return;
        }
        const ids = new Set((selected ?? []).map((m) => m.id));
        const stepPx = canvas.fieldProperties.pixelsPerStep;
        const drawings: PlacedBoxDrawing[] = placedBoxesAt(beat, recipes)
            .filter(
                (box) =>
                    mode === "always" ||
                    box.recipe.members.some((m) => ids.has(m.marcherId)),
            )
            .map((box) => {
                const f = footprintOf(box.params, box.spots);
                return {
                    from: { x: f.left, y: f.top },
                    to: { x: f.right, y: f.bottom },
                    label: boxLabel(box, stepPx),
                };
            });
        layer.draw(drawings);
    }, [
        canvas,
        mode,
        isPlaying,
        toolOpen,
        selected,
        recipes,
        beat,
        version,
        timelines,
    ]);
}
