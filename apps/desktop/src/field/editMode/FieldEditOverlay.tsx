import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint, FieldProperties } from "@openmarch/core";
import clsx from "clsx";
import { useTranslate } from "@tolgee/react";
import { useFieldViewStore } from "@/field/three/fieldView";
import { useIsTouchMode } from "@/stores/InputModeStore";
import { isToggleOn } from "@/stores/TouchModifierStore";
import {
    DRAG_SNAP_STEPS,
    FINE_DRAG_SNAP_STEPS,
    RULER_PX,
    dragSteps,
    fieldScreenRect,
    fieldToSteps,
    lineKey,
    lineLabel,
    lineReadout,
    lineScreen,
    linesInBox,
    linesOn,
    overRuler,
    sameLine,
    screenToField,
    stepsToField,
    toRef,
    type FieldLineRef,
} from "./lines";
import {
    boxSelect,
    clickLine,
    existingSelection,
    isSelected,
    selectionWithTwins,
} from "./lineSelection";
import {
    fieldEditMode,
    useFieldEditModeStore,
    type FieldEditDrag,
} from "./fieldEditModeStore";
import { useApplyFieldEdits } from "./useApplyFieldEdits";
import {
    addLineEdit,
    deleteLinesEdit,
    moveLineEdit,
    nudgeLinesEdit,
} from "./lineCommands";
import { selectAdded } from "./useFieldEditModeActions";
import { LineReadoutText } from "./LineReadoutText";
import { LineMenu } from "./LineMenu";
import { LinePopover } from "./LinePopover";

/** How far a press moves before it's a drag, in CSS px: a finger wanders more than a mouse */
const DRAG_START_PX = { mouse: 3, touch: 8 } as const;
/** How long a finger stays on a line to open its menu */
const LONG_PRESS_MS = 500;

type Press =
    | {
          kind: "line";
          pointerId: number;
          pointerType: string;
          start: { x: number; y: number };
          line: Checkpoint;
          additive: boolean;
          wasSelected: boolean;
          dragging: boolean;
          /** The lines a drag moves */
          moving: FieldLineRef[];
      }
    | {
          kind: "ruler";
          pointerId: number;
          axis: "x" | "y";
          start: { x: number; y: number };
          dragging: boolean;
      }
    | {
          kind: "box";
          pointerId: number;
          pointerType: string;
          start: { x: number; y: number };
          end: { x: number; y: number };
          additive: boolean;
          dragging: boolean;
      };

/**
 * The Edit field mode on the canvas (#824): rulers along the top (X lines) and left (Y lines),
 * the lines as things to pick and drag, a box to pick many, and the line's menu and exact-values
 * popover. Covers the field while the mode is on, so marchers can't be picked; the wheel and pan
 * drags still reach the field's navigation.
 *
 * - Drag out of a ruler to add a line (with Mirror on, its twin too), a line to move it, and a
 *   line back into its ruler to delete it. Whole steps; half steps with Shift (or the touch pill's
 *   Fine). A readout says where.
 * - Click a line or its ruler tab to pick it, Shift-click to add, drag a box over the field to
 *   pick the lines it crosses. Double-click (or tap a picked line) for exact values; right-click
 *   or a long press for its menu.
 */
export function FieldEditOverlay({ fp }: { fp: FieldProperties }) {
    const { t } = useTranslate();
    const view = useFieldViewStore();
    const isTouch = useIsTouchMode();
    const apply = useApplyFieldEdits();
    const storedSelection = useFieldEditModeStore((s) => s.selection);
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const hover = useFieldEditModeStore((s) => s.hover);
    const drag = useFieldEditModeStore((s) => s.drag);
    const editing = useFieldEditModeStore((s) => s.editing);
    const menu = useFieldEditModeStore((s) => s.menu);
    const selectMany = useFieldEditModeStore((s) => s.selectMany);
    const selection = existingSelection(fp, storedSelection);
    // An undo can take a picked line away: forget it
    useEffect(() => {
        if (selection !== storedSelection) fieldEditMode.select(selection);
    }, [selection, storedSelection]);

    const root = useRef<HTMLDivElement>(null);
    const press = useRef<Press | null>(null);
    const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [box, setBox] = useState<{
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    } | null>(null);
    const [pointerAt, setPointerAt] = useState<{ x: number; y: number } | null>(
        null,
    );

    const local = (event: { clientX: number; clientY: number }) => {
        const rect = root.current?.getBoundingClientRect();
        return {
            x: event.clientX - (rect?.left ?? 0),
            y: event.clientY - (rect?.top ?? 0),
        };
    };
    const snapFor = (event: { shiftKey: boolean }) =>
        event.shiftKey || isToggleOn("fine")
            ? FINE_DRAG_SNAP_STEPS
            : DRAG_SNAP_STEPS;
    const clearLongPress = () => {
        if (longPress.current !== null) clearTimeout(longPress.current);
        longPress.current = null;
    };
    const cancel = useCallback(() => {
        press.current = null;
        clearLongPress();
        setBox(null);
        fieldEditMode.setDrag(null);
    }, []);
    // Escape lets go of a drag without changing anything
    useEffect(() => {
        if (!drag && !box) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [drag, box, cancel]);
    useEffect(() => cancel, [cancel]);

    const rect = fieldScreenRect(fp, view);
    const highlighted = useMemo(
        () =>
            new Set(
                selectionWithTwins(fp, selection, mirror).map((r) =>
                    lineKey(r),
                ),
            ),
        [fp, selection, mirror],
    );

    /* -------------------------------------------------------------- presses on a line */

    const onLineDown = (event: React.PointerEvent, line: Checkpoint) => {
        if (event.button !== 0 || press.current) return;
        event.stopPropagation();
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        const ref = toRef(line);
        const additive = event.shiftKey || selectMany;
        const wasSelected = isSelected(selection, ref);
        // Picked on press, so a drag moves what's under the pointer
        if (!wasSelected)
            fieldEditMode.select(clickLine(selection, ref, additive));
        const current = fieldEditMode.get().selection;
        const sameAxis = current.filter((r) => r.axis === line.axis);
        press.current = {
            kind: "line",
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            start: local(event),
            line,
            additive,
            wasSelected,
            dragging: false,
            // The pressed line first: it's the one the drag puts under the pointer
            moving:
                isSelected(current, ref) && sameAxis.length > 1
                    ? [ref, ...sameAxis.filter((r) => !sameLine(r, ref))]
                    : [ref],
        };
        if (event.pointerType !== "mouse") {
            const at = local(event);
            longPress.current = setTimeout(() => {
                const p = press.current;
                if (!p || p.kind !== "line" || p.dragging) return;
                press.current = null;
                fieldEditMode.openMenu({ line: ref, at });
            }, LONG_PRESS_MS);
        }
    };

    const onRulerDown = (event: React.PointerEvent, axis: "x" | "y") => {
        if (event.button !== 0 || press.current) return;
        event.stopPropagation();
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        press.current = {
            kind: "ruler",
            pointerId: event.pointerId,
            axis,
            start: local(event),
            dragging: false,
        };
    };

    const onSurfaceDown = (event: React.PointerEvent) => {
        // A finger on the open field pans it (navigation); a mouse or pen draws a box
        if (event.button !== 0 || press.current) return;
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        const at = local(event);
        press.current = {
            kind: "box",
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            start: at,
            end: at,
            additive: event.shiftKey || selectMany,
            dragging: false,
        };
    };

    const onMove = (event: React.PointerEvent) => {
        const at = local(event);
        // Where X and Y add a line: the pointer, while it's over the field
        const inField =
            at.x >= rect.left &&
            at.x <= rect.right &&
            at.y >= rect.top &&
            at.y <= rect.bottom;
        fieldEditMode.setPointer(
            inField
                ? {
                      x: fieldToSteps(fp, "x", screenToField(view, "x", at.x)),
                      y: fieldToSteps(fp, "y", screenToField(view, "y", at.y)),
                  }
                : null,
        );
        const p = press.current;
        if (!p || p.pointerId !== event.pointerId) return;
        setPointerAt(at);
        const threshold =
            event.pointerType === "mouse"
                ? DRAG_START_PX.mouse
                : DRAG_START_PX.touch;
        if (
            !p.dragging &&
            Math.hypot(at.x - p.start.x, at.y - p.start.y) < threshold
        )
            return;
        if (!p.dragging) clearLongPress();
        p.dragging = true;
        if (p.kind === "box") {
            if (p.pointerType === "touch") return;
            p.end = at;
            setBox({ x0: p.start.x, y0: p.start.y, x1: at.x, y1: at.y });
            return;
        }
        const axis = p.kind === "ruler" ? p.axis : p.line.axis;
        const steps = dragSteps(
            fp,
            view,
            axis,
            axis === "x" ? at.x : at.y,
            snapFor(event),
        );
        const next: FieldEditDrag = {
            kind: p.kind === "ruler" ? "add" : "move",
            axis,
            steps,
            overRuler: overRuler(axis, at),
            lines: p.kind === "line" ? p.moving : [],
        };
        fieldEditMode.setDrag(next);
    };

    const onUp = (event: React.PointerEvent) => {
        const p = press.current;
        if (!p || p.pointerId !== event.pointerId) return;
        press.current = null;
        clearLongPress();
        const current = fieldEditMode.get().drag;
        fieldEditMode.setDrag(null);
        setBox(null);
        setPointerAt(null);
        if (p.kind === "box") {
            if (p.dragging && p.pointerType !== "touch") {
                const lines = linesInBox(fp, view, {
                    x0: p.start.x,
                    y0: p.start.y,
                    x1: p.end.x,
                    y1: p.end.y,
                });
                fieldEditMode.select(boxSelect(selection, lines, p.additive));
            } else if (!p.dragging && !p.additive) fieldEditMode.select([]);
            return;
        }
        if (p.kind === "ruler") {
            if (!p.dragging || !current || current.overRuler) return;
            void apply(addLineEdit(p.axis, current.steps, mirror)).then(
                selectAdded,
            );
            return;
        }
        // A line
        const ref = toRef(p.line);
        if (!p.dragging || !current) {
            if (p.wasSelected && p.additive)
                fieldEditMode.select(clickLine(selection, ref, true));
            else if (p.wasSelected && !p.additive) {
                // A tap on a picked line opens its exact values (touch); a click picks it alone
                if (p.pointerType !== "mouse" && selection.length === 1)
                    fieldEditMode.edit(ref);
                else fieldEditMode.select([ref]);
            }
            return;
        }
        if (current.overRuler) {
            const edit = deleteLinesEdit(fp, p.moving, mirror);
            if (edit)
                void apply(edit).then((result) => {
                    if (result?.diff.ok) fieldEditMode.select([]);
                });
            return;
        }
        const by = current.steps - p.line.stepsFromCenterFront;
        if (Math.abs(by) < 1e-9) return;
        const edit =
            p.moving.length > 1
                ? nudgeLinesEdit(fp, p.moving, p.line.axis, by, mirror)
                : moveLineEdit(ref, current.steps, mirror);
        if (edit) void apply(edit);
    };

    const onLostCapture = (event: React.PointerEvent) => {
        if (press.current?.pointerId === event.pointerId) cancel();
    };

    /* -------------------------------------------------------------- drawing */

    const width = view.width;
    const height = view.height;
    const lines = [...linesOn(fp, "x"), ...linesOn(fp, "y")];
    const dragged = new Set((drag?.lines ?? []).map(lineKey));
    const ghost = drag && !drag.overRuler ? ghostLines(fp, drag, mirror) : [];
    const stepPx = fp.pixelsPerStep * view.zoom;
    const touchPad = isTouch ? 10 : 5;

    return (
        <div
            ref={root}
            data-field-edit-overlay
            data-testid="field-edit-overlay"
            className={clsx(
                "absolute inset-0 z-30 touch-none select-none",
                drag?.overRuler && "cursor-not-allowed",
            )}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onLostCapture}
            onLostPointerCapture={onLostCapture}
            onPointerLeave={() => fieldEditMode.setPointer(null)}
        >
            {/* The open field: a box picks lines (mouse, pen); a tap there clears the pick */}
            <div
                className="absolute inset-0"
                data-testid="field-edit-surface"
                onPointerDown={onSurfaceDown}
            />
            <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden
            >
                {lines.map((c) => {
                    const key = lineKey(toRef(c));
                    const at = lineScreen(fp, view, c);
                    const lit = highlighted.has(key);
                    const hovered = hover && sameLine(hover, toRef(c));
                    const moving = dragged.has(key);
                    // Hidden lines are drawn faint here, so they can be found and picked
                    if (!lit && !hovered && c.visible && !moving) return null;
                    const [x1, y1, x2, y2] =
                        c.axis === "x"
                            ? [at, rect.top, at, rect.bottom]
                            : [rect.left, at, rect.right, at];
                    return (
                        <line
                            key={key}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            className={clsx(
                                lit || hovered
                                    ? "stroke-accent"
                                    : "stroke-text-subtitle",
                                moving && "opacity-40",
                            )}
                            strokeWidth={lit ? 2.5 : hovered ? 1.5 : 1}
                            strokeDasharray={
                                c.visible ? undefined : lit ? "6 4" : "3 5"
                            }
                            opacity={!c.visible && !lit && !hovered ? 0.7 : 1}
                        />
                    );
                })}
                {ghost.map((g, i) => {
                    const at = fieldToScreenAxis(fp, view, g.axis, g.steps);
                    const [x1, y1, x2, y2] =
                        g.axis === "x"
                            ? [at, rect.top, at, rect.bottom]
                            : [rect.left, at, rect.right, at];
                    return (
                        <line
                            key={i}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            className="stroke-accent"
                            strokeWidth={2}
                            strokeDasharray={g.twin ? "4 4" : undefined}
                        />
                    );
                })}
                {box && (
                    <rect
                        x={Math.min(box.x0, box.x1)}
                        y={Math.min(box.y0, box.y1)}
                        width={Math.abs(box.x1 - box.x0)}
                        height={Math.abs(box.y1 - box.y0)}
                        className="fill-accent/10 stroke-accent"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                    />
                )}
            </svg>

            {/* Each line, to pick, drag, double-click or open its menu */}
            {lines.map((c) => {
                const at = lineScreen(fp, view, c);
                const ref = toRef(c);
                if (
                    c.axis === "x"
                        ? at < -10 || at > width + 10
                        : at < -10 || at > height + 10
                )
                    return null;
                const style =
                    c.axis === "x"
                        ? {
                              left: at - touchPad,
                              width: touchPad * 2,
                              top: Math.max(rect.top, RULER_PX),
                              height: Math.max(
                                  0,
                                  Math.min(rect.bottom, height) -
                                      Math.max(rect.top, RULER_PX),
                              ),
                          }
                        : {
                              top: at - touchPad,
                              height: touchPad * 2,
                              left: Math.max(rect.left, RULER_PX),
                              width: Math.max(
                                  0,
                                  Math.min(rect.right, width) -
                                      Math.max(rect.left, RULER_PX),
                              ),
                          };
                return (
                    <div
                        key={lineKey(ref)}
                        role="button"
                        tabIndex={-1}
                        aria-label={lineLabel(fp, c)}
                        aria-pressed={isSelected(selection, ref)}
                        data-field-line={lineKey(ref)}
                        className={clsx(
                            "absolute",
                            c.axis === "x"
                                ? "cursor-ew-resize"
                                : "cursor-ns-resize",
                        )}
                        style={style}
                        onPointerDown={(e) => onLineDown(e, c)}
                        onPointerEnter={() => fieldEditMode.setHover(ref)}
                        onPointerLeave={() =>
                            fieldEditMode.get().hover &&
                            sameLine(fieldEditMode.get().hover!, ref) &&
                            fieldEditMode.setHover(null)
                        }
                        onDoubleClick={() => fieldEditMode.edit(ref)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            if (!isSelected(selection, ref))
                                fieldEditMode.select([ref]);
                            fieldEditMode.openMenu({ line: ref, at: local(e) });
                        }}
                    />
                );
            })}

            <Ruler
                axis="x"
                fp={fp}
                view={view}
                length={width}
                stepPx={stepPx}
                highlighted={highlighted}
                hover={hover}
                onRulerDown={onRulerDown}
                onLineDown={onLineDown}
                onLineDoubleClick={(ref) => fieldEditMode.edit(ref)}
                onRulerDoubleClick={(axis, pixel) =>
                    void apply(
                        addLineEdit(
                            axis,
                            dragSteps(fp, view, axis, pixel),
                            mirror,
                        ),
                    ).then(selectAdded)
                }
                title={t("fieldEditMode.ruler.x")}
            />
            <Ruler
                axis="y"
                fp={fp}
                view={view}
                length={height}
                stepPx={stepPx}
                highlighted={highlighted}
                hover={hover}
                onRulerDown={onRulerDown}
                onLineDown={onLineDown}
                onLineDoubleClick={(ref) => fieldEditMode.edit(ref)}
                onRulerDoubleClick={(axis, pixel) =>
                    void apply(
                        addLineEdit(
                            axis,
                            dragSteps(fp, view, axis, pixel),
                            mirror,
                        ),
                    ).then(selectAdded)
                }
                title={t("fieldEditMode.ruler.y")}
            />
            {/* The corner where the rulers meet */}
            <div
                className="bg-fg-1 border-stroke absolute top-0 left-0 z-10 border-r border-b"
                style={{ width: RULER_PX, height: RULER_PX }}
            />

            {drag && pointerAt && (
                <div
                    data-testid="field-edit-readout"
                    className="bg-modal text-text rounded-6 border-stroke shadow-modal text-sub pointer-events-none absolute z-20 border px-8 py-4 whitespace-nowrap tabular-nums"
                    style={{
                        left: Math.min(
                            pointerAt.x + 14,
                            Math.max(0, width - 260),
                        ),
                        top: Math.min(
                            pointerAt.y + 14,
                            Math.max(0, height - 60),
                        ),
                    }}
                >
                    {drag.overRuler ? (
                        drag.kind === "move" ? (
                            <span className="text-red">
                                {t("fieldEditMode.readout.releaseToDelete", {
                                    count: drag.lines.length,
                                })}
                            </span>
                        ) : (
                            t("fieldEditMode.readout.dragOut")
                        )
                    ) : (
                        <LineReadoutText
                            readout={lineReadout(
                                fp,
                                drag.axis,
                                drag.steps,
                                drag.lines,
                            )}
                            adding={drag.kind === "add"}
                            mirrored={
                                mirror && drag.axis === "x" && drag.steps !== 0
                            }
                        />
                    )}
                </div>
            )}

            {menu && <LineMenu fp={fp} line={menu.line} at={menu.at} />}
            {editing && (
                <LinePopover
                    key={lineKey(editing)}
                    fp={fp}
                    line={editing}
                    view={view}
                    bounds={{ width, height }}
                />
            )}
        </div>
    );
}

function fieldToScreenAxis(
    fp: FieldProperties,
    view: { zoom: number; panX: number; panY: number },
    axis: "x" | "y",
    steps: number,
) {
    const field = stepsToField(fp, axis, steps);
    return (axis === "x" ? view.panX : view.panY) + field * view.zoom;
}

/** Where a drag would put its lines (and with mirror, their twins) */
function ghostLines(
    fp: FieldProperties,
    drag: FieldEditDrag,
    mirror: boolean,
): { axis: "x" | "y"; steps: number; twin: boolean }[] {
    const mirrored = (steps: number) =>
        mirror && drag.axis === "x" && Math.abs(steps) > 1e-9
            ? [{ axis: drag.axis, steps: -steps, twin: true }]
            : [];
    if (drag.kind === "add")
        return [
            { axis: drag.axis, steps: drag.steps, twin: false },
            ...mirrored(drag.steps),
        ];
    // The pressed line (listed first) goes to `steps`; the others move as far
    const lines = drag.lines.flatMap(
        (ref) =>
            (ref.axis === "x" ? fp.xCheckpoints : fp.yCheckpoints).find(
                (c) => c.id === ref.id,
            ) ?? [],
    );
    const lead = lines[0];
    if (!lead) return [];
    const by = drag.steps - lead.stepsFromCenterFront;
    return lines.flatMap((c) => {
        const steps = c.stepsFromCenterFront + by;
        return [{ axis: drag.axis, steps, twin: false }, ...mirrored(steps)];
    });
}

/**
 * A ruler: along the top for X lines, down the left for Y lines. Ticks every step (every 4 or 8
 * when they'd crowd), a tab for each line with its short name, picked and dragged like the line.
 * Dragging out of the ruler adds a line; double-clicking it adds one there.
 */
function Ruler({
    axis,
    fp,
    view,
    length,
    stepPx,
    highlighted,
    hover,
    onRulerDown,
    onLineDown,
    onLineDoubleClick,
    onRulerDoubleClick,
    title,
}: {
    axis: "x" | "y";
    fp: FieldProperties;
    view: { zoom: number; panX: number; panY: number };
    length: number;
    stepPx: number;
    highlighted: ReadonlySet<string>;
    hover: FieldLineRef | null;
    onRulerDown: (event: React.PointerEvent, axis: "x" | "y") => void;
    onLineDown: (event: React.PointerEvent, line: Checkpoint) => void;
    onLineDoubleClick: (ref: FieldLineRef) => void;
    onRulerDoubleClick: (axis: "x" | "y", pixel: number) => void;
    title: string;
}) {
    const horizontal = axis === "x";
    const every = stepPx >= 6 ? 1 : stepPx >= 1.5 ? 4 : 8;
    const ticks: { at: number; major: boolean }[] = [];
    const start = screenToField(view, axis, 0);
    const end = screenToField(view, axis, length);
    const firstStep = Math.ceil(fieldToSteps(fp, axis, start) / every) * every;
    const lastStep = Math.floor(fieldToSteps(fp, axis, end) / every) * every;
    if (lastStep - firstStep <= 4000 * every)
        for (let s = firstStep; s <= lastStep; s += every)
            ticks.push({
                at: fieldToScreenAxis(fp, view, axis, s),
                major: s % 8 === 0,
            });
    const lines = linesOn(fp, axis);
    const positions = lines.map((c) => lineScreen(fp, view, c));
    // Room for a name between neighbors? Else a slim tab
    const roomy = (i: number) => {
        const gap = Math.min(
            i > 0 ? positions[i]! - positions[i - 1]! : Infinity,
            i < positions.length - 1
                ? positions[i + 1]! - positions[i]!
                : Infinity,
        );
        return Math.abs(gap) >= (horizontal ? 30 : 18);
    };
    const local = (event: React.MouseEvent) => {
        const rect = (
            event.currentTarget as HTMLElement
        ).getBoundingClientRect();
        return horizontal
            ? event.clientX - rect.left
            : event.clientY - rect.top;
    };
    return (
        <div
            data-field-control
            data-testid={`field-edit-ruler-${axis}`}
            title={title}
            className={clsx(
                "bg-fg-1/95 border-stroke backdrop-blur-32 absolute z-10 cursor-copy overflow-hidden",
                horizontal
                    ? "top-0 right-0 left-0 border-b"
                    : "top-0 bottom-0 left-0 border-r",
            )}
            style={horizontal ? { height: RULER_PX } : { width: RULER_PX }}
            onPointerDown={(e) => onRulerDown(e, axis)}
            onDoubleClick={(e) => {
                if (e.target === e.currentTarget)
                    onRulerDoubleClick(axis, local(e));
            }}
        >
            <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden
            >
                {ticks.map((tick) => {
                    const size = tick.major ? 7 : 4;
                    return horizontal ? (
                        <line
                            key={tick.at}
                            x1={tick.at}
                            x2={tick.at}
                            y1={RULER_PX - size}
                            y2={RULER_PX}
                            className="stroke-text-subtitle"
                            strokeWidth={1}
                        />
                    ) : (
                        <line
                            key={tick.at}
                            y1={tick.at}
                            y2={tick.at}
                            x1={RULER_PX - size}
                            x2={RULER_PX}
                            className="stroke-text-subtitle"
                            strokeWidth={1}
                        />
                    );
                })}
            </svg>
            {lines.map((c, i) => {
                const at = positions[i]!;
                if (at < -20 || at > length + 20) return null;
                const ref = toRef(c);
                const key = lineKey(ref);
                const lit = highlighted.has(key);
                const hovered = hover && sameLine(hover, ref);
                const named = roomy(i);
                return (
                    <div
                        key={key}
                        role="button"
                        tabIndex={-1}
                        aria-label={lineLabel(fp, c)}
                        data-field-line-tab={key}
                        className={clsx(
                            "rounded-4 text-sub absolute flex items-center justify-center overflow-hidden border leading-none tabular-nums",
                            horizontal
                                ? "cursor-ew-resize"
                                : "cursor-ns-resize",
                            lit
                                ? "bg-accent text-text-invert border-accent"
                                : hovered
                                  ? "border-accent bg-bg-1 text-text"
                                  : "border-stroke bg-bg-1 text-text-subtitle",
                            !c.visible && !lit && "border-dashed opacity-70",
                        )}
                        style={
                            horizontal
                                ? {
                                      left: at - (named ? 14 : 3),
                                      width: named ? 28 : 6,
                                      top: 3,
                                      height: RULER_PX - 6,
                                  }
                                : {
                                      top: at - (named ? 8 : 3),
                                      height: named ? 16 : 6,
                                      left: 2,
                                      width: RULER_PX - 4,
                                  }
                        }
                        onPointerDown={(e) => onLineDown(e, c)}
                        onPointerEnter={() => fieldEditMode.setHover(ref)}
                        onPointerLeave={() => fieldEditMode.setHover(null)}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onLineDoubleClick(ref);
                        }}
                    >
                        {named && horizontal ? c.terseName : null}
                    </div>
                );
            })}
        </div>
    );
}
