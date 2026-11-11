import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { getButtonClassName } from "@openmarch/ui";
import {
    ArrowArcLeftIcon,
    ArrowArcRightIcon,
    ArrowsLeftRightIcon,
    CheckSquareOffsetIcon,
} from "@phosphor-icons/react";
import ActionButton from "@/shortcuts/ActionButton";
import Shortcut from "@/components/ui/Shortcut";
import View3dButton from "@/components/toolbar/View3dButton";
import { useIsTouchMode } from "@/stores/InputModeStore";
import type { ActionId } from "@/shortcuts/definitions";
import { fieldEditMode, useFieldEditModeStore } from "./fieldEditModeStore";
import { useFieldProperties } from "./useApplyFieldEdits";
import { baseTemplateOf, changesFromTemplate } from "./fieldEditPlans";
import { FieldEditKeysHelp } from "./FieldEditKeysHelp";

const BUTTON = `${getButtonClassName({ variant: "secondary", size: "compact" })} text-body whitespace-nowrap`;

/**
 * The Edit field mode's bar (#824), in the toolbar's place while the mode is on: what you're
 * editing ("Editing field · Based on College football · 3 changes"), the line commands with
 * their keys, Mirror, Undo and Done. Every button runs the mode's action, so a mouse user finds
 * each one here with its shortcut, and a finger reaches all of them without hover.
 */
export function FieldEditBar() {
    const { t } = useTranslate();
    const fp = useFieldProperties();
    const isTouch = useIsTouchMode();
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const selectMany = useFieldEditModeStore((s) => s.selectMany);
    const base = useMemo(() => (fp ? baseTemplateOf(fp) : null), [fp]);
    const changes = useMemo(
        () => (fp && base ? changesFromTemplate(fp, base.template) : null),
        [fp, base],
    );

    const command = (action: ActionId, label: string, danger = false) => (
        <ActionButton
            action={action}
            className={clsx(BUTTON, danger && "text-red")}
        >
            {label}
            <Shortcut action={action} />
        </ActionButton>
    );

    return (
        <div
            data-testid="field-edit-bar"
            data-field-edit-pane="bar"
            role="region"
            aria-label={t("fieldEditMode.bar.title")}
            className="rounded-6 border-accent/60 bg-fg-1 flex min-h-44 flex-wrap items-center gap-8 border px-12 py-8"
        >
            <div className="text-body flex min-w-0 items-center gap-8">
                <span
                    aria-hidden
                    className="bg-accent size-8 shrink-0 rounded-full"
                />
                <span className="font-medium whitespace-nowrap">
                    {t("fieldEditMode.bar.title")}
                </span>
                <span
                    className="text-text-subtitle truncate"
                    data-testid="field-edit-based-on"
                >
                    {base
                        ? t("fieldEditMode.bar.basedOn", {
                              template: base.template.name,
                          })
                        : t("fieldEditMode.bar.custom")}
                </span>
                {changes !== null && (
                    <span
                        className="border-stroke text-sub rounded-full border px-8 py-2 whitespace-nowrap"
                        data-testid="field-edit-changes"
                    >
                        {t("fieldEditMode.bar.changes", { count: changes })}
                    </span>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
                {command("fieldEditAddXLine", t("fieldEditMode.bar.addX"))}
                {command("fieldEditAddYLine", t("fieldEditMode.bar.addY"))}
                {command("fieldEditEditLine", t("fieldEditMode.bar.edit"))}
                {command(
                    "fieldEditToggleVisible",
                    t("fieldEditMode.bar.hideShow"),
                )}
                {command(
                    "fieldEditToggleReference",
                    t("fieldEditMode.bar.reference"),
                )}
                {command(
                    "fieldEditEveryOther",
                    t("fieldEditMode.bar.everyOther"),
                )}
                {command(
                    "fieldEditDeleteLines",
                    t("fieldEditMode.bar.delete"),
                    true,
                )}
                {/* A finger has no Shift: taps add to the pick while this is on */}
                {isTouch && (
                    <button
                        type="button"
                        aria-pressed={selectMany}
                        className={clsx(
                            BUTTON,
                            selectMany && "border-accent text-accent",
                        )}
                        onClick={() => fieldEditMode.setSelectMany(!selectMany)}
                    >
                        <CheckSquareOffsetIcon size={16} />
                        {t("fieldEditMode.bar.selectMany")}
                    </button>
                )}
            </div>

            <div className="ml-auto flex items-center gap-4">
                <ActionButton
                    action="fieldEditMirror"
                    toggleState={mirror ? "on" : "off"}
                    aria-pressed={mirror}
                    data-testid="field-edit-mirror"
                    className={clsx(
                        BUTTON,
                        mirror && "border-accent text-accent",
                    )}
                    tooltip={t(
                        mirror
                            ? "fieldEditMode.bar.mirrorOnTip"
                            : "fieldEditMode.bar.mirrorOffTip",
                    )}
                >
                    <ArrowsLeftRightIcon size={16} />
                    {t("fieldEditMode.bar.mirror")}
                    <Shortcut action="fieldEditMirror" />
                </ActionButton>
                <ActionButton
                    action="performUndo"
                    className={BUTTON}
                    caption={t("fieldEditMode.bar.undo")}
                >
                    <ArrowArcLeftIcon size={16} />
                </ActionButton>
                <ActionButton
                    action="performRedo"
                    className={BUTTON}
                    caption={t("fieldEditMode.bar.redo")}
                >
                    <ArrowArcRightIcon size={16} />
                </ActionButton>
                <View3dButton />
                <FieldEditKeysHelp />
                <ActionButton
                    action="fieldEditDone"
                    data-testid="field-edit-done"
                    className={`${getButtonClassName({ variant: "primary", size: "compact" })} text-body`}
                >
                    {t("fieldEditMode.bar.done")}
                    <Shortcut action="fieldEditDone" />
                </ActionButton>
            </div>
        </div>
    );
}
