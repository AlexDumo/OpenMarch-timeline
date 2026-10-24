/**
 * The Sketches tab of the editor's left sidebar (ADR 0006, ux-spec §2.1 and §3): the show's
 * sketches, newest first, each with its thumbnail, name and time, and the templates in this show
 * and in the Library. Sketches open in the Sketchpad window; this panel never loads Excalidraw.
 *
 * Rename, duplicate and delete are outside the editor's undo history. Delete asks nothing and
 * offers Undo in a toast instead (ux-spec §3.5).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    DotsThreeIcon,
    PencilSimpleLineIcon,
    PlusIcon,
    XIcon,
} from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@openmarch/ui";
import { SidebarModalLauncher } from "@/components/sidebar/SidebarModal";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import {
    invalidateSketches,
    useSketchChanges,
    useSketches,
    useSketchTemplates,
} from "@/hooks/queries/useSketches";
import tolgee from "@/global/singletons/Tolgee";
import type {
    SketchListItem,
    SketchOpenRequest,
    SketchTemplateListItem,
} from "@/sketchpad/protocol";

export const SKETCHES_CONTENT_ID = "sketches";
/** How long the Undo toast after a delete stays (ux-spec §3.5) */
export const SKETCH_UNDO_TOAST_MS = 10_000;

export default function SketchesModal() {
    const { t } = useTranslate();
    return (
        <SidebarModalLauncher
            contents={<SketchesPanelContents />}
            newContentId={SKETCHES_CONTENT_ID}
            buttonLabel={<PencilSimpleLineIcon size={24} />}
            ariaLabel={t("sketches.title")}
            testId="sketches-tab"
        />
    );
}

/** Opens the Sketchpad window with a sketch, a new sketch or a template */
export function openSketchpad(request: SketchOpenRequest) {
    void window.electron.sketches.open(request);
}

/** "Edited 5 min ago", in the app's language */
export function editedAgo(updatedAt: number, now: number, language: string) {
    const seconds = Math.round((updatedAt - now) / 1000);
    const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
        ["second", 60],
        ["minute", 60],
        ["hour", 24],
        ["day", 30],
        ["month", 12],
    ];
    let value = seconds;
    for (const [unit, size] of steps) {
        if (Math.abs(value) < size)
            return unit === "second" && Math.abs(value) < 45
                ? format.format(0, "second")
                : format.format(value, unit);
        value = Math.round(value / size);
    }
    return format.format(value, "year");
}

const MENU_CLASS =
    "bg-modal text-text rounded-6 border-stroke shadow-modal z-50 flex min-w-[160px] flex-col gap-2 border p-4 backdrop-blur-md";
const MENU_ITEM_CLASS =
    "text-body rounded-4 data-[highlighted]:bg-fg-2 cursor-pointer px-8 py-4 outline-none";

export function SketchesPanelContents() {
    const { t } = useTranslate();
    const { setOpen } = useSidebarModalStore();
    const { data: sketches, isLoading } = useSketches();
    const { data: templates } = useSketchTemplates();
    useSketchChanges();

    return (
        <div
            className="animate-scale-in text-text flex h-full w-[24rem] flex-col gap-16"
            data-testid="sketches-panel"
        >
            <header className="flex items-center justify-between gap-16">
                <h4 className="text-h4 leading-none">
                    <T keyName="sketches.title" />
                </h4>
                <div className="flex items-center gap-12">
                    <NewSketchButton />
                    <button
                        onClick={() => setOpen(false)}
                        className="hover:text-red duration-150 ease-out"
                        aria-label={t("sketches.close")}
                    >
                        <XIcon size={24} />
                    </button>
                </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto">
                {!isLoading && sketches?.length === 0 ? (
                    <EmptyState />
                ) : (
                    <ul
                        className="flex flex-col gap-8"
                        data-testid="sketch-list"
                    >
                        {sketches?.map((s) => (
                            <SketchCard key={s.id} sketch={s} />
                        ))}
                    </ul>
                )}
                <TemplatesSection templates={templates ?? []} />
            </div>
        </div>
    );
}

function NewSketchButton() {
    const { t } = useTranslate();
    return (
        <Button
            size="compact"
            data-testid="sketches-new"
            tooltipText={t("sketches.newTooltip")}
            onClick={(event) =>
                // Alt+click skips the dialog (ux-spec §3.1)
                openSketchpad({ kind: "new", blank: event.altKey })
            }
        >
            <PlusIcon size={14} />
            <T keyName="sketches.new" />
        </Button>
    );
}

function EmptyState() {
    return (
        <div
            className="border-stroke rounded-6 flex flex-col items-center gap-8 border border-dashed p-24 text-center"
            data-testid="sketches-empty"
        >
            <PencilSimpleLineIcon size={32} className="text-text-subtitle" />
            <p className="text-body font-medium">
                <T keyName="sketches.empty.title" />
            </p>
            <p className="text-sub text-text-subtitle">
                <T keyName="sketches.empty.body" />
            </p>
            <Button
                size="compact"
                variant="secondary"
                onClick={() => openSketchpad({ kind: "new" })}
            >
                <T keyName="sketches.new" />
            </Button>
        </div>
    );
}

/** A thumbnail PNG from main, as an object URL while it shows */
function Thumbnail({
    bytes,
    name,
}: {
    bytes: Uint8Array | null;
    name: string;
}) {
    const url = useMemo(
        () =>
            bytes
                ? URL.createObjectURL(
                      new Blob([bytes as Uint8Array<ArrayBuffer>], {
                          type: "image/png",
                      }),
                  )
                : null,
        [bytes],
    );
    useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
    return (
        <div className="bg-fg-2 rounded-4 border-stroke flex h-[54px] w-[96px] shrink-0 items-center justify-center overflow-hidden border">
            {url ? (
                <img
                    src={url}
                    alt={name}
                    className="size-full object-contain"
                    data-testid="sketch-thumbnail"
                    draggable={false}
                />
            ) : (
                <PencilSimpleLineIcon
                    size={20}
                    className="text-text-subtitle"
                />
            )}
        </div>
    );
}

/** Shows "Deleted …" with Undo for 10 s after `remove` resolves with something to restore */
function useUndoToast() {
    const { t } = useTranslate();
    const qc = useQueryClient();
    return async <R,>(
        name: string,
        remove: () => Promise<R | null>,
        restore: (removed: R) => Promise<unknown>,
    ) => {
        const removed = await remove();
        await invalidateSketches(qc);
        if (!removed) return;
        toast(t("sketches.deleted", { name }), {
            duration: SKETCH_UNDO_TOAST_MS,
            action: {
                label: t("sketches.undo"),
                onClick: () =>
                    void restore(removed).then(() => invalidateSketches(qc)),
            },
        });
    };
}

interface CardAction {
    label: ReactNode;
    onSelect: () => void;
    testId: string;
    danger?: boolean;
}

/**
 * A sketch or template in the panel: thumbnail, name (double-click or Rename to edit it in
 * place) and a line under it, with a ⋯ menu
 */
function ItemCard({
    id,
    name,
    thumbnail,
    detail,
    onOpen,
    onRename,
    actions,
    testId,
    openLabel,
}: {
    id: string;
    name: string;
    thumbnail: Uint8Array | null;
    detail: ReactNode;
    onOpen: () => void;
    onRename: (name: string) => Promise<unknown>;
    actions: (startRename: () => void) => CardAction[];
    testId: string;
    openLabel: string;
}) {
    const { t } = useTranslate();
    const qc = useQueryClient();
    const [renaming, setRenaming] = useState(false);

    const rename = async (next: string) => {
        setRenaming(false);
        const trimmed = next.trim();
        if (!trimmed || trimmed === name) return;
        await onRename(trimmed);
        await invalidateSketches(qc);
    };

    return (
        <li
            className="hover:bg-fg-2 rounded-6 group flex items-center gap-12 p-4"
            data-testid={testId}
            data-sketch-id={id}
        >
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-12 text-left"
                onClick={() => !renaming && onOpen()}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    setRenaming(true);
                }}
                aria-label={openLabel}
            >
                <Thumbnail bytes={thumbnail} name={name} />
                <span className="flex min-w-0 flex-col gap-2">
                    {renaming ? (
                        <RenameInput
                            initial={name}
                            onDone={(next) => void rename(next)}
                            onCancel={() => setRenaming(false)}
                        />
                    ) : (
                        <span
                            className="text-body truncate"
                            data-testid="sketch-name"
                        >
                            {name}
                        </span>
                    )}
                    <span className="text-sub text-text-subtitle truncate">
                        {detail}
                    </span>
                </span>
            </button>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                    <button
                        type="button"
                        className="rounded-4 hover:bg-fg-1 text-text-subtitle hover:text-text flex size-24 shrink-0 items-center justify-center"
                        aria-label={t("sketches.menu", { name })}
                        data-testid="sketch-menu"
                    >
                        <DotsThreeIcon size={18} weight="bold" />
                    </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        align="end"
                        sideOffset={4}
                        className={MENU_CLASS}
                    >
                        {actions(() => setRenaming(true)).map((a) => (
                            <DropdownMenu.Item
                                key={a.testId}
                                className={
                                    a.danger
                                        ? `${MENU_ITEM_CLASS} text-red`
                                        : MENU_ITEM_CLASS
                                }
                                data-testid={a.testId}
                                onSelect={a.onSelect}
                            >
                                {a.label}
                            </DropdownMenu.Item>
                        ))}
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
        </li>
    );
}

function SketchCard({ sketch }: { sketch: SketchListItem }) {
    const { t } = useTranslate();
    const qc = useQueryClient();
    const undoable = useUndoToast();
    const api = window.electron.sketches;
    const open = () => openSketchpad({ kind: "sketch", id: sketch.id });
    return (
        <ItemCard
            id={sketch.id}
            name={sketch.name}
            thumbnail={sketch.thumbnail}
            testId="sketch-card"
            openLabel={t("sketches.open", { name: sketch.name })}
            detail={t("sketches.edited", {
                when: editedAgo(
                    sketch.updatedAt,
                    Date.now(),
                    tolgee.getLanguage() ?? "en",
                ),
            })}
            onOpen={open}
            onRename={(name) => api.rename(sketch.id, name)}
            actions={(startRename) => [
                {
                    label: <T keyName="sketches.action.open" />,
                    onSelect: open,
                    testId: "sketch-open",
                },
                {
                    label: <T keyName="sketches.action.rename" />,
                    onSelect: startRename,
                    testId: "sketch-rename",
                },
                {
                    label: <T keyName="sketches.action.duplicate" />,
                    onSelect: () =>
                        void api
                            .duplicate(sketch.id)
                            .then(() => invalidateSketches(qc)),
                    testId: "sketch-duplicate",
                },
                {
                    label: <T keyName="sketches.action.delete" />,
                    onSelect: () =>
                        void undoable(
                            sketch.name,
                            () => api.remove(sketch.id),
                            (removed) => api.restore(removed),
                        ),
                    testId: "sketch-delete",
                    danger: true,
                },
            ]}
        />
    );
}

function RenameInput({
    initial,
    onDone,
    onCancel,
}: {
    initial: string;
    onDone: (name: string) => void;
    onCancel: () => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const cancelled = useRef(false);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    return (
        <input
            ref={ref}
            defaultValue={initial}
            className="text-body bg-fg-1 border-stroke rounded-4 w-full border px-4"
            data-testid="sketch-name-input"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") ref.current?.blur();
                if (e.key === "Escape") {
                    cancelled.current = true;
                    onCancel();
                }
            }}
            onBlur={(e) => {
                if (!cancelled.current) onDone(e.currentTarget.value);
            }}
        />
    );
}

function TemplateCard({ template }: { template: SketchTemplateListItem }) {
    const { t } = useTranslate();
    const qc = useQueryClient();
    const undoable = useUndoToast();
    const api = window.electron.sketches;
    const ref = { id: template.id, destination: template.destination };
    const other = template.destination === "show" ? "library" : "show";
    return (
        <ItemCard
            id={template.id}
            name={template.name}
            thumbnail={template.thumbnail}
            testId="sketch-template"
            openLabel={t("sketches.templates.use", { name: template.name })}
            detail={
                <T
                    keyName={
                        template.destination === "show"
                            ? "sketches.templates.show"
                            : "sketches.templates.library"
                    }
                />
            }
            // The card makes a new sketch from the template; Edit changes the template
            onOpen={() => openSketchpad({ kind: "template", template: ref })}
            onRename={(name) =>
                api.renameTemplate(template.id, template.destination, name)
            }
            actions={(startRename) => [
                {
                    label: <T keyName="sketches.templates.action.edit" />,
                    onSelect: () =>
                        openSketchpad({ kind: "edit-template", template: ref }),
                    testId: "template-edit",
                },
                {
                    label: <T keyName="sketches.templates.action.newSketch" />,
                    onSelect: () =>
                        openSketchpad({ kind: "template", template: ref }),
                    testId: "template-new-sketch",
                },
                {
                    label: <T keyName="sketches.action.rename" />,
                    onSelect: startRename,
                    testId: "template-rename",
                },
                {
                    label: <T keyName="sketches.action.duplicate" />,
                    onSelect: () =>
                        void api
                            .duplicateTemplate(
                                template.id,
                                template.destination,
                            )
                            .then(() => invalidateSketches(qc)),
                    testId: "template-duplicate",
                },
                {
                    label: (
                        <T
                            keyName={
                                other === "library"
                                    ? "sketches.templates.action.copyToLibrary"
                                    : "sketches.templates.action.copyToShow"
                            }
                        />
                    ),
                    onSelect: () =>
                        void api
                            .copyTemplate(
                                template.id,
                                template.destination,
                                other,
                            )
                            .then(() => invalidateSketches(qc)),
                    testId: "template-copy",
                },
                {
                    label: <T keyName="sketches.action.delete" />,
                    onSelect: () =>
                        void undoable(
                            template.name,
                            () =>
                                api.removeTemplate(
                                    template.id,
                                    template.destination,
                                ),
                            (removed) => api.restoreTemplate(removed),
                        ),
                    testId: "template-delete",
                    danger: true,
                },
            ]}
        />
    );
}

function TemplatesSection({
    templates,
}: {
    templates: SketchTemplateListItem[];
}) {
    const [open, setOpen] = useState(true);
    return (
        <section className="flex flex-col gap-8" data-testid="sketch-templates">
            <button
                type="button"
                className="text-sub text-text-subtitle hover:text-text flex items-center gap-4 text-left font-medium tracking-wide uppercase"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
            >
                <T keyName="sketches.templates.title" />
            </button>
            {open &&
                (templates.length === 0 ? (
                    <p className="text-sub text-text-subtitle">
                        <T keyName="sketches.templates.empty" />
                    </p>
                ) : (
                    <ul className="flex flex-col gap-8">
                        {templates.map((template) => (
                            <TemplateCard
                                key={`${template.destination}:${template.id}`}
                                template={template}
                            />
                        ))}
                    </ul>
                ))}
        </section>
    );
}
