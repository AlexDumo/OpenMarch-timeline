import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { FlagIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
} from "./TimelineRangeMenu";

/**
 * The right-click menu of **+** (ui.md UI-9): **Add subset page** adds the page the click would
 * add, as a subset, so later pages keep their numbers. Without `onAddSubsetPage`, **+** has no
 * menu and `children` render as they are.
 */
export function AddPageFlagMenu({
    onAddSubsetPage,
    children,
}: {
    onAddSubsetPage?: () => void;
    children: ReactNode;
}) {
    if (!onAddSubsetPage) return <>{children}</>;
    return (
        <ContextMenu.Root>
            {/* A right-click on **+** is its own, not the surface's range menu */}
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
                        data-testid="timeline-add-subset-page"
                        onSelect={onAddSubsetPage}
                        className="rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none"
                    >
                        <FlagIcon size={14} />
                        {tolgee.t(
                            "timeline.addPageFlag.subset",
                            "Add subset page",
                        )}
                    </ContextMenu.Item>
                </ContextMenu.Content>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}
