import { useCallback, useSyncExternalStore } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import type { AreaShape } from "@/field/editor/areaGestures";
import { HANDLE_SIZE, type HandleId } from "@/field/editor/groupTransform";
import type { FieldRect } from "@/field/editor/selectionArea";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import {
    drawnSelectionBox,
    selectionHandles,
    type DrawnSelectionBox,
} from "./selectionFrame";
import { SELECTION_COLOR } from "./selectionRing";

/** Fabric's selection border width, in CSS px. */
const BOX_WIDTH = 2;
/** Fabric's marquee border width, in CSS px. */
const MARQUEE_WIDTH = 2;
/** Fabric's lasso stroke: 2 CSS px, dashed 5 on, 5 off. */
const LASSO_WIDTH = 2;
const LASSO_DASH = "5 5";

/** The rotate handle's connecting line, in CSS px (Fabric's border width). */
const ROTATE_LINE_WIDTH = 1;

/**
 * The SVG overlay over the field (ADR 0005 D-2): what the editor draws on top
 * of the WebGL field in screen space. The selection box around a selection of
 * two or more marchers (#193) with its scale and rotate handles (#198), and
 * the marquee and lasso while one is drawn (#195); line previews (#203) come
 * later.
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
    editor,
    theme,
}: {
    marchers: FieldMarchers;
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
                    subscribeEditor(listener),
                ];
                return () => off.forEach((unsubscribe) => unsubscribe());
            },
            [marchers, subscribeEditor],
        ),
        () => JSON.stringify(drawnSelectionBox(marchers, editor)),
    );
    const area = useSyncExternalStore(subscribeEditor, () =>
        editor.areaShape(),
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
