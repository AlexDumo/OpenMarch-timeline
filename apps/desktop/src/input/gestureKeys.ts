import { isMacPlatform } from "@/shortcuts/platform";
import {
    releaseUsedKeys,
    rolesOf,
    trackHeldKeys,
    type GestureContext,
    type HeldKeys,
    type HeldRole,
    type RoleKey,
    type RoleMap,
    type Roles,
} from "./modifierRoles";

/**
 * The held roles of one gesture, from its press to its release. Keeps the press rule (a key the
 * press used is no role until it's released) and follows keys pressed or released mid-drag, so a
 * gesture only asks `roles()` and re-runs its last move when told to.
 */
export interface GestureKeys {
    /** The held roles now */
    roles(): Roles;
    /** The keys held now */
    keys(): HeldKeys;
    /** Takes the keys a pointer event carries; returns whether the roles changed */
    update(keys: HeldKeys): boolean;
    /** Stops following the keyboard */
    dispose(): void;
}

const sameRoles = (a: Roles, b: Roles) =>
    a.fine === b.fine &&
    a.constrain === b.constrain &&
    a.fromCenter === b.fromCenter;

export function startGestureKeys({
    context,
    press,
    usedByPress = [],
    onScreen,
    onRolesChange,
    track = true,
    map,
    isMac = isMacPlatform(),
}: {
    context: GestureContext;
    /** The keys held at the press (`heldKeysOf` the pointer-down) */
    press: HeldKeys;
    /** The key a press choice used (`pressChoiceOf(...).key`), if any */
    usedByPress?: readonly RoleKey[];
    /** Touch and Pencil toggles, read whenever the roles are */
    onScreen?: () => ReadonlySet<HeldRole>;
    /** Called when a key pressed or released mid-drag changes the roles */
    onRolesChange?: (roles: Roles) => void;
    /** Follow `keydown`/`keyup` on window; off for tests and one-shot reads */
    track?: boolean;
    map?: RoleMap;
    isMac?: boolean;
}): GestureKeys {
    let keys = press;
    let used: ReadonlySet<RoleKey> = new Set(usedByPress);
    const roles = () =>
        rolesOf(keys, context, {
            map,
            isMac,
            onScreen: onScreen?.(),
            usedByPress: used,
        });
    let last = roles();
    const update = (next: HeldKeys) => {
        keys = next;
        used = releaseUsedKeys(used, keys, isMac);
        const now = roles();
        const changed = !sameRoles(now, last);
        last = now;
        return changed;
    };
    const detach = track
        ? trackHeldKeys(
              (next) => {
                  if (update(next)) onRolesChange?.(last);
              },
              () => keys,
          )
        : () => {};
    return { roles, keys: () => keys, update, dispose: detach };
}
