import { useSyncExternalStore } from "react";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import { selectionBoxPadding, SELECTION_COLOR } from "./selectionRing";

/** Fabric's selection border width, in CSS px. */
const BOX_WIDTH = 2;

/**
 * The SVG overlay over the field (ADR 0005 D-2): what the editor draws on top
 * of the WebGL field in screen space. #193 draws the selection box around a
 * selection of two or more marchers; handles (#198), the marquee and lasso
 * (#195) and line previews (#203) come later.
 *
 * It reads the camera from the view store, as the WebGL camera does, and
 * re-renders only when what it draws changes: with no box, playback doesn't
 * render it. It takes no pointer events: the field under it does.
 */
export default function FieldOverlay({
    marchers,
}: {
    marchers: FieldMarchers;
}) {
    // The box's bounds as a string, so an unchanged box is an unchanged snapshot
    const box = useSyncExternalStore(marchers.subscribe, () =>
        JSON.stringify(selectionBox(marchers)),
    );

    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="fieldOverlay"
        >
            <SelectionBox box={JSON.parse(box) as Bounds | null} />
        </svg>
    );
}

type Bounds = { left: number; top: number; right: number; bottom: number };

/** The box around a multi-selection, clear of the selection rings. */
function SelectionBox({ box }: { box: Bounds | null }) {
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

/**
 * The bounds of the selected marchers, in field units, or null when fewer
 * than two are selected (a single marcher gets its ring and no box).
 */
function selectionBox(marchers: FieldMarchers): Bounds | null {
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
