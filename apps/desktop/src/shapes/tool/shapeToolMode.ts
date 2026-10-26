import { create } from "zustand";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import type { FieldMode, FieldPointer } from "@/field/editor/fieldEditor";
import type { ShapeField } from "../field/shapeField";
import type { XY } from "../types";
import { shapeOutline } from "../frame/gestures";
import { outlineGapAt } from "../distribute/outlineGap";
import {
    drillNumbers,
    frameDrawing,
    guideDrawing,
    keysOf,
    memoDrawing,
    shapeCursor,
    SPOT_LABEL_LIMIT,
} from "../field/fieldModeBase";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import { toolEnvFor } from "./toolEnv";
import {
    cancelGesture,
    pointerMove,
    press,
    pressTarget,
    release,
    slotsOf,
    startsOf,
    targetsOf,
    type ToolState,
} from "./toolMachine";
import { updateTool, useShapeToolStore } from "./shapeToolStore";
import { SpotGlide } from "./spotGlide";

/**
 * `hover`: the spot the pointer rests on, with who will stand there, on shapes too big to label
 * every spot (sims, F1: with 64 nobody could tell who goes where). Null otherwise.
 * `over`: the pointer is over the shape or one of its controls (#403).
 */
const useSpotHover = create<{
    hover: { at: XY; text: string } | null;
    over: boolean;
}>(() => ({
    hover: null,
    over: false,
}));

interface Shown {
    readonly tool: ToolState;
    readonly hover: { at: XY; text: string } | null;
    readonly over: boolean;
    /** The walks are shown: the pathways toggle (#403) */
    readonly walks: boolean;
}
let shown: Shown | null = null;
const shownNow = (): Shown | null => {
    const { tool } = useShapeToolStore.getState();
    if (!tool) return null;
    const { hover, over } = useSpotHover.getState();
    const walks = useUiSettingsStore.getState().uiSettings.shapeWalks ?? false;
    if (
        shown?.tool !== tool ||
        shown.hover !== hover ||
        shown.over !== over ||
        shown.walks !== walks
    )
        shown = { tool, hover, over, walks };
    return shown;
};

/** Notes the spot under the pointer, on a shape that doesn't label every spot */
function hoverAt(tool: ToolState, at: XY, radius: number): void {
    const field = currentShapeField();
    let hover: { at: XY; text: string } | null = null;
    if (
        field &&
        !tool.gesture &&
        tool.params !== null &&
        tool.marchers.length > SPOT_LABEL_LIMIT
    ) {
        const names = drillNumbers(field);
        let best = radius;
        for (const t of targetsOf(tool, shapeContextFor(field))) {
            const d = Math.hypot(t.to.x - at.x, t.to.y - at.y);
            if (d <= best) {
                best = d;
                hover = { at: t.to, text: names.get(t.id) ?? "" };
            }
        }
    }
    const was = useSpotHover.getState().hover;
    if (was?.text !== hover?.text || was?.at !== hover?.at)
        useSpotHover.setState({ hover });
}

/** Notes whether the pointer is over the shape or one of its controls (#403) */
function overAt(over: boolean): void {
    if (useSpotHover.getState().over !== over) useSpotHover.setState({ over });
}

const drawingOf = memoDrawing(({ tool, hover, over, walks }: Shown) => {
    const field = currentShapeField();
    if (!field) return null;
    const ctx = shapeContextFor(field);
    const n = tool.spots;
    const spots = slotsOf(tool, ctx);
    // The marchers' ghosts stand where they start the move: at the start flag (#346, #417). They
    // always show, so where the marchers come from reads; the pathways toggle is only the walks
    // (owner lab feedback on #417)
    const rings = startsOf(tool);
    const ringIds = tool.marchers.map((m) => m.id);
    if (tool.params === null)
        return {
            outline: null,
            spots,
            walks: [],
            handles: [],
            rings,
            ringIds,
        };
    // While a drag draws a new shape: its spots and a dashed outline, no walks yet (06). Every
    // other gesture holds who goes where, so the walks follow it live.
    const drawing = tool.gesture?.type === "draw";
    const targets = drawing ? [] : targetsOf(tool, ctx);
    const names = drillNumbers(field);
    const env = toolEnvFor(field, { shift: false, alt: false });
    const gap = drawing ? null : outlineGapAt(tool.kind, tool.params, n);
    const g =
        tool.gesture &&
        tool.gesture.type !== "draw" &&
        tool.gesture.type !== "edit"
            ? tool.gesture
            : null;
    return {
        stage: drawing ? ("drawing" as const) : ("open" as const),
        outline: shapeOutline(tool.kind, tool.params, n),
        spots,
        walks: walks ? targets.map((t) => ({ from: t.from, to: t.to })) : [],
        rings,
        ringIds,
        // The controls stay at full strength while the pointer is on the shape or a gesture runs
        calm: !over && !tool.gesture,
        gaps: gap ? [gap] : [],
        labels:
            n <= SPOT_LABEL_LIMIT
                ? targets.map((t) => ({
                      at: t.to,
                      text: names.get(t.id) ?? "",
                  }))
                : [],
        handles: drawing
            ? []
            : tool.kind.handles(tool.params, n).map((h) => h.at),
        ...(drawing
            ? {}
            : frameDrawing(
                  tool.kind,
                  tool.params,
                  n,
                  g,
                  tool.pointer ?? null,
                  env,
              )),
        ...guideDrawing(
            tool.kind,
            tool.params,
            n,
            spots,
            tool.gesture,
            env,
            field,
        ),
        ...(hover && !tool.gesture
            ? { labels: [{ at: hover.at, text: hover.text }] }
            : {}),
    };
});

/**
 * The open shape's marchers glide to their new spots when it changes without a gesture (a press
 * of − or +, a layout picked, a quarter turn): the owner picked it in the lab (#387)
 */
const glide = new SpotGlide();
const glideListeners = new Set<() => void>();
let gliding = false;
/** Counts the glide's frames: the overlay reads the drawing as a snapshot, so one per frame */
let glideStamp = 0;
let glideCache: {
    shown: Shown | null;
    stamp: number;
    drawing: ReturnType<typeof drawingOf>;
} | null = null;

/** Redraws every frame while a glide runs, then once more where it lands */
function glideFrame() {
    glideStamp++;
    glideListeners.forEach((listener) => listener());
    if (glide.active(performance.now())) requestAnimationFrame(glideFrame);
    else {
        gliding = false;
        glideStamp++;
        glideListeners.forEach((listener) => listener());
    }
}

/** {@link glidingDrawing}, worked out once per state and glide frame */
function glidingSnapshot(shown: Shown | null) {
    if (glideCache?.shown !== shown || glideCache.stamp !== glideStamp)
        glideCache = {
            shown,
            stamp: glideStamp,
            drawing: glidingDrawing(shown),
        };
    return glideCache.drawing;
}

/** People who ask their system for less motion get no glide, as the timeline's follow does */
const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * The drawing, with each marcher's spot, walk and label part way to where it's going while a
 * glide runs: a change without a gesture slides, not jumps
 */
function glidingDrawing(shown: Shown | null) {
    const drawing = drawingOf(shown);
    if (!shown) return drawing;
    const { tool } = shown;
    const field = currentShapeField();
    if (!drawing || tool.params === null || !field || reducedMotion())
        return drawing;
    const targets = targetsOf(tool, shapeContextFor(field));
    const now = performance.now();
    glide.update(
        tool.params,
        tool.gesture !== null && tool.gesture !== undefined,
        targets,
        now,
    );
    const at = glide.positions(now);
    if (!at) return drawing;
    if (!gliding) {
        gliding = true;
        requestAnimationFrame(glideFrame);
    }
    const shownAt = (t: { id: number; to: XY }) => at.get(t.id) ?? t.to;
    const labels = drawing.labels ?? [];
    return {
        ...drawing,
        gliding: true,
        spots:
            drawing.spots.length === targets.length
                ? targets.map(shownAt)
                : drawing.spots,
        walks: shown.walks
            ? targets.map((t) => ({ from: t.from, to: shownAt(t) }))
            : [],
        labels:
            labels.length === targets.length
                ? labels.map((l, i) => ({ ...l, at: shownAt(targets[i]!) }))
                : labels,
    };
}

/** The env for a pointer event: a dragged pivot also snaps to the open shape's spots (#350) */
const envOf = (field: ShapeField, tool: ToolState, pointer: FieldPointer) =>
    toolEnvFor(field, keysOf(pointer), () =>
        slotsOf(tool, shapeContextFor(field)),
    );

/**
 * The open shape tool on the field (docs/timeline/research/shapes/06-box-v1.md): a field editor
 * mode that takes every edit press while the tool is open and hands it to the tool's state
 * machine, so nothing selects, drags or lassos underneath. Navigation keeps its presses (right and
 * middle drags, the wheel). Alt is the tool's "don't snap", not a pan, on this field.
 */
export const shapeToolMode: FieldMode = {
    claims: () => useShapeToolStore.getState().tool !== null,
    press(pointer) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) => press(t, pointer.field, envOf(field, t, pointer)));
    },
    move(pointer) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) =>
            pointerMove(t, pointer.field, envOf(field, t, pointer)),
        );
    },
    release(_pointer, click) {
        const field = currentShapeField();
        if (!field) return;
        updateTool((t) => release(t, shapeContextFor(field), click));
    },
    cancel() {
        updateTool(cancelGesture);
    },
    cursorAt(pointer) {
        const tool = useShapeToolStore.getState().tool;
        const field = currentShapeField();
        if (!tool || !field) return null;
        const env = envOf(field, tool, pointer);
        // The editor asks for the cursor as the pointer moves, so this is where hovering is seen
        hoverAt(tool, pointer.field, env.hitRadius);
        const target = pressTarget(tool, pointer.field, env);
        overAt(target.type !== "draw");
        if (target.type === "draw") return "crosshair";
        return shapeCursor(tool.kind, tool.params, tool.spots, target);
    },
    leave() {
        overAt(false);
        if (useSpotHover.getState().hover)
            useSpotHover.setState({ hover: null });
    },
    drawing: () => glidingSnapshot(shownNow()),
    subscribe: (listener) => {
        const offTool = useShapeToolStore.subscribe(listener);
        const offHover = useSpotHover.subscribe(listener);
        const offSettings = useUiSettingsStore.subscribe(listener);
        glideListeners.add(listener);
        return () => {
            offTool();
            offHover();
            offSettings();
            glideListeners.delete(listener);
        };
    },
    // The tool's handles move the shape; the marchers stay put until Place
    ownsSelectionBox: true,
    locksSelection: true,
    gesture: { kind: "shape", always: true },
};
