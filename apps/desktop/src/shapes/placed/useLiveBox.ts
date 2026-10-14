import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { footprintOf, type BoxParams } from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { shapeContextFor } from "../canvas/shapeCanvasContext";
import { blockKind } from "../kinds/block";
import ShapeToolLayer, { type ShapeToolInput } from "../tool/ShapeToolLayer";
import { toolEnvFor } from "../tool/toolEnv";
import type { XY } from "../types";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { commitBox } from "./commitBox";
import {
    moveLive,
    openLive,
    pressLive,
    releaseLive,
    type LiveBox,
} from "./liveBox";
import { enterBox } from "./useBoxSelection";
import type { PlacedBox } from "./placedBox";

const colorsOf = (theme: FieldTheme) => ({
    shape: rgbaToString(theme.shape),
    walk: rgbaToString({ ...theme.shape, a: 0.4 }),
    handleFill: "#fff",
});

/** The outline through the box's edge marchers */
function outlineOf(live: LiveBox): XY[] {
    const f = footprintOf(live.params, live.box.spots);
    return [
        { x: f.left, y: f.top },
        { x: f.right, y: f.top },
        { x: f.right, y: f.bottom },
        { x: f.left, y: f.bottom },
    ];
}

/**
 * A selected placed box, edited in place (07-placed-boxes.md): handles on its corner and edge
 * marchers stretch it, a drag inside moves it on the half-step grid, and each gesture is saved
 * when it ends, as one undo step. Other presses go to the canvas as usual. A double click on a
 * member goes inside the box.
 */
export function useLiveBox({
    canvas,
    theme,
}: {
    canvas: OpenMarchCanvas | null;
    theme?: FieldTheme;
}): void {
    const box = useBoxSelectionStore((s) => s.selected);
    const queryClient = useQueryClient();
    const liveRef = useRef<LiveBox | null>(null);
    const layerRef = useRef<ShapeToolLayer | null>(null);
    const open = box !== null;

    useEffect(() => {
        if (!canvas || !open) return;
        const draw = () => {
            const live = liveRef.current;
            if (!live) return;
            const n = live.box.spots;
            layerRef.current?.draw({
                outline: outlineOf(live),
                // While a gesture goes, where the marchers will stand
                spots: live.gesture
                    ? blockKind.generate(
                          live.params,
                          n,
                          shapeContextFor(canvas),
                      )
                    : [],
                walks: [],
                handles: boxTool.handles(live.params, n).map((h) => h.at),
            });
        };
        const layer = new ShapeToolLayer(
            canvas,
            colorsOf(canvas.fieldProperties.theme),
            liveInput(canvas, liveRef, draw, (box, params) =>
                commitBox(box, params, queryClient),
            ),
        );
        layerRef.current = layer;
        const unsubscribe = useBoxSelectionStore.subscribe((s) => {
            if (!s.selected) return;
            // Mid-gesture, the gesture's own box stays until it is saved
            if (liveRef.current?.gesture) return;
            liveRef.current = openLive(s.selected);
            draw();
            hideControls(canvas);
        });
        const selected = useBoxSelectionStore.getState().selected;
        if (selected) liveRef.current = openLive(selected);
        draw();
        hideControls(canvas);
        return () => {
            unsubscribe();
            layerRef.current = null;
            liveRef.current = null;
            layer.dispose();
            const active = canvas.getActiveObject();
            if (active) active.hasControls = true;
            canvas.requestRenderAll();
        };
    }, [canvas, open, queryClient]);

    useEffect(() => {
        if (theme) layerRef.current?.setColors(colorsOf(theme));
    }, [theme]);
}

/** The layer's input for a selected box: its gestures, cursors and double clicks */
function liveInput(
    canvas: OpenMarchCanvas,
    liveRef: { current: LiveBox | null },
    draw: () => void,
    commit: (box: PlacedBox, params: BoxParams) => Promise<void>,
): ShapeToolInput {
    return {
        claims: (at, keys) =>
            liveRef.current !== null &&
            pressLive(liveRef.current, at, toolEnvFor(canvas, keys)) !== null,
        press: (at, keys) => {
            const live = liveRef.current;
            if (!live) return;
            liveRef.current =
                pressLive(live, at, toolEnvFor(canvas, keys)) ?? live;
            draw();
        },
        move: (at, keys) => {
            const live = liveRef.current;
            if (!live) return;
            liveRef.current = moveLive(live, at, toolEnvFor(canvas, keys));
            draw();
        },
        release: () => {
            const live = liveRef.current;
            if (!live) return;
            const out = releaseLive(live);
            liveRef.current = out.live;
            draw();
            if (out.changed) void commit(live.box, out.live.params);
        },
        cursorAt: (at, keys) => {
            const live = liveRef.current;
            if (!live) return null;
            const pressed = pressLive(live, at, toolEnvFor(canvas, keys));
            if (!pressed?.gesture) return null;
            if (pressed.gesture.type === "move") return "move";
            const key = pressed.gesture.key;
            return (
                boxTool
                    .handles(live.params, live.box.spots)
                    .find((h) => h.key === key)?.cursor ?? null
            );
        },
        doubleClick: (at) => {
            const live = liveRef.current;
            if (!live) return;
            // The member nearest the double click
            let best: { id: number; d: number } | null = null;
            for (const m of live.box.recipe.members) {
                const d = Math.hypot(m.x - at.x, m.y - at.y);
                if (!best || d < best.d) best = { id: m.marcherId, d };
            }
            if (best) enterBox(canvas, best.id);
        },
    };
}

/** The box's own handles replace fabric's scale and rotate controls on the selection */
function hideControls(canvas: OpenMarchCanvas): void {
    const active = canvas.getActiveObject();
    if (active) {
        active.hasControls = false;
        canvas.requestRenderAll();
    }
}
