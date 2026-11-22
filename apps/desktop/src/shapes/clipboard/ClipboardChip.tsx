import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { CaretUpIcon, WarningIcon } from "@phosphor-icons/react";
import ActionButton from "@/shortcuts/ActionButton";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import {
    actionDisabledReason,
    isActionEnabled,
    subscribeToActionHandlers,
} from "@/shortcuts/registry";
import { useShapeShown } from "../tool/shapeToolStore";
import {
    CHIP_VIEW,
    CLIPBOARD_BUTTON_CLASS,
    ClipboardCard,
    PicturePreview,
    useClipboardView,
    type ClipboardView,
} from "./ClipboardCard";
import type { PictureFit } from "./picture";
import {
    announceClipboard,
    useClipboardAnnouncementStore,
} from "./pictureStore";

/** How long the chip says "Copied" after a copy, in ms */
const COPIED_FOR = 1500;
/** How near a drag on the field comes before the chip fades out of its way, in CSS px */
const FADE_REACH = 48;

/**
 * What's copied, in the field's bottom-left corner (#961, owner 2026-11-22), across from the
 * zoom box: there only while something is copied. Folded, a chip: the picture as it will paste,
 * what it is and how many marchers, one line saying how it fits the selection (or why Paste
 * can't run), and Paste with its key. A press on the chip opens its card above it
 * (`ClipboardCard`); it always starts folded, so it never stays open over the field.
 *
 * - A copy says "Copied" on the chip's second line for a moment, with an accent ring: no toast.
 * - A live region, always there, has screen readers say each copy, clear and paste preview.
 * - A paste preview opening folds the card and takes the focus off it, so Enter places the
 *   paste and Escape discards it instead of reaching a button.
 * - A drag on the field near it fades it and lets the pointer through, so it never blocks a
 *   marquee or a marcher at the field's front edge.
 * - In the touch layout it's a `control` layer: the pill and the shape editor bar keep off it.
 */
export function ClipboardChip() {
    const view = useClipboardView();
    // Here, mounted while nothing is copied too, so the first copy flashes as well
    const copiedNow = useCopiedFlash(view?.picture ?? null);
    return (
        <>
            <ClipboardAnnouncer view={view} />
            {view && <ChipOrCard view={view} copiedNow={copiedNow} />}
        </>
    );
}

function ChipOrCard({
    view,
    copiedNow,
}: {
    view: ClipboardView;
    /** A copy was just made: the chip says so for a moment */
    copiedNow: boolean;
}) {
    const { t } = useTranslate();
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    const fold = useRef<HTMLButtonElement>(null);
    const faded = useFadeWhileDraggingNear(box);
    const shapeShown = useShapeShown();
    const pasteReason = useActionReason("pasteFormation");

    // A paste preview opening: folded, and the focus off the chip so Enter and Escape reach it
    useEffect(() => {
        if (!shapeShown) return;
        setOpen(false);
        const active = document.activeElement;
        if (active instanceof HTMLElement && box.current?.contains(active))
            active.blur();
    }, [shapeShown]);

    // Opened, the focus goes to the card's fold button; folded from the card, back to the chip
    const opened = useRef(false);
    useEffect(() => {
        if (open) fold.current?.focus();
        else if (
            opened.current &&
            box.current?.contains(document.activeElement)
        )
            toggle.current?.focus();
        opened.current = open;
    }, [open]);

    const status = chipStatus(t, view.fit, pasteReason, copiedNow);
    const countText = t("shapes.clipboard.marchers", {
        count: view.summary.count,
    });
    return (
        <div
            ref={box}
            data-testid="clipboard-chip"
            data-open={open || undefined}
            data-faded={faded || undefined}
            data-flash={copiedNow || undefined}
            // #927: the pill and the shape editor bar keep off it
            data-field-layer="control"
            className={twMerge(
                POPOVER_CLASS,
                "pointer-events-auto absolute bottom-6 left-6 z-10 p-4 motion-safe:transition-[opacity,box-shadow] motion-safe:duration-150",
                open && "p-12",
                copiedNow && "ring-accent ring-2",
                faded && "pointer-events-none opacity-20",
            )}
            onKeyDown={(e) => {
                // Escape inside the open card folds it, and goes no further (the field's
                // Escape would clear the selection)
                if (e.key === "Escape" && open) {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                }
            }}
        >
            {open ? (
                <ClipboardCard
                    view={view}
                    onFold={() => setOpen(false)}
                    foldRef={fold}
                />
            ) : (
                <div className="flex items-center gap-8 pr-4">
                    <button
                        ref={toggle}
                        type="button"
                        onClick={() => setOpen(true)}
                        aria-expanded={false}
                        aria-label={t("shapes.clipboard.chipLabel", {
                            name: view.name,
                            count: countText,
                            status: status.text,
                        })}
                        data-testid="clipboard-chip-toggle"
                        className="rounded-4 enabled:hover:bg-text/10 focus-visible:bg-text/10 touch:min-h-44 flex min-w-0 items-center gap-8 px-4 py-4 text-left outline-hidden"
                    >
                        <PicturePreview
                            picture={view.picture}
                            summary={view.summary}
                            count={view.drawnCount}
                            view={CHIP_VIEW}
                            testId="clipboard-chip-picture"
                        />
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate">
                                <span
                                    className="text-body font-medium"
                                    data-testid="clipboard-chip-kind"
                                >
                                    {view.name}
                                </span>
                                <span className="text-sub text-text-subtitle">
                                    {" · "}
                                    {countText}
                                </span>
                            </span>
                            <span
                                className={clsx(
                                    "text-sub flex max-w-224 items-center gap-4",
                                    status.tone === "copied"
                                        ? "text-accent"
                                        : "text-text-subtitle",
                                )}
                                data-testid="clipboard-chip-status"
                                data-status={status.kind}
                            >
                                {status.tone === "warning" && (
                                    <WarningIcon
                                        size={12}
                                        weight="fill"
                                        className="text-yellow shrink-0"
                                        aria-hidden
                                    />
                                )}
                                <span className="truncate" title={status.text}>
                                    {status.text}
                                </span>
                            </span>
                        </span>
                        <CaretUpIcon
                            size={14}
                            className="text-text-subtitle shrink-0"
                            aria-hidden
                        />
                    </button>
                    <ActionButton
                        action="pasteFormation"
                        data-testid="clipboard-chip-paste"
                        className={CLIPBOARD_BUTTON_CLASS}
                    >
                        {t("actions.edit.paste")}
                    </ActionButton>
                </div>
            )}
        </div>
    );
}

type ChipStatus = {
    kind: "copied" | "reason" | PictureFit["fit"];
    tone: "copied" | "warning" | "plain";
    text: string;
};

/**
 * The chip's second line: "Copied" for a moment after a copy, then how the copy fits the
 * selection, or why Paste can't run (nothing selected, a shape open), so the reason is there
 * without hovering
 */
function chipStatus(
    t: ReturnType<typeof useTranslate>["t"],
    fit: PictureFit,
    pasteReason: string | null,
    copiedNow: boolean,
): ChipStatus {
    if (copiedNow)
        return {
            kind: "copied",
            tone: "copied",
            text: t("shapes.clipboard.chipCopied"),
        };
    if (pasteReason)
        return { kind: "reason", tone: "plain", text: pasteReason };
    switch (fit.fit) {
        case "laidOut":
            return {
                kind: "laidOut",
                tone: "plain",
                text: t("shapes.clipboard.chipLaidOut", {
                    count: fit.selected,
                }),
            };
        case "exact":
            return {
                kind: "exact",
                tone: "plain",
                text: t("shapes.clipboard.chipExact", { count: fit.selected }),
            };
        case "emptySpots":
            return {
                kind: "emptySpots",
                tone: "warning",
                text: t("shapes.clipboard.chipEmptySpots", {
                    count: fit.empty,
                }),
            };
        case "leftOut":
            return {
                kind: "leftOut",
                tone: "warning",
                text: t("shapes.clipboard.chipLeftOut", { count: fit.left }),
            };
        case "none":
            return {
                kind: "none",
                tone: "plain",
                text: t("shapes.clipboard.reasonSelectToPaste"),
            };
    }
}

/** Why `action` can't run now, or null when it can (or gives no reason) */
function useActionReason(
    action: Parameters<typeof isActionEnabled>[0],
): string | null {
    return useSyncExternalStore(subscribeToActionHandlers, () =>
        isActionEnabled(action) ? null : (actionDisabledReason(action) ?? null),
    );
}

/** True for a moment after each new copy; not for the copy already there when it mounts */
function useCopiedFlash(picture: ClipboardView["picture"] | null): boolean {
    const [now, setNow] = useState(false);
    const last = useRef(picture);
    useEffect(() => {
        if (picture === last.current) return;
        last.current = picture;
        if (!picture) return setNow(false);
        setNow(true);
        const timer = setTimeout(() => setNow(false), COPIED_FOR);
        return () => clearTimeout(timer);
    }, [picture]);
    return now;
}

/**
 * True while a drag that started elsewhere (a marquee, a marcher dragged) comes within reach of
 * `box`: the chip fades and lets the pointer through until the button comes up
 */
function useFadeWhileDraggingNear(
    box: React.RefObject<HTMLDivElement | null>,
): boolean {
    const [faded, setFaded] = useState(false);
    useEffect(() => {
        let dragging = false;
        const down = (e: PointerEvent) => {
            const el = box.current;
            dragging = !(
                el &&
                e.target instanceof Node &&
                el.contains(e.target)
            );
        };
        const move = (e: PointerEvent) => {
            if (!dragging || e.buttons === 0) return;
            const r = box.current?.getBoundingClientRect();
            if (!r) return;
            const near =
                e.clientX > r.left - FADE_REACH &&
                e.clientX < r.right + FADE_REACH &&
                e.clientY > r.top - FADE_REACH &&
                e.clientY < r.bottom + FADE_REACH;
            if (near) setFaded(true);
        };
        const up = () => {
            dragging = false;
            setFaded(false);
        };
        window.addEventListener("pointerdown", down, true);
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
        return () => {
            window.removeEventListener("pointerdown", down, true);
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", up, true);
        };
    }, [box]);
    return faded;
}

/**
 * The live region screen readers hear the clipboard through: always mounted, so its first words
 * are announced too. Says each new copy and a clear itself; a paste preview's words come from
 * `pasteFormation`.
 */
function ClipboardAnnouncer({ view }: { view: ClipboardView | null }) {
    const { t } = useTranslate();
    const picture = view?.picture ?? null;
    const last = useRef(picture);
    useEffect(() => {
        if (picture === last.current) return;
        const had = last.current;
        last.current = picture;
        if (picture && view)
            announceClipboard(
                t("shapes.clipboard.announceCopied", {
                    name: view.name,
                    count: view.summary.count,
                }),
            );
        else if (had) announceClipboard(t("shapes.clipboard.announceCleared"));
        // Only a new picture speaks; the name changing with Paste as doesn't
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [picture]);
    const { text, n } = useClipboardAnnouncementStore();
    return (
        <span role="status" className="sr-only" data-testid="clipboard-live">
            {/* A new key per announcement, so the same words twice are said twice */}
            <span key={n}>{text}</span>
        </span>
    );
}
