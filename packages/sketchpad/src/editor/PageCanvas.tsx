import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Excalidraw,
    CaptureUpdateAction,
    restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
    AppState,
    BinaryFiles,
    ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FieldProperties } from "@openmarch/core";
import { fieldUnderlayMarkup } from "../field/fieldStyle";
import {
    snapDelta,
    snapScenePoint,
    snapTargets,
    type SnapGuide,
    type SnapMode,
} from "../drill/snap";
import type { ScenePoint } from "../drill/coordinates";
import type { FieldSnapshot, SketchStore } from "../types";
import { clientToScene, fitField, loadFiles, sceneToClient } from "./scene";

/** Tools that never snap (UX spec 7.1: free draw never snaps) */
const NO_SNAP = new Set(["freedraw", "eraser", "hand", "laser", "image"]);

export interface PageCanvasProps {
    pageId: string;
    /** The page's elements when it mounts; later changes come from Excalidraw itself */
    initialElements: readonly ExcalidrawElement[];
    snapshot: FieldSnapshot;
    fieldProperties: FieldProperties;
    store: SketchStore;
    active: boolean;
    snapMode: SnapMode;
    onApi: (pageId: string, api: ExcalidrawImperativeAPI | null) => void;
    onChange: (
        pageId: string,
        elements: readonly ExcalidrawElement[],
        appState: AppState,
        files: BinaryFiles,
    ) => void;
    onPointer: (p: ScenePoint | null) => void;
    /** A pointer press on the canvas before Excalidraw sees it; return true to keep it from Excalidraw */
    onCanvasPress?: (p: ScenePoint, event: PointerEvent) => boolean;
    /** Stores an image the user added and returns its sha256 */
    generateIdForFile: (file: File) => Promise<string>;
    /** Insets for "fit the field", so the panels don't cover it */
    fitInsets: { left: number; right: number; top: number; bottom: number };
}

const UI_OPTIONS = {
    canvasActions: {
        changeViewBackgroundColor: false,
        clearCanvas: false,
        export: false as const,
        loadScene: false,
        saveToActiveFile: false,
        saveAsImage: false,
        toggleTheme: false,
    },
    tools: { image: true },
};

/**
 * One page: an Excalidraw instance over the field underlay. The underlay is an SVG behind
 * Excalidraw (which runs with a transparent background); `onScrollChange` writes its transform
 * straight to the DOM, so it stays locked to the scene without a React render (spike: under
 * 1 px of drift).
 */
export const PageCanvas = memo(function PageCanvas({
    pageId,
    initialElements,
    snapshot,
    fieldProperties,
    store,
    active,
    snapMode,
    onApi,
    onChange,
    onPointer,
    onCanvasPress,
    generateIdForFile,
    fitInsets,
}: PageCanvasProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const underlayRef = useRef<SVGGElement>(null);
    const guideRef = useRef<SVGGElement>(null);
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const [guides, setGuidesState] = useState<SnapGuide[]>([]);
    const guidesRef = useRef<SnapGuide[]>([]);
    const setGuides = useCallback((next: SnapGuide[]) => {
        if (JSON.stringify(guidesRef.current) === JSON.stringify(next)) return;
        guidesRef.current = next;
        setGuidesState(next);
    }, []);
    const markup = useMemo(() => fieldUnderlayMarkup(snapshot), [snapshot]);

    const applyTransform = useCallback((sx: number, sy: number, z: number) => {
        const t = `scale(${z}) translate(${sx} ${sy})`;
        underlayRef.current?.setAttribute("transform", t);
        guideRef.current?.setAttribute("transform", t);
    }, []);

    const onScrollChange = useCallback(
        (sx: number, sy: number, zoom: { value: number }) =>
            applyTransform(sx, sy, zoom.value),
        [applyTransform],
    );

    // The scene loads with its files; Excalidraw repairs elements on restore
    const initialData = useMemo(
        () => async () => {
            const elements = restoreElements(initialElements, null, {
                repairBindings: true,
            });
            const files = await loadFiles(store, initialElements);
            return {
                elements,
                files: Object.fromEntries(files.map((f) => [f.id, f])),
                appState: {
                    viewBackgroundColor: "transparent",
                    currentItemStrokeColor: "#1e1e1e",
                    currentItemRoughness: 1,
                    currentItemFontFamily: 5,
                    currentItemRoundness: "sharp" as const,
                    currentItemBackgroundColor: "transparent",
                    activeTool: {
                        type: "freedraw" as const,
                        customType: null,
                        locked: false,
                        fromSelection: false,
                        lastActiveTool: null,
                    },
                    objectsSnapModeEnabled: false,
                },
            };
        },
        // Loaded once per mount; later changes come from Excalidraw itself
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const fitted = useRef(false);
    const handleApi = useCallback(
        (api: ExcalidrawImperativeAPI) => {
            apiRef.current = api;
            onApi(pageId, api);
            // Fit the field once the scene has loaded
            const poll = () => {
                if (apiRef.current !== api) return;
                const st = api.getAppState();
                if (st.isLoading || st.width === 0)
                    return void requestAnimationFrame(poll);
                if (!fitted.current) {
                    fitted.current = true;
                    fitField(api, fieldProperties, fitInsets);
                }
                const s = api.getAppState();
                applyTransform(s.scrollX, s.scrollY, s.zoom.value);
            };
            poll();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pageId, onApi, applyTransform],
    );

    // Tell the tab when this page unmounts (only then: onApi may change identity)
    const onApiRef = useRef(onApi);
    onApiRef.current = onApi;
    useEffect(() => () => onApiRef.current(pageId, null), [pageId]);

    // Pages hidden while mounted come back at the right size
    useEffect(() => {
        if (active) apiRef.current?.refresh();
    }, [active]);

    useEffect(() => {
        apiRef.current?.updateScene({
            appState: {
                objectsSnapModeEnabled: snapMode === "shapes",
            } as AppState,
            captureUpdate: CaptureUpdateAction.NEVER,
        });
    }, [snapMode]);

    // Field-aware snapping: rewrite the pointer's position before Excalidraw reads it
    const targets = useMemo(
        () => snapTargets(fieldProperties),
        [fieldProperties],
    );
    useEffect(() => {
        if (!active) return;
        let drag: { start: ScenePoint } | null = null;
        let rafPending = false;
        let lastPointer: ScenePoint | null = null;
        const report = () => {
            rafPending = false;
            onPointer(lastPointer);
        };
        const handler = (e: PointerEvent) => {
            const api = apiRef.current;
            const host = hostRef.current;
            if (!api || !host) return;
            const canvas = host.querySelector(
                "canvas.excalidraw__canvas.interactive",
            );
            const onCanvas = e.target === canvas;
            if (e.type === "pointerdown" && !onCanvas) return;
            if (e.type !== "pointerdown" && !drag && !onCanvas) return;
            const st = api.getAppState();
            const raw = clientToScene(st, e.clientX, e.clientY);
            lastPointer = raw;
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(report);
            }
            if (e.type === "pointerdown" && onCanvasPress?.(raw, e)) {
                e.stopImmediatePropagation();
                e.preventDefault();
                return;
            }
            const tool = st.activeTool.type;
            const bypass = e.ctrlKey || e.metaKey;
            const snapping =
                (snapMode === "steps" || snapMode === "lines") &&
                !bypass &&
                !NO_SNAP.has(tool);
            if (e.type === "pointerdown") drag = { start: raw };
            const done = e.type === "pointerup" || e.type === "pointercancel";
            if (!snapping) {
                setGuides([]);
                if (done) drag = null;
                return;
            }
            let target: ScenePoint;
            let nextGuides: SnapGuide[] = [];
            if (tool === "selection") {
                // Selecting is never snapped (it would miss thin lines); dragging moves in whole steps
                if (e.type === "pointerdown" || !drag || e.buttons === 0) {
                    if (done) drag = null;
                    return;
                }
                const d = snapDelta(fieldProperties, snapMode, {
                    x: raw.x - drag.start.x,
                    y: raw.y - drag.start.y,
                });
                target = { x: drag.start.x + d.x, y: drag.start.y + d.y };
            } else {
                const r = snapScenePoint(
                    fieldProperties,
                    snapMode,
                    raw,
                    st.zoom.value,
                    10,
                    targets,
                );
                target = r.point;
                nextGuides = r.guides;
            }
            const c = sceneToClient(st, target.x, target.y);
            Object.defineProperty(e, "clientX", {
                value: c.x,
                configurable: true,
            });
            Object.defineProperty(e, "clientY", {
                value: c.y,
                configurable: true,
            });
            setGuides(done ? [] : nextGuides);
            if (done) drag = null;
        };
        const leave = () => {
            lastPointer = null;
            onPointer(null);
            setGuides([]);
        };
        const types = [
            "pointerdown",
            "pointermove",
            "pointerup",
            "pointercancel",
        ] as const;
        for (const t of types) window.addEventListener(t, handler, true);
        const host = hostRef.current;
        host?.addEventListener("pointerleave", leave);
        return () => {
            for (const t of types) window.removeEventListener(t, handler, true);
            host?.removeEventListener("pointerleave", leave);
        };
    }, [
        active,
        snapMode,
        fieldProperties,
        targets,
        onPointer,
        onCanvasPress,
        setGuides,
    ]);

    const handleChange = useCallback(
        (
            elements: readonly ExcalidrawElement[],
            appState: AppState,
            files: BinaryFiles,
        ) => onChange(pageId, elements, appState, files),
        [onChange, pageId],
    );

    const fp = fieldProperties;
    const left = -fp.centerFrontPoint.xPixels;
    const right = fp.width - fp.centerFrontPoint.xPixels;
    const top = -fp.height;

    return (
        <div
            ref={hostRef}
            className="om-sketch-page absolute inset-0"
            data-page-id={pageId}
            data-active={active ? "true" : "false"}
            style={{ visibility: active ? "visible" : "hidden" }}
        >
            <svg
                className="pointer-events-none absolute inset-0 size-full"
                data-testid={active ? "field-underlay" : undefined}
                aria-hidden
            >
                <g
                    ref={underlayRef}
                    dangerouslySetInnerHTML={{ __html: markup }}
                />
            </svg>
            <div className="absolute inset-0">
                <Excalidraw
                    excalidrawAPI={handleApi}
                    initialData={initialData}
                    onChange={handleChange}
                    onScrollChange={onScrollChange}
                    UIOptions={UI_OPTIONS}
                    generateIdForFile={generateIdForFile}
                    theme="light"
                    autoFocus={active}
                />
            </div>
            <svg
                className="pointer-events-none absolute inset-0 size-full"
                aria-hidden
            >
                <g ref={guideRef}>
                    {guides.map((g) =>
                        g.axis === "x" ? (
                            <line
                                key={`x${g.value}`}
                                x1={g.value}
                                x2={g.value}
                                y1={top - 30}
                                y2={30}
                                className="om-snap-guide"
                                vectorEffect="non-scaling-stroke"
                            />
                        ) : (
                            <line
                                key={`y${g.value}`}
                                x1={left - 30}
                                x2={right + 30}
                                y1={g.value}
                                y2={g.value}
                                className="om-snap-guide"
                                vectorEffect="non-scaling-stroke"
                            />
                        ),
                    )}
                </g>
            </svg>
            {guides.length > 0 && (
                <div
                    className="om-snap-label pointer-events-none absolute top-[4.75rem] left-1/2 -translate-x-1/2"
                    data-testid="snap-guide-label"
                >
                    {guides.map((g) => g.label).join(" · ")}
                </div>
            )}
        </div>
    );
});
