import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import tolgee from "@/global/singletons/Tolgee";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
} from "./TimelineRangeMenu";

const ITEM_CLASS =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none";

/**
 * The paused playhead's right-click menu (UI-9; replaced the **+** beside the playhead, owner
 * 2026-10-19: a button on the end of the start flag–playhead pair read as acting on that range,
 * but adding a page only puts a flag at one beat). **Add page** puts a flag at the playhead, and
 * **Add subset page** adds the same page as a subset, so later pages keep their numbers. Each shows
 * the name the new page would get, muted. Without `onAddPage` (playing, on a flag, at home, past
 * the beats) there's no menu and `children` render as they are.
 */
export function AddPageFlagMenu({
    onAddPage,
    onAddSubsetPage,
    names,
    children,
}: {
    onAddPage?: () => void;
    onAddSubsetPage?: () => void;
    names?: { page: string; subset: string };
    children: ReactNode;
}) {
    if (!onAddPage) return <>{children}</>;
    return (
        <ContextMenu.Root>
            {/* A right-click on the playhead is its own, not the surface's range menu */}
            <ContextMenu.Trigger
                asChild
                onContextMenu={(event) => event.stopPropagation()}
            >
                {children}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Content
                    data-testid="timeline-add-page-flag-menu"
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    <ContextMenu.Item
                        data-testid="timeline-add-page"
                        onSelect={onAddPage}
                        className={ITEM_CLASS}
                    >
                        {tolgee.t("timeline.addPageFlag.page", "Add page")}
                        <MutedName name={names?.page} />
                    </ContextMenu.Item>
                    {onAddSubsetPage && (
                        <ContextMenu.Item
                            data-testid="timeline-add-subset-page"
                            onSelect={onAddSubsetPage}
                            className={ITEM_CLASS}
                        >
                            {tolgee.t(
                                "timeline.addPageFlag.subset",
                                "Add subset page",
                            )}
                            <MutedName name={names?.subset} />
                        </ContextMenu.Item>
                    )}
                </ContextMenu.Content>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

/** The new page's name, after the entry's words */
const MutedName = ({ name }: { name?: string }) =>
    name ? (
        <span
            data-testid="timeline-add-page-name"
            className="text-text-subtitle ml-auto pl-16 text-[11px]"
        >
            {name}
        </span>
    ) : null;
