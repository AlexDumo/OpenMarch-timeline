import type { FieldProperties } from "@openmarch/core";
import type { UiSettings } from "@/stores/UiSettingsStore";
import { getRoundCoordinates2 } from "@/utilities/CoordinateActions";
import { followPointer, type MoveTransform } from "./moveGesture";

/**
 * The rules that modify a marcher drag (#197, #189 user stories 36 to 40;
 * rules table: Snapping, Lock X / Lock Y; held roles from the modifier roles
 * design, version A: fine and constrain). Pure: the move gesture calls them
 * on every pointer event, and when a role key changes mid-drag, with the
 * settings and roles as they are then, so what's drawn is what's dropped.
 */

/** What the drag rules read from the app's settings and the field. */
export type MoveRules = {
    /** The coordinate-rounding settings (`UiSettings.coordinateRounding`); 0 or none on an axis is off. */
    rounding: UiSettings["coordinateRounding"];
    /** The marchers can't move along X (the toolbar's Lock X). */
    lockX: boolean;
    /** The marchers can't move along Y (the toolbar's Lock Y). */
    lockY: boolean;
    /** The grid rounding is measured on; null (no field yet) turns snapping off. */
    grid: Pick<FieldProperties, "centerFrontPoint" | "pixelsPerStep"> | null;
    /** The Snap toggle; off turns snapping off. On when omitted. */
    snap?: boolean;
};

/**
 * The drag rules as a {@link MoveTransform}, reading `rules` on every call:
 *
 * - Lock X / Lock Y keep that axis where the marchers started.
 * - Constrain keeps the marchers on one axis too, across or down, whichever
 *   the drag has gone further along, on top of the locks.
 * - With coordinate rounding on, one marcher snaps onto the rounding grid; a
 *   group moves in whole rounding steps, so each marcher keeps its offset
 *   from the grid.
 * - Fine, or the Snap toggle off, turns snapping off. The marchers still
 *   follow the pointer at full speed (owner, 2026-11-15: fine is "no snap",
 *   not "slower").
 */
export function ruledMove(rules: () => MoveRules): MoveTransform {
    return (delta, roles, starts) => {
        const { rounding, grid, snap: snapOn = true, ...locks } = rules();
        const across = Math.abs(locks.lockX ? 0 : delta.x);
        const down = Math.abs(locks.lockY ? 0 : delta.y);
        const lockX = locks.lockX || (roles.constrain && down > across);
        const lockY = locks.lockY || (roles.constrain && down <= across);
        const locked = { x: lockX ? 0 : delta.x, y: lockY ? 0 : delta.y };
        const snap = grid !== null && snapOn && !roles.fine;
        if (!snap) return followPointer(locked, roles, starts);

        if (starts.length === 1) {
            const [start] = starts;
            const rounded = getRoundCoordinates2({
                coordinate: {
                    xPixels: start.x + locked.x,
                    yPixels: start.y + locked.y,
                },
                uiSettings: { coordinateRounding: rounding },
                fieldProperties: grid,
            });
            return [
                {
                    id: start.id,
                    x: lockX ? start.x : rounded.xPixels,
                    y: lockY ? start.y : rounded.yPixels,
                },
            ];
        }

        const stepped = {
            x: wholeSteps(locked.x, rounding?.nearestXSteps, grid),
            y: wholeSteps(locked.y, rounding?.nearestYSteps, grid),
        };
        // As getRoundCoordinates2 does, so float noise never reaches a save
        return followPointer(stepped, roles, starts).map(({ id, x, y }) => ({
            id,
            x: thousandths(x),
            y: thousandths(y),
        }));
    };
}

/** `value` to three decimal places, the precision rounding saves. */
const thousandths = (value: number) => Math.round(value * 1000) / 1000;

/** `distance` rounded to whole multiples of `steps` steps; unchanged when `steps` is off. */
function wholeSteps(
    distance: number,
    steps: number | undefined,
    grid: Pick<FieldProperties, "pixelsPerStep">,
): number {
    if (!steps) return distance;
    const size = Math.abs(steps) * grid.pixelsPerStep;
    return Math.round(distance / size) * size;
}
