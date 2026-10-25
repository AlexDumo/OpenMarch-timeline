import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
    Checkbox,
    Dialog,
    DialogContent,
    DialogTitle,
    Input,
} from "@openmarch/ui";
import type {
    SketchTemplate,
    TemplateDestination,
    TemplateSummary,
} from "../types";

/** A small popover menu that closes on an outside click or Escape */
export function Menu({
    open,
    onClose,
    children,
    className,
    testId,
}: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    testId?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const down = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) onClose();
        };
        const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        // Wait a frame, so the click that opened the menu doesn't close it
        const id = requestAnimationFrame(() => {
            window.addEventListener("pointerdown", down, true);
            window.addEventListener("keydown", key, true);
        });
        return () => {
            cancelAnimationFrame(id);
            window.removeEventListener("pointerdown", down, true);
            window.removeEventListener("keydown", key, true);
        };
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div
            ref={ref}
            role="menu"
            data-testid={testId}
            className={clsx(
                "border-stroke bg-modal backdrop-blur-32 rounded-6 shadow-modal text-text pointer-events-auto absolute z-50 flex min-w-[13rem] flex-col border p-4",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function MenuItem({
    children,
    onClick,
    shortcut,
    disabled,
    testId,
}: {
    children: ReactNode;
    onClick: () => void;
    shortcut?: string;
    disabled?: boolean;
    testId?: string;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            data-testid={testId}
            onClick={onClick}
            className="text-body rounded-4 enabled:hover:bg-text/10 flex h-30 items-center justify-between gap-16 px-10 text-left disabled:opacity-40"
        >
            <span className="truncate">{children}</span>
            {shortcut && (
                <span className="text-sub text-text-subtitle font-mono">
                    {shortcut}
                </span>
            )}
        </button>
    );
}

export const MenuSeparator = () => <div className="bg-stroke my-4 h-px" />;

export interface TemplateChoice {
    id: string;
    name: string;
    group: string;
    load: () => Promise<SketchTemplate>;
}

/** New sketch: Blank, the built-in templates and the store's (UX spec 3.1, 3.2) */
export function NewSketchDialog({
    open,
    onOpenChange,
    builtIns,
    templates,
    destinations,
    loadTemplate,
    onCreate,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    builtIns: SketchTemplate[];
    templates: TemplateSummary[];
    destinations: TemplateDestination[];
    loadTemplate: (id: string) => Promise<SketchTemplate>;
    onCreate: (template: SketchTemplate, name: string) => void;
}) {
    const [picked, setPicked] = useState<string>("builtin:blank");
    const [name, setName] = useState("");
    useEffect(() => {
        if (open) {
            setPicked("builtin:blank");
            setName("");
        }
    }, [open]);
    const groups: { label: string; items: { id: string; name: string }[] }[] = [
        {
            label: "Start from",
            items: builtIns.map((t) => ({ id: t.id, name: t.name })),
        },
        ...destinations.map((d) => ({
            label: d.label,
            items: templates
                .filter((t) => t.destination === d.id)
                .map((t) => ({ id: t.id, name: t.name })),
        })),
    ];
    const create = async () => {
        const builtIn = builtIns.find((t) => t.id === picked);
        const template = builtIn ?? (await loadTemplate(picked));
        onCreate(template, name.trim());
        onOpenChange(false);
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="w-[34rem] max-w-[90vw]"
                data-testid="new-sketch-dialog"
                onKeyDown={(e) => e.stopPropagation()}
            >
                <DialogTitle>New sketch</DialogTitle>
                <div className="flex flex-col gap-12 overflow-y-auto">
                    {groups.map((g) => (
                        <div key={g.label}>
                            <div className="text-sub text-text-subtitle mb-6">
                                {g.label}
                            </div>
                            {g.items.length === 0 ? (
                                <div className="border-stroke text-sub text-text-subtitle rounded-6 border border-dashed p-12">
                                    Save any sketch as a template from its ≡
                                    menu.
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-8">
                                    {g.items.map((t) => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            data-testid={`template-${t.id}`}
                                            onClick={() => setPicked(t.id)}
                                            onDoubleClick={() => {
                                                setPicked(t.id);
                                                void create();
                                            }}
                                            className={clsx(
                                                "rounded-6 text-body flex h-56 items-center justify-center border px-8 text-center",
                                                picked === t.id
                                                    ? "border-accent bg-accent/15 text-accent"
                                                    : "border-stroke hover:bg-text/10",
                                            )}
                                        >
                                            {t.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    <label className="flex flex-col gap-4">
                        <span className="text-sub text-text-subtitle">
                            Name (optional)
                        </span>
                        <Input
                            compact
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) =>
                                e.key === "Enter" && void create()
                            }
                            placeholder="Sketch name"
                            data-testid="new-sketch-name"
                        />
                    </label>
                    <div className="text-sub text-text-subtitle">
                        A template brings its pages and field style. The field
                        layout comes from your current field.
                    </div>
                </div>
                <div className="flex justify-end">
                    <button
                        type="button"
                        autoFocus
                        className="bg-accent text-text-invert rounded-6 h-32 px-16"
                        onClick={() => void create()}
                        data-testid="create-sketch"
                    >
                        Create sketch
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Save as template: a name and a destination the store offers (owner decision Q3) */
export function SaveTemplateDialog({
    open,
    onOpenChange,
    defaultName,
    destinations,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultName: string;
    destinations: TemplateDestination[];
    onSave: (opts: {
        name: string;
        destination: string;
        includeDrawing: boolean;
        includeFieldStyle: boolean;
    }) => Promise<void>;
}) {
    const [name, setName] = useState(defaultName);
    const [destination, setDestination] = useState(
        destinations[0]?.id ?? "show",
    );
    const [includeDrawing, setIncludeDrawing] = useState(true);
    const [includeFieldStyle, setIncludeFieldStyle] = useState(true);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open) {
            setName(defaultName);
            setDestination(destinations[0]?.id ?? "show");
        }
    }, [open, defaultName, destinations]);
    const save = async () => {
        setBusy(true);
        try {
            await onSave({
                name: name.trim() || defaultName,
                destination,
                includeDrawing,
                includeFieldStyle,
            });
            onOpenChange(false);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="w-[26rem] max-w-[90vw]"
                data-testid="save-template-dialog"
                onKeyDown={(e) => e.stopPropagation()}
            >
                <DialogTitle>Save as template</DialogTitle>
                <label className="flex flex-col gap-4">
                    <span className="text-sub text-text-subtitle">Name</span>
                    <Input
                        compact
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        data-testid="template-name"
                    />
                </label>
                {destinations.length > 1 && (
                    <div
                        className="flex flex-col gap-4"
                        role="radiogroup"
                        aria-label="Save to"
                    >
                        <span className="text-sub text-text-subtitle">
                            Save to
                        </span>
                        {destinations.map((d) => (
                            <label
                                key={d.id}
                                className="text-body flex items-center gap-8"
                            >
                                <input
                                    type="radio"
                                    name="template-destination"
                                    checked={destination === d.id}
                                    onChange={() => setDestination(d.id)}
                                />
                                {d.label}
                            </label>
                        ))}
                    </div>
                )}
                <label className="text-body flex items-center gap-8">
                    <Checkbox
                        checked={includeDrawing}
                        onCheckedChange={(v) => setIncludeDrawing(v === true)}
                    />
                    Include drawing
                </label>
                <label className="text-body flex items-center gap-8">
                    <Checkbox
                        checked={includeFieldStyle}
                        onCheckedChange={(v) =>
                            setIncludeFieldStyle(v === true)
                        }
                    />
                    Include field style
                </label>
                <div className="text-sub text-text-subtitle">
                    The field layout is never saved in a template.
                </div>
                <div className="flex justify-end">
                    <button
                        type="button"
                        disabled={busy}
                        className="bg-accent text-text-invert rounded-6 h-32 px-16 disabled:opacity-50"
                        onClick={() => void save()}
                        data-testid="save-template"
                    >
                        Save template
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
