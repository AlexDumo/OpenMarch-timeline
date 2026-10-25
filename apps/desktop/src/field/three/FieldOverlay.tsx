import { useCallback, useSyncExternalStore } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type { FieldEditor, FieldModeDrawing } from "@/field/editor/fieldEditor";
import type { AreaShape } from "@/field/editor/areaGestures";
import { HANDLE_SIZE, type HandleId } from "@/field/editor/groupTransform";
import type { FieldRect } from "@/field/editor/selectionArea";
import type { PropToolShape } from "@/field/editor/propTool";
import type { FieldMarchers } from "./fieldMarchers";
import type { FieldItems } from "./fieldItems";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import {
    drawnSelectionBox,
    selectionHandles,
    type DrawnSelectionBox,
} from "./selectionFrame";
import { ringReach, SELECTION_COLOR } from "./selectionRing";

/** The selection border width, in CSS px. */
const BOX_WIDTH = 2;
/** The marquee border width, in CSS px. */
const MARQUEE_WIDTH = 2;
/** The lasso stroke: 2 CSS px, dashed 5 on, 5 off. */
const LASSO_WIDTH = 2;
const LASSO_DASH = "5 5";
/**
 * A mode's look (the shape tool, a selected placed box): the outline 1 CSS px
 * wide, dashed 6 on, 4 off; spots of radius 4 field units, 1.5 wide; walks 1
 * field unit wide; handles 9 CSS px squares with a 1.5 px rim. As on Fabric.
 */
const SHAPE_OUTLINE_WIDTH = 1;
const SHAPE_OUTLINE_DASH = "6 4";
const SPOT_RADIUS = 4;
const SPOT_WIDTH = 1.5;
const WALK_WIDTH = 1;
/**
 * The hollow ring where each of the shape's marchers starts, in CSS px: just outside a selected
 * marcher's ring, so a marcher standing on its start shows both.
 */
const START_RING_GAP = 2;
const START_RING_WIDTH = 1.5;
const SHAPE_HANDLE_SIZE = 9;
const SHAPE_HANDLE_WIDTH = 1.5;

/** The prop tool's line while drawing, in CSS px. */
const PROP_PREVIEW_WIDTH = 2;

/** The rotate handle's connecting line, in CSS px. */
const ROTATE_LINE_WIDTH = 1;
/** A shape's rotate knob, center dot and pivot, in CSS px (08-shape-system-ux.md). */
const KNOB_RADIUS = 5;
const CENTER_DOT_RADIUS = 5;
const CENTER_DOT_RING = 2.5;
const PIVOT_RADIUS = 4;
const PIVOT_COLOR = "#facc15";
/** The pivot's crosshair once it's out of the center (#350): its arms and ring, in CSS px */
const PIVOT_MARK_ARM = 9;
const PIVOT_MARK_RING = 5;
/** How strong an open shape's controls are while the pointer is away from it (#403) */
const CALM_CONTROLS_OPACITY = 0.25;
/** Spot labels and the pointer tip, in CSS px. */
const SPOT_LABEL_PX = 10;
const TIP_PX = 12;
const TIP_OFFSET_PX = 14;

/**
 * The SVG overlay over the field (ADR 0005 D-2): what the editor draws on top
 * of the WebGL field in screen space. The selection box around a selection of
 * two or more marchers (#193) with its scale and rotate handles (#198), the
 * marquee and lasso while one is drawn (#195), and what a mode draws: the
 * shape tool's box, or a selected placed box's (#204).
 *
 * It reads the camera from the view store, as the WebGL camera does, and
 * re-renders only when what it draws changes: with no box, playback doesn't
 * render it. During a marquee, lasso or handle drag it re-renders on every
 * pointer move; nothing else in the app does. It takes no pointer events: the
 * field under it does, and the editor hit-tests the handles as it does the
 * marchers.
 */
export default function FieldOverlay({
    marchers,
    items,
    editor,
    theme,
}: {
    marchers: FieldMarchers;
    items: FieldItems;
    editor: FieldEditor;
    theme: FieldTheme;
}) {
    const subscribeEditor = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    // The box as a string, so an unchanged box is an unchanged snapshot
    const box = useSyncExternalStore(
        useCallback(
            (listener: () => void) => {
                const off = [
                    marchers.subscribe(listener),
                    items.subscribe(listener),
                    subscribeEditor(listener),
                ];
                return () => off.forEach((unsubscribe) => unsubscribe());
            },
            [marchers, items, subscribeEditor],
        ),
        () => JSON.stringify(drawnSelectionBox(marchers, editor, items)),
    );
    const area = useSyncExternalStore(subscribeEditor, () =>
        editor.areaShape(),
    );
    const modeDrawing = useSyncExternalStore(subscribeEditor, () =>
        editor.modeDrawing(),
    );
    const propTool = useSyncExternalStore(subscribeEditor, () =>
        editor.propToolShape(),
    );

    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="fieldOverlay"
        >
            <SelectionBox frame={JSON.parse(box) as DrawnSelectionBox | null} />
            {area?.kind === "marquee" && (
                <Marquee rect={area.rect} theme={theme} />
            )}
            {area?.kind === "lasso" && <Lasso lasso={area} theme={theme} />}
            {modeDrawing && <ModeDrawing drawing={modeDrawing} theme={theme} />}
            {propTool && <PropToolPreview tool={propTool} theme={theme} />}
        </svg>
    );
}

/**
 * The box around a multi-selection, clear of the selection rings, with its
 * handles (#198): squares on the corners and middles, and the rotate handle
 * above the top middle, joined to it by a line. Turned with the marchers
 * while a rotation is dragged.
 */
function SelectionBox({ frame }: { frame: DrawnSelectionBox | null }) {
    const view = useFieldViewStore();
    if (!frame) return null;
    const screen = Object.fromEntries(
        Object.entries(selectionHandles(frame, view.zoom)).map(([id, at]) => [
            id,
            fieldToElement(view, at.x, at.y),
        ]),
    ) as Record<HandleId, { x: number; y: number }>;
    const corners = [screen.nw, screen.ne, screen.se, screen.sw]
        .map(({ x, y }) => `${x},${y}`)
        .join(" ");
    const half = HANDLE_SIZE / 2;
    return (
        <g data-testid="fieldSelectionBox">
            <polygon
                points={corners}
                fill="none"
                stroke={SELECTION_COLOR}
                strokeWidth={BOX_WIDTH}
            />
            <line
                x1={screen.n.x}
                y1={screen.n.y}
                x2={screen.rot.x}
                y2={screen.rot.y}
                stroke={SELECTION_COLOR}
                strokeWidth={ROTATE_LINE_WIDTH}
            />
            {(Object.keys(screen) as HandleId[]).map((id) =>
                id === "rot" ? (
                    <circle
                        key={id}
                        cx={screen.rot.x}
                        cy={screen.rot.y}
                        r={half}
                        fill="white"
                        stroke={SELECTION_COLOR}
                        strokeWidth={1}
                    />
                ) : (
                    <rect
                        key={id}
                        x={-half}
                        y={-half}
                        width={HANDLE_SIZE}
                        height={HANDLE_SIZE}
                        transform={`translate(${screen[id].x} ${screen[id].y}) rotate(${frame.angle})`}
                        fill="white"
                        stroke={SELECTION_COLOR}
                        strokeWidth={1}
                    />
                ),
            )}
        </g>
    );
}

/**
 * The prop tool's Outline as it's drawn (C2.1): the theme's line color,
 * filled at 30% when it's a closed shape.
 */
function PropToolPreview({
    tool,
    theme,
}: {
    tool: PropToolShape;
    theme: FieldTheme;
}) {
    const view = useFieldViewStore();
    const { preview } = tool;
    if (!preview) return null;
    const points = preview.points
        .map((point) => {
            const at = fieldToElement(view, point.x, point.y);
            return `${at.x},${at.y}`;
        })
        .join(" ");
    const stroke = rgbaToString(theme.primaryStroke);
    return preview.closed ? (
        <polygon
            data-testid="fieldPropTool"
            points={points}
            fill={rgbaToString({ ...theme.primaryStroke, a: 0.3 })}
            stroke={stroke}
            strokeWidth={PROP_PREVIEW_WIDTH}
        />
    ) : (
        <polyline
            data-testid="fieldPropTool"
            points={points}
            fill="none"
            stroke={stroke}
            strokeWidth={PROP_PREVIEW_WIDTH}
        />
    );
}

/** The marquee: the theme's shape color, filled at 20%. */
function Marquee({ rect, theme }: { rect: FieldRect; theme: FieldTheme }) {
    const view = useFieldViewStore();
    const topLeft = fieldToElement(view, rect.left, rect.top);
    const bottomRight = fieldToElement(view, rect.right, rect.bottom);
    return (
        <rect
            data-testid="fieldMarquee"
            x={topLeft.x}
            y={topLeft.y}
            width={bottomRight.x - topLeft.x}
            height={bottomRight.y - topLeft.y}
            fill={rgbaToString({ ...theme.shape, a: 0.2 })}
            stroke={rgbaToString(theme.shape)}
            strokeWidth={MARQUEE_WIDTH}
        />
    );
}

/**
 * The lasso's line, dashed: the theme's stroke color, and its
 * next-path green while releasing would close it.
 */
function Lasso({
    lasso,
    theme,
}: {
    lasso: AreaShape & { kind: "lasso" };
    theme: FieldTheme;
}) {
    const view = useFieldViewStore();
    const points = lasso.points
        .map((point) => {
            const at = fieldToElement(view, point.x, point.y);
            return `${at.x},${at.y}`;
        })
        .join(" ");
    return (
        <polyline
            data-testid="fieldLasso"
            data-closes={lasso.closes}
            points={points}
            fill="none"
            stroke={rgbaToString(
                lasso.closes ? theme.nextPath : theme.primaryStroke,
            )}
            strokeWidth={LASSO_WIDTH}
            strokeDasharray={LASSO_DASH}
        />
    );
}

/**
 * What a mode draws (#204): the shape's outline, dashed, the spots its
 * marchers will stand on, a faint line from each marcher to its spot, and its
 * handles, in the theme's shape color.
 */
function ModeDrawing({
    drawing,
    theme,
}: {
    drawing: FieldModeDrawing;
    theme: FieldTheme;
}) {
    const view = useFieldViewStore();
    const shape = rgbaToString(theme.shape);
    const walk = rgbaToString({ ...theme.shape, a: 0.4 });
    const fill = rgbaToString({ ...theme.shape, a: 0.06 });
    const z = view.zoom;
    const at = (point: { x: number; y: number }) =>
        fieldToElement(view, point.x, point.y);
    const half = SHAPE_HANDLE_SIZE / 2;
    const open = drawing.stage === "open";
    const dots = drawing.stage === "drawing";
    // The controls fade while the pointer is away from the shape (#403), and come back over it
    const controls = {
        opacity: drawing.calm ? CALM_CONTROLS_OPACITY : 1,
        transition: "opacity 150ms ease-out",
    };
    return (
        <g data-testid="fieldShapeMode" data-stage={drawing.stage}>
            {drawing.outline && (
                <polygon
                    points={drawing.outline
                        .map((point) => {
                            const p = at(point);
                            return `${p.x},${p.y}`;
                        })
                        .join(" ")}
                    // The faint fill shows with the controls, on hover (#403)
                    fill={open && !drawing.calm ? fill : "none"}
                    stroke={shape}
                    strokeWidth={SHAPE_OUTLINE_WIDTH}
                    strokeDasharray={open ? undefined : SHAPE_OUTLINE_DASH}
                />
            )}
            {drawing.rings?.map((point, i) => {
                const p = at(point);
                return (
                    <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={ringReach(z) * z + START_RING_GAP}
                        fill="none"
                        stroke={shape}
                        strokeWidth={START_RING_WIDTH}
                        data-testid="fieldShapeStartRing"
                    />
                );
            })}
            {drawing.walks.map(({ from, to }, i) => {
                const a = at(from);
                const b = at(to);
                return (
                    <line
                        key={i}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={walk}
                        strokeWidth={WALK_WIDTH * z}
                    />
                );
            })}
            {drawing.spots.map((point, i) => {
                const p = at(point);
                return (
                    <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={SPOT_RADIUS * z}
                        // Solid while drawn and once open (#403): the spots are where everyone will
                        // stand, unlike the hollow start rings
                        fill={dots || open ? shape : "none"}
                        stroke={dots || open ? "white" : shape}
                        strokeWidth={SPOT_WIDTH * z}
                    />
                );
            })}
            {drawing.gaps?.map((point, i) => {
                const p = at(point);
                return (
                    <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={SPOT_RADIUS * z}
                        fill="none"
                        stroke={shape}
                        strokeWidth={SPOT_WIDTH * z}
                        strokeDasharray={`${1.5 * z} ${1.5 * z}`}
                        style={controls}
                        data-testid="fieldShapeGap"
                    />
                );
            })}
            {drawing.labels?.map(({ at: point, text }, i) => {
                const p = at(point);
                return (
                    <text
                        key={i}
                        x={p.x}
                        y={p.y - (SPOT_RADIUS + 2) * z}
                        fontSize={SPOT_LABEL_PX}
                        fontFamily="DM Sans, sans-serif"
                        textAnchor="middle"
                        fill={shape}
                        data-testid="fieldShapeSpotLabel"
                    >
                        {text}
                    </text>
                );
            })}
            {drawing.knob &&
                (() => {
                    const a = at(drawing.knob.stem);
                    const b = at(drawing.knob.at);
                    return (
                        <g data-testid="fieldShapeKnob" style={controls}>
                            <line
                                x1={a.x}
                                y1={a.y}
                                x2={b.x}
                                y2={b.y}
                                stroke={shape}
                                strokeWidth={ROTATE_LINE_WIDTH}
                                strokeDasharray="3 3"
                            />
                            <circle
                                cx={b.x}
                                cy={b.y}
                                r={KNOB_RADIUS}
                                fill="white"
                                stroke={shape}
                                strokeWidth={SHAPE_HANDLE_WIDTH}
                            />
                        </g>
                    );
                })()}
            {drawing.handles.map((point, i) => {
                const p = at(point);
                return (
                    <rect
                        key={i}
                        x={p.x - half}
                        y={p.y - half}
                        width={SHAPE_HANDLE_SIZE}
                        height={SHAPE_HANDLE_SIZE}
                        fill="white"
                        stroke={shape}
                        strokeWidth={SHAPE_HANDLE_WIDTH}
                        style={controls}
                        data-testid="fieldShapeHandle"
                    />
                );
            })}
            {drawing.centerDot &&
                (() => {
                    const p = at(drawing.centerDot);
                    return (
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={CENTER_DOT_RADIUS}
                            fill="white"
                            stroke={shape}
                            strokeWidth={CENTER_DOT_RING}
                            style={controls}
                            data-testid="fieldShapeCenterDot"
                        />
                    );
                })()}
            {drawing.pivotMark &&
                (() => {
                    const p = at(drawing.pivotMark);
                    const r = PIVOT_MARK_ARM;
                    const cross = `M ${p.x - r} ${p.y} H ${p.x + r} M ${p.x} ${p.y - r} V ${p.y + r}`;
                    return (
                        <g data-testid="fieldShapePivotMark" style={controls}>
                            {/* A dark edge under the yellow, so it reads on grass and on white */}
                            <path d={cross} stroke="black" strokeWidth={3.5} />
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={PIVOT_MARK_RING}
                                fill="none"
                                stroke="black"
                                strokeWidth={3.5}
                            />
                            <path
                                d={cross}
                                stroke={PIVOT_COLOR}
                                strokeWidth={1.5}
                            />
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={PIVOT_MARK_RING}
                                fill="none"
                                stroke={PIVOT_COLOR}
                                strokeWidth={1.5}
                            />
                        </g>
                    );
                })()}
            {drawing.pivot &&
                (() => {
                    const a = at(drawing.pivot.at);
                    const b = at(drawing.pivot.to);
                    return (
                        <g data-testid="fieldShapePivot">
                            <line
                                x1={a.x}
                                y1={a.y}
                                x2={b.x}
                                y2={b.y}
                                stroke={PIVOT_COLOR}
                                strokeWidth={ROTATE_LINE_WIDTH}
                                strokeDasharray="4 3"
                            />
                            <circle
                                cx={a.x}
                                cy={a.y}
                                r={PIVOT_RADIUS}
                                fill={PIVOT_COLOR}
                                stroke="black"
                                strokeWidth={1}
                            />
                        </g>
                    );
                })()}
            {drawing.tip &&
                (() => {
                    const p = at(drawing.tip.at);
                    return (
                        <text
                            x={p.x + TIP_OFFSET_PX}
                            y={p.y + TIP_OFFSET_PX}
                            fontSize={TIP_PX}
                            fontFamily="DM Sans, sans-serif"
                            fill="white"
                            stroke="black"
                            strokeWidth={3}
                            paintOrder="stroke"
                            dominantBaseline="hanging"
                            data-testid="fieldShapeTip"
                        >
                            {drawing.tip.text}
                        </text>
                    );
                })()}
        </g>
    );
}
