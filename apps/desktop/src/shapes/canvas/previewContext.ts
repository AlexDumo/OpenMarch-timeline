import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { editingPositionAt } from "@/timeline/timelineIsolationPlan";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { DEFAULT_DOT_RADIUS } from "@/global/classes/canvasObjects/CanvasMarcher";
import type { XY } from "../types";

/**
 * How the tool previews a shape on the field:
 * - `result`: the new shape is drawn as the marchers themselves (their dots and drill numbers),
 *   with faint ghosts where they come from, and the marchers' current dots hidden;
 * - `ghost`: the marchers stay drawn where they are and the new spots are small faint dots.
 *
 * `result` is the default; a study can switch with `{"shapePreview": "ghost"}` in the
 * `openmarch.pinExperiment` local storage key (the simulated-user harness's variant switch).
 */
export type ShapePreviewStyle = "result" | "ghost";

export function shapePreviewStyle(): ShapePreviewStyle {
    try {
        const raw = window.localStorage.getItem("openmarch.pinExperiment");
        const parsed = raw
            ? (JSON.parse(raw) as { shapePreview?: string })
            : null;
        if (parsed?.shapePreview === "ghost") return "ghost";
    } catch {
        // Not JSON: the default
    }
    return "result";
}

/**
 * Where each marcher comes from in the move being edited: its position at the start flag (or at
 * the isolated move's start), not where it is drawn now at the playhead, which the edit is about
 * to replace. Empty at Home, where there is no move.
 */
export function originsAtStart(ids: readonly number[]): Map<number, XY> {
    const out = new Map<number, XY>();
    const resolver = useTimelineResolverStore.getState().resolver;
    const { selection, isolation } = useTimelineSelectionStore.getState();
    const start = isolation
        ? isolation.start
        : selection.kind === "range"
          ? selection.start
          : null;
    if (!resolver || start === null) return out;
    const known = new Set(resolver.marcherIds());
    for (const id of ids) {
        if (!known.has(id)) continue;
        const [x, y] = editingPositionAt(resolver, id, start);
        out.set(id, { x, y });
    }
    return out;
}

/** How each marcher looks on the canvas: its drill number and dot color, for the result preview */
export interface MarcherLook {
    readonly label: string;
    /** The drill number alone ("12" for OT12), for tight spacing */
    readonly short: string;
    readonly fill: string;
    readonly stroke: string;
    readonly radius: number;
}

export function marcherLooks(
    canvas: OpenMarchCanvas,
    ids: readonly number[],
): Map<number, MarcherLook> {
    const wanted = new Set(ids);
    const out = new Map<number, MarcherLook>();
    for (const m of canvas.getCanvasMarchers()) {
        if (!wanted.has(m.id)) continue;
        out.set(m.id, {
            label: m.marcherObj.drill_number,
            short: String(m.marcherObj.drill_order),
            fill: String(m.dotObject.fill ?? "#e00"),
            stroke: String(m.dotObject.stroke ?? "#000"),
            radius: DEFAULT_DOT_RADIUS,
        });
    }
    return out;
}

/** Hides (or shows again) the marchers' own dots, which the result preview stands in for */
export function setMarchersHidden(
    canvas: OpenMarchCanvas,
    ids: readonly number[],
    hidden: boolean,
): void {
    const wanted = new Set(ids);
    for (const m of canvas.getCanvasMarchers()) {
        if (!wanted.has(m.id)) continue;
        // The dot, its drill number (a separate object) and its box in the selection
        m.set({ opacity: hidden ? 0 : 1, hasBorders: !hidden });
        m.textLabel.set({ opacity: hidden ? 0 : 1 });
    }
    canvas.requestRenderAll();
}
