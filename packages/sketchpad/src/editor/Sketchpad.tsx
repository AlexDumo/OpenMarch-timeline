import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import clsx from "clsx";
import { FolderOpenIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { FieldProperties } from "@openmarch/core";
import {
    docForTemplateEdit,
    docFromTemplate,
    nextSketchName,
} from "../doc/sketchDoc";
import type { SnapMode } from "../drill/snap";
import { registerOmFillers } from "../fills/roughFiller";
import type {
    FieldPropertiesJson,
    SketchDoc,
    SketchStore,
    SketchSummary,
    SketchTemplate,
    TemplateSummary,
} from "../types";
import { builtInTemplates } from "./builtInTemplates";
import { Menu, MenuItem, NewSketchDialog } from "./dialogs";
import {
    SketchTab,
    type SaveStatus,
    type SketchMenuItem,
    type SketchTabHandle,
} from "./SketchTab";

registerOmFillers();

declare global {
    interface Window {
        EXCALIDRAW_ASSET_PATH?: string | string[];
    }
}

/**
 * Where Excalidraw loads its fonts from: a URL (or path) whose `fonts/` folder holds the package's
 * `dist/fonts`. Hosts must set it, so nothing is fetched from a CDN (ADR 0006 D-1).
 */
export function setSketchpadAssetPath(path: string) {
    window.EXCALIDRAW_ASSET_PATH = path.endsWith("/") ? path : `${path}/`;
}

export interface SketchpadHandle {
    /** Saves every open sketch that changed (hosts call this when the show saves or closes) */
    flush(): Promise<void>;
    /** Opens a stored sketch in a tab, or focuses its tab */
    open(id: string): Promise<void>;
    /** Opens a sketch the host loaded itself (a `.omsketch` file), saving it to the store */
    openDoc(doc: SketchDoc): Promise<void>;
    /**
     * Shows the New sketch dialog; with `blank`, makes a blank sketch without asking, and with
     * `templateId`, makes one from that template (an id from `store.templates.list()`)
     */
    newSketch(options?: { blank?: boolean; templateId?: string }): void;
    /** Renames an open sketch's tab after the host renamed the sketch itself */
    rename(id: string, name: string): void;
    /** Closes a sketch's tab without saving it (the host deleted the sketch) */
    discard(id: string): void;
    /**
     * Opens a template in a tab to edit it, or focuses its tab (`key` is its id from
     * `store.templates.list()`). It's drawn on `initialField` and saves back to the template.
     */
    editTemplate(key: string): Promise<void>;
    /** The active tab's sketch as it is now */
    activeDoc(): SketchDoc | null;
}

export interface SketchpadProps {
    store: SketchStore;
    /** The host's current field; new sketches copy it (ADR 0006 D-3) */
    initialField: FieldPropertiesJson;
    /** See `setSketchpadAssetPath` */
    assetPath: string;
    /** Sketches to open first; with none, the most recent opens, or a new blank one */
    initialOpenIds?: string[];
    /**
     * With false, only `initialOpenIds` open at the start: nothing else opens or is created when
     * none of them can be (for a host that asks for a new sketch right away)
     */
    autoOpen?: boolean;
    /** The show's name, for export file names */
    hostName?: string;
    theme?: "dark" | "light";
    /** Extra entries for the ≡ menu, such as "Save as .omsketch file" */
    menuItems?: SketchMenuItem[];
    /** Receives exported files; the default downloads them */
    onExportFile?: (blob: Blob, filename: string) => void;
    /** The open sketches changed (for hosts that remember them) */
    onOpenChange?: (ids: string[], activeId: string | null) => void;
    className?: string;
}

export function downloadBlob(blob: Blob, filename: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

interface Tab {
    doc: SketchDoc;
    isNew: boolean;
    /** Set for a tab that edits a template */
    templateKey?: string;
}

/**
 * The Sketchpad: a tab per open sketch, each with FigJam-like pages over its field. Every tab and
 * page keeps its Excalidraw instance mounted, so its undo history survives switching (owner
 * decisions Q2, Q5).
 */
export const Sketchpad = forwardRef<SketchpadHandle, SketchpadProps>(
    function Sketchpad(
        {
            store,
            initialField,
            assetPath,
            initialOpenIds,
            autoOpen = true,
            hostName,
            theme = "dark",
            menuItems,
            onExportFile = downloadBlob,
            onOpenChange,
            className,
        },
        ref,
    ) {
        useState(() => setSketchpadAssetPath(assetPath));
        const [tabs, setTabs] = useState<Tab[]>([]);
        const [activeId, setActiveId] = useState<string | null>(null);
        const [meta, setMeta] = useState<
            Record<string, { name: string; status: SaveStatus }>
        >({});
        const [snapMode, setSnapMode] = useState<SnapMode>("off");
        const [newOpen, setNewOpen] = useState(false);
        const [openMenu, setOpenMenu] = useState(false);
        const [summaries, setSummaries] = useState<SketchSummary[]>([]);
        const [templates, setTemplates] = useState<TemplateSummary[]>([]);
        const handles = useRef(new Map<string, SketchTabHandle>());
        const tabsRef = useRef(tabs);
        tabsRef.current = tabs;

        const fieldProperties = useMemo(
            () => new FieldProperties(initialField),
            [initialField],
        );
        const builtIns = useMemo(
            () => builtInTemplates(fieldProperties),
            [fieldProperties],
        );

        const flush = useCallback(async () => {
            await Promise.all(
                [...handles.current.values()].map((h) => h.flush()),
            );
        }, []);

        const addTab = useCallback(
            (doc: SketchDoc, isNew: boolean, templateKey?: string) => {
                setTabs((t) =>
                    t.some((x) => x.doc.id === doc.id)
                        ? t
                        : [...t, { doc, isNew, templateKey }],
                );
                setActiveId(doc.id);
            },
            [],
        );

        const open = useCallback(
            async (id: string) => {
                if (tabsRef.current.some((t) => t.doc.id === id)) {
                    setActiveId(id);
                    return;
                }
                addTab(await store.load(id), false);
            },
            [store, addTab],
        );

        const createFrom = useCallback(
            async (template: SketchTemplate, name: string) => {
                const existing = (await store.list()).map((s) => s.name);
                const fallback =
                    template.id === "builtin:blank"
                        ? nextSketchName(existing)
                        : nextSketchName(existing, template.name);
                addTab(
                    docFromTemplate(template, initialField, name || fallback),
                    true,
                );
            },
            [store, initialField, addTab],
        );

        const openDoc = useCallback(
            async (doc: SketchDoc) => {
                await store.save(doc, { pages: [], thumbnail: null });
                const existing = tabsRef.current.find(
                    (t) => t.doc.id === doc.id,
                );
                if (existing) {
                    // Reopen it from the file
                    setTabs((t) => t.filter((x) => x.doc.id !== doc.id));
                    handles.current.delete(doc.id);
                    await new Promise((r) => setTimeout(r, 0));
                }
                addTab(doc, true);
            },
            [store, addTab],
        );

        const showNew = useCallback(() => {
            void store.templates
                .list()
                .then(setTemplates, () => setTemplates([]));
            setNewOpen(true);
        }, [store]);

        const newSketch = useCallback(
            (options?: { blank?: boolean; templateId?: string }) => {
                if (options?.templateId) {
                    const id = options.templateId;
                    const builtIn = builtIns.find((t) => t.id === id);
                    void (
                        builtIn
                            ? Promise.resolve(builtIn)
                            : store.templates.load(id)
                    )
                        .then((template) => createFrom(template, ""))
                        .catch((error: unknown) =>
                            console.error("Couldn't use the template", error),
                        );
                } else if (options?.blank) void createFrom(builtIns[0]!, "");
                else showNew();
            },
            [builtIns, store, createFrom, showNew],
        );

        const editTemplate = useCallback(
            async (key: string) => {
                const template = await store.templates.load(key);
                if (tabsRef.current.some((t) => t.doc.id === template.id)) {
                    setActiveId(template.id);
                    return;
                }
                addTab(docForTemplateEdit(template, initialField), false, key);
            },
            [store, initialField, addTab],
        );

        const discard = useCallback((id: string) => {
            handles.current.delete(id);
            setTabs((t) => {
                const index = t.findIndex((x) => x.doc.id === id);
                if (index < 0) return t;
                const rest = t.filter((x) => x.doc.id !== id);
                setActiveId((active) =>
                    active === id
                        ? (rest[Math.max(0, index - 1)]?.doc.id ?? null)
                        : active,
                );
                return rest;
            });
        }, []);

        useImperativeHandle(
            ref,
            () => ({
                flush,
                open,
                openDoc,
                newSketch,
                rename: (id: string, name: string) =>
                    handles.current.get(id)?.rename(name),
                discard,
                editTemplate,
                activeDoc: () =>
                    activeId
                        ? (handles.current.get(activeId)?.getDoc() ?? null)
                        : null,
            }),
            [flush, open, openDoc, newSketch, discard, editTemplate, activeId],
        );

        // Open something right away: paper first (UX spec principle 1)
        const started = useRef(false);
        useEffect(() => {
            if (started.current) return;
            started.current = true;
            void (async () => {
                const ids = initialOpenIds ?? [];
                let opened = 0;
                for (const id of ids) {
                    try {
                        await open(id);
                        opened++;
                    } catch {
                        // A sketch removed since; skip it
                    }
                }
                if (opened > 0 || !autoOpen) return;
                const list = await store.list();
                const recent = [...list].sort(
                    (a, b) => b.updatedAt - a.updatedAt,
                )[0];
                if (recent) await open(recent.id);
                else await createFrom(builtIns[0]!, "");
            })();
        }, [initialOpenIds, autoOpen, open, store, createFrom, builtIns]);

        // Save on blur and when the page hides (ADR 0006 D-4)
        useEffect(() => {
            const save = () => void flush();
            const hidden = () =>
                document.visibilityState === "hidden" && save();
            window.addEventListener("blur", save);
            window.addEventListener("pagehide", save);
            document.addEventListener("visibilitychange", hidden);
            return () => {
                window.removeEventListener("blur", save);
                window.removeEventListener("pagehide", save);
                document.removeEventListener("visibilitychange", hidden);
            };
        }, [flush]);

        useEffect(() => {
            onOpenChange?.(
                tabs.map((t) => t.doc.id),
                activeId,
            );
        }, [tabs, activeId, onOpenChange]);

        const closeTab = async (id: string) => {
            await handles.current.get(id)?.flush();
            handles.current.delete(id);
            setTabs((t) => {
                const index = t.findIndex((x) => x.doc.id === id);
                const rest = t.filter((x) => x.doc.id !== id);
                if (activeId === id)
                    setActiveId(rest[Math.max(0, index - 1)]?.doc.id ?? null);
                return rest;
            });
        };

        const onMetaChange = useCallback(
            (id: string, m: { name: string; status: SaveStatus }) => {
                setMeta((prev) =>
                    prev[id]?.name === m.name && prev[id]?.status === m.status
                        ? prev
                        : { ...prev, [id]: m },
                );
            },
            [],
        );

        const setHandle = (id: string) => (h: SketchTabHandle | null) => {
            if (h) handles.current.set(id, h);
        };

        return (
            <div
                className={clsx(
                    "om-sketchpad text-text bg-bg-1 relative flex size-full flex-col overflow-hidden font-sans",
                    theme === "dark" && "dark",
                    className,
                )}
                data-testid="sketchpad"
            >
                {/* Tabs */}
                <div
                    className="border-stroke bg-bg-1 relative z-30 flex h-36 shrink-0 items-end gap-2 border-b px-8"
                    role="tablist"
                    aria-label="Open sketches"
                >
                    {tabs.map((t) => {
                        const m = meta[t.doc.id];
                        const selected = t.doc.id === activeId;
                        return (
                            <div
                                key={t.doc.id}
                                role="tab"
                                aria-selected={selected}
                                data-testid="sketch-tab"
                                className={clsx(
                                    "rounded-t-6 group flex h-30 max-w-[14rem] items-center gap-6 border border-b-0 pr-4 pl-12",
                                    selected
                                        ? "border-stroke bg-fg-2 text-text"
                                        : "text-text-subtitle hover:text-text border-transparent",
                                )}
                            >
                                <button
                                    type="button"
                                    className="text-body min-w-0 flex-1 truncate text-left"
                                    onClick={() => setActiveId(t.doc.id)}
                                >
                                    {t.templateKey && (
                                        <span
                                            className="text-accent mr-4 font-medium"
                                            data-testid="tab-template-badge"
                                        >
                                            Template ·
                                        </span>
                                    )}
                                    {m?.name ?? t.doc.name}
                                    {m?.status === "unsaved" ||
                                    m?.status === "saving"
                                        ? " •"
                                        : ""}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Close ${m?.name ?? t.doc.name}`}
                                    data-testid="close-tab"
                                    className="rounded-4 hover:bg-text/10 flex size-20 items-center justify-center opacity-60 group-hover:opacity-100"
                                    onClick={() => void closeTab(t.doc.id)}
                                >
                                    <XIcon size={12} />
                                </button>
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        aria-label="New sketch"
                        title="New sketch"
                        data-testid="new-sketch"
                        className="rounded-4 hover:bg-text/10 text-text-subtitle hover:text-text mb-4 flex size-26 items-center justify-center"
                        onClick={showNew}
                    >
                        <PlusIcon size={14} />
                    </button>
                    <div className="relative mb-4">
                        <button
                            type="button"
                            aria-label="Open a sketch"
                            title="Open a sketch"
                            data-testid="open-sketch"
                            className="rounded-4 hover:bg-text/10 text-text-subtitle hover:text-text flex size-26 items-center justify-center"
                            onClick={() => {
                                void store.list().then(setSummaries);
                                setOpenMenu((o) => !o);
                            }}
                        >
                            <FolderOpenIcon size={14} />
                        </button>
                        <Menu
                            open={openMenu}
                            onClose={() => setOpenMenu(false)}
                            className="top-30 left-0"
                            testId="open-menu"
                        >
                            {summaries.length === 0 && (
                                <div className="text-sub text-text-subtitle px-10 py-6">
                                    No sketches yet
                                </div>
                            )}
                            {[...summaries]
                                .sort((a, b) => b.updatedAt - a.updatedAt)
                                .map((s) => (
                                    <MenuItem
                                        key={s.id}
                                        onClick={() => {
                                            setOpenMenu(false);
                                            void open(s.id);
                                        }}
                                    >
                                        {s.name}
                                    </MenuItem>
                                ))}
                        </Menu>
                    </div>
                </div>
                <div className="relative min-h-0 flex-1">
                    {tabs.map((t) => (
                        <SketchTab
                            key={t.doc.id}
                            ref={setHandle(t.doc.id)}
                            initialDoc={t.doc}
                            store={store}
                            active={t.doc.id === activeId}
                            currentField={initialField}
                            snapMode={snapMode}
                            onSnapModeChange={setSnapMode}
                            onMetaChange={onMetaChange}
                            onNewSketch={showNew}
                            onExportFile={onExportFile}
                            menuItems={menuItems}
                            saveOnMount={t.isNew}
                            hostName={hostName}
                            templateKey={t.templateKey}
                            onNewFromTemplate={
                                t.templateKey
                                    ? () =>
                                          // From the template as it is now
                                          void (
                                              handles.current
                                                  .get(t.doc.id)
                                                  ?.flush() ?? Promise.resolve()
                                          ).then(() =>
                                              newSketch({
                                                  templateId: t.templateKey,
                                              }),
                                          )
                                    : undefined
                            }
                        />
                    ))}
                </div>
                <NewSketchDialog
                    open={newOpen}
                    onOpenChange={setNewOpen}
                    builtIns={builtIns}
                    templates={templates}
                    destinations={store.templates.destinations}
                    loadTemplate={(id) => store.templates.load(id)}
                    onCreate={(template, name) =>
                        void createFrom(template, name)
                    }
                />
            </div>
        );
    },
);
