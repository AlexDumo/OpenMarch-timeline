import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { getButtonClassName } from "@openmarch/ui";
import {
    ArrowArcLeftIcon,
    ArrowArcRightIcon,
    ArrowsLeftRightIcon,
    CheckSquareOffsetIcon,
    PlusIcon,
    XIcon,
} from "@phosphor-icons/react";
import ActionButton from "@/shortcuts/ActionButton";
import Shortcut from "@/components/ui/Shortcut";
import { useIsTouchMode } from "@/stores/InputModeStore";
import type { ActionId } from "@/shortcuts/definitions";
import { fieldEditMode, useFieldEditModeStore } from "./fieldEditModeStore";
import { useFieldProperties } from "./useApplyFieldEdits";
import { baseTemplateOf, changesFromTemplate } from "./fieldEditPlans";
import { FieldEditKeysHelp } from "./FieldEditKeysHelp";
import { FieldSettingsSections } from "./panel/FieldSettings";

const BUTTON = `${getButtonClassName({ variant: "secondary", size: "compact" })} text-body whitespace-nowrap`;

export { FIELD_EDIT_PANEL_ID } from "./fieldEditPanelId";

/**
 * The Field panel (#824), opened from the sidebar's Field button like the Marchers and Show
 * settings panels: while it's open the canvas edits the field. It holds Done (keep the changes)
 * and X (put the field back as it was when the panel opened), what the field is based on, the
 * line commands with their keys, the lines list and the field's settings. Every button runs the
 * mode's action, so a mouse user finds each one here with its shortcut, and a finger reaches all
 * of them without hover.
 */
export function FieldEditPanel() {
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

    const command = (
        action: ActionId,
        label: string,
        { danger = false, plus = false } = {},
    ) => (
        <ActionButton
            action={action}
            className={clsx(BUTTON, danger && "text-red")}
        >
            {plus && <PlusIcon size={14} />}
            {label}
            <Shortcut action={action} />
        </ActionButton>
    );

    return (
        <div
            className="animate-scale-in text-text touch:w-400 flex h-full w-336 min-w-0 flex-col gap-12"
            data-testid="field-edit-panel"
            data-field-edit-pane="panel"
            role="region"
            aria-label={t("fieldEditMode.panel.title")}
        >
            <header className="flex items-center gap-8">
                <h4 className="text-h4 flex-1 leading-none">
                    {t("fieldEditMode.panel.title")}
                </h4>
                <FieldEditKeysHelp />
                <ActionButton
                    action="fieldEditDone"
                    data-testid="field-edit-done"
                    className={`${getButtonClassName({ variant: "primary", size: "compact" })} text-body`}
                >
                    {t("fieldEditMode.panel.done")}
                </ActionButton>
                <ActionButton
                    action="fieldEditDiscard"
                    data-testid="field-edit-discard"
                    aria-label={t("fieldEditMode.panel.discard")}
                    tooltip={t("fieldEditMode.panel.discardTip")}
                    className="hover:text-red touch:size-44 flex items-center justify-center duration-150 ease-out"
                >
                    <XIcon size={24} />
                </ActionButton>
            </header>

            <p
                className="text-sub text-text-subtitle"
                data-testid="field-edit-based-on"
            >
                {base
                    ? t("fieldEditMode.panel.basedOn", {
                          template: base.template.name,
                      })
                    : t("fieldEditMode.panel.custom")}
                {changes !== null && (
                    <span data-testid="field-edit-changes">
                        {" · "}
                        {t("fieldEditMode.panel.changes", { count: changes })}
                    </span>
                )}
            </p>

            <div className="flex flex-wrap items-center gap-4">
                {command("fieldEditAddXLine", t("fieldEditMode.panel.addX"), {
                    plus: true,
                })}
                {command("fieldEditAddYLine", t("fieldEditMode.panel.addY"), {
                    plus: true,
                })}
                {command("fieldEditEditLine", t("fieldEditMode.panel.edit"))}
                {command(
                    "fieldEditToggleVisible",
                    t("fieldEditMode.panel.hideShow"),
                )}
                {command(
                    "fieldEditToggleReference",
                    t("fieldEditMode.panel.reference"),
                )}
                {command(
                    "fieldEditEveryOther",
                    t("fieldEditMode.panel.everyOther"),
                )}
                {command(
                    "fieldEditDeleteLines",
                    t("fieldEditMode.panel.delete"),
                    { danger: true },
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
                        {t("fieldEditMode.panel.selectMany")}
                    </button>
                )}
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
                            ? "fieldEditMode.panel.mirrorOnTip"
                            : "fieldEditMode.panel.mirrorOffTip",
                    )}
                >
                    <ArrowsLeftRightIcon size={16} />
                    {t("fieldEditMode.panel.mirror")}
                    <Shortcut action="fieldEditMirror" />
                </ActionButton>
                <ActionButton
                    action="performUndo"
                    className={BUTTON}
                    caption={t("fieldEditMode.panel.undo")}
                >
                    <ArrowArcLeftIcon size={16} />
                </ActionButton>
                <ActionButton
                    action="performRedo"
                    className={BUTTON}
                    caption={t("fieldEditMode.panel.redo")}
                >
                    <ArrowArcRightIcon size={16} />
                </ActionButton>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-24 overflow-y-auto pr-4">
                {fp && <FieldSettingsSections fp={fp} />}
            </div>
        </div>
    );
}
