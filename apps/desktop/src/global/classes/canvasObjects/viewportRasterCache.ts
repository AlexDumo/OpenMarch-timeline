import { fabric } from "fabric";

/**
 * Draws a static object, the field grid, from a bitmap the size of the canvas instead of
 * redrawing its hundreds of lines and labels every frame.
 *
 * The bitmap holds exactly what the object puts on the visible canvas, at device resolution, so
 * it is as sharp as drawing the object directly. It is redrawn only when that would change:
 * the viewport transform (zoom, pan), the canvas size or retina scale, or the object itself
 * (`dirty`, set by Fabric when a child changes). Between those, a frame costs one `drawImage`,
 * so playback and marcher drags no longer pay for the grid.
 *
 * Fabric's own object cache keeps priority: while `objectCaching` is on (the canvas turns it on
 * during a wheel zoom, for speed), the object renders the normal way. Renders to any context
 * other than the canvas's own (exports, `toDataURL`) also draw directly.
 *
 * The object must be drawn first after the canvas is cleared (it is sent to the back); the bitmap
 * then composites exactly like direct drawing.
 */
export function cacheAtViewportResolution(
    obj: fabric.Object,
    canvas: fabric.StaticCanvas,
): void {
    const drawDirectly = obj.render.bind(obj);
    let layer: HTMLCanvasElement | null = null;
    let layerCtx: CanvasRenderingContext2D | null = null;
    // a, b, c, d, e, f of the transform the bitmap was drawn with, then the target's size
    const drawnWith = new Float64Array(8);
    let valid = false;

    const matches = (t: DOMMatrix, width: number, height: number) =>
        valid &&
        drawnWith[0] === t.a &&
        drawnWith[1] === t.b &&
        drawnWith[2] === t.c &&
        drawnWith[3] === t.d &&
        drawnWith[4] === t.e &&
        drawnWith[5] === t.f &&
        drawnWith[6] === width &&
        drawnWith[7] === height;

    obj.render = (ctx: CanvasRenderingContext2D) => {
        const ownContext = (canvas as unknown as { contextContainer?: unknown })
            .contextContainer;
        if (
            obj.objectCaching ||
            ctx !== ownContext ||
            typeof ctx.getTransform !== "function"
        ) {
            drawDirectly(ctx);
            return;
        }
        const target = ctx.canvas;
        const t = ctx.getTransform();
        if (obj.dirty || !matches(t, target.width, target.height)) {
            if (!layer || !layerCtx) {
                layer = document.createElement("canvas");
                layerCtx = layer.getContext("2d");
                if (!layerCtx) {
                    layer = null;
                    drawDirectly(ctx);
                    return;
                }
            }
            if (layer.width !== target.width) layer.width = target.width;
            if (layer.height !== target.height) layer.height = target.height;
            layerCtx.setTransform(1, 0, 0, 1, 0, 0);
            layerCtx.clearRect(0, 0, layer.width, layer.height);
            fabric.util.setImageSmoothing(
                layerCtx,
                (
                    canvas as fabric.StaticCanvas & {
                        imageSmoothingEnabled?: boolean;
                    }
                ).imageSmoothingEnabled ?? true,
            );
            layerCtx.setTransform(t);
            drawDirectly(layerCtx); // clears `dirty`
            drawnWith.set([
                t.a,
                t.b,
                t.c,
                t.d,
                t.e,
                t.f,
                target.width,
                target.height,
            ]);
            valid = true;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer!, 0, 0);
        ctx.restore();
    };
}
