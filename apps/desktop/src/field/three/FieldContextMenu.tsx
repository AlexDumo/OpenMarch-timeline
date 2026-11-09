import {
    Fragment,
    useCallback,
    useEffect,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTranslate } from "@tolgee/react";
import {
    KEEP_MENU_EVENTS,
    PAGE_MARCHER_ACTIONS,
    PAGE_MARCHER_COMMANDS,
    PageMarcherMenuGroup,
    TIMELINE_MENU_CONTENT_CLASS,
    TimelineMenuClose,
    type PageMarcherEntry,
} from "@/components/timeline/TimelineRangeMenu";
import { pageMarcherHeading } from "@/timeline/timelineClearPage";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import type { ActionId } from "@/shortcuts/definitions";
import { getActionLabel } from "@/shortcuts/labels";
import Shortcut from "@/components/ui/Shortcut";
import {
    actionLabelNow,
    actionMenuLabelNow,
    actionUnavailableReason,
    isActionChecked,
    isActionEnabled,
    runAction,
    subscribeToActionHandlers,
} from "@/shortcuts/registry";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, useFieldViewStore } from "./fieldView";
import {
    MENU_ITEM_CLASS,
    MENU_SEPARATOR_CLASS,
} from "@/components/ui/popupClasses";

/**
 * The field's right-click menu (#315). Every entry is a registered action, run
 * through the actions layer, so it does what its shortcut and the command
 * palette do, and is unavailable when they are. It acts on the selection: the
 * editor selects an unselected marcher right-clicked before it opens.
 *
 * - **Group** or **Ungroup**, first, each shown only while it's available: Group with two or
 *   more marchers selected that aren't one placed shape (#603), Ungroup with one selected whole.
 * - The commands for the selection on the current page, under a heading that says so
 *   ("4 selected on Page 5"): the same group as the page box menu (`PageMarcherMenuGroup`).
 *   Define as shown and Hold from previous page need timeline mode. With nothing selected the
 *   group is Clear for every performer, in red and worded "Clear everyone from Page N".
 * - Arranging the selection: align and distribute, and Swap (two marchers).
 * - **Select all**, which right-clicking empty field reaches for.
 */
const SHAPE_GROUP: readonly ActionId[] = ["shapeGroup", "shapeUngroup"];
const ACTION_GROUPS: readonly (readonly ActionId[])[] = [
    [
        "alignHorizontally",
        "alignVertically",
        "evenlyDistributeHorizontally",
        "evenlyDistributeVertically",
        "swapMarchers",
    ],
    ["selectAllMarchers"],
];

/** The actions the menu offers. */
export const FIELD_MENU_ACTIONS: readonly ActionId[] = [
    ...SHAPE_GROUP,
    ...Object.values(PAGE_MARCHER_ACTIONS.selected),
    ...Object.values(PAGE_MARCHER_ACTIONS.all),
    ...ACTION_GROUPS.flat(),
];

/** Each action's state and live words, as one string, so a change re-renders. */
const handlerSnapshot = () =>
    FIELD_MENU_ACTIONS.map(
        (id) =>
            `${isActionEnabled(id) ? 1 : 0}${isActionChecked(id) ? 1 : 0}${actionMenuLabelNow(id) ?? ""}|${actionUnavailableReason(id) ?? ""}|${actionLabelNow(id) ?? ""}`,
    ).join("\n");

/** Closed, the menu shows nothing, so it reads no handler (a label may run a check) */
const closedSnapshot = () => "";

export default function FieldContextMenu({
    at,
    onClose,
    selectedCount,
    pageName,
    timelineMode,
}: {
    /** Where it opens, in CSS pixels in the field's element; null while closed. */
    at: { x: number; y: number } | null;
    onClose: () => void;
    selectedCount: number;
    /** The current page's name, for the page commands' heading */
    pageName?: string;
    /** Whether the show's timeline is loaded (the holds need it). */
    timelineMode: boolean;
}) {
    const { t } = useTranslate();
    const open = at !== null;
    useSyncExternalStore(
        subscribeToActionHandlers,
        open ? handlerSnapshot : closedSnapshot,
    );
    // The context-menu key and Shift+F10 also fire the browser's own menu
    useEffect(() => {
        if (!open) return;
        const block = (event: Event) => event.preventDefault();
        document.addEventListener("contextmenu", block, true);
        return () => document.removeEventListener("contextmenu", block, true);
    }, [open]);
    if (!at) return null;

    const labelOf = (id: ActionId) =>
        actionMenuLabelNow(id) ??
        getActionLabel(id, (key, params) => t(key, params as never));
    const enabled = (id: ActionId) =>
        isActionEnabled(id) && (id !== "swapMarchers" || selectedCount === 2);

    const pageActions =
        PAGE_MARCHER_ACTIONS[selectedCount > 0 ? "selected" : "all"];
    const pageEntries = PAGE_MARCHER_COMMANDS.flatMap(
        (command): PageMarcherEntry[] => {
            const id = pageActions[command];
            if (!id) return [];
            const on = isActionEnabled(id);
            if (
                !timelineMode &&
                (command === "defineAsShown" || command === "holdFromPrevious")
            )
                return [];
            // Only where later pages would move back, and there's something to clear
            if (
                command === "clearFollowBack" &&
                (!on || isActionChecked(pageActions.clear!))
            )
                return [];
            const reason = on ? null : actionUnavailableReason(id);
            return [
                {
                    command,
                    testId: `field-menu-${id}`,
                    label: labelOf(id),
                    checked: isActionChecked(id),
                    reason,
                    disabled: !on && reason === null,
                    shortcut: id,
                    everyone: selectedCount === 0,
                    onSelect: () => runAction(id),
                },
            ];
        },
    );

    const actionGroup = (group: readonly ActionId[]) =>
        group.map((id) => (
            <DropdownMenu.Item
                key={id}
                data-testid={`field-menu-${id}`}
                disabled={!enabled(id)}
                onSelect={() => runAction(id)}
                className={MENU_ITEM_CLASS}
            >
                {labelOf(id)}
                <span className="ml-auto pl-16">
                    <Shortcut action={id} />
                </span>
            </DropdownMenu.Item>
        ));
    const shapes = SHAPE_GROUP.filter((id) => isActionEnabled(id));
    const sections: { key: string; content: ReactNode }[] = [
        ...(shapes.length > 0
            ? [{ key: "shapes", content: actionGroup(shapes) }]
            : []),
        ...(pageEntries.length > 0
            ? [
                  {
                      key: "page",
                      content: (
                          <PageMarcherMenuGroup
                              heading={
                                  pageName === undefined
                                      ? undefined
                                      : pageMarcherHeading(
                                            selectedCount,
                                            pageName,
                                        )
                              }
                              headingTestId="field-menu-page-heading"
                              entries={pageEntries}
                          />
                      ),
                  },
              ]
            : []),
        ...ACTION_GROUPS.map((group) => ({
            key: group[0]!,
            content: actionGroup(group),
        })),
    ];

    return (
        <DropdownMenu.Root
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DropdownMenu.Trigger asChild>
                <div
                    data-testid="field-menu-anchor"
                    aria-hidden
                    className="pointer-events-none absolute h-0 w-0"
                    style={{ left: at.x, top: at.y }}
                />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-testid="field-menu"
                    align="start"
                    side="bottom"
                    collisionPadding={8}
                    // Focus isn't returned to the anchor, a hidden div: it falls to the page
                    // body. The shortcuts listen on the window, so the field's
                    // keys still work
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    <TimelineMenuClose.Provider value={onClose}>
                        {sections.map(({ key, content }, i) => (
                            <Fragment key={key}>
                                {i > 0 && (
                                    <DropdownMenu.Separator
                                        className={MENU_SEPARATOR_CLASS}
                                    />
                                )}
                                {content}
                            </Fragment>
                        ))}
                    </TimelineMenuClose.Provider>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

type MenuPoint = { x: number; y: number };

/**
 * Where the field's menu is open, in CSS pixels in the field's element, and
 * how it opens: at a right-click (the editor's `openMenu` port, with
 * `openAt`), or from the keyboard (the `openFieldMenu` action: the
 * context-menu key or Shift+F10, while the field has focus and a selection) at
 * the middle of the selected marchers drawn.
 */
export function useFieldMenu({
    marchers,
    editor,
    hasSelection,
}: {
    marchers: FieldMarchers;
    editor: FieldEditor;
    hasSelection: boolean;
}) {
    const [at, setAt] = useState<MenuPoint | null>(null);
    const openAt = useCallback((point: MenuPoint) => setAt(point), []);
    const close = useCallback(() => setAt(null), []);
    useActionHandler(
        "openFieldMenu",
        () => {
            // Not while the open shape is being edited (a selected placed box is its marchers)
            if (editor.blocksFieldMenu()) return;
            const center = selectedCenter(marchers);
            const view = useFieldViewStore.getState();
            setAt(
                center
                    ? fieldToElement(view, center.x, center.y)
                    : { x: view.width / 2, y: view.height / 2 },
            );
        },
        { enabled: hasSelection },
    );
    return { at, openAt, close };
}

/** The middle of the selected marchers drawn (hidden ones aren't), in field units; null with none. */
function selectedCenter(marchers: FieldMarchers): MenuPoint | null {
    const { selected, hidden, positions } = marchers;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < selected.length; i++) {
        if (!selected[i] || hidden[i]) continue;
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    }
    return left === Infinity
        ? null
        : { x: (left + right) / 2, y: (top + bottom) / 2 };
}
