import { useCallback, useSyncExternalStore } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import type { AreaShape } from "@/field/editor/areaGestures";
import type { FieldRect } from "@/field/editor/selectionArea";
import type { LineToolShape } from "@/field/editor/lineTool";
import { DOT_RADIUS } from "@/field/editor/hitTest";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import {
    dotSizes,
    selectionBoxPadding,
    SELECTION_COLOR,
} from "./selectionRing";

/** Fabric's selection border width, in CSS px. */
const BOX_WIDTH = 2;
/** Fabric's marquee border width, in CSS px. */
const MARQUEE_WIDTH = 2;
/** Fabric's lasso stroke: 2 CSS px, dashed 5 on, 5 off. */
const LASSO_WIDTH = 2;
const LASSO_DASH = "5 5";
/**
 * The line tool's look, as Fabric's (`LineListeners`), in field units, so
 * they scale with the field: a 3-wide line, 2-wide pathways dashed 5 on, 3
 * off, and dots of radius 3 at each pathway's middle and end. Its marchers'
 * outlines are squares just outside the dot, 1.5 wide, dashed 3 on, 5 off.
 */
const LINE_WIDTH = 3;
const PATH_WIDTH = 2;
const PATH_DASH = [5, 3];
const PATH_DOT_RADIUS = 3;
const OUTLINE_WIDTH = 1.5;
const OUTLINE_DASH = [3, 5];
/** How far a line marcher's outline's center line sits outside its dot. */
const OUTLINE_GAP = 0.25;

/**
 * The SVG overlay over the field (ADR 0005 D-2): what the editor draws on top
 * of the WebGL field in screen space. The selection box around a selection of
 * two or more marchers (#193), and the marquee and lasso while one is drawn
 * (#195), and the line tool's line, previews and outlined marchers (#203);
 * handles (#198) come later.
 *
 * It reads the camera from the view store, as the WebGL camera does, and
 * re-renders only when what it draws changes: with no box, playback doesn't
 * render it. During a marquee or lasso it re-renders on every pointer move;
 * nothing else in the app does. It takes no pointer events: the field under
 * it does.
 */
export default function FieldOverlay({
    marchers,
    editor,
    theme,
}: {
    marchers: FieldMarchers;
    editor: FieldEditor;
    theme: FieldTheme;
}) {
    // The box's bounds as a string, so an unchanged box is an unchanged snapshot
    const box = useSyncExternalStore(marchers.subscribe, () =>
        JSON.stringify(selectionBox(marchers)),
    );
    const subscribeEditor = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    const area = useSyncExternalStore(subscribeEditor, () =>
        editor.areaShape(),
    );
    const lineTool = useSyncExternalStore(subscribeEditor, () =>
        editor.lineToolShape(),
    );

    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="fieldOverlay"
        >
            <SelectionBox box={JSON.parse(box) as FieldRect | null} />
            {area?.kind === "marquee" && (
                <Marquee rect={area.rect} theme={theme} />
            )}
            {area?.kind === "lasso" && <Lasso lasso={area} theme={theme} />}
            {lineTool && (
                <LineToolPreview
                    tool={lineTool}
                    marchers={marchers}
                    theme={theme}
                />
            )}
        </svg>
    );
}

/** The box around a multi-selection, clear of the selection rings. */
function SelectionBox({ box }: { box: FieldRect | null }) {
    const view = useFieldViewStore();
    if (!box) return null;
    const pad = selectionBoxPadding(view.zoom) * view.zoom;
    const topLeft = fieldToElement(view, box.left, box.top);
    const bottomRight = fieldToElement(view, box.right, box.bottom);
    return (
        <rect
            x={topLeft.x - pad}
            y={topLeft.y - pad}
            width={bottomRight.x - topLeft.x + pad * 2}
            height={bottomRight.y - topLeft.y + pad * 2}
            fill="none"
            stroke={SELECTION_COLOR}
            strokeWidth={BOX_WIDTH}
        />
    );
}

/** The marquee, in Fabric's colors: the theme's shape color, filled at 20%. */
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
 * The lasso's line, dashed as Fabric's: the theme's stroke color, and its
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
 * The bounds of the selected marchers, in field units, or null when fewer
 * than two are selected (a single marcher gets its ring and no box).
 */
function selectionBox(marchers: FieldMarchers): FieldRect | null {
    const { selected, positions } = marchers;
    let count = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < selected.length; i++) {
        if (!selected[i]) continue;
        count++;
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    }
    return count < 2 ? null : { left, top, right, bottom };
}

/**
 * The line tool: its marchers outlined (dashed, the theme's shape color),
 * the line in the shape color, and dashed pathways in the temporary path
 * color from each marcher to where the line puts it.
 */
function LineToolPreview({
    tool,
    marchers,
    theme,
}: {
    tool: LineToolShape;
    marchers: FieldMarchers;
    theme: FieldTheme;
}) {
    const view = useFieldViewStore();
    // Where the outlined marchers are drawn, as a string so the snapshot is stable
    const outlined = useSyncExternalStore(marchers.subscribe, () =>
        JSON.stringify(drawnAt(marchers, tool.marchers)),
    );
    const shape = rgbaToString(theme.shape);
    const path = rgbaToString(theme.tempPath);
    const z = view.zoom;
    const at = (point: { x: number; y: number }) =>
        fieldToElement(view, point.x, point.y);
    const half = (DOT_RADIUS * dotSizes(z).scale + OUTLINE_GAP) * z;
    const { line } = tool;
    return (
        <g data-testid="fieldLineTool">
            {(JSON.parse(outlined) as { x: number; y: number }[]).map(
                (point, i) => {
                    const center = at(point);
                    return (
                        <rect
                            key={i}
                            x={center.x - half}
                            y={center.y - half}
                            width={half * 2}
                            height={half * 2}
                            fill="none"
                            stroke={shape}
                            strokeWidth={OUTLINE_WIDTH * z}
                            strokeDasharray={OUTLINE_DASH.map(
                                (d) => d * z,
                            ).join(" ")}
                        />
                    );
                },
            )}
            {line && (
                <line
                    x1={at(line.start).x}
                    y1={at(line.start).y}
                    x2={at(line.end).x}
                    y2={at(line.end).y}
                    stroke={shape}
                    strokeWidth={LINE_WIDTH * z}
                />
            )}
            {tool.previews.map(({ id, from, to }) => {
                const a = at(from);
                const b = at(to);
                return (
                    <g key={id}>
                        <line
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke={path}
                            strokeWidth={PATH_WIDTH * z}
                            strokeDasharray={PATH_DASH.map((d) => d * z).join(
                                " ",
                            )}
                        />
                        <circle
                            cx={(a.x + b.x) / 2}
                            cy={(a.y + b.y) / 2}
                            r={PATH_DOT_RADIUS * z}
                            fill="white"
                            stroke={path}
                            strokeWidth={PATH_WIDTH * z}
                        />
                        <circle
                            cx={b.x}
                            cy={b.y}
                            r={PATH_DOT_RADIUS * z}
                            fill={path}
                        />
                    </g>
                );
            })}
        </g>
    );
}

/** Where the marchers in `ids` are drawn, skipping any not drawn or hidden. */
function drawnAt(marchers: FieldMarchers, ids: readonly number[]) {
    const wanted = new Set(ids);
    const points: { x: number; y: number }[] = [];
    const { ids: drawn, positions, hidden } = marchers;
    for (let i = 0; i < drawn.length; i++) {
        if (!wanted.has(drawn[i]) || hidden?.[i]) continue;
        points.push({ x: positions[i * 2], y: positions[i * 2 + 1] });
    }
    return points;
}
