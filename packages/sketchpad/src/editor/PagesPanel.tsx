import { useState } from "react";
import clsx from "clsx";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    PlusIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import type { SketchPage } from "../types";
import { Panel, PanelButton } from "./ui";

/** The FigJam-like page list: click to switch, double-click to rename, drag to reorder */
export function PagesPanel({
    pages,
    activeId,
    onSelect,
    onAdd,
    onRename,
    onMove,
    onDelete,
}: {
    pages: readonly Pick<SketchPage, "id" | "name">[];
    activeId: string;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onRename: (id: string, name: string) => void;
    /** Moves a page to an index */
    onMove: (id: string, to: number) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<number | null>(null);
    return (
        <Panel
            label="Pages"
            testId="sketch-pages"
            className="flex w-[16.5rem] flex-col p-8"
        >
            <div className="flex items-center justify-between px-6 pb-4">
                <span className="text-sub text-text-subtitle">Pages</span>
                <PanelButton
                    label="Add page"
                    onClick={onAdd}
                    testId="add-page"
                    className="h-24 min-w-24"
                >
                    <PlusIcon size={14} />
                </PanelButton>
            </div>
            <ol className="flex max-h-[9.5rem] flex-col gap-1 overflow-y-auto">
                {pages.map((page, index) => {
                    const active = page.id === activeId;
                    return (
                        <li
                            key={page.id}
                            draggable={editing !== page.id}
                            onDragStart={(e) => {
                                setDragging(page.id);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData(
                                    "text/x-om-page",
                                    page.id,
                                );
                            }}
                            onDragOver={(e) => {
                                if (!dragging) return;
                                e.preventDefault();
                                setOver(index);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (dragging) onMove(dragging, index);
                                setDragging(null);
                                setOver(null);
                            }}
                            onDragEnd={() => {
                                setDragging(null);
                                setOver(null);
                            }}
                            className={clsx(
                                "group rounded-4 flex h-28 items-center gap-4 pr-2 pl-8",
                                active
                                    ? "bg-accent/20 text-accent"
                                    : "hover:bg-text/10",
                                over === index &&
                                    dragging &&
                                    dragging !== page.id &&
                                    "ring-accent ring-1",
                            )}
                            data-testid="page-item"
                            data-active={active}
                        >
                            {editing === page.id ? (
                                <input
                                    autoFocus
                                    defaultValue={page.name}
                                    aria-label="Page name"
                                    className="text-body text-text min-w-0 flex-1 bg-transparent outline-none"
                                    onBlur={(e) => {
                                        onRename(
                                            page.id,
                                            e.target.value.trim() || page.name,
                                        );
                                        setEditing(null);
                                    }}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter")
                                            (
                                                e.target as HTMLInputElement
                                            ).blur();
                                        if (e.key === "Escape")
                                            setEditing(null);
                                    }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="text-body min-w-0 flex-1 truncate text-left"
                                    onClick={() => onSelect(page.id)}
                                    onDoubleClick={() => setEditing(page.id)}
                                    title="Click to open, double-click to rename, drag to reorder"
                                >
                                    {page.name}
                                </button>
                            )}
                            <span className="hidden items-center group-hover:flex">
                                <PanelButton
                                    label={`Move ${page.name} up`}
                                    disabled={index === 0}
                                    onClick={() => onMove(page.id, index - 1)}
                                    className="h-22 min-w-22 px-2"
                                >
                                    <ArrowUpIcon size={12} />
                                </PanelButton>
                                <PanelButton
                                    label={`Move ${page.name} down`}
                                    disabled={index === pages.length - 1}
                                    onClick={() => onMove(page.id, index + 1)}
                                    className="h-22 min-w-22 px-2"
                                >
                                    <ArrowDownIcon size={12} />
                                </PanelButton>
                                <PanelButton
                                    label={`Delete ${page.name}`}
                                    disabled={pages.length === 1}
                                    onClick={() => onDelete(page.id)}
                                    className="h-22 min-w-22 px-2"
                                    testId="delete-page"
                                >
                                    <TrashIcon size={12} />
                                </PanelButton>
                            </span>
                        </li>
                    );
                })}
            </ol>
        </Panel>
    );
}
