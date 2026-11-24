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
import { liveLinks, type ShapeLink } from "./shapeLinks";
import { useLinkDragStore } from "./linkDragStore";

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
     * Its outline as drawn, turned with it: a closed shape's half a step out, a box's back-left
     * corner first; an open line's path, from its first point to its last
     */
    readonly corners: readonly { readonly x: number; readonly y: number }[];
    /** The outline is an open line's path, drawn without joining its ends */
    readonly open: boolean;
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

/** The field-aligned rectangle around the shape's outline, however it's turned */
function boundsOf(box: PlacedBox) {
    const outline = shapeOutline(box.kind, box.params, box.spots);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
}

/** How the field outlines placed shape `box`, `stepPx` field units a step */
export function placedBoxDrawing(
    box: PlacedBox,
    stepPx: number,
): PlacedBoxDrawing {
    const pad = stepPx / 2;
    // An open line is drawn along its path, as the selected one is (`LiveBoxMode`): its frame
    // runs straight from its first point to its last, through no bend or corner of it
    const open = box.kind.outlineOpen?.(box.params, box.spots) ?? false;
    const corners = open
        ? shapeOutline(box.kind, box.params, box.spots)
        : outlineOut(box, pad);
    const f = boundsOf(box);
    return {
        id: box.recipe.id,
        rect: {
            left: f.left - pad,
            top: f.top - pad,
            right: f.right + pad,
            bottom: f.bottom + pad,
        },
        corners,
        open,
        label: boxLabel(box, stepPx),
    };
}

let drawn: readonly PlacedBoxDrawing[] = [];
let drawnJoints: readonly XY[] = [];

/** The placed boxes outlined on the field now, for the field test API */
export const drawnPlacedBoxes = (): readonly PlacedBoxDrawing[] => drawn;

/** The joints of linked shapes marked on the field now (#1235), for the field test API */
export const drawnShapeJoints = (): readonly XY[] => drawnJoints;

/**
 * A joint's mark (#1235): a ring with a diamond in it, its radius in CSS px, wide enough to show
 * round a selected shape's end handle
 */
const JOINT_PX = 11;
/** The snap ring while a dragged end will attach, in CSS px */
const SNAP_PX = 11;

/**
 * The joints marked on the field (#1235): only those of a shape selected or being edited
 * (`picked`), so with nothing selected linked shapes look like any others (owner on #1249)
 */
export const jointsShown = (
    links: readonly ShapeLink[],
    picked: (box: PlacedBox) => boolean,
): XY[] =>
    links.filter((l) => picked(l.attacher) || picked(l.owner)).map((l) => l.at);

/** A link's mark at `at` (CSS px): a ring round the joint's marcher with a diamond in it */
function JointMark({ at, color }: { at: XY; color: string }) {
    const d = JOINT_PX * 0.45;
    return (
        <g data-testid="shapeJoint">
            <circle
                cx={at.x}
                cy={at.y}
                r={JOINT_PX}
                fill="none"
                stroke={color}
                strokeWidth={2}
            />
            <polygon
                points={`${at.x},${at.y - d} ${at.x + d},${at.y} ${at.x},${at.y + d} ${at.x - d},${at.y}`}
                fill={color}
            />
        </g>
    );
}

/**
 * Placed shapes on the field (docs/timeline/research/shapes/07-placed-boxes.md), by the View tab's
 * **Shapes** setting: while any member is selected (the default), always, or never. A thin
 * outline through each shape's edge marchers, half a step out (an open line's own path), and its
 * label above it, in the theme's shape color. Hidden during playback and while the Shape tool is open, which draws its
 * own; the selected box draws its own outline and handles (`LiveBoxMode`). Few boxes, so SVG
 * over the field, like the editor's overlay. It takes no pointer events, and exports don't draw
 * it. The joints of a selected linked shape are marked whenever the setting isn't off (#1235), and
 * a drag of a selected shape, or of a new one's end in the Shape tool, draws the ring of the end it
 * will attach to (and the shapes following a placed one).
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
    const linkDrag = useLinkDragStore();

    // The recipes change with the show: every resolver change re-reads them, and so does every
    // undoable edit, undo and redo, for those that change only a recipe
    useEffect(() => {
        invalidatePlacedBoxes();
    }, [version]);
    useEffect(() => followPlacedBoxChanges(), []);

    const { drawings, joints } = useMemo(() => {
        if (mode === "off" || isPlaying || toolOpen)
            return { drawings: [], joints: [] };
        const ids = new Set((selected ?? []).map((m) => m.id));
        const boxes = placedBoxesAt(beat, recipes);
        const picked = (box: PlacedBox) =>
            box.recipe.id === editing ||
            box.recipe.members.some((m) => ids.has(m.marcherId));
        return {
            drawings: boxes
                .filter(
                    (box) =>
                        box.recipe.id !== editing &&
                        (mode === "always" || picked(box)),
                )
                .map((box) => placedBoxDrawing(box, stepPx)),
            joints: jointsShown(liveLinks(boxes, beat), picked),
        };
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
        drawnJoints = joints;
        return () => {
            drawn = [];
            drawnJoints = [];
        };
    }, [drawings, joints]);

    const dragging = linkDrag.ring !== null || linkDrag.followers.length > 0;
    if (drawings.length === 0 && joints.length === 0 && !dragging) return null;
    const color = rgbaToString(theme.shape);
    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="placedBoxes"
        >
            {drawings.map(({ id, corners, open, label }) => {
                const points = corners.map((c) =>
                    fieldToElement(view, c.x, c.y),
                );
                // The label sits over the corner highest on screen
                const a = points.reduce((top, p) => (p.y < top.y ? p : top));
                const Outline = open ? "polyline" : "polygon";
                return (
                    <g key={id} data-testid="placedBox">
                        <Outline
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
                            className="font-sans"
                            fill={color}
                            dominantBaseline="hanging"
                        >
                            {label}
                        </text>
                    </g>
                );
            })}
            {joints.map((at) => (
                <JointMark
                    key={`${at.x},${at.y}`}
                    at={fieldToElement(view, at.x, at.y)}
                    color={color}
                />
            ))}
            {/* Shapes linked to the one dragged, where they'll be (#1235) */}
            {linkDrag.followers.map((f) => (
                <g key={`follow-${f.id}`} data-testid="linkFollower">
                    <polyline
                        points={f.outline
                            .map((c) => fieldToElement(view, c.x, c.y))
                            .map((p) => `${p.x},${p.y}`)
                            .join(" ")}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                    />
                    {f.spots.map((c, i) => {
                        const p = fieldToElement(view, c.x, c.y);
                        return (
                            <circle
                                key={i}
                                cx={p.x}
                                cy={p.y}
                                r={3}
                                fill={color}
                                fillOpacity={0.6}
                            />
                        );
                    })}
                </g>
            ))}
            {linkDrag.ring &&
                (() => {
                    const p = fieldToElement(
                        view,
                        linkDrag.ring.x,
                        linkDrag.ring.y,
                    );
                    return (
                        <circle
                            data-testid="linkSnapRing"
                            cx={p.x}
                            cy={p.y}
                            r={SNAP_PX}
                            fill={color}
                            fillOpacity={0.15}
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray="3 2"
                        />
                    );
                })()}
        </svg>
    );
}
