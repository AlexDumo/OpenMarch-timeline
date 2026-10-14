import { useEffect, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { FieldProperties } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import {
    filesOf,
    footprintOf,
    ranksOf,
    shortBy,
    type BoxParams,
} from "../box/boxGeometry";
import { stepFiles } from "./ShapeToolKeys";
import { useShapeToolStore } from "./shapeToolStore";
import { upperCanvasOf } from "./ShapeToolLayer";

/** Steps in half steps, as drill writers say them: 2½, 3, ½ */
export function formatSteps(steps: number): string {
    const halves = Math.round(steps * 2);
    if (Math.abs(steps * 2 - halves) > 1e-6)
        return String(Math.round(steps * 100) / 100);
    const whole = Math.floor(halves / 2);
    if (halves % 2 === 0) return String(whole);
    return whole === 0 ? "½" : `${whole}½`;
}

/** Where a field point is drawn, relative to the readout's positioned parent */
function screenPoint(
    canvas: OpenMarchCanvas,
    parent: Element,
    p: { x: number; y: number },
) {
    const vt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const offset = FieldProperties.GRID_STROKE_WIDTH / 2;
    const canvasBox = upperCanvasOf(canvas).getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    return {
        x: canvasBox.left - parentBox.left + vt[0]! * (p.x + offset) + vt[4]!,
        y: canvasBox.top - parentBox.top + vt[3]! * (p.y + offset) + vt[5]!,
    };
}

/**
 * The open box's numbers, just under it: "8 × 4 · 2 steps · 1 short", across × deep (owner,
 * 2026-10-14: say "8 × 4", nobody says files and ranks), with buttons for one fewer or more
 * across (also `[` and `]`). Before a box is drawn, a line at the top of the field says how to
 * draw one.
 */
export function ShapeToolReadout({
    canvas,
}: {
    canvas: OpenMarchCanvas | null;
}) {
    const tool = useShapeToolStore((s) => s.tool);
    const ref = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);
    // Follow the box, and the field as it pans and zooms
    const n = tool?.marchers.length ?? 0;
    const params = (tool?.params ?? null) as BoxParams | null;
    useEffect(() => {
        if (!canvas || !params) {
            setAt(null);
            return;
        }
        const place = () => {
            const parent = ref.current?.offsetParent;
            if (!parent) return;
            // Half an interval below the front rank, clear of its marchers
            const f = footprintOf(params, n);
            const p = screenPoint(canvas, parent, {
                x: (f.left + f.right) / 2,
                y: f.bottom + params.deep / 2,
            });
            setAt((old) =>
                old &&
                Math.abs(old.x - p.x) < 0.5 &&
                Math.abs(old.y - p.y) < 0.5
                    ? old
                    : p,
            );
        };
        place();
        canvas.on("after:render", place);
        return () => {
            canvas.off("after:render", place as never);
        };
    }, [canvas, params, n]);

    if (!tool || !canvas) return null;
    if (!params)
        return (
            <div
                ref={ref}
                className="rounded-6 border-stroke bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
                data-testid="shape-tool-hint"
            >
                Drag on the field to draw a box · Esc to cancel
            </div>
        );
    const stepPx = canvas.fieldProperties.pixelsPerStep;
    const files = filesOf(params);
    const ranks = ranksOf(params, n);
    const short = shortBy(params, n);
    return (
        <div
            ref={ref}
            className="rounded-6 border-stroke bg-modal text-sub text-text shadow-modal absolute z-10 flex -translate-x-1/2 items-center gap-8 border px-8 py-4 whitespace-nowrap"
            style={
                at ? { left: at.x, top: at.y + 10 } : { visibility: "hidden" }
            }
            data-testid="shape-tool-readout"
        >
            <button
                type="button"
                aria-label="One fewer across"
                title="One fewer across ( [ )"
                className="hover:text-accent disabled:opacity-40"
                disabled={files <= 1}
                onClick={() => stepFiles(-1)}
            >
                <MinusIcon size={14} />
            </button>
            <span data-testid="shape-tool-readout-text">
                {files} × {ranks} · {formatSteps(params.across / stepPx)} ×{" "}
                {formatSteps(params.deep / stepPx)} steps
                {short > 0 && ` · ${short} short`}
            </span>
            <button
                type="button"
                aria-label="One more across"
                title="One more across ( ] )"
                className="hover:text-accent disabled:opacity-40"
                disabled={files >= n}
                onClick={() => stepFiles(1)}
            >
                <PlusIcon size={14} />
            </button>
            <span className="text-text/50">[ ]</span>
        </div>
    );
}
