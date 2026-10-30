import type { Pivot, ShapeFrame } from "../frame/frame";
import type { ScrubMove } from "../editor/scrub";
import type { ClosedShape } from "../distribute/region";
import type { LayoutFamily } from "../distribute/distribution";
import type { AnyShapeKind, XY } from "../types";

/**
 * What a gesture knows about the field and the roles held. Built fresh for each pointer event.
 */
export interface ToolEnv {
    /** Field units per 8-to-5 step */
    readonly stepPx: number;
    /**
     * False while `fine` is held or the Snap toggle is off: sizes and spots aren't rounded to the
     * half-step ladder
     */
    readonly snap: boolean;
    /**
     * False while the Snap toggle is off: nothing is pulled onto the field's lines either (#425,
     * #444, #446, #452), and a turn is free of its steps. `fine` keeps the pulls (owner on #453).
     * On when absent.
     */
    readonly pull?: boolean;
    /** The `fine` role is held: the ladder off and the pulls on (owner on #453), whole degrees */
    readonly fine?: boolean;
    /**
     * The `constrain` role is held: the gesture's own constraint (equal spacings, 45° ends, the
     * block handle's 15°)
     */
    readonly constrain: boolean;
    /** The nearest spot on the half-step grid */
    readonly gridSnap: (p: XY) => XY;
    /** How far from a handle a press still takes it, in field units */
    readonly hitRadius: number;
    /**
     * The press's `reachInside` choice: a press on the center dot pulls the pivot out (#350). Read
     * at the press only.
     */
    readonly reachInside?: boolean;
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
    /**
     * The field's lines a box's edge is pulled onto while its handle is dragged or it's drawn
     * (#425), in field units: x for lines side to side (yard lines), y for front to back (hashes,
     * sidelines). None when absent.
     */
    readonly fieldLines?: FieldLines;
    /** How near a line a moving edge must come to be pulled onto it, in field units (#425) */
    readonly pullRadius?: number;
}

/** Lines across the field at these x (side to side) and y (front to back) values */
export interface FieldLines {
    readonly x: readonly number[];
    readonly y: readonly number[];
}

/** A handle the canvas draws, and the cursor it shows on hover */
export interface ToolHandle {
    readonly key: string;
    readonly at: XY;
    readonly cursor: string;
    /** A handle that adds a point (a Line's segment midpoint, #524), drawn smaller and round */
    readonly adds?: boolean;
}

/** A parameter's direction mark: ↔ across, ↕ deep */
export type ParamGlyph = "↔" | "↕";

/**
 * One of a kind's numbers (#344, "The kind contract"), declared once so the host can show and
 * change it without knowing the kind: the floating chip shows the primary ones now, and the
 * inspector, the command bar's steps and a later API read the same list. Everything is pure.
 * `n` is the spot count, which the host gives; a kind never reads the selection.
 */
export interface ToolParam<P> {
    /** Stable for the kind: the command bar and saved shapes name the parameter by it */
    readonly key: string;
    /**
     * Shown as about so much ("≈1.83"): worked out from the shape rather than set, off the half
     * steps. Still dragged and typed; pressed, it goes to the nearest half step ({@link snap}).
     * An outline's spacing a drag or the other spacing left there (owner on #459).
     */
    readonly derived?: (params: P, n: number, stepPx: number) => boolean;
    /**
     * The number put on the nearest half step, as an edit of it: what pressing it does while it
     * shows as about so much ({@link ToolParam.derived}; an outline's spacing: owner on #459)
     */
    readonly snap?: (params: P, n: number, env: ToolEnv) => P;
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
    /**
     * A mark before the number in the chip, so its direction reads without words: ↔ across, ↕
     * deep. Drawn as an icon (`GlyphText`), never as text a font may make an emoji.
     */
    readonly glyph?: ParamGlyph;
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

/** One group of a kind's interval list as the floating editor shows it (#526) */
export interface ToolGroup {
    /** Marchers in it as laid out: "2" */
    readonly count: string;
    /** Its interval in steps: "3", "1⅔" */
    readonly interval: string;
    /** No count was given: it takes the marchers the other groups don't */
    readonly rest: boolean;
    /** Marchers it took past its count, as the last group with no rest to take them; 0 if none */
    readonly grown: number;
    /** Too few marchers to reach it: it's dropped off the end */
    readonly dropped: boolean;
}

/** Which number of a group: how many marchers, or the steps between them */
export type GroupPart = "count" | "interval";

/**
 * A kind's mixed intervals (#526, spec #522): groups of marchers, each at its own interval, which
 * the floating editor shows as a chip each (`2 × 3 │ 4 × 2`) in place of the kind's single
 * interval. Everything is pure.
 */
export interface ToolGroups<P> {
    /** The groups, or null when the shape has one interval for everyone (its interval number) */
    shown(params: P, n: number, stepPx: number): readonly ToolGroup[] | null;
    /**
     * `text` typed over group `index`'s count or interval; a whole list typed there (`2*3+4*2`)
     * replaces the list. Null when the text isn't understood.
     */
    type(
        params: P,
        n: number,
        index: number,
        part: GroupPart,
        text: string,
        env: ToolEnv,
    ): P | null;
    /** Group `index`'s count or interval dragged by `move` from `base`, the params at the press */
    scrub(
        base: P,
        n: number,
        index: number,
        part: GroupPart,
        move: ScrubMove,
        env: ToolEnv,
    ): P;
    /** The params with a group added at the end (the chip's +) */
    add(params: P, n: number, env: ToolEnv): P;
    /** The params without group `index`; one group left is everyone at its interval */
    remove(params: P, n: number, index: number, env: ToolEnv): P;
}

/** One answer in a kind's menu ({@link ToolChoice}) */
export interface ToolChoiceOption {
    /** Stable for the kind: tests and a later command step name the answer by it */
    readonly value: string;
    readonly label: string;
}

/**
 * A menu of the kind's own (a Line's spacing, #523), declared once so the floating editor shows it
 * without knowing the kind, as it does the kind's numbers. Picking an answer is one change of the
 * shape. Everything is pure.
 */
export interface ToolChoice<P> {
    /** Stable for the kind */
    readonly key: string;
    /** What it is, for its tooltip and screen readers: "Spacing" */
    readonly label: string;
    /** The answers, in the order the menu lists them */
    options(params: P, n: number): readonly ToolChoiceOption[];
    /** The answer the shape has now: one of {@link options}' values */
    current(params: P, n: number): string;
    /** The params with `value` picked */
    pick(params: P, n: number, value: string, env: ToolEnv): P;
    /** Hidden while this is false (the corners switch on a line with no corner); shown when absent */
    shown?(params: P, n: number): boolean;
}

/**
 * Drawing by clicking point after point (#524, spec #522), for a kind that opts in. A drag still
 * draws with {@link ToolKind.draw}; a click with no drag starts a run of points, each click adds
 * one, and Enter, a double-click or a click on the last point finishes it. Everything is pure.
 */
export interface ToolClickPoints<P> {
    /**
     * Where a point clicked at `at` lands, after `previous` (the points placed so far, landed):
     * on the grid or a field line, at 45° from the last with `constrain`
     */
    land(previous: readonly XY[], at: XY, env: ToolEnv): XY;
    /** The shape through `points`, in order, or undefined while they aren't one yet */
    draw(points: readonly XY[], n: number, env: ToolEnv): P | undefined;
}

/**
 * How one kind of shape is drawn and edited with the pointer. The tool's state machine
 * (`toolMachine.ts`) owns the gestures and calls these; a kind never sees a pointer event.
 * Everything is pure.
 */
export interface ToolKind<P> {
    /** The shape kind that generates its spots and is stored in recipes */
    readonly shape: AnyShapeKind;
    /**
     * A preset of another kind's shape, named for the pickers (Curve, a Line whose points start
     * smooth, #525): its recipes are that kind's, read back as it. Absent for the kind itself.
     */
    readonly preset?: string;
    /** Its numbers, in the order the chip shows them (#344) */
    readonly params: readonly ToolParam<P>[];
    /** Its own menus, shown under the floating editor beside how it's filled (#523) */
    readonly choices?: readonly ToolChoice<P>[];
    /** Its mixed intervals, when it can be spaced by groups of marchers (#526) */
    readonly groups?: ToolGroups<P>;
    /**
     * Its spots run in an order along it (a Line, #528): the host offers who goes where by Least
     * travel, Keep order or Reverse. Absent: always least travel.
     */
    readonly ordered?: boolean;
    /**
     * Whether params read back from a recipe are a shape of this kind this app can lay out. Absent:
     * they have a center, as every frame-based kind stores (ADR 0006). A kind whose frame follows
     * from its points (a Line) checks its own.
     */
    readable?(params: unknown): boolean;
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
    /** Whether this shape offers the ratio lock, when the kind does; always when absent */
    ratioLockFor?(params: P, n: number): boolean;
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
    /**
     * Click point after point to draw (#524); absent for kinds drawn by one drag only (the box,
     * the circle)
     */
    readonly clickPoints?: ToolClickPoints<P>;
    handles(params: P, n: number): readonly ToolHandle[];
    /**
     * What a click on handle `key` does, rather than nothing: a Line's midpoint handle splits its
     * segment (#524). Null or absent: a click does nothing.
     */
    clickHandle?(params: P, n: number, key: string): P | null;
    /** The params with handle `key` dragged to `to`, starting from `base` (the params at press) */
    dragHandle(base: P, n: number, key: string, to: XY, env: ToolEnv): P;
    /** The shape's outline on the field; the frame's four corners when absent */
    outline?(params: P, n: number): readonly XY[];
    /** Whether the outline is open, drawn without joining its last point to its first (a line) */
    outlineOpen?(params: P, n: number): boolean;
    /**
     * The points pulled onto the field's lines while the shape is moved (#446): a box's corners,
     * then its center. None when absent, so the shape moves on the grid alone.
     */
    snapPoints?(params: P, n: number): readonly XY[];
    /**
     * Whether a press at `at` grabs the whole shape to move it. `env` gives the field's scale, for
     * kinds whose body is a reach around a line rather than an area.
     */
    contains(params: P, n: number, at: XY, env?: ToolEnv): boolean;
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

/** What the pickers know a kind by: its preset's name, else its shape's id */
export const toolId = (kind: AnyToolKind): string =>
    kind.preset ?? kind.shape.id;
