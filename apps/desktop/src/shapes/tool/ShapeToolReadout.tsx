import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import {
    filesOf,
    footprintOf,
    ranksOf,
    shortBy,
    type BoxParams,
} from "../box/boxGeometry";
import { stepFiles } from "./ShapeToolKeys";
import { useShapeToolStore } from "./shapeToolStore";

/** Steps in half steps, as drill writers say them: 2½, 3, ½ */
export function formatSteps(steps: number): string {
    const halves = Math.round(steps * 2);
    if (Math.abs(steps * 2 - halves) > 1e-6)
        return String(Math.round(steps * 100) / 100);
    const whole = Math.floor(halves / 2);
    if (halves % 2 === 0) return String(whole);
    return whole === 0 ? "½" : `${whole}½`;
}

/**
 * Where a readout sits under a box: half an interval below its front rank, clear of its
 * marchers, in CSS px from the field's top-left. Follows the field as it pans and zooms.
 */
export function useReadoutPoint(
    params: BoxParams | null,
    spots: number,
): { x: number; y: number } | null {
    const view = useFieldViewStore();
    if (!params) return null;
    const f = footprintOf(params, spots);
    const p = fieldToElement(
        view,
        (f.left + f.right) / 2,
        f.bottom + params.deep / 2,
    );
    return { x: p.x, y: p.y };
}

/**
 * The open box's numbers, just under it: "8 × 4 · 2 steps · 1 short", across × deep (owner,
 * 2026-10-14: say "8 × 4", nobody says files and ranks), with buttons for one fewer or more
 * across (also `[` and `]`). Before a box is drawn, a line at the top of the field says how to
 * draw one.
 */
export function ShapeToolReadout({ stepPx }: { stepPx: number }) {
    const tool = useShapeToolStore((s) => s.tool);
    const n = tool?.marchers.length ?? 0;
    const params = (tool?.params ?? null) as BoxParams | null;
    const at = useReadoutPoint(params, n);

    if (!tool) return null;
    if (!params)
        return (
            <div
                className="rounded-6 border-stroke bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
                data-testid="shape-tool-hint"
            >
                Drag on the field to draw a box · Esc to cancel
            </div>
        );
    const files = filesOf(params);
    const ranks = ranksOf(params, n);
    const short = shortBy(params, n);
    return (
        <div
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
