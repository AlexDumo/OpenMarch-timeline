import { useEffect, useRef } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { shapeContextFor } from "../canvas/shapeCanvasContext";
import type { XY } from "../types";
import { footprintOf, type BoxParams } from "../box/boxGeometry";
import ShapeToolLayer, { type ShapeToolLayerColors } from "./ShapeToolLayer";
import { toolEnvFor } from "./toolEnv";
import {
    pointerMove,
    press,
    pressTarget,
    release,
    slotsOf,
    targetsOf,
    type ToolState,
} from "./toolMachine";
import {
    closeShapeTool,
    updateTool,
    useShapeToolStore,
} from "./shapeToolStore";

const colorsOf = (theme: FieldTheme): ShapeToolLayerColors => ({
    shape: rgbaToString(theme.shape),
    walk: rgbaToString({ ...theme.shape, a: 0.4 }),
    handleFill: "#fff",
});

/** The outline the box tool draws: through its edge marchers */
function outlineOf(tool: ToolState): XY[] | null {
    if (tool.params === null) return null;
    const f = footprintOf(tool.params as BoxParams, tool.marchers.length);
    return [
        { x: f.left, y: f.top },
        { x: f.right, y: f.top },
        { x: f.right, y: f.bottom },
        { x: f.left, y: f.bottom },
    ];
}

/**
 * Puts the open shape tool on the canvas: a `ShapeToolLayer` that owns presses on the field while
 * the tool is open, drawing the tool's state.
 *
 * The tool is about one moment and one group of marchers, so it closes, placing nothing, when
 * playback starts, the edit window moves or the selection changes.
 */
export function useShapeToolCanvas({
    canvas,
    isPlaying,
    theme,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
    theme?: FieldTheme;
}): void {
    const tool = useShapeToolStore((s) => s.tool);
    const open = tool !== null;
    const layerRef = useRef<ShapeToolLayer | null>(null);

    useEffect(() => {
        if (!canvas || !open) return;
        const layer = new ShapeToolLayer(
            canvas,
            colorsOf(canvas.fieldProperties.theme),
            {
                press: (at, keys) =>
                    updateTool((t) => press(t, at, toolEnvFor(canvas, keys))),
                move: (at, keys) =>
                    updateTool((t) =>
                        pointerMove(t, at, toolEnvFor(canvas, keys)),
                    ),
                release: () =>
                    updateTool((t) => release(t, shapeContextFor(canvas))),
                cursorAt: (at, keys) => {
                    const t = useShapeToolStore.getState().tool;
                    if (!t) return "";
                    const target = pressTarget(t, at, toolEnvFor(canvas, keys));
                    if (target.type === "move") return "move";
                    if (target.type === "draw") return "crosshair";
                    return (
                        t.kind
                            .handles(t.params, t.marchers.length)
                            .find((h) => h.key === target.key)?.cursor ??
                        "default"
                    );
                },
            },
        );
        layerRef.current = layer;
        canvas.shapeToolLayer = layer;
        // The selection stays put while the tool is open
        canvas.setSelectionLocked(true);
        return () => {
            canvas.setSelectionLocked(false);
            if (canvas.shapeToolLayer === layer) canvas.shapeToolLayer = null;
            layerRef.current = null;
            layer.dispose();
        };
    }, [canvas, open]);

    useEffect(() => {
        if (theme) layerRef.current?.setColors(colorsOf(theme));
    }, [theme]);

    // Draw the state
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer || !canvas || !tool) return;
        const ctx = shapeContextFor(canvas);
        layer.draw({
            outline: outlineOf(tool),
            spots: slotsOf(tool, ctx),
            // The walks show once a gesture ends and who goes where is worked out
            walks: tool.gesture
                ? []
                : targetsOf(tool, ctx).map((t) => ({ from: t.from, to: t.to })),
            handles:
                tool.params === null
                    ? []
                    : tool.kind
                          .handles(tool.params, tool.marchers.length)
                          .map((h) => h.at),
        });
    }, [canvas, tool]);

    useCloseWhenTheMomentChanges(isPlaying, open);
}

function useCloseWhenTheMomentChanges(isPlaying: boolean, open: boolean): void {
    useEffect(() => {
        if (isPlaying) closeShapeTool();
    }, [isPlaying]);

    const selected = useSelectedMarchers()?.selectedMarchers;
    useEffect(() => {
        const tool = useShapeToolStore.getState().tool;
        if (!tool || !selected) return;
        const ids = new Set(selected.map((m) => m.id));
        const same =
            ids.size === tool.marchers.length &&
            tool.marchers.every((m) => ids.has(m.id));
        if (!same) closeShapeTool();
    }, [selected]);

    const windowKey = useTimelineSelectionStore((s) => {
        const sel = s.selection;
        const iso = s.isolation;
        return [
            sel.kind,
            sel.kind === "range" ? `${sel.start}-${sel.end}` : "",
            iso ? `${iso.timelineId}:${iso.start}-${iso.end}` : "",
        ].join("|");
    });
    const openedAt = useRef(windowKey);
    useEffect(() => {
        if (open) openedAt.current = windowKey;
        // Only the opening: a later change of window is handled below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    useEffect(() => {
        if (open && windowKey !== openedAt.current) closeShapeTool();
    }, [windowKey, open]);
}
