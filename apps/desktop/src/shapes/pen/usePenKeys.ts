import { useEffect } from "react";
import { heldKeysOf } from "@/input/modifierRoles";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { holdsOtherKind, setDrawKind, setOtherKindHeld } from "./penKind";
import type { PenSubject } from "./penSubject";

/**
 * The pen's commands (shared pen, plan step 1): **Draw straight** and **Draw curves**, the
 * Straight | Curve switch (palette only: Alt is the keyboard's way). A setting of the user's, so
 * they can be set any time, drawing or not.
 */
export function usePenKindActions(): void {
    useActionHandler("pathDrawStraight", () => setDrawKind("straight"), {});
    useActionHandler("pathDrawCurve", () => setDrawKind("curve"), {});
}

/**
 * The pen's keys while a line is drawn (`drawing`), mounted where the caller's own keys go so they
 * sit on top of the editor's: **Enter** (applyShape) finishes, **undo** takes the last point back
 * and with none left does as the subject's undo says, and **Alt** shows on the next point's cue the
 * moment it's pressed or let go, the pointer still. `subject` is read when a key is pressed;
 * `finishElse` and `undoElse` run Enter and undo for a drawing with no points (the Follow tool's
 * ends pulsing, going round an outline). Escape and
 * Backspace stay the caller's, which share them with its own edits; they call the subject's
 * `cancel` and `removeLast`.
 */
export function usePenKeys({
    drawing,
    subject,
    finishElse,
    undoElse,
    finishLabel,
}: {
    drawing: boolean;
    subject: () => PenSubject | null;
    finishElse: () => void;
    undoElse: () => void;
    finishLabel: string;
}): void {
    // A window that loses focus lets go of Alt
    useEffect(() => {
        if (!drawing) return;
        const onKey = (e: KeyboardEvent) =>
            setOtherKindHeld(holdsOtherKind(heldKeysOf(e)));
        const onBlur = () => setOtherKindHeld(false);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("keyup", onKey, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("keyup", onKey, true);
            window.removeEventListener("blur", onBlur);
            setOtherKindHeld(false);
        };
    }, [drawing]);
    useActionHandler(
        "applyShape",
        () => {
            const s = subject();
            if (s) s.finish();
            else finishElse();
        },
        { label: finishLabel },
        drawing,
    );
    // While drawing, undo takes points back first, as a Line's points are
    useActionHandler(
        "performUndo",
        () => {
            const s = subject();
            if (s) s.undo();
            else undoElse();
        },
        {},
        drawing,
    );
}
