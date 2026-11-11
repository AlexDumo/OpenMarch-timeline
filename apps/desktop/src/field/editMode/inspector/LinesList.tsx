import { Fragment, useMemo } from "react";
import type { Checkpoint, FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { Switch } from "@openmarch/ui";
import {
    CrosshairSimpleIcon,
    EyeIcon,
    EyeSlashIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import ActionButton from "@/shortcuts/ActionButton";
import Shortcut from "@/components/ui/Shortcut";
import { useIsTouchMode } from "@/stores/InputModeStore";
import { fieldEditMode, useFieldEditModeStore } from "../fieldEditModeStore";
import { lineKey, linesOn, sameLine, toRef, type FieldLineRef } from "../lines";
import { clickLine, selectionWithTwins } from "../lineSelection";
import { insertBetweenEdit, toggleLinesEdit } from "../lineCommands";
import { useApplyFieldEdits } from "../useApplyFieldEdits";
import { selectAdded } from "../useFieldEditModeActions";

/** One row of the list: a line, or with Mirror on an X line and its twin */
export interface LineRow {
    /** The line the row picks and edits (side 2's of a pair, or the center) */
    readonly lead: Checkpoint;
    readonly lines: readonly Checkpoint[];
    /** Steps from the center (X) or behind the front (Y) */
    readonly distance: number;
    /** X: "both", "left", "right" or "center" */
    readonly where: "both" | "left" | "right" | "center" | "y";
}

/**
 * The list's rows (#824): Y front to back; X side 1 to side 2, or with Mirror on, the pairs as one
 * row from the center out (a line without a twin keeps its own row, after its pair's place).
 */
export function lineRows(
    fp: FieldProperties,
    axis: "x" | "y",
    mirror: boolean,
): LineRow[] {
    const lines = linesOn(fp, axis);
    if (axis === "y")
        return lines.map((c) => ({
            lead: c,
            lines: [c],
            distance: Math.abs(c.stepsFromCenterFront),
            where: "y",
        }));
    const side = (c: Checkpoint): LineRow["where"] =>
        Math.abs(c.stepsFromCenterFront) < 1e-6
            ? "center"
            : c.stepsFromCenterFront < 0
              ? "left"
              : "right";
    if (!mirror)
        return lines.map((c) => ({
            lead: c,
            lines: [c],
            distance: Math.abs(c.stepsFromCenterFront),
            where: side(c),
        }));
    const rows: LineRow[] = [];
    const taken = new Set<number>();
    const byDistance = [...lines].sort(
        (a, b) =>
            Math.abs(a.stepsFromCenterFront) -
                Math.abs(b.stepsFromCenterFront) ||
            b.stepsFromCenterFront - a.stepsFromCenterFront,
    );
    for (const c of byDistance) {
        if (taken.has(c.id)) continue;
        taken.add(c.id);
        const twin = lines.find(
            (o) =>
                !taken.has(o.id) &&
                Math.abs(o.stepsFromCenterFront + c.stepsFromCenterFront) <
                    1e-6 &&
                Math.abs(c.stepsFromCenterFront) > 1e-6,
        );
        if (twin) taken.add(twin.id);
        rows.push({
            lead: c,
            lines: twin ? [c, twin] : [c],
            distance: Math.abs(c.stepsFromCenterFront),
            where: twin ? "both" : side(c),
        });
    }
    return rows;
}

/**
 * The inspector's list of lines (#824), linked to the field: one row per line (a mirrored pair is
 * one row), a + in each gap that adds a line halfway, and the same pick and hover as the field
 * (a row lights its line, a line lights its row). Each row's eye and target hide or show the line
 * and make it a reference or not (H and R on the pick).
 */
export function LinesList({ fp }: { fp: FieldProperties }) {
    const { t } = useTranslate();
    const apply = useApplyFieldEdits();
    const isTouch = useIsTouchMode();
    const mirror = useFieldEditModeStore((s) => s.mirror);
    const selection = useFieldEditModeStore((s) => s.selection);
    const hover = useFieldEditModeStore((s) => s.hover);
    const lit = useMemo(
        () =>
            new Set(
                selectionWithTwins(fp, selection, mirror).map((r) =>
                    lineKey(r),
                ),
            ),
        [fp, selection, mirror],
    );

    const axisList = (axis: "x" | "y") => {
        const rows = lineRows(fp, axis, mirror);
        const sides = fp.sideDescriptions;
        const whereText = (row: LineRow) =>
            row.where === "y"
                ? t("fieldEditMode.list.behind", { steps: row.distance })
                : row.where === "center"
                  ? t("fieldEditMode.list.center")
                  : row.where === "both"
                    ? t("fieldEditMode.list.bothSides", {
                          left: sides.terseLeft,
                          right: sides.terseRight,
                          steps: row.distance,
                      })
                    : t("fieldEditMode.list.oneSide", {
                          side:
                              row.where === "left"
                                  ? sides.terseLeft
                                  : sides.terseRight,
                          steps: row.distance,
                      });
        const pick = (row: LineRow, additive: boolean) =>
            fieldEditMode.select(
                clickLine(selection, toRef(row.lead), additive),
            );
        const toggle = (row: LineRow, key: "visible" | "useAsReference") => {
            const edit = toggleLinesEdit(fp, row.lines.map(toRef), key, false);
            if (edit) void apply(edit);
        };
        const insert = (a: LineRow, b: LineRow) =>
            void apply(
                insertBetweenEdit(axis, [a.lead.id, b.lead.id], mirror),
            ).then(selectAdded);
        return (
            <div
                className="flex flex-col"
                role="listbox"
                aria-multiselectable
                aria-label={t(
                    axis === "x"
                        ? "fieldEditMode.list.xHeading"
                        : "fieldEditMode.list.yHeading",
                )}
                data-testid={`field-lines-${axis}`}
            >
                {rows.map((row, i) => {
                    const ref = toRef(row.lead);
                    const selected = row.lines.some((c) =>
                        lit.has(lineKey(toRef(c))),
                    );
                    const hovered =
                        hover !== null &&
                        row.lines.some((c) => sameLine(hover, toRef(c)));
                    const next = rows[i + 1];
                    return (
                        <Fragment key={lineKey(ref)}>
                            <div
                                role="option"
                                aria-selected={selected}
                                tabIndex={-1}
                                data-field-line-row={lineKey(ref)}
                                className={clsx(
                                    "group rounded-4 touch:min-h-44 grid cursor-default grid-cols-[3rem_1fr_auto_auto] items-center gap-6 px-6 py-2",
                                    selected
                                        ? "bg-accent/20"
                                        : hovered
                                          ? "bg-text/10"
                                          : "hover:bg-text/5",
                                    !row.lead.visible && "text-text-subtitle",
                                )}
                                onClick={(e) =>
                                    pick(
                                        row,
                                        e.shiftKey ||
                                            fieldEditMode.get().selectMany,
                                    )
                                }
                                onDoubleClick={() => fieldEditMode.edit(ref)}
                                onPointerEnter={() =>
                                    fieldEditMode.setHover(ref)
                                }
                                onPointerLeave={() =>
                                    fieldEditMode.setHover(null)
                                }
                            >
                                <span className="text-body truncate font-medium tabular-nums">
                                    {row.lead.terseName}
                                </span>
                                <span className="text-sub flex min-w-0 flex-col">
                                    <span className="truncate">
                                        {row.lead.name}
                                    </span>
                                    <span className="text-text-subtitle tabular-nums">
                                        {whereText(row)}
                                    </span>
                                </span>
                                <RowToggle
                                    on={row.lead.visible}
                                    label={t(
                                        row.lead.visible
                                            ? "fieldEditMode.menu.hide"
                                            : "fieldEditMode.menu.show",
                                    )}
                                    onClick={() => toggle(row, "visible")}
                                    icon={
                                        row.lead.visible ? (
                                            <EyeIcon size={16} />
                                        ) : (
                                            <EyeSlashIcon size={16} />
                                        )
                                    }
                                />
                                <RowToggle
                                    on={row.lead.useAsReference}
                                    label={t(
                                        row.lead.useAsReference
                                            ? "fieldEditMode.menu.stopReference"
                                            : "fieldEditMode.menu.useAsReference",
                                    )}
                                    onClick={() =>
                                        toggle(row, "useAsReference")
                                    }
                                    icon={
                                        <CrosshairSimpleIcon
                                            size={16}
                                            weight={
                                                row.lead.useAsReference
                                                    ? "bold"
                                                    : "regular"
                                            }
                                        />
                                    }
                                />
                            </div>
                            {next && (
                                <div className="group/gap relative h-6">
                                    <button
                                        type="button"
                                        data-testid="field-lines-insert"
                                        aria-label={t(
                                            "fieldEditMode.list.insert",
                                            {
                                                a: row.lead.terseName,
                                                b: next.lead.terseName,
                                            },
                                        )}
                                        title={t("fieldEditMode.list.insert", {
                                            a: row.lead.terseName,
                                            b: next.lead.terseName,
                                        })}
                                        className={clsx(
                                            "border-stroke bg-bg-1 text-text-subtitle hover:text-accent hover:border-accent focus-visible:border-accent absolute top-1/2 left-12 z-10 flex size-18 -translate-y-1/2 items-center justify-center rounded-full border duration-150 ease-out focus-visible:opacity-100",
                                            isTouch
                                                ? "touch:size-28 opacity-100"
                                                : "opacity-0 group-hover/gap:opacity-100",
                                        )}
                                        onClick={() => insert(row, next)}
                                    >
                                        <PlusIcon size={12} weight="bold" />
                                    </button>
                                </div>
                            )}
                        </Fragment>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-12">
            <p className="text-sub text-text/60">
                {t("fieldEditMode.list.hint")}
            </p>
            <div className="flex flex-wrap gap-6">
                <ActionButton
                    action="fieldEditAddXLine"
                    className={`${getButtonClassName({ variant: "secondary", size: "compact" })} text-body`}
                >
                    <PlusIcon size={14} />
                    {t("fieldEditMode.bar.addX")}
                    <Shortcut action="fieldEditAddXLine" />
                </ActionButton>
                <ActionButton
                    action="fieldEditAddYLine"
                    className={`${getButtonClassName({ variant: "secondary", size: "compact" })} text-body`}
                >
                    <PlusIcon size={14} />
                    {t("fieldEditMode.bar.addY")}
                    <Shortcut action="fieldEditAddYLine" />
                </ActionButton>
            </div>
            <div className="flex items-baseline justify-between">
                <p className="text-body font-medium">
                    {t("fieldEditMode.list.xHeading")}
                </p>
                <span className="text-sub text-text/60">
                    {fp.xCheckpoints.length}
                </span>
            </div>
            {axisList("x")}
            <div className="flex items-center justify-between gap-8">
                <p className="text-body font-medium">
                    {t("fieldEditMode.list.yHeading")}{" "}
                    <span className="text-sub text-text/60 font-normal">
                        {fp.yCheckpoints.length}
                    </span>
                </p>
                <label
                    className="text-sub flex items-center gap-6"
                    title={t("fieldProperties.tooltips.useHashes")}
                >
                    {t("fieldEditMode.list.drawAsHashes")}
                    <Switch
                        checked={fp.useHashes}
                        data-testid="field-use-hashes"
                        onCheckedChange={(on) =>
                            void apply({
                                edit: "setFieldSettings",
                                args: { patch: { useHashes: on } },
                            })
                        }
                    />
                </label>
            </div>
            {axisList("y")}
        </div>
    );
}

function RowToggle({
    on,
    label,
    onClick,
    icon,
}: {
    on: boolean;
    label: string;
    onClick: () => void;
    icon: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={on}
            title={label}
            className={clsx(
                "touch:size-44 hover:text-accent flex size-24 items-center justify-center rounded-full",
                on ? "text-text" : "text-text-subtitle opacity-60",
            )}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            {icon}
        </button>
    );
}

export type { FieldLineRef };
