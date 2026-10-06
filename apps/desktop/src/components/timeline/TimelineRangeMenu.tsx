import { useState, type MouseEvent, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    FlagIcon,
    MinusCircleIcon,
    PlusCircleIcon,
    UserPlusIcon,
} from "@phosphor-icons/react";
import { tolgeeTranslate as t } from "@/timeline/drillEditText";
import type { TimelineBeatRange } from "./TimelineViewModel";
import type { TimelineMeasureRowTarget } from "./TimelineMeasureRow";

/**
 * The timeline's right-click menu (ui.md UI-9 Adding marchers, P8.14). It offers **Add selected
 * marchers** on a page box, a clip (its timeline) or a dragged range, for the range under the
 * pointer. Opening it doesn't change the timeline selection: the marchers to add are picked first,
 * where they can be selected. On a page box it also offers **Delete page flag** (UI-9 Deleting a
 * flag, P8.15). On the measure row it offers measure lines, marks and beats instead (tempo E8,
 * `MeasureRowMenuItems`). With the Tempo lab's `drillChoices` (E10) it also offers count edits that ask
 * what the drill should do: **Remove counts…** on a dragged range or a measure, **Add counts at
 * the end of this page…** on a page box, and **Add counts at the playhead…** anywhere.
 */

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
     * **Delete page flag** on a page box (UI-9 Deleting a flag, P8.15): the page whose flag goes.
     * Without it, the menu has no delete entry.
     */
    readonly onDeleteFlag?: (pageId: string | number) => void;
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

/** An extra entry for a target, such as the Align view's "Even out page 5" */
export interface TimelineMenuExtraItem {
    readonly id: string;
    readonly label: string;
    /** Gets where the menu was opened, in client pixels */
    readonly onSelect: (at: { readonly x: number; readonly y: number }) => void;
}

/** No commands: the menu then shows only extra entries */
const NO_MENU: TimelineAddMarchersMenu<TimelineMenuTarget> = {};

/**
 * The menu as an `onContextMenu` handler for the timeline surface and an element to render next
 * to it, so the surface's markup doesn't change. `resolveRange` gives the range under the
 * right-click, or null for no menu there. Without a `menu`, the handler does nothing.
 */
const ITEM =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none";

/** Which count edits (E10) the menu offers for `target` */
const countEditsFor = <T,>(
    menu: TimelineAddMarchersMenu<T>,
    target: TimelineMenuTarget,
) => {
    // A dragged range or a measure; not a page box or a clip, whose range isn't a cut
    const remove =
        menu.onRemoveCounts !== undefined &&
        target.pageId === undefined &&
        target.trackId === undefined &&
        target.measureRow?.kind !== "count";
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

export function useTimelineRangeMenu({
    menu: givenMenu,
    resolveRange,
    extraItems,
}: {
    menu?: TimelineAddMarchersMenu<TimelineMenuTarget>;
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
        target.measureRow ? [] : (extraItems?.(target) ?? []);
    const onContextMenu = (event: MouseEvent<HTMLElement>) => {
        if (!menu) return;
        const target = resolveRange(event);
        if (!target) return;
        if (target.measureRow) {
            if (!menu.measureRowItems) return;
        } else {
            // Nothing to offer here: no add, no page box to delete the flag of, no count edit and
            // no extra entry
            const canDelete =
                menu.onDeleteFlag !== undefined && target.pageId !== undefined;
            if (
                !menu.onAdd &&
                !canDelete &&
                !countEditsFor(menu, target).any &&
                extrasFor(target).length === 0
            )
                return;
        }
        event.preventDefault();
        setOpen({ target, x: event.clientX, y: event.clientY });
    };
    const disabledReason = menu?.disabledReason ?? null;
    const counts = menu && open ? countEditsFor(menu, open.target) : null;
    const extras = open ? extrasFor(open.target) : [];
    const element = menu && open && (
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
                    // Focus stays where the command puts it, such as the measure row's input
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    className="bg-modal text-text rounded-6 border-stroke shadow-modal z-50 flex min-w-[180px] flex-col gap-4 border p-4 backdrop-blur-md"
                >
                    {open.target.measureRow &&
                        menu.measureRowItems?.(open.target.measureRow)}
                    {!open.target.measureRow && menu.onAdd && (
                        <DropdownMenu.Item
                            disabled={disabledReason !== null}
                            onSelect={() => menu.onAdd?.(open.target)}
                            className="rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none data-[disabled]:opacity-50"
                        >
                            <UserPlusIcon size={14} />
                            Add selected marchers
                        </DropdownMenu.Item>
                    )}
                    {!open.target.measureRow &&
                        menu.onAdd &&
                        disabledReason !== null && (
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
                            className={ITEM}
                        >
                            {item.label}
                        </DropdownMenu.Item>
                    ))}
                    {!open.target.measureRow &&
                        menu.onDeleteFlag &&
                        open.target.pageId !== undefined && (
                            <DropdownMenu.Item
                                data-testid="timeline-range-menu-delete-flag"
                                onSelect={() =>
                                    menu.onDeleteFlag?.(open.target.pageId!)
                                }
                                className="rounded-4 data-[highlighted]:bg-fg-2 text-red flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none"
                            >
                                <FlagIcon size={14} />
                                Delete page flag
                            </DropdownMenu.Item>
                        )}
                    {counts?.any && (
                        <DropdownMenu.Separator className="bg-stroke my-2 h-px" />
                    )}
                    {counts?.remove && (
                        <DropdownMenu.Item
                            data-testid="timeline-range-menu-remove-counts"
                            onSelect={() => menu.onRemoveCounts?.(open.target)}
                            className={ITEM}
                        >
                            <MinusCircleIcon size={14} />
                            {open.target.measure
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
                    {counts?.addAtFlag && (
                        <DropdownMenu.Item
                            data-testid="timeline-range-menu-add-counts-flag"
                            onSelect={() =>
                                menu.onAddCountsAtFlag?.(open.target.pageId!)
                            }
                            className={ITEM}
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
                            onSelect={() => menu.onAddCountsAtPlayhead?.()}
                            className={ITEM}
                        >
                            <PlusCircleIcon size={14} />
                            {t(
                                "timeline.drillEdits.menu.addAtPlayhead",
                                "Add counts at the playhead…",
                            )}
                        </DropdownMenu.Item>
                    )}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
    return { onContextMenu, element };
}
