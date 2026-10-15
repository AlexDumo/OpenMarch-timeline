import type { BenchmarkView } from "./fieldScenarios";
import type { FrameProbe } from "./runFieldBenchmark";

/**
 * The Fabric field as the benchmark sees it, so the parity gate (#208) can
 * compare both fields on the same machine until #209 deletes Fabric. Read
 * through `window.canvas` and Fabric's render events, as the field test API
 * reads Fabric, with no Fabric import; nothing here changes how Fabric draws.
 */
type FabricCanvas = {
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
    getWidth(): number;
    getHeight(): number;
    viewportTransform: number[];
    setViewportTransform(transform: number[]): void;
    requestRenderAll(): void;
    getCanvasMarchers?(): unknown[];
};

/** Fabric's canvas, once it's up. */
export const fabricCanvas = (): FabricCanvas | null =>
    (window as unknown as { canvas?: FabricCanvas }).canvas ?? null;

/**
 * Fabric's frames: its whole render, from `before:render` to `after:render`.
 * Redrawing only the top canvas (the selection box) fires `after:render`
 * alone; that isn't a frame of the field.
 */
export function fabricFrames(canvas: () => FabricCanvas | null): FrameProbe {
    return {
        listen(onStart, onEnd) {
            const target = canvas();
            if (!target) return () => {};
            let rendering = false;
            const before = () => {
                rendering = true;
                onStart();
            };
            const after = () => {
                if (!rendering) return;
                rendering = false;
                onEnd();
            };
            target.on("before:render", before);
            target.on("after:render", after);
            return () => {
                target.off("before:render", before);
                target.off("after:render", after);
            };
        },
        // Canvas2D has no draw calls to count
        drawCalls: () => 0,
    };
}

/**
 * Fabric's view in its own canvas pixels: the zoom and pan of its viewport
 * transform. The scenarios only move it relative to where it started.
 */
export function fabricView(canvas: () => FabricCanvas | null): BenchmarkView {
    return {
        get() {
            const target = canvas();
            const vpt = target?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
            return {
                width: target?.getWidth() ?? 0,
                height: target?.getHeight() ?? 0,
                zoom: vpt[0]!,
                panX: vpt[4]!,
                panY: vpt[5]!,
            };
        },
        set({ zoom, panX, panY }) {
            const target = canvas();
            if (!target) return;
            target.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
            target.requestRenderAll();
        },
    };
}

/** How many marchers Fabric draws. */
export const fabricMarcherCount = () =>
    fabricCanvas()?.getCanvasMarchers?.().length ?? 0;
