import {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    forwardRef,
    type ReactNode,
} from "react";
import clsx from "clsx";
import { hashElementsVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
    AppState,
    BinaryFiles,
    ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
    ArrowClockwiseIcon,
    ArrowCounterClockwiseIcon,
    CaretDownIcon,
    DownloadSimpleIcon,
    FlipHorizontalIcon,
    ListIcon,
    MagnetIcon,
    MinusIcon,
    PlusIcon,
    SquaresFourIcon,
} from "@phosphor-icons/react";
import {
    createPage,
    nextPageName,
    templateFromDoc,
    templateFromEditedDoc,
} from "../doc/sketchDoc";
import {
    drillPosition,
    formatDrillPosition,
    formatStepSize,
} from "../drill/position";
import { mirrorAcross50, offsetCopy } from "../drill/mirror";
import { SNAP_MODE_LABELS, type SnapMode } from "../drill/snap";
import type { ScenePoint } from "../drill/coordinates";
import {
    exportPagePdf,
    exportPagePng,
    exportPageSvg,
    renderPage,
    renderThumbnail,
} from "../export/exportPage";
import { sameFieldLayout, snapshotFieldProperties } from "../field/fieldStyle";
import { formatOmFill } from "../fills/omFills";
import type { FieldProperties } from "@openmarch/core";
import type {
    FieldPropertiesJson,
    FieldStyle,
    SketchDoc,
    SketchPageRender,
    SketchStore,
} from "../types";
import { FieldPanel } from "./FieldPanel";
import { PageCanvas } from "./PageCanvas";
import { PagesPanel } from "./PagesPanel";
import { PropertiesPanel, type PropertiesActions } from "./PropertiesPanel";
import {
    addElements,
    clickExcalidrawButton,
    createSticky,
    dataUrlToBlob,
    deleteSelection,
    editSelectedLabel,
    elementsForSave,
    fitField,
    loadFiles,
    reorderSelection,
    selectedElements,
    zoomTo,
} from "./scene";
import * as S from "./style";
import { Toolbar, type ToolId } from "./tools";
import { Menu, MenuItem, MenuSeparator, SaveTemplateDialog } from "./dialogs";
import { Panel, PanelButton, PanelSeparator } from "./ui";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export interface SketchTabHandle {
    /** Saves now if anything changed; resolves when the store has it */
    flush(): Promise<void>;
    /** The sketch as it is now */
    getDoc(): SketchDoc;
    /** Takes a name given elsewhere (the host's sidebar), and saves it like any change */
    rename(name: string): void;
}

export interface SketchMenuItem {
    label: string;
    onSelect: (doc: SketchDoc) => void;
    testId?: string;
}

export interface SketchTabProps {
    initialDoc: SketchDoc;
    store: SketchStore;
    active: boolean;
    /** The host's current field, for "Use current show field" */
    currentField: FieldPropertiesJson;
    snapMode: SnapMode;
    onSnapModeChange: (mode: SnapMode) => void;
    onMetaChange: (
        id: string,
        meta: { name: string; status: SaveStatus },
    ) => void;
    onNewSketch: () => void;
    onExportFile: (blob: Blob, filename: string) => void;
    menuItems?: SketchMenuItem[];
    /** Save right away (a new sketch) */
    saveOnMount?: boolean;
    /** Shown before the sketch name in export file names */
    hostName?: string;
    /**
     * The template this tab edits (its key from `store.templates.list()`): saves go back to
     * the template through `store.templates.update`, not to the sketches
     */
    templateKey?: string;
    /** "New sketch from this template", for a template tab */
    onNewFromTemplate?: () => void;
}

const EMPTY: readonly ExcalidrawElement[] = [];

/** The pointer's scene position, outside React state so moving the mouse renders only the readout */
function createPointerStore() {
    let value: ScenePoint | null = null;
    const listeners = new Set<() => void>();
    return {
        set: (p: ScenePoint | null) => {
            value = p;
            for (const l of listeners) l();
        },
        get: () => value,
        subscribe: (l: () => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
    };
}
type PointerStore = ReturnType<typeof createPointerStore>;

function PointerPosition({
    store,
    fieldProperties,
}: {
    store: PointerStore;
    fieldProperties: FieldProperties;
}) {
    const p = useSyncExternalStore(store.subscribe, store.get);
    const text = p
        ? formatDrillPosition(drillPosition(fieldProperties, p))
        : "";
    return (
        <span data-testid="drill-position" className="min-w-[12rem]">
            {text || "—"}
        </span>
    );
}

const AUTOSAVE_DEBOUNCE_MS = 2000;
const AUTOSAVE_MAX_MS = 30000;

const TYPE_LABELS: Record<string, string> = {
    rectangle: "Rect",
    ellipse: "Ellipse",
    diamond: "Diamond",
    line: "Line",
    arrow: "Arrow",
    freedraw: "Drawing",
    text: "Text",
    image: "Image",
};

interface UiState {
    tool: ToolId;
    locked: boolean;
    zoom: number;
    view: S.StyleView;
    selection: string;
    empty: boolean;
    canUndo: boolean;
}

const toolOf = (type: string): ToolId =>
    (
        [
            "hand",
            "selection",
            "rectangle",
            "diamond",
            "ellipse",
            "arrow",
            "line",
            "freedraw",
            "text",
            "image",
            "eraser",
        ] as const
    ).includes(type as never)
        ? (type as ToolId)
        : "selection";

const isTyping = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return (
        !!el &&
        (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable)
    );
};

const safeName = (name: string) =>
    name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "sketch";

/** One open sketch: its pages, panels and autosave (ADR 0006 D-4) */
export const SketchTab = forwardRef<SketchTabHandle, SketchTabProps>(
    function SketchTab(
        {
            initialDoc,
            store,
            active,
            currentField,
            snapMode,
            onSnapModeChange,
            onMetaChange,
            onNewSketch,
            onExportFile,
            menuItems,
            saveOnMount,
            hostName,
            templateKey,
            onNewFromTemplate,
        },
        ref,
    ) {
        const docId = initialDoc.id;
        const [name, setName] = useState(initialDoc.name);
        const [field, setField] = useState(initialDoc.field);
        const [pages, setPages] = useState<{ id: string; name: string }[]>(() =>
            initialDoc.pages.map((p) => ({ id: p.id, name: p.name })),
        );
        const [activePageId, setActivePageId] = useState(
            initialDoc.pages[0]!.id,
        );
        const [mounted, setMounted] = useState<string[]>([
            initialDoc.pages[0]!.id,
        ]);
        const [status, setStatus] = useState<SaveStatus>("saved");
        const [fieldOpen, setFieldOpen] = useState(false);
        const [menuOpen, setMenuOpen] = useState(false);
        const [exportOpen, setExportOpen] = useState(false);
        const [snapOpen, setSnapOpen] = useState(false);
        const [templateOpen, setTemplateOpen] = useState(false);
        const [renaming, setRenaming] = useState(false);
        const [sticky, setSticky] = useState(false);
        const [exporting, setExporting] = useState<string | null>(null);
        const pointerStore = useMemo(() => createPointerStore(), []);
        const [ui, setUi] = useState<UiState | null>(null);

        const rootRef = useRef<HTMLDivElement>(null);
        const apis = useRef(new Map<string, ExcalidrawImperativeAPI>());
        /** Elements of pages that aren't mounted (or as loaded) */
        const stored = useRef(
            new Map<string, ExcalidrawElement[]>(
                initialDoc.pages.map((p) => [p.id, p.elements]),
            ),
        );
        const hashes = useRef(
            new Map<string, number>(
                initialDoc.pages.map((p) => [
                    p.id,
                    hashElementsVersion(p.elements),
                ]),
            ),
        );
        const renders = useRef(
            new Map<string, { hash: number; render: SketchPageRender }>(),
        );
        const thumb = useRef<{ key: string; blob: Blob | null } | null>(null);
        const knownFiles = useRef(new Set<string>());
        const uiKey = useRef("");

        const fieldProperties = useMemo(
            () => snapshotFieldProperties(field),
            [field],
        );
        const pps = fieldProperties.pixelsPerStep;
        const activeApi = () => apis.current.get(activePageId) ?? null;

        // Latest values for callbacks that outlive a render
        const latest = useRef({ name, field, pages, activePageId, sticky, ui });
        latest.current = { name, field, pages, activePageId, sticky, ui };

        useEffect(
            () => onMetaChange(docId, { name, status }),
            [docId, name, status, onMetaChange],
        );

        /* ---------------- saving ---------------- */

        const dirtySince = useRef<number | null>(
            saveOnMount ? Date.now() : null,
        );
        const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
        const saving = useRef<Promise<void> | null>(null);
        const again = useRef(false);

        const pageElements = useCallback((id: string): ExcalidrawElement[] => {
            const api = apis.current.get(id);
            return api
                ? [...api.getSceneElementsIncludingDeleted()]
                : (stored.current.get(id) ?? []);
        }, []);

        const buildDoc = useCallback((): SketchDoc => {
            const l = latest.current;
            return {
                id: docId,
                name: l.name,
                field: l.field,
                pages: l.pages.map((p) => ({
                    id: p.id,
                    name: p.name,
                    elements: elementsForSave(pageElements(p.id)),
                })),
                schemaVersion: 1,
            };
        }, [docId, pageElements]);

        const pageFiles = useCallback(
            async (
                id: string,
                elements: readonly ExcalidrawElement[],
            ): Promise<BinaryFiles> => {
                const api = apis.current.get(id);
                if (api) return api.getFiles();
                const files = await loadFiles(store, elements);
                return Object.fromEntries(
                    files.map((f) => [f.id, f]),
                ) as BinaryFiles;
            },
            [store],
        );

        /** Images pasted from elsewhere may not be in this store yet */
        const ensureFiles = useCallback(
            async (doc: SketchDoc) => {
                for (const page of doc.pages) {
                    const api = apis.current.get(page.id);
                    if (!api) continue;
                    for (const el of page.elements) {
                        if (
                            el.type !== "image" ||
                            el.isDeleted ||
                            !el.fileId ||
                            knownFiles.current.has(el.fileId)
                        )
                            continue;
                        const id = el.fileId;
                        if (!(await store.getFile(id))) {
                            const file = api.getFiles()[id];
                            if (file)
                                await store.putFile(
                                    await dataUrlToBlob(file.dataURL),
                                );
                        }
                        knownFiles.current.add(id);
                    }
                }
            },
            [store],
        );

        const saveNow = useCallback(async (): Promise<void> => {
            if (saving.current) {
                again.current = true;
                return saving.current;
            }
            if (dirtySince.current === null) return;
            dirtySince.current = null;
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            setStatus("saving");
            const run = (async () => {
                try {
                    const doc = buildDoc();
                    await ensureFiles(doc);
                    const pagesRender: SketchPageRender[] = [];
                    for (const page of doc.pages) {
                        const hash = hashElementsVersion(page.elements);
                        const cached = renders.current.get(page.id);
                        if (cached && cached.hash === hash) {
                            pagesRender.push(cached.render);
                            continue;
                        }
                        const render = await renderPage(page.id, {
                            elements: page.elements,
                            files: await pageFiles(page.id, page.elements),
                        });
                        renders.current.set(page.id, { hash, render });
                        pagesRender.push(render);
                    }
                    const first = doc.pages[0]!;
                    const key = `${first.id}:${hashElementsVersion(first.elements)}:${JSON.stringify(doc.field)}`;
                    if (thumb.current?.key !== key) {
                        const blob = await renderThumbnail(doc.field, {
                            elements: first.elements,
                            files: await pageFiles(first.id, first.elements),
                        }).catch(() => null);
                        thumb.current = { key, blob };
                    }
                    if (templateKey && store.templates.update)
                        await store.templates.update(
                            templateKey,
                            templateFromEditedDoc(doc),
                            { thumbnail: thumb.current.blob },
                        );
                    else
                        await store.save(doc, {
                            pages: pagesRender,
                            thumbnail: thumb.current.blob,
                        });
                    setStatus(
                        dirtySince.current === null ? "saved" : "unsaved",
                    );
                } catch (error) {
                    console.error("Sketch save failed", error);
                    dirtySince.current ??= Date.now();
                    setStatus("error");
                }
            })();
            saving.current = run;
            await run;
            saving.current = null;
            if (again.current) {
                again.current = false;
                await saveNow();
            }
        }, [buildDoc, ensureFiles, pageFiles, store, templateKey]);

        const markDirty = useCallback(() => {
            const now = Date.now();
            dirtySince.current ??= now;
            setStatus((s) => (s === "saving" ? s : "unsaved"));
            if (timer.current) clearTimeout(timer.current);
            // Debounced, but at least every 30 s while editing
            const wait = Math.max(
                0,
                Math.min(
                    AUTOSAVE_DEBOUNCE_MS,
                    dirtySince.current + AUTOSAVE_MAX_MS - now,
                ),
            );
            timer.current = setTimeout(() => void saveNow(), wait);
        }, [saveNow]);

        useImperativeHandle(
            ref,
            () => ({
                flush: saveNow,
                getDoc: buildDoc,
                rename: (next: string) => {
                    if (next.trim()) setName(next.trim());
                },
            }),
            [saveNow, buildDoc],
        );

        useEffect(() => {
            if (saveOnMount) void saveNow();
            return () => {
                if (timer.current) clearTimeout(timer.current);
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        // Field and page changes are saved like drawing changes
        const firstMeta = useRef(true);
        useEffect(() => {
            if (firstMeta.current) {
                firstMeta.current = false;
                return;
            }
            markDirty();
        }, [name, field, pages, markDirty]);

        /* ---------------- the active page's state ---------------- */

        const refreshUi = useCallback(
            (force = false) => {
                const api = apis.current.get(latest.current.activePageId);
                if (!api) return;
                const st = api.getAppState();
                const sel = selectedElements(api, true);
                const tool: ToolId = latest.current.sticky
                    ? "sticky"
                    : toolOf(st.activeTool.type);
                const key = [
                    tool,
                    st.activeTool.locked,
                    st.zoom.value,
                    sel.map((e) => `${e.id}:${e.version}`).join(","),
                    st.currentItemStrokeColor,
                    st.currentItemBackgroundColor,
                    st.currentItemFillStyle,
                    st.currentItemStrokeWidth,
                    st.currentItemStrokeStyle,
                    st.currentItemRoughness,
                    st.currentItemOpacity,
                    st.currentItemFontSize,
                    st.currentItemFontFamily,
                    st.currentItemTextAlign,
                    st.currentItemRoundness,
                    st.currentItemStartArrowhead,
                    st.currentItemEndArrowhead,
                    api.getSceneElements().length === 0,
                ].join("|");
                if (!force && key === uiKey.current) return;
                uiKey.current = key;
                const own = sel.filter(
                    (e) => !(e.type === "text" && e.containerId),
                );
                let selection = "";
                if (own.length === 1) {
                    const e = own[0]!;
                    selection = `${TYPE_LABELS[e.type] ?? "Shape"} ${formatStepSize(fieldProperties, e.width, e.height)}`;
                } else if (own.length > 1) selection = `${own.length} shapes`;
                setUi({
                    tool,
                    locked: st.activeTool.locked,
                    zoom: st.zoom.value,
                    view: S.styleView(api, tool),
                    selection,
                    empty: api.getSceneElements().length === 0,
                    canUndo: true,
                });
            },
            [fieldProperties],
        );

        const refreshUiRef = useRef(refreshUi);
        refreshUiRef.current = refreshUi;

        const handleChange = useCallback(
            (
                pageId: string,
                elements: readonly ExcalidrawElement[],
                appState: AppState,
            ) => {
                const hash = hashElementsVersion(elements);
                if (hashes.current.get(pageId) !== hash) {
                    hashes.current.set(pageId, hash);
                    markDirty();
                }
                if (pageId !== latest.current.activePageId) return;
                if (
                    latest.current.sticky &&
                    appState.activeTool.type !== "selection"
                )
                    setSticky(false);
                refreshUi();
            },
            [markDirty, refreshUi],
        );

        const handleApi = useCallback(
            (pageId: string, api: ExcalidrawImperativeAPI | null) => {
                if (api) apis.current.set(pageId, api);
                else {
                    const old = apis.current.get(pageId);
                    if (old)
                        stored.current.set(pageId, [
                            ...old.getSceneElementsIncludingDeleted(),
                        ]);
                    apis.current.delete(pageId);
                }
                if (api && pageId === latest.current.activePageId)
                    requestAnimationFrame(() => refreshUiRef.current(true));
            },
            [],
        );

        useEffect(() => {
            uiKey.current = "";
            refreshUi(true);
        }, [activePageId, sticky, refreshUi]);

        const generateIdForFile = useCallback(
            async (file: File) => {
                const id = await store.putFile(file);
                knownFiles.current.add(id);
                return id;
            },
            [store],
        );

        const focusCanvas = useCallback(() => {
            const host = rootRef.current?.querySelector<HTMLElement>(
                `[data-page-id="${latest.current.activePageId}"] .excalidraw`,
            );
            host?.focus({ preventScroll: true });
        }, []);

        /* ---------------- tools and actions ---------------- */

        const setTool = useCallback(
            (tool: ToolId) => {
                const api = activeApi();
                if (!api) return;
                if (tool === "sticky") {
                    api.setActiveTool({ type: "selection" });
                    setSticky(true);
                } else {
                    setSticky(false);
                    api.setActiveTool({ type: tool });
                }
                focusCanvas();
            },
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [activePageId, focusCanvas],
        );

        const onCanvasPress = useCallback((p: ScenePoint) => {
            if (!latest.current.sticky) return false;
            const api = apis.current.get(latest.current.activePageId);
            if (!api) return false;
            const els = createSticky(p.x, p.y);
            addElements(api, els);
            if (!api.getAppState().activeTool.locked) setSticky(false);
            // Type right away (UX spec 5)
            requestAnimationFrame(() =>
                editSelectedLabel(
                    rootRef.current?.querySelector<HTMLElement>(
                        `[data-page-id="${latest.current.activePageId}"]`,
                    ) ?? null,
                ),
            );
            return true;
        }, []);

        const mirror = useCallback(() => {
            const api = activeApi();
            if (!api) return;
            const sel = selectedElements(api, true);
            if (sel.length) addElements(api, mirrorAcross50(sel));
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [activePageId]);

        const fit = useCallback(() => {
            const api = activeApi();
            if (api) fitField(api, fieldProperties, fitInsets);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [activePageId, fieldProperties]);

        const pageHost = () =>
            rootRef.current?.querySelector<HTMLElement>(
                `[data-page-id="${activePageId}"]`,
            ) ?? null;

        const doExport = useCallback(
            async (format: "svg" | "png" | "pdf") => {
                setExportOpen(false);
                setMenuOpen(false);
                const api = activeApi();
                if (!api) return;
                const scene = {
                    elements: api.getSceneElements(),
                    files: api.getFiles(),
                    appState: api.getAppState(),
                };
                const l = latest.current;
                const pageName =
                    l.pages.find((p) => p.id === l.activePageId)?.name ??
                    "Page";
                const base = safeName(
                    [hostName, l.name, l.pages.length > 1 ? pageName : null]
                        .filter(Boolean)
                        .join(" - "),
                );
                setExporting(format);
                try {
                    const blob =
                        format === "svg"
                            ? await exportPageSvg(l.field, scene)
                            : format === "png"
                              ? await exportPagePng(l.field, scene, 2)
                              : await exportPagePdf(l.field, scene);
                    onExportFile(blob, `${base}.${format}`);
                } catch (error) {
                    console.error(`Sketch ${format} export failed`, error);
                    window.alert(
                        `The ${format.toUpperCase()} export failed: ${(error as Error).message}`,
                    );
                } finally {
                    setExporting(null);
                }
            },
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [activePageId, hostName, onExportFile],
        );

        const actions: PropertiesActions = useMemo(() => {
            const run = (fn: (api: ExcalidrawImperativeAPI) => void) => () => {
                const api = apis.current.get(latest.current.activePageId);
                if (api) fn(api);
            };
            const with1 =
                <T,>(fn: (api: ExcalidrawImperativeAPI, v: T) => void) =>
                (v: T) => {
                    const api = apis.current.get(latest.current.activePageId);
                    if (api) fn(api, v);
                };
            return {
                strokeColor: with1(S.setStrokeColor),
                backgroundColor: with1(S.setBackgroundColor),
                pattern: with1((api, p: S.FillPattern) =>
                    S.setPattern(api, p, pps),
                ),
                dotInterval: with1((api, steps: number) =>
                    S.setDotFill(api, (f) => ({ ...f, spacing: steps * pps })),
                ),
                dotSize: with1(S.setDotSize),
                dotCount: with1((api, count: number) =>
                    S.setDotFill(api, (f) => ({ ...f, count })),
                ),
                strokeWidth: with1(S.setStrokeWidth),
                strokeStyle: with1(S.setStrokeStyle),
                roughness: with1(S.setRoughness),
                roundness: with1(S.setRoundness),
                opacity: with1(S.setOpacity),
                fontSize: with1(S.setFontSize),
                fontFamily: with1(S.setFontFamily),
                textAlign: with1(S.setTextAlign),
                arrowhead: (end, head) => {
                    const api = apis.current.get(latest.current.activePageId);
                    if (api) S.setArrowhead(api, end, head);
                },
                stickyColor: with1(S.setStickyColor),
                duplicate: run((api) =>
                    addElements(
                        api,
                        offsetCopy(
                            selectedElements(api, true),
                            pps * 2,
                            pps * 2,
                        ),
                    ),
                ),
                remove: run(deleteSelection),
                lock: run(S.toggleLock),
                mirror: run((api) => {
                    const sel = selectedElements(api, true);
                    if (sel.length) addElements(api, mirrorAcross50(sel));
                }),
                layer: (to) => {
                    const api = apis.current.get(latest.current.activePageId);
                    if (api) reorderSelection(api, to);
                },
            };
        }, [pps]);

        /* ---------------- keyboard ---------------- */

        const onKeyDownCapture = (e: React.KeyboardEvent) => {
            if (isTyping(e.target)) return;
            const api = activeApi();
            if (api?.getAppState().editingTextElement) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            const handled = () => {
                e.preventDefault();
                e.stopPropagation();
            };
            if (!mod && !e.altKey && !e.shiftKey && key === "s") {
                setTool("sticky");
                return handled();
            }
            if (key === "escape" && sticky) {
                setSticky(false);
                return handled();
            }
            if (!mod && e.shiftKey && e.code === "Digit1") {
                fit();
                return handled();
            }
            if (mod && e.shiftKey && key === "m") {
                mirror();
                return handled();
            }
            if (mod && e.shiftKey && key === "e") {
                setExportOpen(true);
                return handled();
            }
            if (mod && !e.shiftKey && key === "s") {
                void saveNow();
                return handled();
            }
        };

        /* ---------------- pages ---------------- */

        const selectPage = (id: string) => {
            setActivePageId(id);
            setMounted((m) => (m.includes(id) ? m : [...m, id]));
        };
        const addPage = () => {
            const page = createPage(nextPageName(pages));
            stored.current.set(page.id, []);
            hashes.current.set(page.id, hashElementsVersion([]));
            setPages((p) => [...p, { id: page.id, name: page.name }]);
            selectPage(page.id);
        };
        const renamePage = (id: string, pageName: string) =>
            setPages((p) =>
                p.map((x) => (x.id === id ? { ...x, name: pageName } : x)),
            );
        const movePage = (id: string, to: number) =>
            setPages((p) => {
                const from = p.findIndex((x) => x.id === id);
                if (from < 0 || to < 0 || to >= p.length || from === to)
                    return p;
                const next = [...p];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved!);
                return next;
            });
        const deletePage = (id: string) => {
            if (pages.length <= 1) return;
            const index = pages.findIndex((p) => p.id === id);
            const rest = pages.filter((p) => p.id !== id);
            if (id === activePageId)
                selectPage(rest[Math.max(0, index - 1)]!.id);
            setPages(rest);
            setMounted((m) => m.filter((x) => x !== id));
            stored.current.delete(id);
            renders.current.delete(id);
        };

        /* ---------------- field ---------------- */

        const setFieldStyle = (style: FieldStyle) =>
            setField((f) => ({ ...f, style }));
        const layoutDiffers = !sameFieldLayout(
            field.fieldProperties,
            currentField,
        );

        /* ---------------- layout ---------------- */

        const view = ui?.view;
        const showProperties = !!view && (!view.empty || ui?.tool === "sticky");
        const fitInsets = useMemo(
            () => ({ left: 300, right: 24, top: 72, bottom: 64 }),
            [],
        );
        const dots = view?.dots ?? null;
        const statusText =
            status === "saving"
                ? "Saving…"
                : status === "unsaved"
                  ? "Edited"
                  : status === "error"
                    ? "Not saved"
                    : "Saved";

        const menuButton = (
            label: string,
            onClick: () => void,
            testId?: string,
            shortcut?: string,
        ): ReactNode => (
            <MenuItem
                onClick={() => {
                    setMenuOpen(false);
                    onClick();
                }}
                testId={testId}
                shortcut={shortcut}
            >
                {label}
            </MenuItem>
        );

        return (
            <div
                ref={rootRef}
                className={clsx(
                    "om-sketch-tab absolute inset-0",
                    sticky && "om-sticky-armed",
                )}
                style={{ visibility: active ? "visible" : "hidden" }}
                data-sketch-id={docId}
                data-testid={active ? "sketch-tab-active" : undefined}
                onKeyDownCapture={onKeyDownCapture}
            >
                {/* The pages, each its own Excalidraw scene with its own undo */}
                {pages
                    .filter((p) => mounted.includes(p.id))
                    .map((p) => (
                        <PageCanvas
                            key={p.id}
                            pageId={p.id}
                            initialElements={stored.current.get(p.id) ?? EMPTY}
                            snapshot={field}
                            fieldProperties={fieldProperties}
                            store={store}
                            active={active && p.id === activePageId}
                            snapMode={snapMode}
                            onApi={handleApi}
                            onChange={handleChange}
                            onPointer={pointerStore.set}
                            onCanvasPress={onCanvasPress}
                            generateIdForFile={generateIdForFile}
                            fitInsets={fitInsets}
                        />
                    ))}

                {/* Top left: menu and title */}
                <div className="pointer-events-none absolute top-12 bottom-64 left-12 z-20 flex flex-col gap-8">
                    <Panel
                        className="relative z-30 flex h-40 items-center gap-6 px-4"
                        label="Sketch"
                    >
                        <PanelButton
                            label="Menu"
                            onClick={() => setMenuOpen((o) => !o)}
                            pressed={menuOpen}
                            testId="sketch-menu"
                        >
                            <ListIcon size={18} />
                        </PanelButton>
                        {renaming ? (
                            <input
                                autoFocus
                                defaultValue={name}
                                aria-label="Sketch name"
                                data-testid="sketch-name-input"
                                className="text-body text-text w-[10rem] bg-transparent outline-none"
                                onBlur={(e) => {
                                    setName(e.target.value.trim() || name);
                                    setRenaming(false);
                                }}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter")
                                        (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setRenaming(false);
                                }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="text-body max-w-[11rem] truncate font-medium"
                                title="Click to rename"
                                onClick={() => setRenaming(true)}
                                data-testid="sketch-name"
                            >
                                {name}
                            </button>
                        )}
                        {templateKey && (
                            <span
                                className="bg-accent/15 text-accent rounded-4 text-sub shrink-0 px-6 py-1 font-medium"
                                data-testid="template-badge"
                            >
                                Template
                            </span>
                        )}
                        <span
                            className={clsx(
                                "text-sub pr-6",
                                status === "error"
                                    ? "text-red"
                                    : "text-text-subtitle",
                            )}
                            data-testid="save-status"
                            aria-live="polite"
                        >
                            {statusText}
                        </span>
                        <Menu
                            open={menuOpen}
                            onClose={() => setMenuOpen(false)}
                            className="top-44 left-0"
                            testId="sketch-menu-list"
                        >
                            {menuButton(
                                "New sketch…",
                                onNewSketch,
                                "menu-new-sketch",
                            )}
                            {templateKey &&
                                onNewFromTemplate &&
                                menuButton(
                                    "New sketch from this template",
                                    onNewFromTemplate,
                                    "menu-new-from-template",
                                )}
                            {menuButton("Rename", () => setRenaming(true))}
                            {menuButton(
                                "Save as template…",
                                () => setTemplateOpen(true),
                                "menu-save-template",
                            )}
                            <MenuSeparator />
                            {menuButton(
                                "Export SVG",
                                () => void doExport("svg"),
                                "menu-export-svg",
                            )}
                            {menuButton(
                                "Export PNG (2×)",
                                () => void doExport("png"),
                                "menu-export-png",
                            )}
                            {menuButton(
                                "Export PDF",
                                () => void doExport("pdf"),
                                "menu-export-pdf",
                            )}
                            <MenuSeparator />
                            {menuButton("Field settings…", () =>
                                setFieldOpen(true),
                            )}
                            {menuButton("Fit the field", fit, undefined, "⇧1")}
                            {menuItems && menuItems.length > 0 && (
                                <MenuSeparator />
                            )}
                            {menuItems?.map((item) =>
                                menuButton(
                                    item.label,
                                    () => item.onSelect(buildDoc()),
                                    item.testId,
                                ),
                            )}
                        </Menu>
                    </Panel>
                    <div className="pointer-events-auto">
                        <PagesPanel
                            pages={pages}
                            activeId={activePageId}
                            onSelect={selectPage}
                            onAdd={addPage}
                            onRename={renamePage}
                            onMove={movePage}
                            onDelete={deletePage}
                        />
                    </div>
                    {showProperties && view && (
                        <div className="flex min-h-0 flex-1 flex-col">
                            <PropertiesPanel
                                view={view}
                                actions={actions}
                                pixelsPerStep={pps}
                            />
                        </div>
                    )}
                </div>

                {/* Top centre: tools */}
                <div className="pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2">
                    {ui && (
                        <Toolbar
                            active={ui.tool}
                            locked={ui.locked}
                            onTool={setTool}
                            onToggleLock={() => {
                                const api = activeApi();
                                if (!api) return;
                                const t = api.getAppState().activeTool;
                                api.setActiveTool({
                                    type:
                                        t.type === "custom"
                                            ? "selection"
                                            : t.type,
                                    locked: !t.locked,
                                } as Parameters<typeof api.setActiveTool>[0]);
                            }}
                        />
                    )}
                    {ui?.empty && !sticky && (
                        <div
                            className="om-hint pointer-events-none mt-10 text-center"
                            data-testid="empty-hint"
                        >
                            Pick a tool and start drawing
                        </div>
                    )}
                    {sticky && (
                        <div className="om-hint pointer-events-none mt-10 text-center">
                            Click to place a sticky note
                        </div>
                    )}
                </div>

                {/* Top right: field and export */}
                <div className="pointer-events-none absolute top-12 right-12 z-20 flex items-start gap-8">
                    <Panel
                        className="flex h-40 items-center px-4"
                        label="Field"
                    >
                        <PanelButton
                            label="Field settings"
                            pressed={fieldOpen}
                            onClick={() => setFieldOpen((o) => !o)}
                            testId="field-button"
                        >
                            <SquaresFourIcon size={18} />
                            <span className="text-body">Field</span>
                        </PanelButton>
                    </Panel>
                    <div className="relative">
                        <Panel
                            className="flex h-40 items-center px-4"
                            label="Export"
                        >
                            <PanelButton
                                label="Export"
                                accent
                                onClick={() => setExportOpen((o) => !o)}
                                testId="export-button"
                                className="px-12"
                            >
                                <DownloadSimpleIcon size={18} />
                                <span className="text-body">
                                    {exporting ? "Exporting…" : "Export"}
                                </span>
                            </PanelButton>
                        </Panel>
                        <Menu
                            open={exportOpen}
                            onClose={() => setExportOpen(false)}
                            className="top-44 right-0"
                            testId="export-menu"
                        >
                            <MenuItem
                                onClick={() => void doExport("png")}
                                testId="export-png"
                            >
                                PNG, 2×
                            </MenuItem>
                            <MenuItem
                                onClick={() => void doExport("svg")}
                                testId="export-svg"
                            >
                                SVG
                            </MenuItem>
                            <MenuItem
                                onClick={() => void doExport("pdf")}
                                testId="export-pdf"
                            >
                                PDF (vector)
                            </MenuItem>
                        </Menu>
                    </div>
                </div>
                {fieldOpen && (
                    <div className="pointer-events-auto absolute top-60 right-12 bottom-64 z-20 flex">
                        <FieldPanel
                            style={field.style}
                            fieldProperties={fieldProperties}
                            layoutDiffers={layoutDiffers}
                            onChange={setFieldStyle}
                            onUseCurrentField={() =>
                                setField((f) => ({
                                    ...f,
                                    fieldProperties: currentField,
                                }))
                            }
                            onClose={() => setFieldOpen(false)}
                        />
                    </div>
                )}

                {/* Bottom left: zoom and undo */}
                <div className="pointer-events-none absolute bottom-12 left-12 z-10">
                    <Panel
                        className="flex h-40 items-center gap-2 px-4"
                        label="Zoom and history"
                    >
                        <PanelButton
                            label="Zoom out"
                            onClick={() =>
                                activeApi() &&
                                zoomTo(activeApi()!, (ui?.zoom ?? 1) / 1.2)
                            }
                        >
                            <MinusIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Fit the field"
                            title="Fit the field (Shift+1)"
                            onClick={fit}
                            className="w-56 font-mono"
                            testId="zoom-readout"
                        >
                            <span className="text-body">
                                {Math.round((ui?.zoom ?? 1) * 100)}%
                            </span>
                        </PanelButton>
                        <PanelButton
                            label="Zoom in"
                            onClick={() =>
                                activeApi() &&
                                zoomTo(activeApi()!, (ui?.zoom ?? 1) * 1.2)
                            }
                        >
                            <PlusIcon size={16} />
                        </PanelButton>
                        <PanelSeparator />
                        <PanelButton
                            label="Undo"
                            title="Undo (Ctrl+Z)"
                            onClick={() =>
                                clickExcalidrawButton(pageHost(), "button-undo")
                            }
                            testId="undo"
                        >
                            <ArrowCounterClockwiseIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Redo"
                            title="Redo (Ctrl+Shift+Z)"
                            onClick={() =>
                                clickExcalidrawButton(pageHost(), "button-redo")
                            }
                            testId="redo"
                        >
                            <ArrowClockwiseIcon size={16} />
                        </PanelButton>
                    </Panel>
                </div>

                {/* Bottom centre: drill helpers */}
                <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 flex -translate-x-1/2 gap-8">
                    <div className="relative">
                        <Panel
                            className="flex h-40 items-center px-4"
                            label="Snapping"
                        >
                            <PanelButton
                                label="Snapping"
                                pressed={snapMode !== "off"}
                                onClick={() => setSnapOpen((o) => !o)}
                                testId="snap-button"
                                className="px-10"
                            >
                                <MagnetIcon size={16} />
                                <span className="text-body">
                                    Snap: {SNAP_MODE_LABELS[snapMode]}
                                </span>
                                <CaretDownIcon size={12} />
                            </PanelButton>
                        </Panel>
                        <Menu
                            open={snapOpen}
                            onClose={() => setSnapOpen(false)}
                            className="bottom-44 left-0"
                            testId="snap-menu"
                        >
                            {(Object.keys(SNAP_MODE_LABELS) as SnapMode[]).map(
                                (m) => (
                                    <MenuItem
                                        key={m}
                                        testId={`snap-${m}`}
                                        onClick={() => {
                                            onSnapModeChange(m);
                                            setSnapOpen(false);
                                        }}
                                    >
                                        {snapMode === m ? "✓ " : " "}
                                        {SNAP_MODE_LABELS[m]}
                                    </MenuItem>
                                ),
                            )}
                            <div className="text-sub text-text-subtitle px-10 py-4">
                                Hold Ctrl or ⌘ to draw without snapping
                            </div>
                        </Menu>
                    </div>
                    <Panel
                        className="flex h-40 items-center px-4"
                        label="Mirror"
                    >
                        <PanelButton
                            label="Mirror selection across the 50"
                            title="Mirror a copy across the 50 (Ctrl+Shift+M)"
                            onClick={mirror}
                            disabled={!view || view.selectionCount === 0}
                            testId="mirror-button"
                            className="px-10"
                        >
                            <FlipHorizontalIcon size={16} />
                            <span className="text-body">Mirror 50</span>
                        </PanelButton>
                    </Panel>
                </div>

                {/* Bottom right: readout in drill language */}
                <div className="pointer-events-none absolute right-12 bottom-12 z-10">
                    <Panel
                        className="text-body flex h-40 items-center gap-12 px-14 font-mono"
                        label="Position"
                        testId="drill-readout"
                    >
                        {ui?.selection && (
                            <span className="text-text-subtitle">
                                {ui.selection}
                            </span>
                        )}
                        {ui?.selection && (
                            <span className="bg-stroke h-16 w-px" />
                        )}
                        <PointerPosition
                            store={pointerStore}
                            fieldProperties={fieldProperties}
                        />
                        {dots !== null && (
                            <>
                                <span className="bg-stroke h-16 w-px" />
                                <span
                                    className="text-accent"
                                    data-testid="readout-dots"
                                >
                                    {dots} dots
                                </span>
                            </>
                        )}
                    </Panel>
                </div>

                <SaveTemplateDialog
                    open={templateOpen}
                    onOpenChange={setTemplateOpen}
                    defaultName={name}
                    destinations={store.templates.destinations}
                    onSave={async ({
                        name: tName,
                        destination,
                        includeDrawing,
                        includeFieldStyle,
                    }) => {
                        const doc = buildDoc();
                        const template = templateFromDoc(doc, {
                            name: tName,
                            includeDrawing,
                            includeFieldStyle,
                        });
                        const first = template.pages[0]!;
                        const thumbnail = await renderThumbnail(
                            { ...doc.field, style: template.style },
                            {
                                elements: first.elements,
                                files: await pageFiles(
                                    first.id,
                                    first.elements,
                                ),
                            },
                        ).catch(() => null);
                        await store.templates.save(template, destination, {
                            thumbnail,
                        });
                    }}
                />
            </div>
        );
    },
);

/** The default style string for a dot fill (exported for hosts' tests) */
export const defaultDotFill = (pixelsPerStep: number) =>
    formatOmFill({ kind: "dots", spacing: 2 * pixelsPerStep, size: "m" });
