/**
 * The shape tool's contract (docs/timeline/research/shapes/README.md, 03-shape-model.md §2).
 *
 * A shape kind is one module that declares its parameters, handles and slot generator. The
 * panel, the canvas preview, assignment and validation are generic and never switch on the kind,
 * so a new kind is one file plus one registry line.
 *
 * Shapes are in place: a kind only says where the selected marchers stand at one moment. Motion
 * and timing stay in the timeline, which the tool writes through like a canvas drag.
 *
 * Units: points and lengths are field units (canvas pixels). The panel shows lengths in steps,
 * converting with {@link ShapeContext.stepPx}.
 */

import type { Icon } from "@phosphor-icons/react";

export interface XY {
    readonly x: number;
    readonly y: number;
}

/** What every kind's functions may read about the field. */
export interface ShapeContext {
    /** Field units per 8-to-5 step */
    readonly stepPx: number;
    /**
     * Snaps a point to the grid the canvas uses. Identity when snapping is off (Alt held, the
     * timeline's no-snap modifier).
     */
    readonly snapPoint: (p: XY) => XY;
}

/** One run of a mixed interval: `count` gaps of `steps` steps each, written `steps x count`. */
export interface IntervalRun {
    readonly steps: number;
    readonly count: number;
}

/**
 * How marchers are spaced along a path. Shared by every path kind so spacing reads and behaves
 * the same everywhere.
 *
 * - `fit`: the path is fixed and the marchers spread evenly over it.
 * - `interval`: the gaps are fixed (one interval, or mixed runs like `5x3,2x4`) and the length the
 *   marchers cover follows from them. `anchor` says which part of the path the run is laid from.
 */
export type Spacing =
    | { readonly mode: "fit" }
    | {
          readonly mode: "interval";
          readonly runs: readonly IntervalRun[];
          readonly anchor: "start" | "center" | "end";
      };

/** A spot a marcher can be put on. The tags let assignment and later tools reason about it. */
export interface Slot extends XY {
    /** Distance along the path from its start, in field units (path kinds) */
    readonly s?: number;
    /** Lattice cell (fill kinds) */
    readonly row?: number;
    readonly col?: number;
}

export type HandleRole =
    /** A defining point, such as a line's end */
    | "point"
    /** Moves the whole shape */
    | "move"
    /** Changes curvature or radius along one axis */
    | "bulge"
    /** Turns the shape about its origin */
    | "rotate";

export interface HandleDef {
    /** Stable for the kind, so a drag keeps its handle while the shape changes */
    readonly key: string;
    readonly role: HandleRole;
    readonly at: XY;
}

export interface DragModifiers {
    /** Constrain: angles to 45°, for example */
    readonly shift: boolean;
}

export type IssueLevel = "error" | "warning" | "info";

export interface ShapeIssue {
    readonly level: IssueLevel;
    readonly message: string;
    /** Slot indexes the issue is about, for highlighting */
    readonly slots?: readonly number[];
}

/**
 * A parameter the panel renders without knowing the kind. `key` names a top-level field of the
 * kind's params. Point parameters aren't listed: they are edited with handles.
 */
export type ParamField =
    | {
          readonly type: "length";
          readonly key: string;
          readonly label: string;
          /** Smallest value, in steps */
          readonly min?: number;
      }
    | {
          readonly type: "count";
          readonly key: string;
          readonly label: string;
          readonly min: number;
      }
    | {
          readonly type: "angle";
          readonly key: string;
          readonly label: string;
      }
    | {
          readonly type: "enum";
          readonly key: string;
          readonly label: string;
          readonly options: readonly {
              readonly value: string;
              readonly label: string;
          }[];
      }
    | { readonly type: "bool"; readonly key: string; readonly label: string }
    /** The shared spacing control; the field must hold a {@link Spacing} */
    | {
          readonly type: "spacing";
          readonly key: string;
          readonly label: string;
      };

export interface ParamGroup<P> {
    readonly label: string;
    readonly fields: readonly ParamField[];
    /** Collapsed under "More" until opened */
    readonly advanced?: boolean;
    /** Hidden unless this holds */
    readonly visibleWhen?: (params: P) => boolean;
}

/** A read-only line in the panel, such as "Length 30 steps". */
export interface Readout {
    readonly label: string;
    readonly value: string;
}

export interface FitInput {
    /** The selected marchers where the edit window arrives, in selection order */
    readonly current: readonly XY[];
}

export interface ShapeKind<P> {
    /** Stored with recipes; never reuse an id */
    readonly id: string;
    /** Bump when `generate` gives different slots for the same params */
    readonly version: number;
    readonly label: string;
    readonly icon: Icon;
    readonly family: "path" | "fill";
    readonly groups: readonly ParamGroup<P>[];

    /** Params that make a first preview land on or near the marchers' current spots. Pure. */
    fit(input: FitInput, ctx: ShapeContext): P;
    handles(params: P, n: number, ctx: ShapeContext): HandleDef[];
    /** Params after dragging handle `key` to `to` (already snapped by the caller). Pure. */
    drag(
        params: P,
        key: string,
        to: XY,
        modifiers: DragModifiers,
        n: number,
        ctx: ShapeContext,
    ): P;
    /** Guide lines to draw under the slots */
    outline(params: P, n: number, ctx: ShapeContext): readonly XY[][];
    /** The spots for `n` marchers, in the kind's natural order. Deterministic. */
    generate(params: P, n: number, ctx: ShapeContext): Slot[];
    /**
     * A sort key for a point, comparable with the same key of the slots, used by "Keep order"
     * assignment: path kinds return the distance along the path, fills their rank then file.
     * `n` is the marcher count, for kinds whose lattice depends on it (a block's ranks).
     */
    orderKey(
        params: P,
        point: XY,
        ctx: ShapeContext,
        n: number,
    ): readonly number[];
    readouts?(params: P, n: number, ctx: ShapeContext): Readout[];
    /** Kind-specific checks; the generic ones run for every kind (`validate.ts`) */
    validate?(
        params: P,
        slots: readonly Slot[],
        ctx: ShapeContext,
    ): ShapeIssue[];
}

// The registry stores kinds of different params side by side; the tool keeps each kind's params
// with the kind that made them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyShapeKind = ShapeKind<any>;
