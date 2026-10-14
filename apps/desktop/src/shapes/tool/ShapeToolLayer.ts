import { fabric } from "fabric";
import { FieldProperties } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { XY } from "../types";

export interface ShapeToolLayerColors {
    /** The shape's outline, its spots and the handles' rims */
    readonly shape: string;
    /** The lines from each marcher to its spot */
    readonly walk: string;
    readonly handleFill: string;
}

/** What the layer draws: everything in field units */
export interface ShapeToolDrawing {
    /** The shape's outline, a closed polygon; null before one is drawn */
    readonly outline: readonly XY[] | null;
    readonly spots: readonly XY[];
    /** From where each marcher stands to its spot; empty during a gesture */
    readonly walks: readonly { from: XY; to: XY }[];
    readonly handles: readonly XY[];
}

/** The pointer events the layer passes on, in field units */
export interface ShapeToolInput {
    press(at: XY, keys: Keys): void;
    move(at: XY, keys: Keys): void;
    release(): void;
    /** The cursor to show over `at` while no gesture is going; null leaves fabric's */
    cursorAt(at: XY, keys: Keys): string | null;
    /**
     * Whether the layer takes a press at `at`. Without it, it takes every plain left press;
     * with it, the presses it turns down go to fabric as usual (a selected placed box, which
     * takes only its handles and its inside)
     */
    claims?(at: XY, keys: Keys): boolean;
    /** A double click on a press the layer took */
    doubleClick?(at: XY, keys: Keys): void;
}

export interface Keys {
    readonly shift: boolean;
    readonly alt: boolean;
}

const SPOT_RADIUS = 4;
const HANDLE_SIZE_PX = 9;
const offset = FieldProperties.GRID_STROKE_WIDTH / 2;

/**
 * The shape tool on the canvas: its input boundary and its drawing.
 *
 * **Input.** While the layer exists, it owns every left press on the field that isn't an
 * Alt-press (Alt+drag pans the canvas), or only the ones its input `claims`. It takes the press in the capture phase on fabric's
 * wrapper, before fabric sees it, and follows the gesture on the window until release. Fabric
 * never sees those presses, so nothing selects, drags or lassos underneath. Other buttons and
 * the wheel go to fabric as usual, so panning and zooming keep working.
 *
 * **Drawing.** Plain fabric objects that can't be hit, pooled so a drag over 300 marchers moves
 * objects instead of rebuilding them.
 */
export default class ShapeToolLayer {
    private outline: fabric.Polygon | null = null;
    private spots: fabric.Circle[] = [];
    private walks: fabric.Line[] = [];
    private handles: fabric.Rect[] = [];
    private gesture = false;
    /** Whether the layer took the last press, so the mouse events after it follow suit */
    private took = false;

    constructor(
        private readonly canvas: OpenMarchCanvas,
        private colors: ShapeToolLayerColors,
        private readonly input: ShapeToolInput,
    ) {
        const wrapper = this.wrapper();
        wrapper?.addEventListener("pointerdown", this.onPointerDown, true);
        wrapper?.addEventListener("mousedown", this.onMouseDown, true);
        wrapper?.addEventListener("dblclick", this.onDoubleClick, true);
        // After fabric's own mousemove, which sets its cursor
        upperCanvasOf(canvas).addEventListener("mousemove", this.onHover);
    }

    dispose(): void {
        this.endGesture();
        const wrapper = this.wrapper();
        wrapper?.removeEventListener("pointerdown", this.onPointerDown, true);
        wrapper?.removeEventListener("mousedown", this.onMouseDown, true);
        wrapper?.removeEventListener("dblclick", this.onDoubleClick, true);
        upperCanvasOf(this.canvas).removeEventListener(
            "mousemove",
            this.onHover,
        );
        upperCanvasOf(this.canvas).style.cursor = "";
        this.draw({ outline: null, spots: [], walks: [], handles: [] });
    }

    setColors(colors: ShapeToolLayerColors): void {
        this.colors = colors;
        for (const s of this.spots) s.set({ stroke: colors.shape });
        for (const h of this.handles)
            h.set({ stroke: colors.shape, fill: colors.handleFill });
        for (const w of this.walks) w.set({ stroke: colors.walk });
        this.outline?.set({ stroke: colors.shape });
        this.canvas.requestRenderAll();
    }

    private wrapper(): HTMLElement | null {
        return (
            (this.canvas as unknown as { wrapperEl?: HTMLElement }).wrapperEl ??
            null
        );
    }

    private fieldPoint(e: MouseEvent): XY {
        const p = this.canvas.getPointer(e);
        return { x: p.x - offset, y: p.y - offset };
    }

    private static owns(e: MouseEvent): boolean {
        return e.button === 0 && !e.altKey;
    }

    private readonly onPointerDown = (e: PointerEvent) => {
        if (this.gesture) return;
        this.took =
            ShapeToolLayer.owns(e) &&
            (this.input.claims?.(this.fieldPoint(e), keysOf(e)) ?? true);
        if (!this.took) return;
        e.preventDefault();
        e.stopPropagation();
        this.gesture = true;
        this.input.press(this.fieldPoint(e), keysOf(e));
        window.addEventListener("pointermove", this.onPointerMove, true);
        window.addEventListener("pointerup", this.onPointerUp, true);
        window.addEventListener("pointercancel", this.onPointerUp, true);
    };

    /** Fabric listens for mouse events too: the press it would see is the tool's */
    private readonly onMouseDown = (e: MouseEvent) => {
        if (!ShapeToolLayer.owns(e) || !this.took) return;
        e.preventDefault();
        e.stopPropagation();
    };

    private readonly onDoubleClick = (e: MouseEvent) => {
        if (!ShapeToolLayer.owns(e) || !this.took) return;
        e.preventDefault();
        e.stopPropagation();
        this.input.doubleClick?.(this.fieldPoint(e), keysOf(e));
    };

    private readonly onPointerMove = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.move(this.fieldPoint(e), keysOf(e));
    };

    private readonly onPointerUp = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.endGesture();
        this.input.release();
    };

    private endGesture(): void {
        this.gesture = false;
        window.removeEventListener("pointermove", this.onPointerMove, true);
        window.removeEventListener("pointerup", this.onPointerUp, true);
        window.removeEventListener("pointercancel", this.onPointerUp, true);
    }

    private readonly onHover = (e: MouseEvent) => {
        if (this.gesture) return;
        if (e.altKey) {
            upperCanvasOf(this.canvas).style.cursor = "";
            return;
        }
        const cursor = this.input.cursorAt(this.fieldPoint(e), keysOf(e));
        if (cursor !== null) upperCanvasOf(this.canvas).style.cursor = cursor;
    };

    /** Keeps the layer above marchers drawn after it */
    bringToFront(): void {
        const objects = [
            this.outline,
            ...this.walks,
            ...this.spots,
            ...this.handles,
        ];
        for (const o of objects) if (o) this.canvas.bringToFront(o);
    }

    draw(d: ShapeToolDrawing): void {
        const zoom = this.canvas.getZoom() || 1;
        this.drawOutline(d.outline, zoom);
        sync(
            this.canvas,
            this.walks,
            d.walks,
            () =>
                new fabric.Line([0, 0, 0, 0], {
                    ...INERT,
                    stroke: this.colors.walk,
                    strokeWidth: 1,
                }),
            (line, w) => {
                const a = toCanvas(w.from);
                const b = toCanvas(w.to);
                line.set({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
                line.setCoords();
            },
        );
        sync(
            this.canvas,
            this.spots,
            d.spots,
            () =>
                new fabric.Circle({
                    ...INERT,
                    radius: SPOT_RADIUS,
                    originX: "center",
                    originY: "center",
                    fill: "transparent",
                    stroke: this.colors.shape,
                    strokeWidth: 1.5,
                }),
            (dot, p) => {
                const c = toCanvas(p);
                dot.set({ left: c.x, top: c.y });
                dot.setCoords();
            },
        );
        const size = HANDLE_SIZE_PX / zoom;
        sync(
            this.canvas,
            this.handles,
            d.handles,
            () =>
                new fabric.Rect({
                    ...INERT,
                    originX: "center",
                    originY: "center",
                    fill: this.colors.handleFill,
                    stroke: this.colors.shape,
                }),
            (handle, p) => {
                const c = toCanvas(p);
                handle.set({
                    left: c.x,
                    top: c.y,
                    width: size,
                    height: size,
                    strokeWidth: 1.5 / zoom,
                });
                handle.setCoords();
            },
        );
        this.bringToFront();
        this.canvas.requestRenderAll();
    }

    private drawOutline(points: readonly XY[] | null, zoom: number): void {
        if (!points) {
            if (this.outline) this.canvas.remove(this.outline);
            this.outline = null;
            return;
        }
        // A polygon's bounds are fixed when it's made, so it's made again for each change
        if (this.outline) this.canvas.remove(this.outline);
        this.outline = new fabric.Polygon(
            points.map((p) => toCanvas(p)),
            {
                ...INERT,
                fill: "transparent",
                stroke: this.colors.shape,
                strokeWidth: 1 / zoom,
                strokeDashArray: [6 / zoom, 4 / zoom],
                objectCaching: false,
            },
        );
        this.canvas.add(this.outline);
    }
}

const INERT = {
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    excludeFromExport: true,
    objectCaching: false,
} as const;

/** The element fabric draws on top and listens on (not in fabric's types) */
export const upperCanvasOf = (canvas: fabric.Canvas): HTMLCanvasElement =>
    (canvas as unknown as { upperCanvasEl: HTMLCanvasElement }).upperCanvasEl;

const toCanvas = (p: XY) => ({ x: p.x + offset, y: p.y + offset });

const keysOf = (e: MouseEvent): Keys => ({ shift: e.shiftKey, alt: e.altKey });

/** Makes `pool` hold one object per item, adding or removing objects as needed */
function sync<T extends fabric.Object, D>(
    canvas: fabric.Canvas,
    pool: T[],
    items: readonly D[],
    make: () => T,
    place: (object: T, item: D) => void,
): void {
    while (pool.length < items.length) {
        const created = make();
        pool.push(created);
        canvas.add(created);
    }
    while (pool.length > items.length) canvas.remove(pool.pop()!);
    items.forEach((item, i) => place(pool[i]!, item));
}
