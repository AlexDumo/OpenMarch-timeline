import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
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
import { keepKeysInside, returnFocusToField } from "./keepKeysInside";

const MENU_ACTIONS: readonly ActionId[] = [
    "fieldEditEditLine",
    "fieldEditToggleVisible",
    "fieldEditToggleReference",
    "fieldEditResetNames",
    "fieldEditEveryOther",
    "fieldEditSelectAllXLines",
    "fieldEditSelectAllYLines",
    "fieldEditDeleteLines",
];

/**
 * A line's menu (#824): right-click, or a long press with a finger (no hover, right-click or
 * modifier needed). Each entry runs the mode's action on the selection, which the press picked,
 * with its shortcut beside it. Opens where it was asked for, moved in to stay inside `bounds`.
 *
 * Keyboard: the arrows, Home and End move between entries, Enter or Space runs one, Escape or
 * Tab closes it. Keys pressed in it are its own: they don't reach the field's shortcuts.
 */
export function LineMenu({
    fp,
    line,
    at,
    bounds,
}: {
    fp: FieldProperties;
    line: FieldLineRef;
    at: { x: number; y: number };
    bounds: { width: number; height: number };
}) {
    const { t } = useTranslate();
    const ref = useRef<HTMLDivElement>(null);
    // Where it's drawn: at the press, moved in once its size is known so it stays on screen
    const [place, setPlace] = useState(at);
    useLayoutEffect(() => {
        const menu = ref.current;
        if (!menu) return;
        setPlace({
            x: clamp(at.x, 8, bounds.width - menu.offsetWidth - 8),
            y: clamp(at.y, 8, bounds.height - menu.offsetHeight - 8),
        });
    }, [at, bounds.width, bounds.height]);
    const checkpoint = findLine(fp, line);
    // Re-read whether each entry can run when the handlers change (the press that opened the
    // menu also picked the line, after this first render)
    useSyncExternalStore(subscribeToActionHandlers, () =>
        MENU_ACTIONS.map((id) => (isActionEnabled(id) ? 1 : 0)).join(""),
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
        ref.current
            ?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")
            ?.focus();
    }, []);
    if (!checkpoint) return null;

    const translate = (key: string, params?: Record<string, string | number>) =>
        t(key, params as never);
    const entry = (action: ActionId, label?: string, danger?: boolean) => (
        <button
            key={action}
            type="button"
            role="menuitem"
            data-action={action}
            disabled={!isActionEnabled(action)}
            className={clsx(
                MENU_BUTTON_CLASS,
                "touch:py-8 justify-between",
                danger && "text-red",
            )}
            onClick={() => {
                fieldEditMode.openMenu(null);
                returnFocusToField(ref.current);
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
            style={{ left: place.x, top: place.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                const items = [
                    ...(ref.current?.querySelectorAll<HTMLButtonElement>(
                        "[role=menuitem]:not(:disabled)",
                    ) ?? []),
                ];
                const index = items.indexOf(
                    document.activeElement as HTMLButtonElement,
                );
                const go = (i: number) => {
                    e.preventDefault();
                    items[(i + items.length) % items.length]?.focus();
                };
                if (e.key === "ArrowDown") go(index + 1);
                else if (e.key === "ArrowUp")
                    go(index < 0 ? items.length - 1 : index - 1);
                else if (e.key === "Home") go(0);
                else if (e.key === "End") go(items.length - 1);
                else if (e.key === "Escape" || e.key === "Tab") {
                    e.preventDefault();
                    fieldEditMode.openMenu(null);
                    returnFocusToField(ref.current);
                }
                keepKeysInside(e);
            }}
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

const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(Math.max(min, max), n));
