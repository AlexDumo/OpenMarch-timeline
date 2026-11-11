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
import { focusFieldEditPane } from "./fieldEditPanes";
import { useFieldImageActions } from "./useFieldImageActions";

/**
 * What owns its own keys when it has focus: a menu (the line menu), a dialog (the line popover,
 * the template sheet) and form controls (switches, inputs, sliders, selects, segmented
 * switches). A key pressed there is the control's, never the mode's.
 */
const OWNS_KEYS = [
    "[role=menu]",
    "[role=menuitem]",
    "[role=dialog]",
    "[role=alertdialog]",
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable=false])",
    "[role=switch]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=radiogroup]",
    "[role=slider]",
    "[role=spinbutton]",
    "[role=combobox]",
    "[role=tab]",
    // A listbox, but not the inspector's list of lines: its rows stand for lines
    "[role=listbox]:not([data-field-line-list])",
].join(", ");

/** The element a key press being handled now went to, or null for anything else */
function keyTarget(): HTMLElement | null {
    // The event being handled right now, when there is one (deprecated, but the one way to
    // tell a key's run from a click's inside `enabled`)
    const current = (window as { event?: Event }).event;
    if (!(current instanceof KeyboardEvent)) return null;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body)
        return null;
    return active;
}

/**
 * Whether Tab or Enter belongs to the field rather than a control: on a focused button, field
 * or row in the bar or the inspector they're that control's (Tab moves on, Enter presses it),
 * and in the line menu and popover they're theirs. Anything that isn't a key press (a menu
 * entry, a button, the palette) is the field's.
 */
export function keyIsForField(): boolean {
    const active = keyTarget();
    if (!active) return true;
    if (active.closest(OWNS_KEYS)) return false;
    return (
        active.closest("[data-field-edit-overlay]") !== null ||
        active.closest("[data-testid='threeField']") !== null ||
        // Enter on a row of the inspector's list edits its line
        active.closest("[data-field-line-list] [role=option]") !== null
    );
}

/**
 * Whether a single key (Delete, H, R, M, X, Y, the arrows, ⌘A) acts on the lines: anywhere but
 * in the line menu, the line popover, a dialog or a form control, whose keys are their own (an
 * arrow moves a slider, H in the popover is typed or ignored). A focused button keeps none of
 * these, so after clicking Hide/Show in the bar, H still hides.
 */
export function keyIsForLines(): boolean {
    const active = keyTarget();
    return !active || active.closest(OWNS_KEYS) === null;
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
    // The mode belongs to the show that's open: a show opening starts outside it, and closing
    // the show (or switching to another) leaves it, with nothing picked, open or dragged
    useEffect(() => {
        fieldEditMode.exit();
        return () => fieldEditMode.exit();
    }, []);
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
    useFieldImageActions(fp);

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
            enabled: keyIsForLines,
        },
    );

    // F6 and Shift+F6: the keyboard's way between the field (where Tab walks lines), the bar and
    // the inspector
    useActionHandler("fieldEditNextPane", () => focusFieldEditPane(1));
    useActionHandler("fieldEditPreviousPane", () => focusFieldEditPane(-1));

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
        enabled: () => !!fp && keyIsForLines(),
    });
    useActionHandler("fieldEditAddYLine", () => addAt("y"), {
        enabled: () => !!fp && keyIsForLines(),
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
        { enabled: () => hasSelection && keyIsForLines() },
    );

    useActionHandler(
        "fieldEditToggleVisible",
        () => {
            const edit =
                fp && toggleLinesEdit(fp, now(), "visible", mirrorNow());
            if (edit) void apply(edit);
        },
        { enabled: () => hasSelection && keyIsForLines() },
    );
    useActionHandler(
        "fieldEditToggleReference",
        () => {
            const edit =
                fp && toggleLinesEdit(fp, now(), "useAsReference", mirrorNow());
            if (edit) void apply(edit);
        },
        { enabled: () => hasSelection && keyIsForLines() },
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
    useActionHandler("selectAllMarchers", selectEvery, {
        enabled: () => !!fp && keyIsForLines(),
    });
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
        { enabled: () => hasSelection && keyIsForLines() },
    );
}
