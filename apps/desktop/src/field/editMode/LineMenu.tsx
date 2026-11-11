import { useEffect, useRef, useSyncExternalStore } from "react";
import type { FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import {
    MENU_BUTTON_CLASS,
    MENU_CONTENT_CLASS,
    MENU_LABEL_CLASS,
    MENU_SEPARATOR_CLASS,
} from "@/components/ui/popupClasses";
import Shortcut from "@/components/ui/Shortcut";
import type { ActionId } from "@/shortcuts/definitions";
import { getActionLabel } from "@/shortcuts/labels";
import {
    isActionEnabled,
    runAction,
    subscribeToActionHandlers,
} from "@/shortcuts/registry";
import { fieldEditMode } from "./fieldEditModeStore";
import { findLine, lineLabel, type FieldLineRef } from "./lines";

/**
 * A line's menu (#824): right-click, or a long press with a finger (no hover, right-click or
 * modifier needed). Each entry runs the mode's action on the selection, which the press picked,
 * with its shortcut beside it.
 */
export function LineMenu({
    fp,
    line,
    at,
}: {
    fp: FieldProperties;
    line: FieldLineRef;
    at: { x: number; y: number };
}) {
    const { t } = useTranslate();
    const ref = useRef<HTMLDivElement>(null);
    const checkpoint = findLine(fp, line);
    // Re-read whether each entry can run when the handlers change
    useSyncExternalStore(subscribeToActionHandlers, () =>
        isActionEnabled("fieldEditEveryOther"),
    );
    useEffect(() => {
        const close = (event: PointerEvent) => {
            if (ref.current?.contains(event.target as Node)) return;
            fieldEditMode.openMenu(null);
        };
        window.addEventListener("pointerdown", close, true);
        return () => window.removeEventListener("pointerdown", close, true);
    }, []);
    useEffect(() => {
        ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }, []);
    if (!checkpoint) return null;

    const translate = (key: string, params?: Record<string, string | number>) =>
        t(key, params as never);
    const entry = (action: ActionId, label?: string, danger?: boolean) => (
        <button
            key={action}
            type="button"
            role="menuitem"
            disabled={!isActionEnabled(action)}
            className={clsx(
                MENU_BUTTON_CLASS,
                "touch:py-8 justify-between",
                danger && "text-red",
            )}
            onClick={() => {
                fieldEditMode.openMenu(null);
                runAction(action);
            }}
        >
            <span>{label ?? getActionLabel(action, translate)}</span>
            <Shortcut action={action} />
        </button>
    );

    return (
        <div
            ref={ref}
            role="menu"
            aria-label={lineLabel(fp, checkpoint)}
            data-testid="field-line-menu"
            className={clsx(MENU_CONTENT_CLASS, "absolute min-w-220")}
            style={{ left: at.x, top: at.y }}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className={MENU_LABEL_CLASS}>{lineLabel(fp, checkpoint)}</div>
            {entry("fieldEditEditLine")}
            {entry(
                "fieldEditToggleVisible",
                t(
                    checkpoint.visible
                        ? "fieldEditMode.menu.hide"
                        : "fieldEditMode.menu.show",
                ),
            )}
            {entry(
                "fieldEditToggleReference",
                t(
                    checkpoint.useAsReference
                        ? "fieldEditMode.menu.stopReference"
                        : "fieldEditMode.menu.useAsReference",
                ),
            )}
            {entry("fieldEditResetNames")}
            <div className={MENU_SEPARATOR_CLASS} />
            {entry("fieldEditEveryOther")}
            {entry(
                line.axis === "x"
                    ? "fieldEditSelectAllXLines"
                    : "fieldEditSelectAllYLines",
            )}
            <div className={MENU_SEPARATOR_CLASS} />
            {entry("fieldEditDeleteLines", undefined, true)}
        </div>
    );
}
