import {
    CaptureUpdateAction,
    convertToExcalidrawElements,
    restoreElements,
} from "@excalidraw/excalidraw";
import type {
    ExcalidrawElement,
    NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
    AppState,
    BinaryFileData,
    ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FieldProperties } from "@openmarch/core";
import { fieldSceneBounds } from "../drill/coordinates";
import { randomInteger } from "../ids";
import type { SketchStore } from "../types";
import { isImageDataUrl } from "../doc/sketchDoc";

export type Api = ExcalidrawImperativeAPI;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The selected elements, plus the text bound to selected containers */
export function selectedElements(
    api: Api,
    withBoundText = false,
): ExcalidrawElement[] {
    const ids = api.getAppState().selectedElementIds;
    const all = api.getSceneElements();
    const picked = all.filter((e) => ids[e.id]);
    if (!withBoundText) return picked;
    const containers = new Set(picked.map((e) => e.id));
    const bound = all.filter(
        (e) =>
            e.type === "text" &&
            e.containerId &&
            containers.has(e.containerId) &&
            !ids[e.id],
    );
    return [...picked, ...bound];
}

/** A changed copy of an element, as Excalidraw's own actions make (new version and nonce) */
export function withChanges<T extends ExcalidrawElement>(
    el: T,
    changes: Partial<T>,
): T {
    return {
        ...el,
        ...changes,
        version: el.version + 1,
        versionNonce: randomInteger(),
        updated: Date.now(),
    };
}

/**
 * Changes the selected elements (one undo step) and the style for new ones. `pick` returns the
 * changes for each selected element, or null to leave it.
 */
export function changeSelection(
    api: Api,
    pick: (el: ExcalidrawElement) => Partial<ExcalidrawElement> | null,
    appState: Partial<AppState> = {},
    { withBoundText = false, refreshText = false } = {},
): void {
    const targets = new Map(
        selectedElements(api, withBoundText).map((e) => [e.id, e]),
    );
    let changed: ExcalidrawElement[] = [];
    const elements = api.getSceneElementsIncludingDeleted().map((el) => {
        if (!targets.has(el.id)) return el;
        const changes = pick(el);
        if (!changes) return el;
        const next = withChanges(el, changes);
        changed.push(next);
        return next;
    });
    if (refreshText && changed.some((e) => e.type === "text")) {
        // Text needs measuring again after a font change
        const map = new Map(elements.map((e) => [e.id, e]));
        changed = restoreElements(changed, null, { refreshDimensions: true });
        for (const e of changed) map.set(e.id, e);
        api.updateScene({
            elements: [...map.values()],
            appState: appState as AppState,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return;
    }
    api.updateScene({
        elements,
        appState: appState as AppState,
        captureUpdate: changed.length
            ? CaptureUpdateAction.IMMEDIATELY
            : CaptureUpdateAction.EVENTUALLY,
    });
}

/** Moves the selection in the stacking order */
export function reorderSelection(
    api: Api,
    to: "back" | "backward" | "forward" | "front",
) {
    const ids = api.getAppState().selectedElementIds;
    const all = [...api.getSceneElementsIncludingDeleted()];
    const isSel = (e: ExcalidrawElement) =>
        !!ids[e.id] ||
        (e.type === "text" && !!e.containerId && !!ids[e.containerId]);
    let next: ExcalidrawElement[];
    if (to === "front")
        next = [...all.filter((e) => !isSel(e)), ...all.filter(isSel)];
    else if (to === "back")
        next = [...all.filter(isSel), ...all.filter((e) => !isSel(e))];
    else {
        next = [...all];
        const dir = to === "forward" ? 1 : -1;
        const order = dir === 1 ? [...next.keys()].reverse() : [...next.keys()];
        for (const i of order) {
            const j = i + dir;
            if (j < 0 || j >= next.length) continue;
            if (isSel(next[i]!) && !isSel(next[j]!)) {
                [next[i], next[j]] = [next[j]!, next[i]!];
            }
        }
    }
    api.updateScene({
        // Excalidraw repairs the fractional indices from the new order
        elements: next.map((e) => (isSel(e) ? withChanges(e, {}) : e)),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
}

/** Adds elements to the scene and selects them, as one undo step */
export function addElements(api: Api, added: readonly ExcalidrawElement[]) {
    const selectedElementIds: Record<string, true> = {};
    for (const e of added)
        if (!(e.type === "text" && e.containerId))
            selectedElementIds[e.id] = true;
    api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...added],
        appState: { selectedElementIds } as Partial<AppState> as AppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
}

export function deleteSelection(api: Api) {
    changeSelection(
        api,
        () => ({ isDeleted: true }),
        { selectedElementIds: {} },
        { withBoundText: true },
    );
}

export const STICKY_COLORS = {
    yellow: { fill: "#fff3bf", stroke: "#f2c94c" },
    pink: { fill: "#ffdeeb", stroke: "#f783ac" },
    blue: { fill: "#d0ebff", stroke: "#74c0fc" },
    green: { fill: "#d3f9d8", stroke: "#8ce99a" },
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;

export const isSticky = (el: ExcalidrawElement) =>
    !!(el.customData as { omSticky?: boolean } | undefined)?.omSticky;

/** A sticky note: a rounded pastel square with a bound label, tagged `customData.omSticky` */
export function createSticky(
    x: number,
    y: number,
    color: StickyColor = "yellow",
    text = "",
): ExcalidrawElement[] {
    const c = STICKY_COLORS[color];
    const size = 150;
    return convertToExcalidrawElements(
        [
            {
                type: "rectangle",
                x: x - size / 2,
                y: y - size / 2,
                width: size,
                height: size,
                backgroundColor: c.fill,
                fillStyle: "solid",
                strokeColor: c.stroke,
                strokeWidth: 1,
                roughness: 0,
                roundness: { type: 3 },
                label: {
                    text: text || " ",
                    fontSize: 20,
                    strokeColor: "#1e1e1e",
                    textAlign: "left",
                    verticalAlign: "top",
                },
                customData: { omSticky: true, color },
            },
        ] as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: true },
    ) as ExcalidrawElement[];
}

/** Starts editing the label of the one selected container, as pressing Enter does */
export function editSelectedLabel(container: HTMLElement | null) {
    const target =
        container?.querySelector<HTMLElement>(".excalidraw-container") ??
        container;
    target?.dispatchEvent(
        new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
        }),
    );
}

/** Clicks one of Excalidraw's own (hidden) buttons, such as undo */
export function clickExcalidrawButton(
    container: HTMLElement | null,
    testId: string,
) {
    container
        ?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
        ?.click();
}

/** Zoom and scroll that fit `bounds` into the visible area, leaving room for the panels */
export function fitView(
    appState: Pick<AppState, "width" | "height">,
    bounds: { x: number; y: number; width: number; height: number },
    insets = { left: 16, right: 16, top: 72, bottom: 64 },
) {
    const availW = Math.max(100, appState.width - insets.left - insets.right);
    const availH = Math.max(100, appState.height - insets.top - insets.bottom);
    const zoom = Math.max(
        0.1,
        Math.min(30, Math.min(availW / bounds.width, availH / bounds.height)),
    );
    const cx = insets.left + availW / 2;
    const cy = insets.top + availH / 2;
    return {
        zoom,
        scrollX: cx / zoom - (bounds.x + bounds.width / 2),
        scrollY: cy / zoom - (bounds.y + bounds.height / 2),
    };
}

export function fitField(
    api: Api,
    fp: FieldProperties,
    insets?: Parameters<typeof fitView>[2],
) {
    const st = api.getAppState();
    const v = fitView(st, fieldSceneBounds(fp, 40), insets);
    api.updateScene({
        appState: {
            zoom: { value: v.zoom },
            scrollX: v.scrollX,
            scrollY: v.scrollY,
        } as unknown as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
    });
}

/** Zooms about the middle of the view */
export function zoomTo(api: Api, value: number) {
    const st = api.getAppState();
    const zoom = Math.max(0.1, Math.min(30, value));
    const cx = st.width / 2;
    const cy = st.height / 2;
    const sceneX = cx / st.zoom.value - st.scrollX;
    const sceneY = cy / st.zoom.value - st.scrollY;
    api.updateScene({
        appState: {
            zoom: { value: zoom },
            scrollX: cx / zoom - sceneX,
            scrollY: cy / zoom - sceneY,
        } as unknown as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
    });
}

/** The scene point under a client (window) point */
export function clientToScene(
    st: Pick<
        AppState,
        "zoom" | "scrollX" | "scrollY" | "offsetLeft" | "offsetTop"
    >,
    clientX: number,
    clientY: number,
) {
    return {
        x: (clientX - st.offsetLeft) / st.zoom.value - st.scrollX,
        y: (clientY - st.offsetTop) / st.zoom.value - st.scrollY,
    };
}

export function sceneToClient(
    st: Pick<
        AppState,
        "zoom" | "scrollX" | "scrollY" | "offsetLeft" | "offsetTop"
    >,
    x: number,
    y: number,
) {
    return {
        x: (x + st.scrollX) * st.zoom.value + st.offsetLeft,
        y: (y + st.scrollY) * st.zoom.value + st.offsetTop,
    };
}

export const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

/**
 * An image data URL as a blob. Anything else is refused: sketch files are untrusted, and a
 * plain `fetch` would follow `https:` or `file:` URLs.
 */
export async function dataUrlToBlob(dataURL: string): Promise<Blob> {
    if (!isImageDataUrl(dataURL))
        throw new Error("A sketch image must be an image data URL");
    return (await fetch(dataURL)).blob();
}

/** The image files a set of elements refers to, from the store */
export async function loadFiles(
    store: Pick<SketchStore, "getFile">,
    elements: readonly ExcalidrawElement[],
): Promise<BinaryFileData[]> {
    const ids = new Set<string>();
    for (const e of elements)
        if (e.type === "image" && !e.isDeleted && e.fileId) ids.add(e.fileId);
    const files: BinaryFileData[] = [];
    await Promise.all(
        [...ids].map(async (id) => {
            const blob = await store.getFile(id);
            if (!blob) return;
            files.push({
                id: id as BinaryFileData["id"],
                dataURL: (await blobToDataUrl(
                    blob,
                )) as BinaryFileData["dataURL"],
                mimeType: (blob.type ||
                    "image/png") as BinaryFileData["mimeType"],
                created: Date.now(),
            });
        }),
    );
    return files;
}

/** Elements as stored: images marked saved (their files are in the store) */
export function elementsForSave(
    elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
    return elements.map((e) =>
        e.type === "image" && e.status !== "saved"
            ? ({ ...e, status: "saved" } as Writable<
                  typeof e
              > as ExcalidrawElement)
            : e,
    );
}

export const visible = (elements: readonly ExcalidrawElement[]) =>
    elements.filter((e) => !e.isDeleted) as NonDeletedExcalidrawElement[];
