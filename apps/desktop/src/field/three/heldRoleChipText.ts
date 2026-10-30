import {
    HELD_ROLES,
    keyFor,
    keyLabel,
    type HeldRole,
    type Roles,
} from "@/input/modifierRoles";

/** Whether the cursor chip should show for this drag state. */
export function shouldShowGestureChip(
    active: boolean,
    roles: Roles,
    snapOn: boolean,
    isPlaying: boolean,
): boolean {
    if (!active || isPlaying) return false;
    const anyHeld =
        roles.fine || roles.constrain || roles.fromCenter || !snapOn;
    if (!anyHeld && snapOn) return false;
    return true;
}

const CONSTRAIN_I18N: Record<string, string> = {
    "one axis": "field.gestureChip.constrainOneAxis",
    "equal spacings": "field.gestureChip.constrainEqualSpacings",
    "45°": "field.gestureChip.constrain45",
};

const ROLE_I18N: Record<HeldRole, string> = {
    fine: "field.gestureChip.fine",
    constrain: "field.gestureChip.constrain",
    fromCenter: "field.gestureChip.fromCenter",
};

/** One chip segment per held role, plus Snap off when snapping is off. */
export function gestureChipSegments(
    roles: Roles,
    constrainWord: string | undefined,
    snapOn: boolean,
    isMac: boolean,
    t: (key: string) => string,
): string[] {
    const segments: string[] = [];
    for (const role of HELD_ROLES) {
        if (!roles[role]) continue;
        const key = keyFor(role, "field");
        const symbol = key ? keyLabel(key, isMac) : "";
        const word =
            role === "constrain" && constrainWord
                ? t(
                      CONSTRAIN_I18N[constrainWord] ??
                          "field.gestureChip.constrain",
                  )
                : t(ROLE_I18N[role]);
        segments.push(`${symbol} ${word}`.trim());
    }
    if (!snapOn) segments.push(t("field.gestureChip.snapOff"));
    return segments;
}
