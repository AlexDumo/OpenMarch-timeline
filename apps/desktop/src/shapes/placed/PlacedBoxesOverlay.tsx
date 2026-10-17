import { useEffect, useMemo } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import tolgee from "@/global/singletons/Tolgee";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { boxBounds, boxFrame, filesOf, ranksOf } from "../box/boxGeometry";
import { frameCorners } from "../frame/frame";
import { formatSteps } from "../editor/format";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { useBoxSelectionStore } from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import {
    invalidatePlacedBoxes,
    placedBoxesAt,
    usePlacedBoxStore,
} from "./placedBoxStore";

/** One placed box as the field outlines it, in field units */
export interface PlacedBoxDrawing {
    readonly id: number;
    /** The rectangle through its edge marchers, half a step out so it doesn't cut the dots */
    readonly rect: {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
    };
    /** Its outline as drawn, half a step out, turned with it: back-left first */
    readonly corners: readonly { readonly x: number; readonly y: number }[];
    readonly label: string;
}

/** The label's size, and how far it stands above the box's back edge (over the back rank's own labels), in CSS px */
const LABEL_PX = 11;
const LABEL_GAP_PX = 30;

/** "Box 5 × 4 · 2 steps", or "· 2 × 1½ steps" when the intervals differ */
export function boxLabel(box: PlacedBox, stepPx: number): string {
    const across = formatSteps(box.params.across / stepPx);
    const deep = formatSteps(box.params.deep / stepPx);
    return tolgee.t(
        "shapes.box.label",
        "Box {files} × {ranks} · {interval} steps",
        {
            files: filesOf(box.params),
            ranks: ranksOf(box.params, box.spots),
            interval: across === deep ? across : `${across} × ${deep}`,
        },
    );
}

let drawn: readonly PlacedBoxDrawing[] = [];

/** The placed boxes outlined on the field now, for the field test API */
export const drawnPlacedBoxes = (): readonly PlacedBoxDrawing[] => drawn;

/**
 * Placed boxes on the field (docs/timeline/research/shapes/07-placed-boxes.md), by the View tab's
 * **Shapes** setting: while any member is selected (the default), always, or never. A thin
 * outline through each box's edge marchers, half a step out, and its label above it, in the
 * theme's shape color. Hidden during playback and while the Shape tool is open, which draws its
 * own; the selected box draws its own outline and handles (`LiveBoxMode`). Few boxes, so SVG
 * over the field, like the editor's overlay. It takes no pointer events, and exports don't draw
 * it.
 */
export function PlacedBoxesOverlay({
    isPlaying,
    theme,
    stepPx,
}: {
    isPlaying: boolean;
    theme: FieldTheme;
    stepPx: number;
}) {
    const mode = useUiSettingsStore((s) => s.uiSettings.shapes ?? "selected");
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = useTimelineSelectionStore(displayedBeat);
    const timelines = useTimelineSelectionStore((s) => s.storedTimelines);
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const editing = useBoxSelectionStore((s) => s.selected?.recipe.id ?? null);
    const selected = useSelectedMarchers()?.selectedMarchers;
    const view = useFieldViewStore();

    // The recipes change with the show: every resolver change re-reads them (undo, redo, edits)
    useEffect(() => {
        invalidatePlacedBoxes();
    }, [version]);

    const drawings = useMemo(() => {
        if (mode === "off" || isPlaying || toolOpen) return [];
        const ids = new Set((selected ?? []).map((m) => m.id));
        const pad = stepPx / 2;
        return placedBoxesAt(beat, recipes)
            .filter(
                (box) =>
                    box.recipe.id !== editing &&
                    (mode === "always" ||
                        box.recipe.members.some((m) => ids.has(m.marcherId))),
            )
            .map((box): PlacedBoxDrawing => {
                const frame = boxFrame(box.params, box.spots);
                const corners = frameCorners({
                    ...frame,
                    halfWidth: frame.halfWidth + pad,
                    halfDepth: frame.halfDepth + pad,
                });
                const f = boxBounds(box.params, box.spots);
                return {
                    id: box.recipe.id,
                    rect: {
                        left: f.left - pad,
                        top: f.top - pad,
                        right: f.right + pad,
                        bottom: f.bottom + pad,
                    },
                    corners,
                    label: boxLabel(box, stepPx),
                };
            });
        // placedBoxesAt reads the resolver and the timelines, which these stand for
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        mode,
        isPlaying,
        toolOpen,
        selected,
        recipes,
        beat,
        version,
        timelines,
        editing,
        stepPx,
    ]);
    useEffect(() => {
        drawn = drawings;
        return () => {
            drawn = [];
        };
    }, [drawings]);

    if (drawings.length === 0) return null;
    const color = rgbaToString(theme.shape);
    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="placedBoxes"
        >
            {drawings.map(({ id, corners, label }) => {
                const points = corners.map((c) =>
                    fieldToElement(view, c.x, c.y),
                );
                // The label sits over the corner highest on screen
                const a = points.reduce((top, p) => (p.y < top.y ? p : top));
                return (
                    <g key={id} data-testid="placedBox">
                        <polygon
                            points={points
                                .map((p) => `${p.x},${p.y}`)
                                .join(" ")}
                            fill="none"
                            stroke={color}
                            strokeWidth={1}
                        />
                        <text
                            x={a.x}
                            y={a.y - LABEL_GAP_PX}
                            fontSize={LABEL_PX}
                            fontFamily="DM Sans, sans-serif"
                            fill={color}
                            dominantBaseline="hanging"
                        >
                            {label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}
