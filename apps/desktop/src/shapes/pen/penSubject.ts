import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";

/**
 * What the pen draws on (shared pen, plan step 1): a caller's line, seen only through this. The
 * pen owns the gestures (a click places, a press-and-drag places a smooth point and sets its
 * roundness, a double-click finishes, Alt places the other kind), the Straight | Curve switch, the
 * cue, one preview per animation frame, the bar and the keys; the subject owns its points, where
 * a click lands on them, what's planned on them, and its writes. Every write is the subject's and
 * one undo step of its own; the pen never touches history.
 *
 * The Path pen, the Follow tool's trail and a trail's head drawn on with clicks are subjects
 * (`pathways/penSubjects.ts`); a Line-shaped fake (`__test__/penDrawing.test.ts`) keeps the
 * interface from being only theirs.
 */
export interface PenSubject {
    /**
     * Who it is, for a preview waiting on its frame: a frame landing after the drawing changed to
     * another (a new grab, a cancel) does nothing
     */
    readonly key: unknown;
    /** Whether a preview waits for the next animation frame (the subject plans a whole line on it) */
    readonly perFrame: boolean;
    /** How many points are placed now (a double-click's take-back compares it) */
    count(): number;
    /** The last point placed, by identity, or null */
    last(): unknown;
    /**
     * Whether a press at `at` finishes rather than places: on the last point, or on a fixed end
     * the line goes to. A drag from there still finishes on release.
     */
    finishesAt(at: XY, env: ToolEnv): boolean;
    /**
     * A click at `at` (the pointer, not yet landed): the point it places, a corner or smooth by
     * `smooth`, landed as the subject lands its points; `"finish"` when it places nothing new (on
     * the last point), as a click on the last point finishes
     */
    click(at: XY, smooth: boolean, env: ToolEnv): "placed" | "finish";
    /** A press-and-drag past the slop: the point its press placed turns smooth toward `to` */
    shapeLast(to: XY, env: ToolEnv): void;
    /** That press-and-drag let go */
    endShape(): void;
    /** That press-and-drag lost (the window lost the pointer): as the subject keeps or drops it */
    loseShape(): void;
    /** The leg to the pointer at `at`, or none (`null`: the pointer left) */
    preview(at: XY | null, env: ToolEnv | null): void;
    /**
     * Whether a double-click's first click, which placed a point, is taken back before finishing
     * (the line ends where the double-click is anyway, at a fixed end)
     */
    dropsDoubleClickPoint(): boolean;
    /** Takes the last placed point back; false when there's nothing to take */
    removeLast(): boolean;
    /** Whether a point placed can be taken back now (the bar's Remove last point) */
    canRemoveLast(): boolean;
    /**
     * Writes what's placed (Enter, a double-click, a click on the last point or a fixed end, the
     * bar's Finish), never the leg to the pointer. `at`: where a finishing click was, for a
     * subject whose ends name something (an end spot)
     */
    finish(at?: XY, env?: ToolEnv): void;
    /** Escape, the bar's Cancel: nothing written */
    cancel(): void;
    /** Undo while drawing: the last point taken back; with none left, as the subject says */
    undo(): void;
}
