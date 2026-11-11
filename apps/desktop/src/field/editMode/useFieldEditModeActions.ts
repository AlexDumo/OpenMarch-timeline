import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { useEffect } from "react";
import { isPreviewMode, useIsPreviewMode } from "@/stores/PreviewModeStore";
import {
    FIELD_LINE_NUDGE_ACTION_IDS,
    type ActionArgs,
} from "@/shortcuts/definitions";
import {
    useActionHandler,
    useActionHandlerGroup,
} from "@/shortcuts/useActionHandler";
import { fieldEditMode, useFieldEditModeStore } from "./fieldEditModeStore";
import { useApplyFieldEdits, useFieldProperties } from "./useApplyFieldEdits";
import { DRAG_SNAP_STEPS, toRef } from "./lines";
import {
    everyOther,
    existingSelection,
    selectAll,
    walkLines,
} from "./lineSelection";
import {
    addLineEdit,
    deleteLinesEdit,
    nudgeLinesEdit,
    resetNamesEdits,
    toggleLinesEdit,
} from "./lineCommands";
import type { FieldEditResult } from "@/field/edits";

/**
 * Whether a key press belongs to the field rather than a control: Enter and Tab on a focused
 * button or field in the inspector are that control's, not the mode's. Anything that isn't a
 * key press (a menu entry, a button, the palette) is the field's.
 */
export function keyIsForField(): boolean {
    // The event being handled right now, when there is one (deprecated, but the one way to
    // tell a key's run from a click's inside `enabled`)
    const current = (window as { event?: Event }).event;
    if (!(current instanceof KeyboardEvent)) return true;
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    if (!(active instanceof HTMLElement)) return true;
    return (
        active.closest("[data-field-edit-overlay]") !== null ||
        active.closest("[data-testid='threeField']") !== null
    );
}

/** Selects the lines an add made, so the next key (Enter, H, Delete) acts on them */
export function selectAdded(result: FieldEditResult | null) {
    const added = result?.diff.ok ? result.diff.checkpoints.added : [];
    // Of a mirrored pair, side 2's: the one the list's row stands for
    const lead = added.find((c) => c.stepsFromCenterFront >= 0) ?? added[0];
    if (lead) fieldEditMode.select([toRef(lead)]);
}

/** Edit field (#824), the one action of the mode that works outside it: enter, or Done */
export function useFieldEditModeEntry() {
    const databaseReady = useDatabaseReady();
    const { setSelectedMarchers } = useSelectedMarchers() ?? {};
    // Preview edits nothing: switching to it leaves the mode
    const preview = useIsPreviewMode();
    useEffect(() => {
        if (preview) fieldEditMode.exit();
    }, [preview]);
    useActionHandler(
        "fieldEditMode",
        () => {
            if (fieldEditMode.isActive()) {
                fieldEditMode.exit();
                return;
            }
            // Marchers can't be picked while the field is edited: nothing stays selected to be
            // nudged or deleted by a key meant for a line
            setSelectedMarchers?.([]);
            fieldEditMode.enter();
        },
        { enabled: () => databaseReady && !isPreviewMode() },
    );
}

/**
 * The mode's keys and commands (#824). Mounted only while the mode is on, so outside it none of
 * these is in the palette and their keys are the canvas's again.
 */
export function useFieldEditModeActions() {
    const { t } = useTranslate();
    const fp = useFieldProperties();
    const apply = useApplyFieldEdits();
    const selection = useFieldEditModeStore((s) => s.selection);
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const hasSelection = fp
        ? existingSelection(fp, selection).length > 0
        : false;
    const manySelected = fp
        ? existingSelection(fp, selection).length > 1
        : false;
    // Read when run, not from the render: a button can pick a line and run an action at once
    const now = () =>
        fp ? existingSelection(fp, fieldEditMode.get().selection) : [];
    const mirrorNow = () => fieldEditMode.get().mirror;

    // Done (the bar, the palette) leaves at once; Escape first closes the menu or popover, then
    // drops the pick, then leaves
    useActionHandler("fieldEditDone", () => fieldEditMode.exit(), {
        onPress: () => {
            const state = fieldEditMode.get();
            if (state.menu) return fieldEditMode.openMenu(null);
            if (state.editing) return fieldEditMode.edit(null);
            if (state.selection.length > 0) return fieldEditMode.select([]);
            fieldEditMode.exit();
        },
    });

    useActionHandler(
        "fieldEditMirror",
        () => fieldEditMode.setMirror(!fieldEditMode.get().mirror),
        {
            label: t(
                mirror ? "actions.field.mirrorOff" : "actions.field.mirrorOn",
            ),
        },
    );

    const addAt = (axis: "x" | "y") => {
        if (!fp) return;
        const pointer = fieldEditMode.get().pointer;
        // At the pointer when it's over the field (whole steps), else halfway into the largest gap
        let steps: number | undefined;
        if (pointer) {
            const raw = axis === "x" ? pointer.x : pointer.y;
            steps = Math.round(raw / DRAG_SNAP_STEPS) * DRAG_SNAP_STEPS;
            if (axis === "y") steps = Math.min(0, steps);
            steps = steps === 0 ? 0 : steps;
        }
        void apply(addLineEdit(axis, steps, mirrorNow())).then(selectAdded);
    };
    useActionHandler("fieldEditAddXLine", () => addAt("x"), {
        enabled: !!fp,
    });
    useActionHandler("fieldEditAddYLine", () => addAt("y"), {
        enabled: !!fp,
    });

    useActionHandler(
        "fieldEditEditLine",
        () => {
            const current = now();
            const last = current[current.length - 1];
            if (last) fieldEditMode.edit(last);
        },
        { enabled: () => hasSelection && keyIsForField() },
    );

    useActionHandler(
        "fieldEditDeleteLines",
        () => {
            if (!fp) return;
            const edit = deleteLinesEdit(fp, now(), mirrorNow());
            if (!edit) return;
            void apply(edit).then((result) => {
                if (result?.diff.ok) fieldEditMode.select([]);
            });
        },
        { enabled: hasSelection },
    );

    useActionHandler(
        "fieldEditToggleVisible",
        () => {
            const edit =
                fp && toggleLinesEdit(fp, now(), "visible", mirrorNow());
            if (edit) void apply(edit);
        },
        { enabled: hasSelection },
    );
    useActionHandler(
        "fieldEditToggleReference",
        () => {
            const edit =
                fp && toggleLinesEdit(fp, now(), "useAsReference", mirrorNow());
            if (edit) void apply(edit);
        },
        { enabled: hasSelection },
    );

    useActionHandler(
        "fieldEditNextLine",
        () => fp && fieldEditMode.select(walkLines(fp, now(), 1)),
        { enabled: () => !!fp && keyIsForField() },
    );
    useActionHandler(
        "fieldEditPreviousLine",
        () => fp && fieldEditMode.select(walkLines(fp, now(), -1)),
        { enabled: () => !!fp && keyIsForField() },
    );

    const selectEvery = () => fp && fieldEditMode.select(selectAll(fp));
    useActionHandler("fieldEditSelectAllLines", selectEvery, {
        enabled: !!fp,
    });
    // ⌘A / Ctrl+A selects lines here: marchers can't be picked in the mode
    useActionHandler("selectAllMarchers", selectEvery, { enabled: !!fp });
    useActionHandler(
        "fieldEditSelectAllXLines",
        () => fp && fieldEditMode.select(selectAll(fp, "x")),
        { enabled: !!fp },
    );
    useActionHandler(
        "fieldEditSelectAllYLines",
        () => fp && fieldEditMode.select(selectAll(fp, "y")),
        { enabled: !!fp },
    );
    useActionHandler(
        "fieldEditEveryOther",
        () => fp && fieldEditMode.select(everyOther(fp, now())),
        { enabled: manySelected },
    );
    useActionHandler(
        "fieldEditResetNames",
        () => {
            if (!fp) return;
            const edits = resetNamesEdits(fp, now(), mirrorNow());
            if (edits.length === 0) {
                toast.message(t("fieldEditMode.namesAlreadyAutomatic"));
                return;
            }
            void apply(edits);
        },
        { enabled: hasSelection },
    );

    useActionHandlerGroup(
        FIELD_LINE_NUDGE_ACTION_IDS,
        (_id, args: ActionArgs | undefined) => {
            if (!fp) return;
            const direction = String(args?.direction);
            const steps = Number(args?.steps ?? 1);
            const axis =
                direction === "left" || direction === "right" ? "x" : "y";
            // Up on screen is toward the back: fewer steps from the front
            const by =
                direction === "right" || direction === "down" ? steps : -steps;
            const edit = nudgeLinesEdit(fp, now(), axis, by, mirrorNow());
            if (edit) void apply(edit);
        },
        { enabled: hasSelection },
    );
}
