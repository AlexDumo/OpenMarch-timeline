import { fabric } from "fabric";
import { FieldProperties } from "@openmarch/core";
import { NoControls } from "@/components/canvas/CanvasConstants";
import type { ShapePreview } from "../session";
import type { HandleDef, HandleRole, XY } from "../types";

export interface ShapeToolOverlayColors {
    /** Outline, ghost spots and handle rims */
    shape: string;
    /** The thin lines from each marcher to its spot */
    travel: string;
    /** Spots with a warning or error */
    issue: string;
    handleFill: string;
}

/** A shape tool handle on the canvas. */
export type ShapeToolHandleObject = fabric.Object & {
    shapeToolHandle: HandleDef;
};

/**
 * Whether `object` is a shape tool handle. The canvas's selection listeners treat handles as
 * transparent: pressing one starts its drag and leaves the marcher selection alone.
 */
export function isShapeToolHandle(
    object: unknown,
): object is ShapeToolHandleObject {
    return (
        typeof object === "object" &&
        object !== null &&
        "shapeToolHandle" in object
    );
}

export interface HandleDragEvents {
    start(key: string): void;
    /** `to` in field units, before snapping */
    move(
        key: string,
        to: XY,
        modifiers: { shift: boolean; alt: boolean },
    ): void;
    end(): void;
}

const HANDLE_RADIUS = 6;
const MOVE_HANDLE_SIZE = 12;
const GHOST_RADIUS = 5;
const offset = FieldProperties.GRID_STROKE_WIDTH / 2;

const toCanvas = (p: XY) => ({ x: p.x + offset, y: p.y + offset });

/**
 * Draws a shape tool preview: the shape's guide lines, a ghost spot where each marcher will
 * stand, a thin line from each marcher to its spot, and the kind's handles. Nothing is written
 * until Apply; handle drags report through `events`.
 *
 * Objects are pooled and moved on each update, so dragging a handle over a 300-marcher shape
 * doesn't rebuild hundreds of objects per mouse move.
 */
export default class ShapeToolOverlay {
    private outlines: fabric.Polyline[] = [];
    private travel: fabric.Line[] = [];
    private ghosts: fabric.Circle[] = [];
    private handles: ShapeToolHandleObject[] = [];
    private handleRoles: string = "";

    constructor(
        private readonly canvas: fabric.Canvas,
        private colors: ShapeToolOverlayColors,
        private readonly events: HandleDragEvents,
    ) {}

    setColors(colors: ShapeToolOverlayColors): void {
        this.colors = colors;
        this.clear();
    }

    show(preview: ShapePreview): void {
        this.syncOutlines(preview.outline);
        const flagged = new Set<number>();
        for (const issue of preview.issues) {
            if (issue.level !== "info")
                issue.slots?.forEach((i) => flagged.add(i));
        }
        this.syncTargets(preview, flagged);
        this.syncHandles(preview.handles);
        this.bringToFront();
        this.canvas.requestRenderAll();
    }

    /** Keeps the handles above marchers, so a marcher can't take their drag. */
    bringToFront(): void {
        for (const outline of this.outlines) outline.bringToFront();
        for (const handle of this.handles) {
            if (handle.shapeToolHandle.role !== "move") handle.bringToFront();
        }
        for (const handle of this.handles) {
            if (handle.shapeToolHandle.role === "move") handle.bringToFront();
        }
    }

    clear(): void {
        const active = this.canvas.getActiveObject();
        if (active && isShapeToolHandle(active))
            this.canvas.discardActiveObject();
        for (const o of [
            ...this.outlines,
            ...this.travel,
            ...this.ghosts,
            ...this.handles,
        ]) {
            this.canvas.remove(o);
        }
        this.outlines = [];
        this.travel = [];
        this.ghosts = [];
        this.handles = [];
        this.handleRoles = "";
        this.canvas.requestRenderAll();
    }

    private syncOutlines(paths: readonly XY[][]): void {
        while (this.outlines.length > paths.length)
            this.canvas.remove(this.outlines.pop()!);
        paths.forEach((path, i) => {
            const points = (
                path.length === 1 ? [path[0]!, path[0]!] : path
            ).map(toCanvas);
            const existing = this.outlines[i];
            if (existing) {
                existing.points = points.map((p) => new fabric.Point(p.x, p.y));
                // fabric 5 keeps left/top/pathOffset from construction; recompute them
                (
                    existing as unknown as {
                        _setPositionDimensions: (o: object) => void;
                    }
                )._setPositionDimensions({});
                existing.dirty = true;
                existing.setCoords();
                return;
            }
            const outline = new fabric.Polyline(points, {
                stroke: this.colors.shape,
                strokeWidth: 2,
                strokeDashArray: [6, 4],
                fill: "",
                objectCaching: false,
                ...NoControls,
            });
            this.outlines.push(outline);
            this.canvas.add(outline);
        });
    }

    private syncTargets(
        preview: ShapePreview,
        flagged: ReadonlySet<number>,
    ): void {
        const n = preview.targets.length;
        while (this.travel.length > n) this.canvas.remove(this.travel.pop()!);
        while (this.ghosts.length > n) this.canvas.remove(this.ghosts.pop()!);
        // `flagged` holds slot indexes; map them to targets through the slots' positions
        const flaggedSpots = new Set([...flagged].map((i) => preview.slots[i]));
        preview.targets.forEach((target, i) => {
            const from = toCanvas(target.from);
            const to = toCanvas(target.to);
            const color = flaggedSpots.has(target.to)
                ? this.colors.issue
                : this.colors.shape;
            const line = this.travel[i];
            if (line) line.set({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
            else {
                const created = new fabric.Line([from.x, from.y, to.x, to.y], {
                    stroke: this.colors.travel,
                    strokeWidth: 1,
                    objectCaching: false,
                    ...NoControls,
                });
                this.travel.push(created);
                this.canvas.add(created);
            }
            const ghost = this.ghosts[i];
            if (ghost) ghost.set({ left: to.x, top: to.y, stroke: color });
            else {
                const created = new fabric.Circle({
                    left: to.x,
                    top: to.y,
                    radius: GHOST_RADIUS,
                    originX: "center",
                    originY: "center",
                    fill: "",
                    stroke: color,
                    strokeWidth: 2,
                    objectCaching: false,
                    ...NoControls,
                });
                this.ghosts.push(created);
                this.canvas.add(created);
            }
        });
        for (const o of [...this.travel, ...this.ghosts]) o.setCoords();
    }

    private syncHandles(defs: readonly HandleDef[]): void {
        const roles = defs.map((d) => `${d.key}:${d.role}`).join("|");
        if (roles !== this.handleRoles) {
            for (const handle of this.handles) this.canvas.remove(handle);
            this.handles = defs.map((def) => this.makeHandle(def));
            for (const handle of this.handles) this.canvas.add(handle);
            this.handleRoles = roles;
            return;
        }
        defs.forEach((def, i) => {
            const handle = this.handles[i]!;
            handle.shapeToolHandle = def;
            const at = toCanvas(def.at);
            handle.set({ left: at.x, top: at.y });
            handle.setCoords();
        });
    }

    private makeHandle(def: HandleDef): ShapeToolHandleObject {
        const at = toCanvas(def.at);
        const common = {
            left: at.x,
            top: at.y,
            originX: "center",
            originY: "center",
            fill: this.colors.handleFill,
            stroke: this.colors.shape,
            strokeWidth: 3,
            hasControls: false,
            hasBorders: false,
            hoverCursor: cursorFor(def.role),
            moveCursor: cursorFor(def.role),
        } as const;
        const object = (
            def.role === "move"
                ? new fabric.Rect({
                      ...common,
                      width: MOVE_HANDLE_SIZE,
                      height: MOVE_HANDLE_SIZE,
                  })
                : def.role === "bulge"
                  ? new fabric.Rect({
                        ...common,
                        width: MOVE_HANDLE_SIZE - 2,
                        height: MOVE_HANDLE_SIZE - 2,
                        angle: 45,
                    })
                  : new fabric.Circle({ ...common, radius: HANDLE_RADIUS })
        ) as ShapeToolHandleObject;
        object.shapeToolHandle = def;
        object.on("mousedown", () =>
            this.events.start(object.shapeToolHandle.key),
        );
        object.on("moving", (options) => {
            const e = (options as { e?: MouseEvent }).e;
            this.events.move(
                object.shapeToolHandle.key,
                {
                    x: (object.left ?? 0) - offset,
                    y: (object.top ?? 0) - offset,
                },
                { shift: e?.shiftKey ?? false, alt: e?.altKey ?? false },
            );
        });
        object.on("mouseup", () => this.events.end());
        return object;
    }
}

function cursorFor(role: HandleRole): string {
    return role === "move" ? "move" : "pointer";
}
