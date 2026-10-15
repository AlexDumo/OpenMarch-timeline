import { useCallback, useSyncExternalStore } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import type { AreaShape } from "@/field/editor/areaGestures";
import type { FieldRect } from "@/field/editor/selectionArea";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import { SELECTION_COLOR } from "./selectionRing";
import { boxPadding, selectedBounds } from "./selectionBox";

/** Fabric's selection border width, in CSS px. */
const BOX_WIDTH = 2;
/** Fabric's marquee border width, in CSS px. */
const MARQUEE_WIDTH = 2;
/** Fabric's lasso stroke: 2 CSS px, dashed 5 on, 5 off. */
const LASSO_WIDTH = 2;
const LASSO_DASH = "5 5";

/**
 * The SVG overlay over the field (ADR 0005 D-2): what the editor draws on top
 * of the WebGL field in screen space. The selection box around a selection of
 * two or more marchers (#193), and the marquee and lasso while one is drawn
 * (#195); handles (#198) and line previews (#203) come later.
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
        JSON.stringify(selectedBounds(marchers)),
    );
    const subscribeEditor = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    const area = useSyncExternalStore(subscribeEditor, () =>
        editor.areaShape(),
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
        </svg>
    );
}

/** The box around a multi-selection, clear of the selection rings. */
function SelectionBox({ box }: { box: FieldRect | null }) {
    const view = useFieldViewStore();
    if (!box) return null;
    const pad = boxPadding(view.zoom) * view.zoom;
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
