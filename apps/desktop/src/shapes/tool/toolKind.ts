import type { Pivot, ShapeFrame } from "../frame/frame";
import type { ScrubMove } from "../editor/scrub";
import type { ClosedShape } from "../distribute/region";
import type { LayoutFamily } from "../distribute/distribution";
import type { AnyShapeKind, XY } from "../types";

/**
 * What a gesture knows about the field and the keys held. Built fresh for each pointer event.
 */
export interface ToolEnv {
    /** Field units per 8-to-5 step */
    readonly stepPx: number;
    /** False while Alt is held: sizes and spots aren't rounded */
    readonly snap: boolean;
    /** Shift is held */
    readonly shift: boolean;
    /** The nearest spot on the half-step grid */
    readonly gridSnap: (p: XY) => XY;
    /** How far from a handle a press still takes it, in field units */
    readonly hitRadius: number;
    /** Cmd (Mac) or Ctrl is held: a drag from the center dot pulls the pivot out (#350) */
    readonly mod?: boolean;
    /**
     * What a change the kind works out grows from (a new count, a spacing): the shape's pivot
     * when the host sets it, the center when absent
     */
    readonly pivot?: Pivot;
    /** Where marchers stand, for a dragged pivot to snap to (#350); none when absent */
    readonly pivotSnaps?: () => readonly XY[];
    /** The box's ratio lock: changing one spacing changes the other in proportion */
    readonly ratioLocked?: boolean;
    /**
     * Where the pivot was, on the field, when a run of size presses began (the chip's − and +):
     * each press grows from there rather than from the last one's rounding, so the shape doesn't
     * creep (#387). From the shape's own pivot when absent.
     */
    readonly anchor?: XY;
    /**
     * The user's last-used Files layout (#387), which a new box starts in; Short back when
     * absent
     */
    readonly layout?: LayoutFamily;
}

/** A handle the canvas draws, and the cursor it shows on hover */
export interface ToolHandle {
    readonly key: string;
    readonly at: XY;
    readonly cursor: string;
}

/**
 * One of a kind's numbers (#344, "The kind contract"), declared once so the host can show and
 * change it without knowing the kind: the floating chip shows the primary ones now, and the
 * inspector, the command bar's steps and a later API read the same list. Everything is pure.
 * `n` is the spot count, which the host gives; a kind never reads the selection.
 */
export interface ToolParam<P> {
    /** Stable for the kind: the command bar and saved shapes name the parameter by it */
    readonly key: string;
    /** What it is, for tooltips and screen readers: "Side-to-side spacing, in steps" */
    readonly label: string;
    /**
     * Counts are whole numbers; steps and degrees are typed and shown as such; a choice is typed
     * by name (the host's mode step)
     */
    readonly unit: "count" | "steps" | "degrees" | "choice";
    /** Shown in the floating chip */
    readonly primary: boolean;
    /** Which way a drag changes it: right for more, up for more, or the first way moved */
    readonly drag: "x" | "y" | "both";
    /** A spacing between neighbors: scaling by interval changes it in half steps */
    readonly interval: boolean;
    /**
     * Can change smoothly over a move. Recorded only: nothing reads it until transforms over
     * time are built (#355).
     */
    readonly blends: boolean;
    /** The answer the command bar starts from, in `unit`; absent when it depends on the shape */
    readonly default?: number;
    /** Smallest and largest values, in `unit`; counts are also capped by the spot count */
    readonly range?: { readonly min?: number; readonly max?: number };
    /** A mark before the number in the chip ("↔"), so its direction reads without words */
    readonly glyph?: string;
    /** Hidden while this is false (a spacing with only one spot that way) */
    shown?(params: P, n: number): boolean;
    /** The number as shown: "6 × 2", "2" */
    display(params: P, n: number, stepPx: number): string;
    /**
     * The number in `unit`. Intervals declare it: a saved shape keeps its intervals by it (#353)
     * and sets them back through {@link set}.
     */
    value?(params: P, n: number, stepPx: number): number;
    /** A note after the number, such as "1 short"; null for none */
    note?(params: P, n: number): string | null;
    /** The params with `text` typed over the number; null when the text isn't understood */
    type(params: P, n: number, text: string, env: ToolEnv): P | null;
    /**
     * The params with the number set to `value`, in `unit`, as typing it would but without going
     * through its text, so a value the chip shows rounded (1.13 for 1⅛) comes back exact (#423).
     * Saved shapes and the command bar's starting numbers use it; without it they type the value
     * as shown.
     */
    set?(params: P, n: number, value: number, env: ToolEnv): P | null;
    /** The params with the number dragged by `move` from `base`, the params at the press */
    scrub(base: P, n: number, move: ScrubMove, env: ToolEnv): P;
    /**
     * The chip's − and + buttons, with what each does in words; `by` gives null where it can't
     * go that way. Absent for numbers without buttons.
     */
    readonly stepper?: {
        readonly less: string;
        readonly more: string;
        by(params: P, n: number, by: -1 | 1, env: ToolEnv): P | null;
    };
    /**
     * An interval's part in scaling (#349): the params with it `by` steps wider (closer when
     * negative), every gap of a gap list at once, kept on half steps; null where it can't go
     * (under half a step). The pivot is the host's: where the shape grows from doesn't matter.
     */
    widen?(params: P, n: number, by: number, env: ToolEnv): P | null;
}

/**
 * How one kind of shape is drawn and edited with the pointer. The tool's state machine
 * (`toolMachine.ts`) owns the gestures and calls these; a kind never sees a pointer event.
 * Everything is pure.
 */
export interface ToolKind<P> {
    /** The shape kind that generates its spots and is stored in recipes */
    readonly shape: AnyShapeKind;
    /** Its numbers, in the order the chip shows them (#344) */
    readonly params: readonly ToolParam<P>[];
    /**
     * What scaling changes (#344): `interval` kinds change their spacings in half steps,
     * `footprint` kinds (no regular spacing) their size in steps
     */
    readonly scaling: "interval" | "footprint";
    /**
     * The chip offers a lock that keeps the kind's two spacings in proportion
     * ({@link ToolEnv.ratioLocked})
     */
    readonly ratioLock?: boolean;
    /**
     * The params a drag from `from` to `to` draws, or undefined while the drag is too short.
     * `previous` is what this same drag drew on the last pointer move.
     */
    draw(
        from: XY,
        to: XY,
        n: number,
        env: ToolEnv,
        previous?: P,
    ): P | undefined;
    handles(params: P, n: number): readonly ToolHandle[];
    /** The params with handle `key` dragged to `to`, starting from `base` (the params at press) */
    dragHandle(base: P, n: number, key: string, to: XY, env: ToolEnv): P;
    /** The shape's outline on the field; the frame's four corners when absent */
    outline?(params: P, n: number): readonly XY[];
    /** Whether a press at `at` grabs the whole shape to move it */
    contains(params: P, n: number, at: XY): boolean;
    /** `base` moved by `delta` */
    move(base: P, n: number, delta: XY, env: ToolEnv): P;
    /**
     * The shape's frame (08-shape-system-ux.md): center, size, turn and flip. Turning, flipping
     * and the center dot work on it, the same for every kind.
     */
    frameOf(params: P, n: number): ShapeFrame;
    /** The params with `frame`'s center, turn and flip; the kind keeps its own size */
    withFrame(params: P, n: number, frame: ShapeFrame): P;
    /**
     * A `footprint` kind's part in scaling (#349): the params with the frame's half sizes set,
     * its center, turn and flip kept. Absent for `interval` kinds, which scale their spacings.
     */
    withSize?(
        params: P,
        n: number,
        half: { readonly halfWidth: number; readonly halfDepth: number },
        env: ToolEnv,
    ): P;
    /**
     * A new shape of this kind filling `frame`: its center, turn and flip, and its size as near
     * as the kind's spacing allows. Picking another kind with a shape open turns the shape into
     * this kind this way, so the frame is kept (#344).
     */
    fromFrame(frame: ShapeFrame, n: number, env: ToolEnv): P;
    /** After a turn or flip: the shape put back on the grid, if it snaps to one */
    settle?(params: P, n: number, env: ToolEnv): P;
    /**
     * A closed kind (spec #385): its region and the modes it can be filled in. Its shape's
     * `generate` lays its spots out through the host's distributor (`distribute/distribute.ts`).
     * Absent for open kinds (a line, an arc).
     */
    readonly closed?: ClosedShape<P>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolKind = ToolKind<any>;
