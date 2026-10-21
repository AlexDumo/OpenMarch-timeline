import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { ShapeContext, XY } from "../types";

/**
 * A shape's small picture (#378): its own spots, and its outline where the kind has one, made
 * from the kind's geometry each time the app runs. No kind draws an icon, so a new kind or a
 * saved shape looks like itself in the Shapes tab, the ring, the library and the command bar.
 * Everything here is pure.
 */
export interface ShapePreview {
    /** The spots, in picture units from the top left ({@link PREVIEW_VIEW} across) */
    readonly spots: readonly XY[];
    /** The kind's outline, closed, in the same units; null when the kind has none */
    readonly outline: readonly XY[] | null;
}

/** How many spots the picture shows: a 3 × 3 box, enough to read as the shape and stay small */
export const PREVIEW_SPOTS = 9;
/** The picture's size, in its own units */
export const PREVIEW_VIEW = 24;
/** Room left at the picture's edges, so the spots' dots aren't cut off */
const PAD = 3;
/** Half the square the shape is laid out in, in steps */
const HALF = 4;

/** One field unit per step, on a half-step grid: only the picture's proportions matter */
const ENV: ToolEnv = {
    stepPx: 1,
    snap: true,
    shift: false,
    gridSnap: ({ x, y }) => ({
        x: Math.round(x * 2) / 2,
        y: Math.round(y * 2) / 2,
    }),
    hitRadius: 0,
};
const CTX: ShapeContext = { stepPx: 1, snapPoint: ENV.gridSnap };

const PREVIEWS = new WeakMap<AnyToolKind, ShapePreview>();

/**
 * The picture of a shape of `kind`: {@link PREVIEW_SPOTS} spots filling a square, as picking the
 * kind with a square shape open would lay them out. A saved shape keeps its intervals, so a wide
 * box looks wide. The same kind gives the same picture.
 */
export function shapePreview(kind: AnyToolKind): ShapePreview {
    const known = PREVIEWS.get(kind);
    if (known) return known;
    const n = PREVIEW_SPOTS;
    // A saved shape's kind sets the saved intervals as it fills the frame
    const params = kind.fromFrame(
        {
            center: { x: 0, y: 0 },
            halfWidth: HALF,
            halfDepth: HALF,
            rotation: 0,
            flipX: false,
            flipY: false,
        },
        n,
        ENV,
    );
    const spots = kind.shape
        .generate(params, n, CTX)
        .map(({ x, y }): XY => ({ x, y }));
    const outline = kind.outline?.(params, n) ?? null;
    const preview = fitToView(spots, outline);
    PREVIEWS.set(kind, preview);
    return preview;
}

/** `spots` and `outline` scaled into the picture, centered, keeping their proportions */
function fitToView(
    spots: readonly XY[],
    outline: readonly XY[] | null,
): ShapePreview {
    const all = [...spots, ...(outline ?? [])];
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const depth = Math.max(...ys) - minY;
    const room = PREVIEW_VIEW - 2 * PAD;
    const k = Math.max(width, depth) > 0 ? room / Math.max(width, depth) : 0;
    const offsetX = (PREVIEW_VIEW - width * k) / 2;
    const offsetY = (PREVIEW_VIEW - depth * k) / 2;
    const place = ({ x, y }: XY): XY => ({
        x: offsetX + (x - minX) * k,
        y: offsetY + (y - minY) * k,
    });
    return {
        spots: spots.map(place),
        outline: outline && outline.map(place),
    };
}
