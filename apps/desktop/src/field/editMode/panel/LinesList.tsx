import { Fragment, useMemo } from "react";
import type { Checkpoint, FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import {
    CrosshairSimpleIcon,
    EyeIcon,
    EyeSlashIcon,
    PlusIcon,
} from "@phosphor-icons/react";
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
 * Whether the outermost X lines are different distances from the center. The field is drawn
 * centered between them (B8), so the 50 then isn't where the lines say it is.
 */
export function xLinesAsymmetric(fp: Pick<FieldProperties, "xCheckpoints">) {
    if (fp.xCheckpoints.length === 0) return false;
    const xs = fp.xCheckpoints.map((c) => c.stepsFromCenterFront);
    return Math.abs(Math.min(0, ...xs) + Math.max(0, ...xs)) > 1e-6;
}

/**
 * The Field panel's list of lines on one axis (#824), linked to the field, one line per row like
 * the Marchers list (a mirrored pair is one row). While Edit lines is off the rows only say what
 * each line is (an eye-slash for a hidden one), and clicking one does nothing. While it's on the rows share the field's pick and hover, each
 * row's eye and target hide or show its line and make it a reference or not (H and R on the
 * pick), and a + in each gap adds a line halfway.
 */
export function LinesList({
    fp,
    axis,
    editing,
}: {
    fp: FieldProperties;
    axis: "x" | "y";
    editing: boolean;
}) {
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
    // With Edit lines off a row is only read: clicking it changes nothing (sims: a click that
    // turned the mode on surprised people, and made others afraid to touch the list)
    const pick = (row: LineRow, additive: boolean) => {
        if (!editing) return;
        fieldEditMode.select(clickLine(selection, toRef(row.lead), additive));
    };
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
            data-field-line-list
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
                const selected =
                    editing &&
                    row.lines.some((c) => lit.has(lineKey(toRef(c))));
                const hovered =
                    editing &&
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
                                "rounded-6 touch:min-h-44 grid min-h-32 cursor-default grid-cols-[2.5rem_minmax(0,1fr)_auto_3.5rem] items-center gap-8 border px-12",
                                selected
                                    ? "border-stroke bg-fg-2"
                                    : hovered
                                      ? "bg-text/5 border-transparent"
                                      : editing
                                        ? "hover:bg-text/5 border-transparent"
                                        : "border-transparent",
                                !row.lead.visible && "text-text-subtitle",
                            )}
                            onClick={(e) =>
                                pick(
                                    row,
                                    e.shiftKey ||
                                        fieldEditMode.get().selectMany,
                                )
                            }
                            onDoubleClick={() => {
                                if (editing) fieldEditMode.edit(ref);
                            }}
                            onPointerEnter={() =>
                                editing && fieldEditMode.setHover(ref)
                            }
                            onPointerLeave={() =>
                                editing && fieldEditMode.setHover(null)
                            }
                        >
                            <span
                                className={clsx(
                                    "text-body truncate font-mono",
                                    selected && "text-accent",
                                )}
                            >
                                {row.lead.terseName}
                            </span>
                            <span className="text-body truncate">
                                {row.lead.name}
                            </span>
                            <span className="text-sub text-text-subtitle truncate tabular-nums">
                                {whereText(row)}
                            </span>
                            <span className="flex items-center justify-end gap-4">
                                {editing ? (
                                    <>
                                        <RowToggle
                                            on={row.lead.visible}
                                            label={t(
                                                row.lead.visible
                                                    ? "fieldEditMode.menu.hide"
                                                    : "fieldEditMode.menu.show",
                                            )}
                                            onClick={() =>
                                                toggle(row, "visible")
                                            }
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
                                    </>
                                ) : (
                                    <>
                                        {!row.lead.visible && (
                                            <EyeSlashIcon
                                                size={16}
                                                aria-label={t(
                                                    "fieldEditMode.list.hidden",
                                                )}
                                            />
                                        )}
                                    </>
                                )}
                            </span>
                        </div>
                        {next && editing && (
                            <div className="group/gap relative h-4">
                                <button
                                    type="button"
                                    data-testid="field-lines-insert"
                                    aria-label={t("fieldEditMode.list.insert", {
                                        a: row.lead.terseName,
                                        b: next.lead.terseName,
                                    })}
                                    title={t("fieldEditMode.list.insert", {
                                        a: row.lead.terseName,
                                        b: next.lead.terseName,
                                    })}
                                    className={clsx(
                                        "border-stroke bg-bg-1 text-text-subtitle hover:text-accent hover:border-accent focus-visible:border-accent absolute top-1/2 left-4 z-10 flex size-18 -translate-y-1/2 items-center justify-center rounded-full border duration-150 ease-out focus-visible:opacity-100",
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
                "rounded-4 touch:size-44 enabled:hover:bg-fg-2 hover:text-accent flex size-24 items-center justify-center duration-150 ease-out",
                on ? "text-text" : "text-text-subtitle",
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
