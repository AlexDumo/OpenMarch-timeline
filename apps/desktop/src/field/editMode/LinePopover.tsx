import { useEffect, useRef, useState } from "react";
import type { FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import {
    Button,
    getButtonClassName,
    Input,
    SegmentedTextSwitch,
    Switch,
} from "@openmarch/ui";
import { XIcon } from "@phosphor-icons/react";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import Shortcut from "@/components/ui/Shortcut";
import { useIsTouchMode } from "@/stores/InputModeStore";
import { runAction } from "@/shortcuts/registry";
import type { FieldEditRequest } from "@/field/edits";
import { mirrorTwin } from "@/field/edits";
import type { FieldView } from "@/field/editor/view";
import { fieldEditMode, useFieldEditModeStore } from "./fieldEditModeStore";
import {
    fieldScreenRect,
    findLine,
    lineLabel,
    lineScreen,
    type FieldLineRef,
} from "./lines";
import { resolveTypedPosition, yardLineOf } from "./positionInput";
import { moveLineEdit } from "./lineCommands";
import { useApplyFieldEdits } from "./useApplyFieldEdits";
import { useDraft } from "./useDraft";
import { Numpad } from "./Numpad";

const POPOVER_WIDTH = 300;

/**
 * A line's exact values (#824): double-click or Enter on a line (a tap on a picked line with a
 * finger). Position (typed as steps, `+4`, `47.5yd` or `85.33/2`), names, yard number, visible and
 * reference. Enter or Done saves the position and names as one undo step; the switches save at
 * once, like H and R. With Mirror on, the twin gets the same (side names swapped).
 */
export function LinePopover({
    fp,
    line,
    view,
    bounds,
}: {
    fp: FieldProperties;
    line: FieldLineRef;
    view: Pick<FieldView, "zoom" | "panX" | "panY">;
    bounds: { width: number; height: number };
}) {
    const { t } = useTranslate();
    const isTouch = useIsTouchMode();
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const apply = useApplyFieldEdits();
    const checkpoint = findLine(fp, line);
    const steps = checkpoint?.stepsFromCenterFront ?? 0;
    const distance = Math.abs(steps);
    const [position, setPosition] = useDraft(String(distance));
    const [side, setSide] = useState<"left" | "right">(
        steps < 0 ? "left" : "right",
    );
    const [shortName, setShortName] = useDraft(checkpoint?.terseName ?? "");
    const [name, setName] = useDraft(checkpoint?.name ?? "");
    const [label, setLabel] = useDraft(checkpoint?.fieldLabel ?? "");
    const positionInput = useRef<HTMLInputElement>(null);
    useEffect(() => {
        positionInput.current?.focus();
        positionInput.current?.select();
    }, []);
    if (!checkpoint) return null;

    const isX = line.axis === "x";
    const football = fp.useHashes;
    const typed = resolveTypedPosition(position, {
        axis: line.axis,
        football,
        current: distance,
    });
    const atCenter = isX && distance === 0 && typed === 0;
    const twin = isX ? mirrorTwin(fp.xCheckpoints, checkpoint) : undefined;

    const save = () => {
        if (typed === null) return;
        const edits: FieldEditRequest[] = [];
        const to = isX ? (side === "left" ? -typed : typed) : -typed;
        if (Math.abs(to - steps) > 1e-9)
            edits.push(moveLineEdit(line, to === 0 ? 0 : to, mirror));
        const patch: Record<string, unknown> = {};
        if (name.trim() !== checkpoint.name) patch.name = name.trim();
        if (shortName.trim() !== checkpoint.terseName)
            patch.shortName = shortName.trim();
        if (isX && label.trim() !== (checkpoint.fieldLabel ?? ""))
            patch.fieldLabel = label.trim() === "" ? null : label.trim();
        if (Object.keys(patch).length > 0)
            edits.push({
                edit: "updateCheckpoints",
                args: { ids: [line], patch, mirror: mirror && isX },
            });
        if (edits.length === 0) {
            fieldEditMode.edit(null);
            return;
        }
        void apply(edits).then((result) => {
            if (result?.diff.ok) fieldEditMode.edit(null);
        });
    };
    const toggle = (key: "visible" | "useAsReference", on: boolean) =>
        void apply({
            edit: "updateCheckpoints",
            args: { ids: [line], patch: { [key]: on }, mirror: mirror && isX },
        });

    // Beside the line: right of an X line, below a Y line, kept on screen
    const rect = fieldScreenRect(fp, view);
    const at = lineScreen(fp, view, checkpoint);
    const left = clamp(
        isX
            ? at + 16
            : (Math.max(rect.left, 0) + Math.min(rect.right, bounds.width)) /
                  2 -
                  POPOVER_WIDTH / 2,
        8,
        bounds.width - POPOVER_WIDTH - 8,
    );
    const top = clamp(
        isX ? Math.max(rect.top, 0) + 40 : at + 16,
        30,
        bounds.height - 420,
    );
    const flipLeft = isX && at + 16 + POPOVER_WIDTH > bounds.width - 8;

    const hint = [
        isX && football && typed !== null && yardLineOf(typed) !== null
            ? t("fieldEditMode.popover.yardLine", { yard: yardLineOf(typed)! })
            : null,
        t(
            isX && football
                ? "fieldEditMode.popover.typeHintYards"
                : "fieldEditMode.popover.typeHint",
        ),
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <form
            role="dialog"
            aria-label={lineLabel(fp, checkpoint)}
            data-testid="field-line-popover"
            className={clsx(POPOVER_CLASS, "absolute z-40 flex flex-col gap-8")}
            style={{
                width: POPOVER_WIDTH,
                left: flipLeft ? Math.max(8, at - 16 - POPOVER_WIDTH) : left,
                top,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    fieldEditMode.edit(null);
                }
            }}
            onSubmit={(e) => {
                e.preventDefault();
                save();
            }}
        >
            <header className="flex items-center justify-between gap-8">
                <span className="text-body font-medium">
                    {lineLabel(fp, checkpoint)}{" "}
                    <span className="text-sub text-text-subtitle font-normal">
                        {t(isX ? "fieldEditMode.xLine" : "fieldEditMode.yLine")}
                    </span>
                </span>
                <button
                    type="button"
                    aria-label={t("fieldEditMode.popover.close")}
                    className="hover:text-red"
                    onClick={() => fieldEditMode.edit(null)}
                >
                    <XIcon size={16} />
                </button>
            </header>

            <label className="text-sub text-text-subtitle flex flex-col gap-4">
                {t("fieldEditMode.popover.position")}
                <span className="flex items-center gap-8">
                    {isX && (
                        <SegmentedTextSwitch
                            ariaLabel={t("fieldEditMode.popover.side")}
                            options={[
                                {
                                    value: "left",
                                    label: fp.sideDescriptions.terseLeft,
                                    disabled: atCenter,
                                },
                                {
                                    value: "right",
                                    label: fp.sideDescriptions.terseRight,
                                    disabled: atCenter,
                                },
                            ]}
                            selected={side}
                            setSelected={(v) => setSide(v as "left" | "right")}
                        />
                    )}
                    <Input
                        ref={positionInput}
                        compact
                        data-testid="field-line-position"
                        inputMode={isTouch ? "none" : "decimal"}
                        className={clsx(
                            "w-96 tabular-nums",
                            typed === null && "border-red",
                        )}
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        aria-invalid={typed === null}
                    />
                    <span className="text-text">
                        {t(
                            isX
                                ? "fieldEditMode.popover.stepsFromCenter"
                                : "fieldEditMode.popover.stepsBehindFront",
                        )}
                    </span>
                </span>
                <span>{hint}</span>
            </label>
            {isTouch && (
                <Numpad
                    yards={isX && football}
                    onKey={(key) =>
                        key === "back"
                            ? setPosition(position.slice(0, -1))
                            : key === "clear"
                              ? setPosition("")
                              : setPosition(position + key)
                    }
                />
            )}

            <TextRow
                label={t("fieldEditMode.popover.shortName")}
                hint={t("fieldEditMode.popover.shortNameHint")}
                value={shortName}
                onChange={setShortName}
                testId="field-line-short-name"
            />
            <TextRow
                label={t("fieldEditMode.popover.name")}
                hint={t("fieldEditMode.popover.nameHint")}
                value={name}
                onChange={setName}
                testId="field-line-name"
            />
            {isX && (
                <TextRow
                    label={t("fieldEditMode.popover.yardNumber")}
                    hint={t("fieldEditMode.popover.yardNumberHint")}
                    value={label}
                    onChange={setLabel}
                    placeholder={t("fieldEditMode.popover.none")}
                    testId="field-line-yard-number"
                />
            )}

            <div className="flex flex-wrap items-center gap-16">
                <label className="text-body flex items-center gap-8">
                    <Switch
                        checked={checkpoint.visible}
                        onCheckedChange={(on) => toggle("visible", on)}
                        data-testid="field-line-visible"
                    />
                    {t("fieldEditMode.popover.visible")}
                    <Shortcut action="fieldEditToggleVisible" />
                </label>
                <label className="text-body flex items-center gap-8">
                    <Switch
                        checked={checkpoint.useAsReference}
                        onCheckedChange={(on) => toggle("useAsReference", on)}
                        data-testid="field-line-reference"
                    />
                    {t("fieldEditMode.popover.reference")}
                    <Shortcut action="fieldEditToggleReference" />
                </label>
            </div>
            {mirror && twin && (
                <p className="text-sub text-text-subtitle">
                    {t("fieldEditMode.popover.mirrored", {
                        twin: lineLabel(fp, twin),
                    })}
                </p>
            )}

            <footer className="flex items-center justify-between gap-8 pt-4">
                <button
                    type="button"
                    className={`${getButtonClassName({ variant: "secondary", size: "compact" })} text-red text-body`}
                    onClick={() => {
                        fieldEditMode.edit(null);
                        fieldEditMode.select([line]);
                        runAction("fieldEditDeleteLines");
                    }}
                >
                    {t("fieldEditMode.popover.delete")}
                    <Shortcut action="fieldEditDeleteLines" />
                </button>
                <Button
                    type="submit"
                    size="compact"
                    disabled={typed === null}
                    data-testid="field-line-done"
                >
                    {t("fieldEditMode.popover.done")}
                    <Shortcut binding="Enter" />
                </Button>
            </footer>
        </form>
    );
}

function TextRow({
    label,
    hint,
    value,
    onChange,
    placeholder,
    testId,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (text: string) => void;
    placeholder?: string;
    testId: string;
}) {
    return (
        <label className="text-sub text-text-subtitle grid grid-cols-[96px_1fr] items-center gap-8">
            <span title={hint}>{label}</span>
            <Input
                compact
                value={value}
                maxLength={40}
                placeholder={placeholder}
                data-testid={testId}
                onChange={(e) => onChange(e.target.value)}
            />
        </label>
    );
}

const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));
