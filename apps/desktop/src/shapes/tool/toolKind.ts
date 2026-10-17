import type { PivotKey, ShapeFrame } from "../frame/frame";
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
    /** What turns and flips go around (the inspector's pivot); the center when absent */
    readonly pivot?: PivotKey;
    /** The box's ratio lock: changing one spacing changes the other in proportion */
    readonly ratioLocked?: boolean;
}

/** A handle the canvas draws, and the cursor it shows on hover */
export interface ToolHandle {
    readonly key: string;
    readonly at: XY;
    readonly cursor: string;
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
    /** After a turn or flip: the shape put back on the grid, if it snaps to one */
    settle?(params: P, n: number, env: ToolEnv): P;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolKind = ToolKind<any>;
