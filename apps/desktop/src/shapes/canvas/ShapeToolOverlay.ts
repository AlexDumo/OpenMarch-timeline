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
    /** The spots marchers will stand on */
    ghost: string;
    /** Spots with a warning or error */
    issue: string;
    handleFill: string;
}

/** A shape tool handle on the canvas. */
export type ShapeToolHandleObject = fabric.Object & {
    shapeToolHandle: HandleDef;
};

export interface HandleDragEvents {
    start(key: string): void;
    /** `to` in field units, before snapping */
    move(
        key: string,
        to: XY,
        modifiers: { shift: boolean; alt: boolean },
    ): void;
    end(): void;
    /**
     * A double-click on the shape: on a handle (`key`), to remove that point; elsewhere on the
     * shape's outline, to add one at `at`
     */
    doubleClick(at: XY, key?: string): void;
}

const HANDLE_RADIUS = 7;
const MOVE_HANDLE_SIZE = 13;
const GHOST_RADIUS = 4;
/** How far from a handle a press still takes it, in screen pixels */
const HIT_RADIUS_PX = 10;
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
    /** While a lock holds a dragged handle back: a line to the cursor and a tag saying why */
    private holdLine: fabric.Line | null = null;
    private holdTag: fabric.Text | null = null;
    /** Fainter lines for the rest of the shape */
    private guides: fabric.Polyline[] = [];
    private travel: fabric.Line[] = [];
    private ghosts: fabric.Circle[] = [];
    private handles: ShapeToolHandleObject[] = [];
    private handleRoles: string = "";

    /** The handle being dragged */
    private dragKey: string | null = null;

    constructor(
        private readonly canvas: fabric.Canvas,
        private colors: ShapeToolOverlayColors,
        private readonly events: HandleDragEvents,
    ) {
        // Capture on the wrapper runs before fabric's own listeners on the canvas element
        const wrapper = this.wrapper();
        wrapper?.addEventListener("pointerdown", this.onPointerDown, true);
        wrapper?.addEventListener("mousedown", this.swallowIfDragging, true);
        wrapper?.addEventListener("dblclick", this.onDoubleClick, true);
        canvas.on("mouse:move", this.onHover);
    }

    /** Removes everything drawn and every listener. */
    dispose(): void {
        this.endDrag();
        this.clear();
        const wrapper = this.wrapper();
        wrapper?.removeEventListener("pointerdown", this.onPointerDown, true);
        wrapper?.removeEventListener("mousedown", this.swallowIfDragging, true);
        wrapper?.removeEventListener("dblclick", this.onDoubleClick, true);
        this.canvas.off("mouse:move", this.onHover as never);
    }

    private wrapper(): HTMLElement | null {
        return (
            (this.canvas as unknown as { wrapperEl?: HTMLElement }).wrapperEl ??
            null
        );
    }

    /** The handle within reach of the pointer, move handles first (they win where handles overlap) */
    private readonly onDoubleClick = (e: MouseEvent) => {
        if (this.handles.length === 0) return;
        const handle = this.handleAt(e);
        const at = this.fieldPoint(e);
        if (handle) {
            e.preventDefault();
            e.stopPropagation();
            this.events.doubleClick(at, handle.shapeToolHandle.key);
            return;
        }
        if (this.nearOutline(e)) {
            e.preventDefault();
            e.stopPropagation();
            this.events.doubleClick(at);
        }
    };

    /** Whether the pointer is within reach of the shape's solid outline */
    private nearOutline(e: MouseEvent): boolean {
        const reach = HIT_RADIUS_PX / (this.canvas.getZoom() || 1);
        const p = this.canvas.getPointer(e);
        for (const line of this.outlines) {
            const points = line.points ?? [];
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1]!;
                const b = points[i]!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx + dy * dy;
                const t =
                    len2 === 0
                        ? 0
                        : Math.max(
                              0,
                              Math.min(
                                  1,
                                  ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2,
                              ),
                          );
                if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= reach)
                    return true;
            }
        }
        return false;
    }

    private handleAt(e: MouseEvent): ShapeToolHandleObject | null {
        const zoom = this.canvas.getZoom() || 1;
        const reach = HIT_RADIUS_PX / zoom;
        const p = this.canvas.getPointer(e);
        let best: ShapeToolHandleObject | null = null;
        let bestD = Infinity;
        for (const handle of this.handles) {
            const d = Math.hypot(
                (handle.left ?? 0) - p.x,
                (handle.top ?? 0) - p.y,
            );
            const moveBonus = handle.shapeToolHandle.role === "move" ? 0.5 : 1;
            if (d <= reach && d * moveBonus < bestD) {
                best = handle;
                bestD = d * moveBonus;
            }
        }
        return best;
    }

    private fieldPoint(e: MouseEvent): XY {
        const p = this.canvas.getPointer(e);
        return { x: p.x - offset, y: p.y - offset };
    }

    private readonly onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0 || e.altKey) return;
        const handle = this.handleAt(e);
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        this.dragKey = handle.shapeToolHandle.key;
        if (handle.shapeToolHandle.role !== "move")
            this.canvas.setCursor("grabbing");
        this.events.start(this.dragKey);
        window.addEventListener("pointermove", this.onPointerMove, true);
        window.addEventListener("pointerup", this.onPointerUp, true);
    };

    /** The mousedown that follows a handle's pointerdown mustn't reach fabric either */
    private readonly swallowIfDragging = (e: MouseEvent) => {
        if (this.dragKey === null) return;
        e.preventDefault();
        e.stopPropagation();
    };

    private readonly onPointerMove = (e: PointerEvent) => {
        if (this.dragKey === null) return;
        e.preventDefault();
        e.stopPropagation();
        this.events.move(this.dragKey, this.fieldPoint(e), {
            shift: e.shiftKey,
            alt: e.altKey,
        });
    };

    private readonly onPointerUp = (e: PointerEvent) => {
        if (this.dragKey === null) return;
        e.preventDefault();
        e.stopPropagation();
        this.endDrag();
    };

    private endDrag(): void {
        window.removeEventListener("pointermove", this.onPointerMove, true);
        window.removeEventListener("pointerup", this.onPointerUp, true);
        if (this.dragKey === null) return;
        this.dragKey = null;
        this.events.end();
    }

    private readonly onHover = (event: fabric.IEvent<MouseEvent>) => {
        if (this.handles.length === 0 || !event.e) return;
        const handle = this.dragKey === null ? this.handleAt(event.e) : null;
        if (handle)
            this.canvas.setCursor(cursorFor(handle.shapeToolHandle.role));
    };

    setColors(colors: ShapeToolOverlayColors): void {
        this.colors = colors;
        this.clear();
    }

    /**
     * Shows, or with null hides, why a dragged handle isn't under the cursor: a dashed line from
     * the handle to the cursor and a short tag such as "Interval locked".
     */
    showHold(hold: { from: XY; to: XY; label: string } | null): void {
        if (!hold) {
            if (this.holdLine) this.canvas.remove(this.holdLine);
            if (this.holdTag) this.canvas.remove(this.holdTag);
            this.holdLine = null;
            this.holdTag = null;
            this.canvas.requestRenderAll();
            return;
        }
        const from = toCanvas(hold.from);
        const to = toCanvas(hold.to);
        const zoom = this.canvas.getZoom() || 1;
        if (this.holdLine) {
            this.holdLine.set({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
            this.holdLine.setCoords();
        } else {
            this.holdLine = new fabric.Line([from.x, from.y, to.x, to.y], {
                stroke: this.colors.shape,
                strokeWidth: 1.5,
                strokeDashArray: [3, 3],
                objectCaching: false,
                ...NoControls,
            });
            this.canvas.add(this.holdLine);
        }
        const tag = {
            left: to.x + 10 / zoom,
            top: to.y + 10 / zoom,
            fontSize: 12 / zoom,
            text: hold.label,
        };
        if (this.holdTag) this.holdTag.set(tag);
        else {
            this.holdTag = new fabric.Text(hold.label, {
                ...tag,
                fill: this.colors.shape,
                backgroundColor: this.colors.handleFill,
                fontFamily: "sans-serif",
                objectCaching: false,
                ...NoControls,
            });
            this.canvas.add(this.holdTag);
        }
        this.holdLine.bringToFront();
        this.holdTag.bringToFront();
        this.canvas.requestRenderAll();
    }

    show(preview: ShapePreview): void {
        this.syncLines(this.guides, preview.guide, {
            stroke: this.colors.travel,
            strokeWidth: 1.5,
            strokeDashArray: [2, 4],
        });
        this.syncLines(this.outlines, preview.outline, {
            stroke: this.colors.shape,
            strokeWidth: 2,
            strokeDashArray: [6, 4],
        });
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
        for (const guide of this.guides) guide.bringToFront();
        for (const outline of this.outlines) outline.bringToFront();
        for (const ghost of this.ghosts) ghost.bringToFront();
        for (const handle of this.handles) {
            if (handle.shapeToolHandle.role !== "move") handle.bringToFront();
        }
        for (const handle of this.handles) {
            if (handle.shapeToolHandle.role === "move") handle.bringToFront();
        }
    }

    clear(): void {
        this.showHold(null);
        for (const o of [
            ...this.guides,
            ...this.outlines,
            ...this.travel,
            ...this.ghosts,
            ...this.handles,
        ]) {
            this.canvas.remove(o);
        }
        this.guides = [];
        this.outlines = [];
        this.travel = [];
        this.ghosts = [];
        this.handles = [];
        this.handleRoles = "";
        this.canvas.requestRenderAll();
    }

    /** Makes `pool` draw `paths`, reusing its polylines */
    private syncLines(
        pool: fabric.Polyline[],
        paths: readonly XY[][],
        style: {
            stroke: string;
            strokeWidth: number;
            strokeDashArray: number[];
        },
    ): void {
        while (pool.length > paths.length) this.canvas.remove(pool.pop()!);
        paths.forEach((path, i) => {
            const points = (
                path.length === 1 ? [path[0]!, path[0]!] : path
            ).map(toCanvas);
            const existing = pool[i];
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
            const line = new fabric.Polyline(points, {
                ...style,
                fill: "",
                objectCaching: false,
                ...NoControls,
            });
            pool.push(line);
            this.canvas.add(line);
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
                : this.colors.ghost;
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
            if (ghost) ghost.set({ left: to.x, top: to.y, fill: color });
            else {
                const created = new fabric.Circle({
                    left: to.x,
                    top: to.y,
                    radius: GHOST_RADIUS,
                    originX: "center",
                    originY: "center",
                    fill: color,
                    strokeWidth: 0,
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
        const roles = defs
            .map((d) => `${d.key}:${d.role}:${d.start ? 1 : 0}`)
            .join("|");
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
            // The start is filled, so "Lay from Start" has a visible end
            fill: def.start ? this.colors.shape : this.colors.handleFill,
            stroke: this.colors.shape,
            strokeWidth: 2.5,
            // A dark halo keeps handles readable over grass, grid lines and marchers
            shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.45)", blur: 4 }),
            // Presses are taken before fabric sees them (`onPointerDown`), so a handle never
            // becomes the active object and the marcher selection is left alone
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
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
        return object;
    }
}

function cursorFor(role: HandleRole): string {
    return role === "move" ? "move" : "grab";
}
