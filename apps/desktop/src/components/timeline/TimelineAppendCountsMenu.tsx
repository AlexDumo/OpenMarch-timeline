import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PlusIcon } from "@phosphor-icons/react";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
} from "./TimelineRangeMenu";

/** The menu's one action: it reads as a button, as **+ N counts** does, and fills on hover */
const ACTION_CLASS =
    "border-accent text-accent rounded-4 data-[highlighted]:bg-accent data-[highlighted]:text-text-invert flex cursor-pointer items-center gap-6 border px-8 py-5 text-[12px] font-medium outline-hidden transition-colors select-none";

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
 * The right-click menu on **+ N counts**: how many counts a new page gets, the file's "Default new
 * page counts" setting (the same as in Workspace settings), typed, saved on Enter or when the box
 * loses focus (Escape cancels, EC-16); and, when the music runs on past the last page, pages every
 * N counts to its end (EC-10).
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
    const field = useRef<HTMLInputElement>(null);
    const content = useRef<HTMLDivElement>(null);
    // Typing is the point: the box has focus, its number selected, once the menu has placed it
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            field.current?.focus();
            field.current?.select();
        });
        return () => cancelAnimationFrame(frame);
    }, []);
    const parsed = parsePageCounts(typed);
    // Escape closes without keeping what was typed; the blur that follows mustn't save it
    const cancelled = useRef(false);
    const save = () => {
        if (cancelled.current || parsed === null || parsed === counts) return;
        onCountsChange(parsed);
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
                    ref={content}
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
                                className={ACTION_CLASS}
                                onSelect={toEnd.onAppend}
                            >
                                <PlusIcon size={12} weight="bold" />
                                {toEnd.label}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                        </>
                    )}
                    <form
                        className="flex items-center gap-6 px-8 py-4 text-[12px]"
                        onSubmit={(event) => {
                            event.preventDefault();
                            save();
                            cancelled.current = true;
                            onClose();
                        }}
                    >
                        <label className="flex items-center gap-6">
                            New pages
                            <input
                                ref={field}
                                aria-label="Counts for new pages"
                                inputMode="numeric"
                                value={typed}
                                onChange={(event) =>
                                    setTyped(event.target.value)
                                }
                                // Enter, or leaving the box, saves a whole number
                                onBlur={(event) => {
                                    save();
                                    // A click on the field doesn't reach the menu's outside-click
                                    // check, but it takes the focus: leaving the menu closes it
                                    const next = event.relatedTarget;
                                    if (
                                        !(next instanceof Node) ||
                                        !content.current?.contains(next)
                                    ) {
                                        cancelled.current = true;
                                        onClose();
                                    }
                                }}
                                // The menu's typeahead would take the digits; Escape still closes
                                onKeyDown={(event) => {
                                    if (event.key === "Escape")
                                        cancelled.current = true;
                                    else event.stopPropagation();
                                }}
                                className="border-stroke bg-bg-1 text-text rounded-4 focus-visible:border-accent h-22 w-48 border px-4 font-mono outline-hidden"
                            />
                            counts
                        </label>
                    </form>
                    <p className="text-text-subtitle px-8 pb-2 text-[11px]">
                        Pages already made keep their length.
                    </p>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
