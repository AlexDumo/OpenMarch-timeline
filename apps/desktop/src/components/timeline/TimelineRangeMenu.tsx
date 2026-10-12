import { useState, type MouseEvent, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    CursorTextIcon,
    FlagIcon,
    LinkBreakIcon,
    LinkSimpleIcon,
    MinusCircleIcon,
    PencilSimpleIcon,
    PlusCircleIcon,
    TrashIcon,
    UserPlusIcon,
} from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { tolgeeTranslate as t } from "@/timeline/drillEditText";
import type { TimelineBeatRange } from "./TimelineViewModel";
import type { TimelineMeasureRowTarget } from "./TimelineMeasureRow";
import { isMac } from "./TimelinePrimitives";

/**
 * The timeline's right-click menu (ui.md UI-9 Adding marchers, P8.14). It offers **Add selected
 * marchers** on a page box, a clip (its timeline) or a dragged range, for the range under the
 * pointer. Opening it doesn't change the timeline selection: the marchers to add are picked first,
 * where they can be selected. On a page box it also offers **Delete page** (UI-9 Deleting a flag,
 * P8.15), which keeps every later page's look, and next to it **Delete page and its moves**
 * (defined coordinates, owner decision 3). On a clip it offers the move's entries (UI-14):
 * **Edit move**, **Rename move…** and **Delete move**, the same entries as the selected clip's ⋯
 * button. On the measure row it offers measure lines, marks and beats instead (tempo E8,
 * `MeasureRowMenuItems`). With the Tempo lab's `drillChoices` (E10) it also offers count edits that
 * ask what the drill should do: **Remove counts…** on a dragged range or a measure, **Add counts at
 * the end of this page…** on a page box, and **Add counts at the playhead…** anywhere.
 */

/** The menus' entry style; `data-[disabled]` dims an unavailable one */
const ITEM_CLASS =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none data-[disabled]:opacity-50";

/** A shortcut after an entry's words, as the transport's popover shows Ctrl+M */
const SHORTCUT_CLASS = "text-text-subtitle ml-auto pl-16 font-mono text-[11px]";

/** The entry's key, right-aligned and quiet; nothing without one. */
const MenuShortcut = ({ keys }: { keys?: string }) =>
    keys ? (
        <span className={SHORTCUT_CLASS} data-testid="timeline-menu-shortcut">
            {keys}
        </span>
    ) : null;

/** The menus' panel style */
export const TIMELINE_MENU_CONTENT_CLASS =
    "bg-modal text-text rounded-6 border-stroke shadow-modal z-[200] flex min-w-[180px] flex-col gap-4 border p-4 backdrop-blur-md";

/**
 * For a menu's content: React events bubble out of a portal through the component tree, so a
 * press in a menu rendered inside the timeline would reach the timeline too, and scrub there.
 */
export const KEEP_MENU_EVENTS = {
    onPointerDown: (event: { stopPropagation: () => void }) =>
        event.stopPropagation(),
    onClick: (event: { stopPropagation: () => void }) =>
        event.stopPropagation(),
    onDoubleClick: (event: { stopPropagation: () => void }) =>
        event.stopPropagation(),
    onContextMenu: (event: { stopPropagation: () => void }) =>
        event.stopPropagation(),
} as const;

/**
 * What a move's entries do, for one clip (UI-14). Rename only asks for the inline name field; the
 * clip's owner commits it.
 */
export interface TimelineMoveMenuActions {
    readonly onEdit: () => void;
    readonly onRename: () => void;
    readonly onDelete: () => void;
    /** Why **Edit move** and **Delete move** are unavailable (while playing), or null */
    readonly disabledReason?: string | null;
}

/**
 * The move commands (UI-14) `Timeline` takes, by stored timeline id (`Id`); inside, the surface
 * gets them by track id. `onRename` commits the inline name field: `name` is what was typed,
 * stored as `renameTimeline` normalizes it.
 */
export interface TimelineMoveCommands<Id = number> {
    readonly onEdit: (id: Id) => void;
    readonly onRename: (id: Id, name: string) => void;
    readonly onDelete: (id: Id) => void;
    /** Why **Edit move** and **Delete move** are unavailable (while playing), or null */
    readonly disabledReason?: string | null;
}

/**
 * A move's entries (UI-14), for the clip's right-click menu and its ⋯ button: **Edit move**,
 * **Rename move…**, then **Delete move**, red and last. Editing and deleting wait while playing,
 * with the reason; renaming only changes a label, so it doesn't.
 */
export function TimelineMoveMenuItems({
    actions,
}: {
    actions: TimelineMoveMenuActions;
}) {
    const reason = actions.disabledReason ?? null;
    return (
        <>
            <DropdownMenu.Item
                data-testid="timeline-move-menu-edit"
                disabled={reason !== null}
                onSelect={actions.onEdit}
                className={ITEM_CLASS}
            >
                <PencilSimpleIcon size={14} />
                Edit move
            </DropdownMenu.Item>
            <DropdownMenu.Item
                data-testid="timeline-move-menu-rename"
                onSelect={actions.onRename}
                className={ITEM_CLASS}
            >
                <CursorTextIcon size={14} />
                Rename move…
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
            <DropdownMenu.Item
                data-testid="timeline-move-menu-delete"
                disabled={reason !== null}
                onSelect={actions.onDelete}
                className={`${ITEM_CLASS} text-red`}
            >
                <TrashIcon size={14} />
                Delete move
            </DropdownMenu.Item>
            {reason !== null && (
                <p
                    data-testid="timeline-move-menu-reason"
                    className="text-text-subtitle px-8 pb-4 text-[11px]"
                >
                    {reason}
                </p>
            )}
        </>
    );
}

/**
 * The menu's command. `Timeline` takes it in spec beats; inside, it gets `TimelineMenuTarget`s
 * (`T`), whose ranges are view beats.
 */
export interface TimelineAddMarchersMenu<T = TimelineBeatRange> {
    /** **Add selected marchers**; without it, the menu has no add entry */
    readonly onAdd?: (target: T) => void;
    /** Why the command is unavailable (for example, no marchers are selected), or null */
    readonly disabledReason?: string | null;
    /**
     * **Delete page** on a page box (UI-9 Deleting a flag, P8.15): the page whose flag goes.
     * Without it, the menu has no delete entry.
     */
    readonly onDeleteFlag?: (pageId: string | number) => void;
    /**
     * **Delete page and its moves** on a page box, shown after **Delete page**: the page goes with
     * its page moves. Without it, the menu has no such entry.
     */
    readonly onDeleteWithMoves?: (pageId: string | number) => void;
    /**
     * **Keep selected marchers here** and **Let selected marchers follow again** on a page box
     * (UI-18 keep later pages), above the deletes. Without it, the menu has no such entries.
     */
    readonly keepHere?: TimelineKeepHereMenu;
    /**
     * **Change to subset** or **Change to normal page** on a page box (UI-9), whichever the page
     * isn't now. Without it, the menu has no such entry.
     */
    readonly subset?: {
        readonly isSubset: (pageId: string | number) => boolean;
        readonly onSet: (pageId: string | number, subset: boolean) => void;
    };
    /**
     * The measure row's entries (tempo E8) for a measure-row target. Without it, a right-click on
     * the measure row offers nothing there.
     */
    readonly measureRowItems?: (target: TimelineMeasureRowTarget) => ReactNode;
    /** **Remove counts…** on a dragged range or a measure (E10) */
    readonly onRemoveCounts?: (target: T) => void;
    /** **Add counts at the end of this page…** on a page box (E10) */
    readonly onAddCountsAtFlag?: (pageId: string | number) => void;
    /** **Add counts at the playhead…** (E10) */
    readonly onAddCountsAtPlayhead?: () => void;
}

/** The page box menu's keep entries (UI-18 keep later pages), by page id. */
export interface TimelineKeepHereMenu {
    /**
     * Whether some selected marchers follow on the page (Keep applies) or were kept there
     * (Follow again applies); null when no marchers are selected, so neither entry shows
     */
    readonly stateFor: (pageId: string | number) => {
        readonly canKeep: boolean;
        readonly canFollow: boolean;
        /** The key that runs the entry from here (**K**), shown after it */
        readonly keepShortcut?: string;
        readonly followShortcut?: string;
    } | null;
    readonly onKeep: (pageId: string | number) => void;
    readonly onFollow: (pageId: string | number) => void;
}

/**
 * What was right-clicked, in view beats. A clip names its track, so `Timeline` can send the
 * stored timeline's spec range: the view axis folds spec beats 0 and 1 together (UI-5), so a
 * view range can't give back a timeline that starts at beat 0. A page box names its page.
 */
export interface TimelineMenuTarget {
    readonly range: TimelineBeatRange;
    readonly trackId?: string;
    readonly pageId?: string;
    /** A count, measure or rehearsal tab on the measure row */
    readonly measureRow?: TimelineMeasureRowTarget;
    /** A measure on the measure row, by its label ("m41"), for count edits */
    readonly measure?: string;
    /**
     * The drawn range the right-click is inside, whatever is under the pointer: **Remove
     * counts…** acts on it
     */
    readonly cut?: TimelineBeatRange;
    /** Empty space: only Add counts at the playhead… and the hint on drawing a cut */
    readonly blank?: boolean;
}

/**
 * Marks an element as a menu target over `range` (view beats), for track `trackId` or page
 * `pageId` if given.
 */
export const timelineRangeTargetProps = (
    range: TimelineBeatRange,
    trackId?: string | number,
    pageId?: string | number,
) => ({
    "data-timeline-range-start": range.startBeatIndex,
    "data-timeline-range-end": range.endBeatIndex,
    ...(trackId === undefined
        ? {}
        : { "data-timeline-range-track": String(trackId) }),
    ...(pageId === undefined
        ? {}
        : { "data-timeline-range-page": String(pageId) }),
});

/** The target of the closest marked element under the event, or null. */
export const markedRangeAt = (
    target: EventTarget | null,
): TimelineMenuTarget | null => {
    const element =
        target instanceof Element
            ? target.closest<HTMLElement>("[data-timeline-range-start]")
            : null;
    if (!element) return null;
    const startBeatIndex = Number(element.dataset.timelineRangeStart);
    const endBeatIndex = Number(element.dataset.timelineRangeEnd);
    if (
        !Number.isFinite(startBeatIndex) ||
        !Number.isFinite(endBeatIndex) ||
        endBeatIndex <= startBeatIndex
    )
        return null;
    const trackId = element.dataset.timelineRangeTrack;
    const pageId = element.dataset.timelineRangePage;
    return {
        range: { startBeatIndex, endBeatIndex },
        ...(trackId === undefined ? {} : { trackId }),
        ...(pageId === undefined ? {} : { pageId }),
    };
};

const stopPropagation = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();

/**
 * Props for a menu's content rendered inside the timeline's React tree: a portal still bubbles
 * React events to its React ancestors, so without these a click on an item reaches the pointer
 * surface, which seeks, captures the pointer and keeps the item from ever being chosen.
 */
export const timelineMenuContentGuards = {
    onPointerDown: stopPropagation,
    onPointerMove: stopPropagation,
    onPointerUp: stopPropagation,
    onClick: stopPropagation,
    onDoubleClick: stopPropagation,
    onContextMenu: (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    },
} as const;

/** An extra entry for a target, such as the Align view's "Even out page 5" */
export interface TimelineMenuExtraItem {
    readonly id: string;
    readonly label: string;
    /** Gets where the menu was opened, in client pixels */
    readonly onSelect: (at: { readonly x: number; readonly y: number }) => void;
}

/** No commands: the menu then shows only extra entries */
const NO_MENU: TimelineAddMarchersMenu<TimelineMenuTarget> = {};

/** Which count edits (E10) the menu offers for `target` */
const countEditsFor = <T,>(
    menu: TimelineAddMarchersMenu<T>,
    target: TimelineMenuTarget,
) => {
    // A drawn range under the pointer (on anything), or a measure; not a page box or a clip on
    // their own, whose range isn't a cut, nor a count that isn't a measure's downbeat
    const remove =
        menu.onRemoveCounts !== undefined &&
        !target.blank &&
        (target.cut !== undefined ||
            (target.pageId === undefined &&
                target.trackId === undefined &&
                (target.measureRow?.kind !== "count" ||
                    target.measure !== undefined)));
    const addAtFlag =
        menu.onAddCountsAtFlag !== undefined && target.pageId !== undefined;
    const addAtPlayhead = menu.onAddCountsAtPlayhead !== undefined;
    return {
        remove,
        addAtFlag,
        addAtPlayhead,
        any: remove || addAtFlag || addAtPlayhead,
    };
};

/**
 * The menu as an `onContextMenu` handler for the timeline surface and an element to render next
 * to it, so the surface's markup doesn't change. `resolveRange` gives the range under the
 * right-click, or null for no menu there. Without a `menu`, the handler does nothing.
 */
export function useTimelineRangeMenu({
    menu: givenMenu,
    movesFor,
    resolveRange,
    extraItems,
}: {
    menu?: TimelineAddMarchersMenu<TimelineMenuTarget>;
    /** A clip's move entries (UI-14) by its track id, or null where it has none */
    movesFor?: (trackId: string) => TimelineMoveMenuActions | null;
    resolveRange: (event: MouseEvent<HTMLElement>) => TimelineMenuTarget | null;
    /** Entries after the others for a target that isn't on the measure row (none for most) */
    extraItems?: (
        target: TimelineMenuTarget,
    ) => readonly TimelineMenuExtraItem[];
}): {
    onContextMenu: (event: MouseEvent<HTMLElement>) => void;
    element: ReactNode;
} {
    const [open, setOpen] = useState<{
        target: TimelineMenuTarget;
        x: number;
        y: number;
    } | null>(null);
    const menu = givenMenu ?? (extraItems ? NO_MENU : undefined);
    const extrasFor = (target: TimelineMenuTarget) =>
        target.measureRow || target.blank ? [] : (extraItems?.(target) ?? []);
    const movesOf = (target: TimelineMenuTarget) =>
        target.trackId === undefined || target.measureRow
            ? null
            : (movesFor?.(target.trackId) ?? null);
    const onContextMenu = (event: MouseEvent<HTMLElement>) => {
        if (!menu && !movesFor) return;
        const target = resolveRange(event);
        if (!target) return;
        if (target.measureRow) {
            if (!menu?.measureRowItems) return;
        } else {
            // Nothing to offer here: no add, no page box to delete the flag of, no move, no count
            // edit and no extra entry
            const canDelete =
                (menu?.onDeleteFlag !== undefined ||
                    menu?.onDeleteWithMoves !== undefined ||
                    menu?.keepHere !== undefined ||
                    menu?.subset !== undefined) &&
                target.pageId !== undefined;
            if (
                (!menu?.onAdd || target.blank) &&
                !canDelete &&
                !movesOf(target) &&
                !(menu && countEditsFor(menu, target).any) &&
                extrasFor(target).length === 0
            )
                return;
        }
        event.preventDefault();
        setOpen({ target, x: event.clientX, y: event.clientY });
    };
    const disabledReason = menu?.disabledReason ?? null;
    const moves = open ? movesOf(open.target) : null;
    const onMeasureRow = open?.target.measureRow !== undefined;
    const keepState =
        open &&
        !onMeasureRow &&
        menu?.keepHere &&
        open.target.pageId !== undefined
            ? menu.keepHere.stateFor(open.target.pageId)
            : null;
    const counts = menu && open ? countEditsFor(menu, open.target) : null;
    const extras = open ? extrasFor(open.target) : [];
    const offersAdd = !onMeasureRow && !open?.target.blank && !!menu?.onAdd;
    const element = open && (
        <DropdownMenu.Root
            open
            modal={false}
            onOpenChange={(next) => {
                if (!next) setOpen(null);
            }}
        >
            <DropdownMenu.Trigger asChild>
                <span
                    aria-hidden="true"
                    className="pointer-events-none fixed size-0"
                    style={{ left: open.x, top: open.y }}
                />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-testid="timeline-range-menu"
                    align="start"
                    // The trigger is an invisible point; focus stays where an entry puts it (the
                    // rename field, UI-14)
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    {...timelineMenuContentGuards}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    {open.target.measureRow &&
                        menu?.measureRowItems?.(open.target.measureRow)}
                    {offersAdd && menu?.onAdd && (
                        <DropdownMenu.Item
                            disabled={disabledReason !== null}
                            onSelect={() => menu.onAdd?.(open.target)}
                            className={ITEM_CLASS}
                        >
                            <UserPlusIcon size={14} />
                            Add selected marchers
                        </DropdownMenu.Item>
                    )}
                    {offersAdd && disabledReason !== null && (
                        <p
                            data-testid="timeline-range-menu-reason"
                            className="text-text-subtitle px-8 pb-4 text-[11px]"
                        >
                            {disabledReason}
                        </p>
                    )}
                    {extras.map((item) => (
                        <DropdownMenu.Item
                            key={item.id}
                            data-testid={`timeline-range-menu-${item.id}`}
                            onSelect={() =>
                                item.onSelect({ x: open.x, y: open.y })
                            }
                            className={ITEM_CLASS}
                        >
                            {item.label}
                        </DropdownMenu.Item>
                    ))}
                    {keepState && (
                        <>
                            <DropdownMenu.Item
                                data-testid="timeline-range-menu-keep-here"
                                disabled={!keepState.canKeep}
                                aria-keyshortcuts={keepState.keepShortcut}
                                onSelect={() =>
                                    menu?.keepHere?.onKeep(open.target.pageId!)
                                }
                                className={ITEM_CLASS}
                            >
                                <LinkBreakIcon size={14} />
                                {tolgee.t(
                                    "timeline.rangeMenu.keepHere",
                                    "Keep selected marchers here",
                                )}
                                <MenuShortcut keys={keepState.keepShortcut} />
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                                data-testid="timeline-range-menu-follow-again"
                                disabled={!keepState.canFollow}
                                aria-keyshortcuts={keepState.followShortcut}
                                onSelect={() =>
                                    menu?.keepHere?.onFollow(
                                        open.target.pageId!,
                                    )
                                }
                                className={ITEM_CLASS}
                            >
                                <LinkSimpleIcon size={14} />
                                {tolgee.t(
                                    "timeline.rangeMenu.followAgain",
                                    "Let selected marchers follow again",
                                )}
                                <MenuShortcut keys={keepState.followShortcut} />
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                        </>
                    )}
                    {!onMeasureRow &&
                        menu?.subset &&
                        open.target.pageId !== undefined && (
                            <>
                                <DropdownMenu.Item
                                    data-testid="timeline-range-menu-subset"
                                    onSelect={() =>
                                        menu.subset?.onSet(
                                            open.target.pageId!,
                                            !menu.subset.isSubset(
                                                open.target.pageId!,
                                            ),
                                        )
                                    }
                                    className={ITEM_CLASS}
                                >
                                    {menu.subset.isSubset(open.target.pageId)
                                        ? tolgee.t(
                                              "timeline.rangeMenu.toNormalPage",
                                              "Change to normal page",
                                          )
                                        : tolgee.t(
                                              "timeline.rangeMenu.toSubset",
                                              "Change to subset",
                                          )}
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                            </>
                        )}
                    {!onMeasureRow &&
                        menu?.onDeleteFlag &&
                        open.target.pageId !== undefined && (
                            <DropdownMenu.Item
                                data-testid="timeline-range-menu-delete-flag"
                                onSelect={() =>
                                    menu.onDeleteFlag?.(open.target.pageId!)
                                }
                                className={`${ITEM_CLASS} text-red`}
                            >
                                <FlagIcon size={14} />
                                Delete page
                            </DropdownMenu.Item>
                        )}
                    {!onMeasureRow &&
                        menu?.onDeleteWithMoves &&
                        open.target.pageId !== undefined && (
                            <DropdownMenu.Item
                                data-testid="timeline-range-menu-delete-with-moves"
                                onSelect={() =>
                                    menu.onDeleteWithMoves?.(
                                        open.target.pageId!,
                                    )
                                }
                                className={`${ITEM_CLASS} text-red`}
                            >
                                <TrashIcon size={14} />
                                {tolgee.t(
                                    "timeline.rangeMenu.deleteWithMoves",
                                    "Delete page and its moves",
                                )}
                            </DropdownMenu.Item>
                        )}
                    {counts?.any && !open.target.blank && (
                        <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                    )}
                    {counts?.remove && (
                        <DropdownMenu.Item
                            data-testid="timeline-range-menu-remove-counts"
                            onSelect={() => menu?.onRemoveCounts?.(open.target)}
                            className={ITEM_CLASS}
                        >
                            <MinusCircleIcon size={14} />
                            {open.target.measure && !open.target.cut
                                ? t(
                                      "timeline.drillEdits.menu.removeMeasure",
                                      "Remove {measure}’s counts…",
                                      { measure: open.target.measure },
                                  )
                                : t(
                                      "timeline.drillEdits.menu.remove",
                                      "Remove counts…",
                                  )}
                        </DropdownMenu.Item>
                    )}
                    {menu?.onRemoveCounts && !open.target.cut && (
                        <p
                            data-testid="timeline-range-menu-cut-hint"
                            className="text-text-subtitle px-8 pb-4 text-[11px]"
                        >
                            {t(
                                "timeline.drillEdits.menu.cutHint",
                                "{modifier}+drag across measures to remove counts",
                                { modifier: isMac() ? "⌘" : "Ctrl" },
                            )}
                        </p>
                    )}
                    {counts?.addAtFlag && (
                        <DropdownMenu.Item
                            data-testid="timeline-range-menu-add-counts-flag"
                            onSelect={() =>
                                menu?.onAddCountsAtFlag?.(open.target.pageId!)
                            }
                            className={ITEM_CLASS}
                        >
                            <PlusCircleIcon size={14} />
                            {t(
                                "timeline.drillEdits.menu.addAtFlag",
                                "Add counts at the end of this page…",
                            )}
                        </DropdownMenu.Item>
                    )}
                    {counts?.addAtPlayhead && (
                        <DropdownMenu.Item
                            data-testid="timeline-range-menu-add-counts-playhead"
                            onSelect={() => menu?.onAddCountsAtPlayhead?.()}
                            className={ITEM_CLASS}
                        >
                            <PlusCircleIcon size={14} />
                            {t(
                                "timeline.drillEdits.menu.addAtPlayhead",
                                "Add counts at the playhead…",
                            )}
                        </DropdownMenu.Item>
                    )}
                    {moves && <TimelineMoveMenuItems actions={moves} />}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
    return { onContextMenu, element };
}
