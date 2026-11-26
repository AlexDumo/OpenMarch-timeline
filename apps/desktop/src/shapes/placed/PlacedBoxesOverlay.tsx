import { useEffect, useMemo } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import tolgee from "@/global/singletons/Tolgee";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { frameCorners } from "../frame/frame";
import { shapeOutline } from "../frame/gestures";
import { useShapeToolStore } from "../tool/shapeToolStore";
import type { XY } from "../types";
import { useBoxSelectionStore } from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import { placedNumbers } from "./placedBoxText";
import {
    followPlacedBoxChanges,
    invalidatePlacedBoxes,
    placedBoxesAt,
    usePlacedBoxStore,
    usePlacedBoxBeat,
} from "./placedBoxStore";
import { closedOf } from "../distribute/modes";

/** One placed shape as the field outlines it, in field units */
export interface PlacedBoxDrawing {
    readonly id: number;
    /** The rectangle around its outline, half a step out so it doesn't cut the dots */
    readonly rect: {
        readonly left: number;
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
    };
    /**
     * Its outline as drawn, turned with it: a box's back-left corner first, half a step out. A
     * line's runs along its path through its marchers, as the selected one's does.
     */
    readonly corners: readonly { readonly x: number; readonly y: number }[];
    /** Whether the outline is open, drawn without joining its last point to its first (a line) */
    readonly open: boolean;
    /** Its other rows (spec #1190), each drawn as its own line is */
    readonly rows: readonly (readonly XY[])[];
    readonly label: string;
}

/** The label's size, and how far it stands above the box's back edge (over the back rank's own labels), in CSS px */
const LABEL_PX = 11;
const LABEL_GAP_PX = 30;

/**
 * "Box 5 × 4 · 2 steps" (or "· 2 × 1½ steps" when the intervals differ), "Circle · 2 steps": the
 * kind and the numbers it declares, as the field shows them
 */
export function boxLabel(box: PlacedBox, stepPx: number): string {
    const { counts, intervals, intervalCount } = placedNumbers(box, stepPx);
    const name = counts
        ? tolgee.t("shapes.placed.name", "{shape} {size}", {
              shape: box.kind.shape.label,
              size: counts,
          })
        : box.kind.shape.label;
    return intervals === null
        ? name
        : tolgee.t(
              "shapes.placed.label",
              "{name} · {count, plural, one {{interval} step} other {{interval} steps}}",
              { name, interval: intervals, count: intervalCount },
          );
}

/**
 * How the field outlines `box` when it isn't the one being edited. A line, curve or arc (a kind
 * with an open outline, closed or not) is drawn as the selected one is (`LiveBoxMode`): along its
 * path through its marchers, with its other rows, never as the box around its chord. Other kinds
 * are outlined half a step out (`pad`).
 */
export function placedOutline(
    box: PlacedBox,
    pad: number,
    stepPx: number,
): Pick<PlacedBoxDrawing, "corners" | "open" | "rows"> {
    const { kind, params, spots } = box;
    if (kind.outlineOpen === undefined)
        return { corners: outlineOut(box, pad), open: false, rows: [] };
    return {
        corners: shapeOutline(kind, params, spots),
        open: kind.outlineOpen(params, spots),
        rows: kind.rowOutlines?.(params, spots, stepPx) ?? [],
    };
}

/**
 * The shape's outline `pad` further out. A shape with corners (or none of its own) grows its
 * frame, so every edge moves out the same; a round one grows from its center.
 */
function outlineOut(box: PlacedBox, pad: number): XY[] {
    const { kind, params, spots } = box;
    const frame = kind.frameOf(params, spots);
    const round =
        kind.outline !== undefined &&
        closedOf(kind, params, spots)?.region(params, spots).corners.length ===
            0;
    if (!round)
        return frameCorners({
            ...frame,
            halfWidth: frame.halfWidth + pad,
            halfDepth: frame.halfDepth + pad,
        });
    const c = frame.center;
    return shapeOutline(kind, params, spots).map((p) => {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        const k = d > 0 ? (d + pad) / d : 1;
        return { x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k };
    });
}

/** The field-aligned rectangle around the shape's outline and rows, however it's turned */
function boundsOf(box: PlacedBox, rows: readonly (readonly XY[])[]) {
    const outline = [
        ...shapeOutline(box.kind, box.params, box.spots),
        ...rows.flat(),
    ];
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
}

let drawn: readonly PlacedBoxDrawing[] = [];

/** The placed boxes outlined on the field now, for the field test API */
export const drawnPlacedBoxes = (): readonly PlacedBoxDrawing[] => drawn;

/**
 * Placed shapes on the field (docs/timeline/research/shapes/07-placed-boxes.md), by the View tab's
 * **Shapes** setting: while any member is selected (the default), always, or never. A thin
 * outline through each shape's edge marchers, half a step out, and its label above it, in the
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
    const beat = usePlacedBoxBeat();
    const ends = usePlacedBoxStore((s) => s.ends);
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const editing = useBoxSelectionStore((s) => s.selected?.recipe.id ?? null);
    const selected = useSelectedMarchers()?.selectedMarchers;
    const view = useFieldViewStore();

    // The recipes change with the show: every resolver change re-reads them, and so does every
    // undoable edit, undo and redo, for those that change only a recipe
    useEffect(() => {
        invalidatePlacedBoxes();
    }, [version]);
    useEffect(() => followPlacedBoxChanges(), []);

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
                const outline = placedOutline(box, pad, stepPx);
                const f = boundsOf(box, outline.rows);
                return {
                    id: box.recipe.id,
                    rect: {
                        left: f.left - pad,
                        top: f.top - pad,
                        right: f.right + pad,
                        bottom: f.bottom + pad,
                    },
                    ...outline,
                    label: boxLabel(box, stepPx),
                };
            });
        // placedBoxesAt reads the resolver and the move end beats, which these stand for
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        mode,
        isPlaying,
        toolOpen,
        selected,
        recipes,
        beat,
        version,
        ends,
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
            {drawings.map(({ id, corners, open, rows, label }) => {
                const toPoints = (line: readonly XY[]) =>
                    line.map((c) => fieldToElement(view, c.x, c.y));
                const points = toPoints(corners);
                const rowPoints = rows.map(toPoints);
                const attr = (line: readonly XY[]) =>
                    line.map((p) => `${p.x},${p.y}`).join(" ");
                // The label sits over the point highest on screen
                const a = [...points, ...rowPoints.flat()].reduce((top, p) =>
                    p.y < top.y ? p : top,
                );
                return (
                    <g key={id} data-testid="placedBox">
                        {open ? (
                            // A line is drawn along its path, as the selected one is
                            <polyline
                                points={attr(points)}
                                fill="none"
                                stroke={color}
                                strokeWidth={1}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ) : (
                            <polygon
                                points={attr(points)}
                                fill="none"
                                stroke={color}
                                strokeWidth={1}
                            />
                        )}
                        {rowPoints.map((row, i) => (
                            <polyline
                                key={i}
                                points={attr(row)}
                                fill="none"
                                stroke={color}
                                strokeWidth={1}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ))}
                        <text
                            x={a.x}
                            y={a.y - LABEL_GAP_PX}
                            fontSize={LABEL_PX}
                            className="font-sans"
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
