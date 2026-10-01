import { fabric } from "fabric";
import { FieldProperties, type ShapeRow, type XY } from "@openmarch/core";
import { NoControls } from "@/components/canvas/CanvasConstants";
import {
    dragHandle,
    shapeHandles,
    shapeOutline,
    type ShapeHandle,
} from "@/timeline/timelineShapeCanvas";

/** The colors the overlay draws with, as CSS colors. */
export interface TimelineShapeOverlayColors {
    /** The outline, the cells and the handles' rims */
    shape: string;
    /** The handles' fill */
    handleFill: string;
}

const HANDLE_RADIUS = 6;
const MOVE_HANDLE_SIZE = 12;
const CELL_RADIUS = 3;

/** A handle on the canvas, and which of `shapeHandles` it is. */
type HandleObject = fabric.Object & { timelineShapeHandle: ShapeHandle };

/**
 * A spec shape drawn on the canvas in timeline mode (P7.11): its outline (a block's cells too)
 * and, when interactive, a handle for each of `shapeHandles`. Dragging a handle redraws the shape
 * locally on every mouse move and writes nothing; releasing it calls `onCommit` once with the new
 * shape. Page mode never creates one; its shapes are `MarcherShape`s.
 *
 * Coordinates are field units. Like the marcher dots and the timeline paths, everything is offset
 * by half a grid line, so the outline runs through the dots it places.
 */
export default class TimelineShapeOverlay {
    static readonly gridOffset = FieldProperties.GRID_STROKE_WIDTH / 2;

    private outline: fabric.Polyline | null = null;
    private cells: fabric.Circle[] = [];
    private handles: HandleObject[] = [];
    /** The shape as drawn when the drag started; drags are planned from it */
    private base: ShapeRow | null = null;
    /** The shape as drawn now, during a drag */
    private preview: ShapeRow | null = null;

    constructor(
        private readonly canvas: fabric.Canvas,
        private readonly colors: TimelineShapeOverlayColors,
        private readonly onCommit: (shape: ShapeRow) => void,
    ) {}

    /** The shape as drawn now (the dragged one during a drag), or null when nothing is drawn. */
    get shown(): ShapeRow | null {
        return this.preview;
    }

    /** The handles on the canvas, in `shapeHandles` order. For tests and the canvas's z-order. */
    get handleObjects(): readonly fabric.Object[] {
        return this.handles;
    }

    /**
     * Draws `shape`, replacing whatever was drawn. Handles are drawn only when `interactive`.
     */
    show(shape: ShapeRow, interactive: boolean): void {
        this.clear();
        this.base = shape;
        this.preview = shape;
        const outline = shapeOutline(shape);
        this.outline = new fabric.Polyline(
            this.toCanvasPoints(outline.points, outline.closed),
            {
                stroke: this.colors.shape,
                strokeWidth: 2,
                fill: "",
                objectCaching: false,
                ...NoControls,
            },
        );
        this.canvas.add(this.outline);
        for (const cell of outline.cells) {
            const dot = new fabric.Circle({
                radius: CELL_RADIUS,
                fill: this.colors.shape,
                originX: "center",
                originY: "center",
                left: cell[0] + TimelineShapeOverlay.gridOffset,
                top: cell[1] + TimelineShapeOverlay.gridOffset,
                ...NoControls,
            });
            this.cells.push(dot);
            this.canvas.add(dot);
        }
        if (interactive)
            for (const handle of shapeHandles(shape)) {
                const object = this.makeHandle(handle);
                this.handles.push(object);
                this.canvas.add(object);
            }
        this.bringToFront();
        this.canvas.requestRenderAll();
    }

    /** Lets the handles be dragged, or not (while an edit is pending). */
    setInteractive(interactive: boolean): void {
        for (const handle of this.handles)
            handle.set({ selectable: interactive, evented: interactive });
        if (!interactive) {
            const active = this.canvas.getActiveObject();
            if (active && (this.handles as fabric.Object[]).includes(active))
                this.canvas.discardActiveObject();
        }
        this.canvas.requestRenderAll();
    }

    /** Puts the handles above everything else, so a marcher under one can't take its drag. */
    bringToFront(): void {
        this.outline?.bringToFront();
        for (const handle of this.handles) handle.bringToFront();
    }

    /** Removes everything this overlay drew. */
    clear(): void {
        const active = this.canvas.getActiveObject();
        if (active && (this.handles as fabric.Object[]).includes(active))
            this.canvas.discardActiveObject();
        if (this.outline) this.canvas.remove(this.outline);
        for (const cell of this.cells) this.canvas.remove(cell);
        for (const handle of this.handles) this.canvas.remove(handle);
        this.outline = null;
        this.cells = [];
        this.handles = [];
        this.base = null;
        this.preview = null;
        this.canvas.requestRenderAll();
    }

    private makeHandle(handle: ShapeHandle): HandleObject {
        const common = {
            left: handle.at[0] + TimelineShapeOverlay.gridOffset,
            top: handle.at[1] + TimelineShapeOverlay.gridOffset,
            originX: "center",
            originY: "center",
            fill: this.colors.handleFill,
            stroke: this.colors.shape,
            strokeWidth: 3,
            hasControls: false,
            hasBorders: false,
            hoverCursor: handle.role === "move" ? "move" : "pointer",
        } as const;
        const object = (
            handle.role === "move"
                ? new fabric.Rect({
                      ...common,
                      width: MOVE_HANDLE_SIZE,
                      height: MOVE_HANDLE_SIZE,
                  })
                : new fabric.Circle({ ...common, radius: HANDLE_RADIUS })
        ) as HandleObject;
        object.timelineShapeHandle = handle;
        object.on("moving", () => this.handleMoving(object));
        object.on("modified", () => this.handleModified(object));
        return object;
    }

    /** Where a handle object sits, in field units. */
    private fieldPointOf(object: fabric.Object): XY {
        return [
            (object.left ?? 0) - TimelineShapeOverlay.gridOffset,
            (object.top ?? 0) - TimelineShapeOverlay.gridOffset,
        ];
    }

    private handleMoving(object: HandleObject): void {
        if (!this.base) return;
        this.preview = dragHandle(
            this.base,
            object.timelineShapeHandle.id,
            this.fieldPointOf(object),
        );
        this.layout(this.preview, object);
    }

    private handleModified(object: HandleObject): void {
        if (!this.base) return;
        const shape = dragHandle(
            this.base,
            object.timelineShapeHandle.id,
            this.fieldPointOf(object),
        );
        this.preview = shape;
        // Later drags (before the edit comes back) start from what is drawn
        this.base = shape;
        this.layout(shape, object);
        this.onCommit(shape);
    }

    /** Moves the outline, cells and handles (except `dragging`) to `shape`. */
    private layout(shape: ShapeRow, dragging: fabric.Object | null): void {
        const outline = shapeOutline(shape);
        if (this.outline) {
            this.outline.points = this.toCanvasPoints(
                outline.points,
                outline.closed,
            );
            // fabric 5 keeps left/top/pathOffset from construction; recompute them for new points
            (
                this.outline as unknown as {
                    _setPositionDimensions: (options: object) => void;
                }
            )._setPositionDimensions({});
            this.outline.dirty = true;
            this.outline.setCoords();
        }
        outline.cells.forEach((cell, i) => {
            const dot = this.cells[i];
            if (!dot) return;
            dot.set({
                left: cell[0] + TimelineShapeOverlay.gridOffset,
                top: cell[1] + TimelineShapeOverlay.gridOffset,
            });
            dot.setCoords();
        });
        const handles = shapeHandles(shape);
        this.handles.forEach((object, i) => {
            const handle = handles[i];
            if (!handle) return;
            object.timelineShapeHandle = handle;
            if (object === dragging) return;
            object.set({
                left: handle.at[0] + TimelineShapeOverlay.gridOffset,
                top: handle.at[1] + TimelineShapeOverlay.gridOffset,
            });
            object.setCoords();
        });
        this.canvas.requestRenderAll();
    }

    private toCanvasPoints(points: readonly XY[], closed: boolean) {
        const offset = TimelineShapeOverlay.gridOffset;
        const out = points.map(
            (p) => new fabric.Point(p[0] + offset, p[1] + offset),
        );
        if (closed && out.length > 0) out.push(out[0]!);
        if (out.length === 1) out.push(out[0]!);
        return out;
    }
}
