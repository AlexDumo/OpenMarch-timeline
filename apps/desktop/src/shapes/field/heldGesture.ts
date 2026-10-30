import { CLICK_SLOP, type FieldPointer } from "@/field/editor/fieldEditor";
import { startGestureKeys } from "@/input/gestureKeys";
import {
    pressChoiceOf,
    type HeldKeys,
    type PressChoice,
    type RoleKey,
    type Roles,
} from "@/input/modifierRoles";
import type { ShapeTarget } from "../frame/gestures";
import type { XY } from "../types";

/**
 * The held roles of one shape gesture, from its press to its end (version A,
 * docs/timeline/research/shapes/modifier-roles.md), and the move to run again when a role key is
 * pressed or released mid-drag. Until a move hands it `last`, the press is still a click, and a key
 * changes nothing.
 */
export interface HeldGesture<A> {
    /** The held roles now */
    roles(): Roles;
    /** A pointer move's keys, and the move to run again (null while the press is still a click) */
    move(keys: HeldKeys, last: A | null): Roles;
    /** The gesture ended (released, cancelled, unmounted): stops following the keyboard */
    end(): void;
}

/** Starts following a gesture's keys; `rerun` is the last move again, with the roles now */
export function holdGesture<A>(
    press: HeldKeys,
    rerun: (last: A, roles: Roles) => void,
    usedByPress: readonly RoleKey[] = [],
): HeldGesture<A> {
    let last: A | null = null;
    let ended = false;
    const keys = startGestureKeys({
        context: "shape",
        press,
        usedByPress,
        onRolesChange: (roles) => {
            if (!ended && last !== null) rerun(last, roles);
        },
    });
    return {
        roles: keys.roles,
        move(next, at) {
            keys.update(next);
            if (at !== null) last = at;
            return keys.roles();
        },
        end() {
            ended = true;
            keys.dispose();
        },
    };
}

/** The press choices a shape press can use: reach inside pulls the pivot out of the center dot */
const REACH_INSIDE: ReadonlySet<PressChoice> = new Set(["reachInside"]);

/** A shape gesture on the field: a move hands its pointer, which counts once past the click slop */
export interface HeldFieldGesture extends Omit<HeldGesture<XY>, "move"> {
    move(pointer: FieldPointer): Roles;
}

/**
 * The held roles of a shape gesture on the field. `grabs` is what the press would take with reach
 * inside on; a press that pulls the pivot out of the center dot uses reach inside's key ($mod), so
 * that key isn't `constrain` until it's released and pressed again. Once the pointer has gone past
 * the field's click slop, a role key pressed or released calls `rerun` at the last pointer; before,
 * the press is still a click and stays one.
 */
export function pressShapeKeys(
    pointer: FieldPointer,
    grabs: () => ShapeTarget | { type: "draw" } | null,
    rerun: (at: XY, roles: Roles) => void,
): { held: HeldFieldGesture; reachInside: boolean } {
    const reach = pressChoiceOf(pointer, "shape", { applicable: REACH_INSIDE });
    const target = reach ? grabs() : null;
    const pulled = target?.type === "pivot" && target.pulled === true;
    const held = holdGesture<XY>(
        pointer,
        rerun,
        pulled && reach ? [reach.key] : [],
    );
    let dragging = false;
    return {
        held: {
            roles: held.roles,
            end: held.end,
            move(p) {
                dragging ||=
                    Math.hypot(
                        p.screen.x - pointer.screen.x,
                        p.screen.y - pointer.screen.y,
                    ) >= CLICK_SLOP;
                return held.move(p, dragging ? p.field : null);
            },
        },
        reachInside: reach !== null,
    };
}
