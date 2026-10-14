import { fabric } from "fabric";
import { FieldProperties } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { XY } from "../types";

/** One placed box as the layer draws it, in field units */
export interface PlacedBoxDrawing {
    /** The rectangle through its edge marchers: back-left and front-right corners */
    readonly from: XY;
    readonly to: XY;
    readonly label: string;
}

const offset = FieldProperties.GRID_STROKE_WIDTH / 2;
const LABEL_PX = 11;
/** How far the label stands above the box's back edge, in screen pixels: over the back rank's own labels */
const LABEL_GAP_PX = 30;

const INERT = {
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    excludeFromExport: true,
    objectCaching: false,
} as const;

/**
 * Placed boxes on the field (docs/timeline/research/shapes/07-placed-boxes.md): a thin outline
 * through each box's edge marchers and its label above it. Nothing here can be hit.
 */
export default class PlacedBoxLayer {
    private objects: fabric.Object[] = [];

    constructor(
        private readonly canvas: OpenMarchCanvas,
        private color: string,
    ) {}

    setColor(color: string): void {
        this.color = color;
    }

    draw(boxes: readonly PlacedBoxDrawing[]): void {
        for (const o of this.objects) this.canvas.remove(o);
        this.objects = [];
        const zoom = this.canvas.getZoom() || 1;
        // Half a step around the marchers, so the line doesn't cut through the dots
        const pad = this.canvas.fieldProperties.pixelsPerStep / 2;
        for (const box of boxes) {
            const left = Math.min(box.from.x, box.to.x) - pad + offset;
            const top = Math.min(box.from.y, box.to.y) - pad + offset;
            const rect = new fabric.Rect({
                ...INERT,
                left,
                top,
                width: Math.abs(box.to.x - box.from.x) + 2 * pad,
                height: Math.abs(box.to.y - box.from.y) + 2 * pad,
                fill: "transparent",
                stroke: this.color,
                strokeWidth: 1 / zoom,
                strokeUniform: true,
            });
            const label = new fabric.Text(box.label, {
                ...INERT,
                left,
                top: top - LABEL_GAP_PX / zoom,
                fontSize: LABEL_PX / zoom,
                fontFamily: "DM Sans, sans-serif",
                fill: this.color,
            });
            this.objects.push(rect, label);
        }
        for (const o of this.objects) this.canvas.add(o);
        this.canvas.requestRenderAll();
    }

    dispose(): void {
        this.draw([]);
    }
}
