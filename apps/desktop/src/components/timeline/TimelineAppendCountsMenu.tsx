import { type PointerEvent, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PlusIcon } from "@phosphor-icons/react";
import {
    KEEP_MENU_EVENTS,
    TIMELINE_MENU_CONTENT_CLASS,
} from "./TimelineRangeMenu";

/** The menu's one action: it reads as a button, as **+ N counts** does, and fills on hover */
const ACTION_CLASS =
    "border-accent text-accent rounded-4 data-[highlighted]:bg-accent data-[highlighted]:text-text-invert hover:bg-accent hover:text-text-invert flex cursor-pointer items-center gap-6 border px-8 py-5 text-[12px] font-medium outline-hidden transition-colors select-none";

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
 * page counts" setting (the same as in Workspace settings), typed, saved on Enter or when the menu
 * closes, the box losing focus to outside it included (Escape cancels, EC-16); and, when the music
 * runs on past the last page, pages every N counts to its end (EC-10). That action follows the box:
 * it reads and makes pages of the number typed there while it is a whole number (else the saved
 * one), and picking it saves that number too, as the menu closes.
 * Focus moving inside the menu never saves: a half-typed "1" on the way to "12" stays unsaved.
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
        readonly label: (counts: number) => string;
        readonly title: (counts: number) => string;
        readonly onAppend: (counts: number) => void;
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
    // What the to-the-end action reads and makes: the typed number, else the saved one
    const shown = parsed ?? counts;
    // Set by Escape, which closes without keeping what was typed
    const cancelled = useRef(false);
    // Every way the menu closes goes through here, once: it saves a whole number unless cancelled
    const closed = useRef(false);
    const close = () => {
        if (closed.current) return;
        closed.current = true;
        if (!cancelled.current && parsed !== null && parsed !== counts)
            onCountsChange(parsed);
        onClose();
    };
    // Radix menu items take the focus on hover; while the box is being typed in, they mustn't, or
    // the digits that follow would go to the menu's typeahead
    const keepTyping = (event: PointerEvent) => {
        if (document.activeElement === field.current) event.preventDefault();
    };
    return (
        <DropdownMenu.Root
            open
            modal={false}
            onOpenChange={(next) => {
                if (!next) close();
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
                    // Escape closes without keeping what was typed
                    onEscapeKeyDown={() => {
                        cancelled.current = true;
                    }}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    {toEnd && (
                        <>
                            <DropdownMenu.Item
                                data-testid="timeline-pages-to-end"
                                title={toEnd.title(shown)}
                                className={ACTION_CLASS}
                                onPointerMove={keepTyping}
                                onPointerLeave={keepTyping}
                                onSelect={() => toEnd.onAppend(shown)}
                            >
                                <PlusIcon size={12} weight="bold" />
                                {toEnd.label(shown)}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                        </>
                    )}
                    <form
                        className="flex items-center gap-6 px-8 py-4 text-[12px]"
                        onSubmit={(event) => {
                            event.preventDefault();
                            close();
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
                                // A click on the field doesn't reach the menu's outside-click
                                // check, but it takes the focus: leaving the menu closes (and
                                // saves); focus moving within the menu saves nothing
                                onBlur={(event) => {
                                    const next = event.relatedTarget;
                                    if (
                                        !(next instanceof Node) ||
                                        !content.current?.contains(next)
                                    )
                                        close();
                                }}
                                // The menu's typeahead would take the digits; Escape still closes
                                onKeyDown={(event) => {
                                    if (event.key !== "Escape")
                                        event.stopPropagation();
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
