import { fabric } from "fabric";
import { NoControls } from "@/components/canvas/CanvasConstants";
import CanvasMarcher, { DEFAULT_DOT_RADIUS } from "./CanvasMarcher";
import {
    inKeptMarkBox,
    keptMarkBox,
    KEPT_MARK_BACKING,
    KEPT_MARK_BACKING_EDGE,
    KEPT_MARK_COLOR,
    KEPT_MARK_CORNER,
    KEPT_MARK_GLYPH_SHARE,
    LINK_BREAK_PATH,
    type KeptMarkBox,
    type TimelineKeptMark,
} from "@/timeline/timelineKeptMarks";

// The mark's placement and look are shared with the new field (`timelineKeptMarks.ts`)
export {
    KEPT_MARK_COLOR,
    keptMarkBox,
    type KeptMarkBox,
    type TimelineKeptMark,
} from "@/timeline/timelineKeptMarks";

let glyph: Path2D | null | undefined;
/** The glyph, parsed once; null where `Path2D` doesn't exist (tests) */
const glyphPath = (): Path2D | null =>
    glyph !== undefined
        ? glyph
        : (glyph =
              typeof Path2D === "undefined"
                  ? null
                  : new Path2D(LINK_BREAK_PATH));

/**
 * The broken chains beside the dots of the marchers kept on the current page, in timeline mode
 * (docs/timeline/ui.md UI-18, kept marchers on the field). One object for every mark, above the
 * marchers, that isn't selectable and takes no events; each frame it reads the dots where they
 * are, so a drag or a redraw carries the marks along without a rebuild. Marks of hidden marchers
 * aren't drawn, and dimmed marchers' marks dim with them.
 */
export default class TimelineKeptLayer extends fabric.Object {
    marks: readonly TimelineKeptMark[];
    private marchersSeen: readonly CanvasMarcher[] | null = null;
    private byId = new Map<number, CanvasMarcher>();

    constructor({
        marks,
        width,
        height,
    }: {
        marks: readonly TimelineKeptMark[];
        width: number;
        height: number;
    }) {
        super({
            left: 0,
            top: 0,
            width,
            height,
            originX: "left",
            originY: "top",
            strokeWidth: 0,
            objectCaching: false,
            ...NoControls,
            selectable: false,
            evented: false,
            hoverCursor: "default",
        });
        this.marks = marks;
    }

    /**
     * Always drawn: the layer covers the field from (0, 0) at its size when made, but marks sit
     * beside dots anywhere, so Fabric's offscreen culling by the layer's own box would drop them
     * when the field is panned or resized (pre-merge review).
     */
    override isOnScreen(): boolean {
        return true;
    }

    update(marks: readonly TimelineKeptMark[]): void {
        this.marks = marks;
        this.dirty = true;
    }

    /** The canvas marcher of `marcherId`, from a map rebuilt when the canvas's marchers change */
    private marcherOf(marcherId: number): CanvasMarcher | undefined {
        const canvas = this.canvas as
            | (fabric.Canvas & {
                  getLiveCanvasMarchers?: () => readonly CanvasMarcher[];
              })
            | undefined;
        if (!canvas) return undefined;
        const marchers =
            canvas.getLiveCanvasMarchers?.() ??
            (canvas.getObjects().filter(CanvasMarcher.isCanvasMarcher) as
                | CanvasMarcher[]
                | undefined) ??
            [];
        if (marchers !== this.marchersSeen) {
            this.marchersSeen = marchers;
            this.byId = new Map(marchers.map((m) => [m.marcherObj.id, m]));
        }
        return this.byId.get(marcherId);
    }

    /** Each drawn mark's square, with its mark */
    boxes(): { mark: TimelineKeptMark; box: KeptMarkBox; opacity: number }[] {
        const zoom = this.canvas?.getZoom() || 1;
        const out = [];
        for (const mark of this.marks) {
            const marcher = this.marcherOf(mark.marcherId);
            if (!marcher || marcher.visible === false) continue;
            out.push({
                mark,
                box: keptMarkBox(marcher.getAbsoluteCoords(), zoom),
                opacity: marcher.opacity ?? 1,
            });
        }
        return out;
    }

    /**
     * The mark under the field point (`x`, `y`): on its square, or on its marcher's dot. Null for
     * none.
     */
    markAt(x: number, y: number): TimelineKeptMark | null {
        for (const { mark, box } of this.boxes()) {
            if (inKeptMarkBox(box, x, y)) return mark;
            const marcher = this.marcherOf(mark.marcherId)!;
            const dot = marcher.getAbsoluteCoords();
            if (Math.hypot(x - dot.x, y - dot.y) <= DEFAULT_DOT_RADIUS * 1.5)
                return mark;
        }
        return null;
    }

    _render(ctx: CanvasRenderingContext2D): void {
        if (this.marks.length === 0) return;
        const zoom = this.canvas?.getZoom() || 1;
        const path = glyphPath();
        ctx.save();
        // fabric puts the origin at the object's center
        ctx.translate(-(this.width ?? 0) / 2, -(this.height ?? 0) / 2);
        for (const { box, opacity } of this.boxes()) {
            ctx.globalAlpha = opacity;
            const radius = box.size * KEPT_MARK_CORNER;
            ctx.beginPath();
            if (ctx.roundRect)
                ctx.roundRect(box.x, box.y, box.size, box.size, radius);
            else ctx.rect(box.x, box.y, box.size, box.size);
            ctx.fillStyle = KEPT_MARK_BACKING;
            ctx.fill();
            ctx.lineWidth = 1 / zoom;
            ctx.strokeStyle = KEPT_MARK_BACKING_EDGE;
            ctx.stroke();
            if (!path) continue;
            const glyphSize = box.size * KEPT_MARK_GLYPH_SHARE;
            const inset = (box.size - glyphSize) / 2;
            ctx.save();
            ctx.translate(box.x + inset, box.y + inset);
            ctx.scale(glyphSize / 256, glyphSize / 256);
            ctx.fillStyle = KEPT_MARK_COLOR;
            ctx.fill(path);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}
