import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CheckIcon } from "@phosphor-icons/react";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
} from "./TimelineRangeMenu";

const ITEM_CLASS =
    "rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center gap-8 px-8 py-6 text-[12px] outline-hidden select-none";

/** The page lengths the menu offers; any other is typed */
export const APPEND_COUNTS_PRESETS = [4, 8, 12, 16, 24, 32] as const;

/** The most counts a new page can default to */
export const MAX_DEFAULT_PAGE_COUNTS = 999;

/** A typed page length as a whole number of counts, or null when it isn't one */
export const parsePageCounts = (text: string): number | null => {
    const value = Number(text.trim());
    return Number.isInteger(value) &&
        value >= 1 &&
        value <= MAX_DEFAULT_PAGE_COUNTS
        ? value
        : null;
};

/**
 * The right-click menu on **+ N counts** (E1): how many counts a new page gets, the file's "Default
 * new page counts" setting (the same as in Workspace settings), a preset or a typed number and
 * Enter; and, when the music runs on past the last page, pages every N counts to its end (FB-7).
 * Opens where the pill was right-clicked.
 */
export function TimelineAppendCountsMenu({
    at,
    counts,
    onCountsChange,
    toEnd,
    onClose,
}: {
    /** The right-click's viewport point */
    at: { readonly x: number; readonly y: number };
    counts: number;
    onCountsChange: (counts: number) => void;
    /** "Create pages every 16 counts to the end", when the music runs on past the last page */
    toEnd?: {
        readonly label: string;
        readonly title: string;
        readonly onAppend: () => void;
    };
    onClose: () => void;
}) {
    const [typed, setTyped] = useState(String(counts));
    const parsed = parsePageCounts(typed);
    const choose = (next: number) => {
        if (next !== counts) onCountsChange(next);
        onClose();
    };
    return (
        <DropdownMenu.Root
            open
            modal={false}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DropdownMenu.Trigger asChild>
                <span
                    aria-hidden="true"
                    className="pointer-events-none fixed size-0"
                    style={{ left: at.x, top: at.y }}
                />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-testid="timeline-append-counts-menu"
                    align="start"
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    {toEnd && (
                        <>
                            <DropdownMenu.Item
                                data-testid="timeline-pages-to-end"
                                title={toEnd.title}
                                className={ITEM_CLASS}
                                onSelect={toEnd.onAppend}
                            >
                                {toEnd.label}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                        </>
                    )}
                    <DropdownMenu.Label className="text-text-subtitle px-8 pt-2 text-[11px]">
                        New pages get
                    </DropdownMenu.Label>
                    {APPEND_COUNTS_PRESETS.map((preset) => (
                        <DropdownMenu.Item
                            key={preset}
                            className={ITEM_CLASS}
                            onSelect={() => choose(preset)}
                        >
                            <span className="flex w-14 justify-center">
                                {preset === counts && (
                                    <CheckIcon size={12} weight="bold" />
                                )}
                            </span>
                            {preset} counts
                        </DropdownMenu.Item>
                    ))}
                    <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                    <form
                        className="flex items-center gap-6 px-8 py-4 text-[12px]"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (parsed !== null) choose(parsed);
                        }}
                    >
                        <label className="flex items-center gap-6">
                            Other
                            <input
                                aria-label="Counts for new pages"
                                inputMode="numeric"
                                value={typed}
                                onChange={(event) =>
                                    setTyped(event.target.value)
                                }
                                // The menu's typeahead would take the digits
                                onKeyDown={(event) => event.stopPropagation()}
                                className="border-stroke bg-bg-1 text-text rounded-4 focus-visible:border-accent h-22 w-48 border px-4 font-mono outline-hidden"
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={parsed === null}
                            className="text-accent rounded-4 hover:bg-fg-2 px-4 py-1 font-medium disabled:opacity-40"
                        >
                            Set
                        </button>
                    </form>
                    <p className="text-text-subtitle max-w-[200px] px-8 pb-2 text-[11px]">
                        Also in Workspace settings. Pages already made keep
                        their length.
                    </p>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
