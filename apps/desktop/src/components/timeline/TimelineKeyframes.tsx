import { memo, useMemo } from "react";
import type { KeyboardEvent } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import clsx from "clsx";
import tolgee from "@/global/singletons/Tolgee";
import type { SelectionKeyframe } from "@/timeline/timelineSetFollowing";
import type { TimelinePageMarker } from "./TimelineViewModel";
import {
    beatToX,
    getPageCountAt,
    TIMELINE_PAGE_ROW_BOTTOM,
} from "./TimelineGeometry";
import { ShortcutTooltip, TransportTooltipProvider } from "./ShortcutTooltip";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
    TIMELINE_MENU_ITEM_CLASS,
} from "./TimelineRangeMenu";

/**
 * A keyframe diamond's right-click menu (#306), by the diamond's beat: **Unset here** and, where
 * pages follow the spot, **Unset here and on Pages N–M**, for the selected marchers Set at that
 * count. The playhead doesn't move.
 */
export interface TimelineKeyframeMenu {
    /**
     * Read when the menu opens: whether **Unset here** can run (some selected marchers are Set at
     * `beat` and nothing plays), and the second entry's label, or null where no pages follow
     */
    readonly stateFor: (beat: number) => {
        readonly canUnset: boolean;
        readonly followingLabel: string | null;
    };
    readonly onUnset: (beat: number) => void;
    readonly onUnsetAndFollowing: (beat: number) => void;
}

/** A diamond's size (px), and the press target around it */
const DIAMOND_SIZE = 9;
const TARGET_SIZE = 13;

/**
 * The selection's keyframes (#303, `useSelectionKeyframes`): a diamond at every count where a
 * selected marcher is Set, filled where all of them are, hollow where only some are. Drawn on the
 * page row's bottom edge, half over the measure row, so it covers no page label, keep chain or the
 * playhead's handle, and only the bottom few pixels of a flag's grip (above it there, so a
 * diamond on a flag still seeks). Only the diamond takes the pointer: the page boxes around it
 * still select and scrub. Nothing selected, no diamonds. With `menu`, a right-click (or the
 * context-menu key, or Shift+F10) offers the Unset actions at the diamond's count (#306).
 */
export const TimelineKeyframes = memo(function TimelineKeyframes({
    keyframes,
    pages,
    pixelsPerBeat,
    onSeek,
    menu,
}: {
    keyframes: readonly SelectionKeyframe[];
    pages: readonly TimelinePageMarker[];
    pixelsPerBeat: number;
    onSeek?: (beat: number) => void;
    menu?: TimelineKeyframeMenu;
}) {
    // Worked out when the keyframes or pages change, not on every render (a scrub re-renders)
    const labels = useMemo(
        () => keyframes.map((keyframe) => keyframeLabel(keyframe, pages)),
        [keyframes, pages],
    );
    if (keyframes.length === 0) return null;
    return (
        <TransportTooltipProvider disableHoverableContent>
            {keyframes.map((keyframe, index) => (
                <KeyframeDiamond
                    key={keyframe.beat}
                    keyframe={keyframe}
                    label={labels[index]!}
                    left={beatToX(keyframe.beat, pixelsPerBeat)}
                    onSeek={onSeek}
                    menu={menu}
                />
            ))}
        </TransportTooltipProvider>
    );
});

/** A diamond's name: its page and count, and how many selected marchers are Set there. */
function keyframeLabel(
    keyframe: SelectionKeyframe,
    pages: readonly TimelinePageMarker[],
): string {
    const { pageLabel, count } = getPageCountAt({ pages }, keyframe.beat);
    return keyframe.total === 1
        ? tolgee.t(
              "timeline.keyframes.labelOne",
              "Page {page}, count {count}: Set",
              { page: pageLabel, count },
          )
        : tolgee.t(
              "timeline.keyframes.label",
              "Page {page}, count {count}: {set} of {total} selected marchers Set",
              {
                  page: pageLabel,
                  count,
                  set: keyframe.set,
                  total: keyframe.total,
              },
          );
}

/**
 * One keyframe's diamond (`TimelineKeyframes`), with its right-click menu (#306) as the Basic
 * points have theirs.
 */
const KeyframeDiamond = memo(function KeyframeDiamond({
    keyframe,
    label,
    left,
    onSeek,
    menu,
}: {
    keyframe: SelectionKeyframe;
    label: string;
    left: number;
    onSeek?: (beat: number) => void;
    menu?: TimelineKeyframeMenu;
}) {
    const filled = keyframe.set === keyframe.total;
    const button = (
        <button
            type="button"
            data-testid={`timeline-keyframe-${keyframe.beat}-${filled ? "filled" : "hollow"}`}
            data-timeline-interactive="true"
            aria-label={label}
            aria-haspopup={menu ? "menu" : undefined}
            // Under the start flag (z-40) and the playhead (z-50), over the flag grips (z-35)
            className="group/keyframe focus-visible:ring-accent pointer-events-auto absolute z-[36] flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2"
            style={{
                left,
                top: TIMELINE_PAGE_ROW_BOTTOM,
                width: TARGET_SIZE,
                height: TARGET_SIZE,
            }}
            // A press here is the diamond's: the timeline under it mustn't scrub
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSeek?.(keyframe.beat)}
            // With its own menu, the page menu on the surface must not open too
            onContextMenu={
                menu ? (event) => event.stopPropagation() : undefined
            }
            onKeyDown={menu ? openMenuFromKeyboard : undefined}
        >
            <span
                aria-hidden="true"
                className={clsx(
                    "border-text block rotate-45 border-[1.5px] group-hover/keyframe:scale-125",
                    filled ? "bg-text" : "bg-bg-1",
                )}
                style={{
                    width: DIAMOND_SIZE - 2,
                    height: DIAMOND_SIZE - 2,
                }}
            />
        </button>
    );
    // Without a menu, a right-click goes on to the timeline's own
    if (!menu)
        return (
            <ShortcutTooltip label={label} side="top" closeOnPress>
                {button}
            </ShortcutTooltip>
        );
    return (
        <ContextMenu.Root>
            <ShortcutTooltip label={label} side="top" closeOnPress>
                <ContextMenu.Trigger asChild>{button}</ContextMenu.Trigger>
            </ShortcutTooltip>
            <ContextMenu.Portal>
                <ContextMenu.Content
                    // React bubbles the portal's presses to the timeline, which would scrub
                    // and capture the pointer
                    data-timeline-interactive="true"
                    data-testid="timeline-keyframe-menu"
                    className={TIMELINE_MENU_CONTENT_CLASS}
                    {...KEEP_MENU_EVENTS}
                >
                    <KeyframeMenuItems beat={keyframe.beat} menu={menu} />
                </ContextMenu.Content>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
});

/** The menu's entries, read from `menu.stateFor` only while it's open */
function KeyframeMenuItems({
    beat,
    menu,
}: {
    beat: number;
    menu: TimelineKeyframeMenu;
}) {
    const { canUnset, followingLabel } = menu.stateFor(beat);
    return (
        <>
            <ContextMenu.Item
                className={TIMELINE_MENU_ITEM_CLASS}
                disabled={!canUnset}
                onSelect={() => menu.onUnset(beat)}
            >
                {tolgee.t("actions.timeline.unsetHere", "Unset here")}
            </ContextMenu.Item>
            {followingLabel && (
                <ContextMenu.Item
                    className={TIMELINE_MENU_ITEM_CLASS}
                    onSelect={() => menu.onUnsetAndFollowing(beat)}
                >
                    {followingLabel}
                </ContextMenu.Item>
            )}
        </>
    );
}

/**
 * The context-menu key or Shift+F10 on a focused diamond opens its menu below it. Browsers don't
 * all send a `contextmenu` for them, so the diamond sends its own.
 */
function openMenuFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
        return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
        new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom,
        }),
    );
}
