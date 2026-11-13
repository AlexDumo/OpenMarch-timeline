import { useEffect, useState } from "react";
import type { FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    getButtonClassName,
    SegmentedTextSwitch,
    WarningNote,
} from "@openmarch/ui";
import {
    ArrowsLeftRightIcon,
    CheckSquareOffsetIcon,
    DotsThreeIcon,
    PencilSimpleLineIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import ActionButton from "@/shortcuts/ActionButton";
import Shortcut from "@/components/ui/Shortcut";
import {
    MENU_CONTENT_CLASS,
    MENU_ITEM_CLASS,
} from "@/components/ui/popupClasses";
import { useIsTouchMode } from "@/stores/InputModeStore";
import type { ActionId } from "@/shortcuts/definitions";
import { getActionLabel } from "@/shortcuts/labels";
import { isActionEnabled, runAction } from "@/shortcuts/registry";
import { fieldEditMode, useFieldEditModeStore } from "../fieldEditModeStore";
import { findLine } from "../lines";
import { existingSelection } from "../lineSelection";
import { FieldEditKeysHelp } from "../FieldEditKeysHelp";
import { useApplyFieldEdits } from "../useApplyFieldEdits";
import { LinesList, xLinesAsymmetric } from "./LinesList";
import { SwitchRow } from "./settingsInputs";

const BUTTON = `${getButtonClassName({ variant: "secondary", size: "compact" })} text-body whitespace-nowrap`;
/** A pressed mode button: Edit music's look, as Mirror sides had it */
const PRESSED = "border-accent text-accent";

/** Commands on the picked lines that don't need a button of their own */
const MORE: readonly ActionId[] = [
    "fieldEditEveryOther",
    "fieldEditResetNames",
    "fieldEditSelectAllXLines",
    "fieldEditSelectAllYLines",
];

/**
 * The Field panel's Lines tab (#824). Edit lines is a mode button, like Edit music: off, the
 * field is only shown and the list only says what each line is; on, the field draws its rulers,
 * lines can be picked, dragged and added, and the picked line's commands show here. Leaving the
 * tab, the button again or Escape turns it off.
 */
export function LinesTab({ fp }: { fp: FieldProperties }) {
    const { t } = useTranslate();
    const translate = (key: string, params?: Record<string, string | number>) =>
        t(key, params as never);
    const apply = useApplyFieldEdits();
    const isTouch = useIsTouchMode();
    const editing = useFieldEditModeStore((s) => s.lines);
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const selectMany = useFieldEditModeStore((s) => s.selectMany);
    const selection = useFieldEditModeStore((s) => s.selection);
    const picked = existingSelection(fp, selection);
    const last = picked[picked.length - 1];
    const lastLine = last ? findLine(fp, last) : undefined;
    const [axis, setAxis] = useState<"x" | "y">("x");
    // Where the picked line is, as its row in the list says it
    const whereOf = (line: {
        axis: "x" | "y";
        stepsFromCenterFront: number;
    }) => {
        const steps = Math.abs(line.stepsFromCenterFront);
        const sides = fp.sideDescriptions;
        if (line.axis === "y") return t("fieldEditMode.list.behind", { steps });
        if (steps < 1e-6) return t("fieldEditMode.list.center");
        if (mirror)
            return t("fieldEditMode.list.bothSides", {
                left: sides.terseLeft,
                right: sides.terseRight,
                steps,
            });
        return t("fieldEditMode.list.oneSide", {
            side:
                line.stepsFromCenterFront < 0
                    ? sides.terseLeft
                    : sides.terseRight,
            steps,
        });
    };
    // A line picked on the field shows its own axis' list, once, when the pick changes: the
    // switch still works after (roast)
    const lastAxis = last?.axis;
    const lastId = last?.id;
    useEffect(() => {
        if (lastAxis) setAxis(lastAxis);
    }, [lastAxis, lastId]);

    return (
        <div className="flex flex-col gap-12">
            <div className="flex flex-wrap items-center gap-8">
                <ActionButton
                    action="fieldEditLines"
                    aria-pressed={editing}
                    toggleState={editing ? "on" : "off"}
                    data-testid="field-edit-lines"
                    className={clsx(BUTTON, editing && PRESSED)}
                >
                    <PencilSimpleLineIcon
                        size={16}
                        weight={editing ? "bold" : "regular"}
                    />
                    {t(
                        editing
                            ? "fieldEditMode.lines.editing"
                            : "fieldEditMode.lines.edit",
                    )}
                </ActionButton>
                {editing && (
                    <ActionButton
                        action="fieldEditMirror"
                        toggleState={mirror ? "on" : "off"}
                        aria-pressed={mirror}
                        data-testid="field-edit-mirror"
                        className={clsx(BUTTON, mirror && PRESSED)}
                        tooltip={t(
                            mirror
                                ? "fieldEditMode.panel.mirrorOnTip"
                                : "fieldEditMode.panel.mirrorOffTip",
                        )}
                    >
                        <ArrowsLeftRightIcon size={16} />
                        {t("fieldEditMode.panel.mirror")}
                    </ActionButton>
                )}
                {editing && isTouch && (
                    // A finger has no Shift: taps add to the pick while this is on
                    <button
                        type="button"
                        aria-pressed={selectMany}
                        className={clsx(BUTTON, selectMany && PRESSED)}
                        onClick={() => fieldEditMode.setSelectMany(!selectMany)}
                    >
                        <CheckSquareOffsetIcon size={16} />
                        {t("fieldEditMode.panel.selectMany")}
                    </button>
                )}
                {editing && (
                    <span className="ml-auto">
                        <FieldEditKeysHelp />
                    </span>
                )}
            </div>

            {!editing && (
                <p className="text-sub text-text-subtitle">
                    {t("fieldEditMode.lines.offHint")}
                </p>
            )}

            {editing && lastLine && (
                <div
                    className="border-stroke bg-fg-1 rounded-6 flex flex-col gap-8 border p-8"
                    data-testid="field-edit-picked"
                >
                    <p className="text-body flex items-baseline gap-8">
                        <span className="truncate">
                            {picked.length > 1
                                ? t("fieldEditMode.lines.pickedMany", {
                                      count: picked.length,
                                  })
                                : lastLine.name}
                        </span>
                        {picked.length === 1 && (
                            <span className="text-sub text-text-subtitle truncate">
                                {whereOf(lastLine)}
                            </span>
                        )}
                    </p>
                    <div className="flex flex-wrap items-center gap-4">
                        <ActionButton
                            action="fieldEditEditLine"
                            className={BUTTON}
                        >
                            {t("fieldEditMode.panel.edit")}
                        </ActionButton>
                        <ActionButton
                            action="fieldEditToggleVisible"
                            className={BUTTON}
                        >
                            {t(
                                lastLine.visible
                                    ? "fieldEditMode.menu.hide"
                                    : "fieldEditMode.menu.show",
                            )}
                        </ActionButton>
                        <ActionButton
                            action="fieldEditToggleReference"
                            className={BUTTON}
                        >
                            {t("fieldEditMode.panel.reference")}
                        </ActionButton>
                        <ActionButton
                            action="fieldEditDeleteLines"
                            className={clsx(BUTTON, "text-red")}
                        >
                            {t("fieldEditMode.panel.delete")}
                        </ActionButton>
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger
                                className={`${getButtonClassName({ variant: "ghost", size: "compact", content: "icon" })} ml-auto`}
                                aria-label={t("fieldEditMode.lines.more")}
                                title={t("fieldEditMode.lines.more")}
                                data-testid="field-edit-more"
                            >
                                <DotsThreeIcon size={20} />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                    align="end"
                                    sideOffset={4}
                                    className={`${MENU_CONTENT_CLASS} min-w-200`}
                                >
                                    {MORE.map((action) => (
                                        <DropdownMenu.Item
                                            key={action}
                                            className={MENU_ITEM_CLASS}
                                            disabled={!isActionEnabled(action)}
                                            onSelect={() => runAction(action)}
                                        >
                                            <span className="flex-1">
                                                {getActionLabel(
                                                    action,
                                                    translate,
                                                )}
                                            </span>
                                            <Shortcut action={action} />
                                        </DropdownMenu.Item>
                                    ))}
                                </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                    </div>
                </div>
            )}

            {editing && !lastLine && (
                <p className="text-sub text-text-subtitle">
                    {t("fieldEditMode.lines.onHint")}
                </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-8">
                <SegmentedTextSwitch
                    ariaLabel={t("fieldEditMode.lines.axis")}
                    selected={axis}
                    setSelected={(value) => setAxis(value as "x" | "y")}
                    testId="field-lines-axis"
                    options={[
                        {
                            value: "x",
                            label: t("fieldEditMode.lines.xTab", {
                                count: fp.xCheckpoints.length,
                            }),
                            testId: "field-lines-axis-x",
                        },
                        {
                            value: "y",
                            label: t("fieldEditMode.lines.yTab", {
                                count: fp.yCheckpoints.length,
                            }),
                            testId: "field-lines-axis-y",
                        },
                    ]}
                />
                {editing && (
                    <ActionButton
                        action={
                            axis === "x"
                                ? "fieldEditAddXLine"
                                : "fieldEditAddYLine"
                        }
                        className={BUTTON}
                    >
                        <PlusIcon size={14} />
                        {t(
                            axis === "x"
                                ? "fieldEditMode.panel.addX"
                                : "fieldEditMode.panel.addY",
                        )}
                    </ActionButton>
                )}
            </div>

            {axis === "x" && xLinesAsymmetric(fp) && (
                <div role="status" data-testid="field-lines-asymmetric">
                    <WarningNote>
                        {t("fieldEditMode.list.asymmetric")}
                    </WarningNote>
                </div>
            )}
            {axis === "y" && (
                <SwitchRow
                    label={t("fieldEditMode.list.drawAsHashes")}
                    checked={fp.useHashes}
                    testId="field-use-hashes"
                    onChange={(on) =>
                        void apply({
                            edit: "setFieldSettings",
                            args: { patch: { useHashes: on } },
                        })
                    }
                />
            )}

            <LinesList fp={fp} axis={axis} editing={editing} />
        </div>
    );
}
