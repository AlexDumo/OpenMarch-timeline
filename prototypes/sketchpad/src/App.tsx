import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  getCommonBounds,
  reconcileElements,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  DEFAULT_FIELD_STYLE,
  FIELD_H,
  FIELD_W,
  FRONT_HASH_Y,
  type FieldStyle,
  fieldSegments,
  fieldSvgContent,
  fieldSvgDocument,
  yardX,
} from "./field";
import { jsPDF } from "jspdf";
import "svg2pdf.js";

type FieldMode = "svg" | "elements" | "image";
const params = new URLSearchParams(location.search);
const FIELD_MODE = (params.get("field") as FieldMode) || "svg";
const PROBE = params.get("probe") === "1";
const COLLAB = params.get("collab") === "1";
const TAB = params.get("tab") || Math.random().toString(36).slice(2, 6);

// Any element we create for the field (elements/image comparison modes) carries this flag.
const isFieldEl = (e: { customData?: Record<string, unknown> }) => !!e.customData?.omField;
type El = ReturnType<ExcalidrawImperativeAPI["getSceneElements"]>[number];

// ---------- field as Excalidraw elements (comparison modes) ----------
function fieldAsElements(style: FieldStyle) {
  const skel: any[] = [
    { type: "rectangle", x: 0, y: 0, width: FIELD_W, height: FIELD_H, backgroundColor: style.turf, fillStyle: "solid", strokeColor: style.lineColor, strokeWidth: 2, roughness: 0 },
  ];
  for (const s of fieldSegments(style)) {
    skel.push({ type: "line", x: s.x1, y: s.y1, points: [[0, 0], [s.x2 - s.x1, s.y2 - s.y1]], strokeColor: s.color, strokeWidth: s.w, roughness: 0 });
  }
  for (let yd = 10; yd <= 90; yd += 10) {
    const t = String(yd <= 50 ? yd : 100 - yd);
    skel.push({ type: "text", x: yardX(yd) - 30, y: FIELD_H - 12 * 12 - 50, text: t, fontSize: 56, strokeColor: style.lineColor });
  }
  return convertToExcalidrawElements(skel).map((e) => ({ ...e, locked: true, customData: { omField: true } }));
}

const svgDataUrl = (svg: string) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));

function fieldAsImage(style: FieldStyle) {
  const [img] = convertToExcalidrawElements([
    { type: "image", x: 0, y: 0, width: FIELD_W, height: FIELD_H, fileId: "om-field" as any } as any,
  ]);
  return {
    element: { ...img, locked: true, status: "saved", customData: { omField: true } },
    file: { id: "om-field" as any, dataURL: svgDataUrl(fieldSvgDocument(style)) as any, mimeType: "image/svg+xml" as const, created: Date.now() },
  };
}

// ---------- the ".dots table" stand-in ----------
interface DotsRow { id: string; name: string; kind: "sketch" | "template"; json: string; updatedAt: number }
const TABLE_KEY = "om-sketch:dots";
const readTable = (): DotsRow[] => { try { return JSON.parse(localStorage.getItem(TABLE_KEY) || "[]"); } catch { return []; } };
const writeTable = (rows: DotsRow[]) => localStorage.setItem(TABLE_KEY, JSON.stringify(rows));

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [fieldStyle, setFieldStyle] = useState<FieldStyle>({ ...DEFAULT_FIELD_STYLE, probe: PROBE });
  const [status, setStatus] = useState("");
  const gRef = useRef<SVGGElement>(null);
  const scrollLog = useRef<{ t: number; sx: number; sy: number; z: number }[]>([]);

  // --- underlay sync: write the transform straight to the DOM, no React render ---
  const applyTransform = useCallback((sx: number, sy: number, z: number) => {
    gRef.current?.setAttribute("transform", `scale(${z}) translate(${sx} ${sy})`);
    scrollLog.current.push({ t: performance.now(), sx, sy, z });
    if (scrollLog.current.length > 5000) scrollLog.current.splice(0, 2500);
  }, []);

  const onScrollChange = useCallback((sx: number, sy: number, zoom: { value: number }) => applyTransform(sx, sy, zoom.value), [applyTransform]);

  const fieldMarkup = useMemo(() => fieldSvgContent(fieldStyle), [fieldStyle]);

  // Excalidraw loads initialData asynchronously and replaces the scene when done, so
  // wait for appState.isLoading to clear before touching the scene.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!api) return;
    let raf = 0;
    const poll = () => (api.getAppState().isLoading ? (raf = requestAnimationFrame(poll)) : setReady(true));
    poll();
    return () => cancelAnimationFrame(raf);
  }, [api]);

  // field elements for the comparison modes
  useEffect(() => {
    if (!api || !ready) return;
    const st = api.getAppState();
    applyTransform(st.scrollX, st.scrollY, st.zoom.value);
    const others = api.getSceneElementsIncludingDeleted().filter((e) => !isFieldEl(e));
    if (FIELD_MODE === "elements") {
      api.updateScene({ elements: [...fieldAsElements(fieldStyle), ...others] as any, captureUpdate: CaptureUpdateAction.NEVER });
    } else if (FIELD_MODE === "image") {
      const { element, file } = fieldAsImage(fieldStyle);
      api.addFiles([file]);
      api.updateScene({ elements: [element, ...others] as any, captureUpdate: CaptureUpdateAction.NEVER });
    }
  }, [api, ready, fieldStyle, applyTransform]);

  // fit the field once
  useEffect(() => {
    if (!api || !ready) return;
    const w = window.innerWidth, h = window.innerHeight;
    const z = Math.min(w / (FIELD_W + 160), h / (FIELD_H + 160));
    api.updateScene({ appState: { zoom: { value: z as any }, scrollX: (w / z - FIELD_W) / 2, scrollY: (h / z - FIELD_H) / 2 }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [api, ready]);

  // ---------- custom fills ----------
  const setFill = useCallback((fillStyle: string) => {
    if (!api) return;
    const sel = api.getAppState().selectedElementIds;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e) =>
        sel[e.id] && ["rectangle", "ellipse", "diamond"].includes(e.type)
          ? ({ ...e, fillStyle, backgroundColor: e.backgroundColor === "transparent" ? "#1e1e1e" : e.backgroundColor, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } as any)
          : e,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, [api]);

  // ---------- sticky notes ----------
  const addSticky = useCallback((text = "Note: company B\nenters here", x?: number, y?: number) => {
    if (!api) return;
    const st = api.getAppState();
    const cx = x ?? -st.scrollX + st.width / st.zoom.value / 2 - 100;
    const cy = y ?? -st.scrollY + st.height / st.zoom.value / 2 - 70;
    const els = convertToExcalidrawElements([
      { type: "rectangle", x: cx, y: cy, width: 200, height: 140, backgroundColor: "#ffec99", fillStyle: "solid", strokeColor: "#e8b500", roughness: 0, roundness: { type: 3 }, label: { text, fontSize: 18, strokeColor: "#1e1e1e", textAlign: "left", verticalAlign: "top" }, customData: { omSticky: true } } as any,
    ]);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    return els;
  }, [api]);

  // ---------- save / load ----------
  const userElements = useCallback(() => (api ? api.getSceneElements().filter((e) => !isFieldEl(e)) : []), [api]);
  const serialize = useCallback(() => {
    if (!api) return "";
    const files = { ...api.getFiles() };
    delete (files as any)["om-field"];
    return serializeAsJSON(userElements(), api.getAppState(), files, "local");
  }, [api, userElements]);

  const save = useCallback((name = "Opener sketch", kind: DotsRow["kind"] = "sketch", id = "sketch-1") => {
    const rows = readTable().filter((r) => r.id !== id);
    rows.push({ id, name, kind, json: serialize(), updatedAt: Date.now() });
    writeTable(rows);
    setStatus(`saved ${kind} "${name}"`);
    return id;
  }, [serialize]);

  const load = useCallback((id = "sketch-1") => {
    if (!api) return false;
    const row = readTable().find((r) => r.id === id);
    if (!row) return false;
    const data = restore(JSON.parse(row.json), null, null);
    const field = api.getSceneElementsIncludingDeleted().filter(isFieldEl);
    if (data.files) api.addFiles(Object.values(data.files));
    api.updateScene({ elements: [...field, ...data.elements] as any, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setStatus(`loaded "${row.name}"`);
    return true;
  }, [api]);

  const saveAsTemplate = useCallback(() => {
    const id = "tpl-" + Date.now().toString(36);
    save("Template from sketch", "template", id);
    return id;
  }, [save]);

  // ---------- export (field composited under the Excalidraw scene) ----------
  const exportBounds = useCallback(() => {
    const els = userElements();
    let [x1, y1, x2, y2] = [0, 0, FIELD_W, FIELD_H];
    if (els.length) {
      const [a, b, c, d] = getCommonBounds(els);
      x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d);
    }
    const pad = 24;
    return { x: Math.floor(x1 - pad), y: Math.floor(y1 - pad), w: Math.ceil(x2 - x1 + 2 * pad), h: Math.ceil(y2 - y1 + 2 * pad) };
  }, [userElements]);

  // An invisible rectangle pins Excalidraw's export bounds to our known viewport.
  const boundsElement = (b: { x: number; y: number; w: number; h: number }) =>
    convertToExcalidrawElements([{ type: "rectangle", x: b.x, y: b.y, width: b.w, height: b.h, strokeColor: "transparent", backgroundColor: "transparent", strokeWidth: 1, roughness: 0 } as any])[0];

  const exportOpts = useCallback(() => {
    const b = exportBounds();
    const files = { ...api!.getFiles() };
    return {
      b,
      opts: {
        elements: [boundsElement(b), ...userElements()],
        appState: { ...api!.getAppState(), exportBackground: false, exportWithDarkMode: false },
        files,
        exportPadding: 0,
      },
    };
  }, [api, exportBounds, userElements]);

  const exportCompositeSvg = useCallback(async () => {
    const { b, opts } = exportOpts();
    const scene = await exportToSvg(opts as any);
    const ns = "http://www.w3.org/2000/svg";
    const out = document.createElementNS(ns, "svg");
    out.setAttribute("xmlns", ns);
    out.setAttribute("width", String(b.w));
    out.setAttribute("height", String(b.h));
    out.setAttribute("viewBox", `0 0 ${b.w} ${b.h}`);
    const field = document.createElementNS(ns, "g");
    field.setAttribute("transform", `translate(${-b.x} ${-b.y})`);
    field.innerHTML = fieldSvgContent({ ...fieldStyle, probe: false });
    out.appendChild(field);
    const sceneG = document.createElementNS(ns, "g");
    sceneG.setAttribute("data-excalidraw", "scene");
    while (scene.firstChild) sceneG.appendChild(scene.firstChild);
    out.appendChild(sceneG);
    const sceneW = Number(scene.getAttribute("width"));
    return { svg: out, text: new XMLSerializer().serializeToString(out), b, sceneW };
  }, [exportOpts, fieldStyle]);

  const exportCompositePng = useCallback(async (scale = 2) => {
    const { b, opts } = exportOpts();
    const sceneBlob = await exportToBlob({ ...(opts as any), appState: { ...opts.appState, exportScale: scale }, mimeType: "image/png" });
    const canvas = document.createElement("canvas");
    canvas.width = b.w * scale;
    canvas.height = b.h * scale;
    const ctx = canvas.getContext("2d")!;
    const fieldImg = new Image();
    fieldImg.src = svgDataUrl(fieldSvgDocument({ ...fieldStyle, probe: false }, b, scale));
    await fieldImg.decode();
    ctx.drawImage(fieldImg, 0, 0, canvas.width, canvas.height);
    const sceneImg = await createImageBitmap(sceneBlob);
    ctx.drawImage(sceneImg, 0, 0, canvas.width, canvas.height);
    return { blob: await new Promise<Blob>((r) => canvas.toBlob((x) => r(x!), "image/png")), b, sceneSize: [sceneImg.width, sceneImg.height] };
  }, [exportOpts, fieldStyle]);

  const exportPdf = useCallback(async () => {
    const { svg, b } = await exportCompositeSvg();
    const doc = new jsPDF({ orientation: b.w > b.h ? "landscape" : "portrait", unit: "pt", format: [b.w, b.h] });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-99999px;top:0";
    host.appendChild(svg);
    document.body.appendChild(host);
    await (doc as any).svg(svg, { x: 0, y: 0, width: b.w, height: b.h });
    host.remove();
    return doc.output("blob");
  }, [exportCompositeSvg]);

  // ---------- collab over BroadcastChannel ----------
  const sentVersions = useRef(new Map<string, number>());
  const sentFiles = useRef(new Set<string>());
  const chan = useMemo(() => (COLLAB ? new BroadcastChannel("om-sketch-room") : null), []);
  const collabStats = useRef({ sent: 0, received: 0, lastApplyMs: 0, lastLatencyMs: 0 });
  useEffect(() => {
    if (!api || !chan) return;
    chan.onmessage = (ev) => {
      const t0 = performance.now();
      const { elements, files, sentAt } = ev.data;
      if (files?.length) { api.addFiles(files); files.forEach((f: any) => sentFiles.current.add(f.id)); }
      const local = api.getSceneElementsIncludingDeleted();
      const merged = reconcileElements(local as any, elements, api.getAppState());
      for (const e of elements) sentVersions.current.set(e.id, Math.max(e.version, sentVersions.current.get(e.id) ?? 0));
      api.updateScene({ elements: merged as any, captureUpdate: CaptureUpdateAction.NEVER });
      collabStats.current.received += elements.length;
      collabStats.current.lastApplyMs = performance.now() - t0;
      collabStats.current.lastLatencyMs = Date.now() - sentAt;
    };
    return () => { chan.onmessage = null; };
  }, [api, chan]);

  const onChange = useCallback((elements: readonly El[], _st: unknown, files: Record<string, any>) => {
    if (!chan) return;
    const changed = elements.filter((e) => !isFieldEl(e) && (sentVersions.current.get(e.id) ?? -1) < e.version);
    if (!changed.length) return;
    changed.forEach((e) => sentVersions.current.set(e.id, e.version));
    const newFiles = Object.values(files).filter((f) => f.id !== "om-field" && !sentFiles.current.has(f.id));
    newFiles.forEach((f) => sentFiles.current.add(f.id));
    collabStats.current.sent += changed.length;
    chan.postMessage({ elements: changed, files: newFiles, sentAt: Date.now(), from: TAB });
  }, [chan]);

  // ---------- test hooks ----------
  useEffect(() => {
    if (!api || !ready) return;
    (window as any).sketch = {
      api, setFill, addSticky, save, load, saveAsTemplate, serialize, readTable, setFieldStyle,
      exportCompositeSvg: async () => (await exportCompositeSvg()).text,
      exportCompositeSvgInfo: async () => { const r = await exportCompositeSvg(); return { b: r.b, sceneW: r.sceneW, len: r.text.length }; },
      exportPngDataUrl: async () => { const { blob } = await exportCompositePng(); return await blobToDataUrl(blob); },
      exportPdfDataUrl: async () => blobToDataUrl(await exportPdf()),
      scrollLog: () => scrollLog.current,
      collabStats: () => collabStats.current,
      fieldMode: FIELD_MODE,
      probeX: yardX(50), probeY: FRONT_HASH_Y,
    };
    (window as any).__ex = { convertToExcalidrawElements };
    (window as any).sketchReady = true;
  }, [api, setFill, addSticky, save, load, saveAsTemplate, serialize, exportCompositeSvg, exportCompositePng, exportPdf, ready]);

  const btn = (label: string, fn: () => unknown, testid?: string) => (
    <button data-testid={testid} onClick={() => void fn()} style={{ display: "block", width: "100%", margin: "2px 0", fontSize: 12 }}>{label}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#2b2f33" }}>
      {FIELD_MODE === "svg" && (
        <svg data-testid="field-underlay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <g ref={gRef} dangerouslySetInnerHTML={{ __html: fieldMarkup }} />
        </svg>
      )}
      <div style={{ position: "absolute", inset: 0 }} className="om-excalidraw-host">
        <Excalidraw
          excalidrawAPI={setApi}
          onScrollChange={onScrollChange}
          onChange={onChange as any}
          initialData={{ appState: { viewBackgroundColor: "transparent", currentItemStrokeColor: "#1e1e1e" } }}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false } }}
        />
      </div>
      <div style={{ position: "absolute", right: 8, top: 64, width: 132, background: "#fffffff0", borderRadius: 8, padding: 6, fontSize: 11, zIndex: 10, boxShadow: "0 1px 4px #0004" }}>
        <b>Sketchpad spike</b>
        <div>field: {FIELD_MODE}{COLLAB ? ` · collab ${TAB}` : ""}</div>
        <hr />
        {btn("Fill: dots", () => setFill("om-dots"), "fill-dots")}
        {btn("Fill: staggered", () => setFill("om-dots-staggered"), "fill-staggered")}
        {btn("Fill: even", () => setFill("om-dots-even"), "fill-even")}
        {btn("Sticky note", () => addSticky(), "sticky")}
        <hr />
        <label><input type="checkbox" checked={fieldStyle.grid} onChange={(e) => setFieldStyle((s) => ({ ...s, grid: e.target.checked }))} /> step grid</label>
        <div>
          lines <select value={fieldStyle.lineColor} onChange={(e) => setFieldStyle((s) => ({ ...s, lineColor: e.target.value }))}>
            <option value="#ffffff">white</option>
            <option value="#ffd43b">yellow</option>
            <option value="#1e1e1e">black</option>
          </select>
        </div>
        <hr />
        {btn("Save", () => save(), "save")}
        {btn("Load", () => load(), "load")}
        {btn("Save as template", () => saveAsTemplate(), "template")}
        <hr />
        {btn("Export PNG", async () => download("sketch.png", (await exportCompositePng()).blob))}
        {btn("Export SVG", async () => download("sketch.svg", new Blob([(await exportCompositeSvg()).text], { type: "image/svg+xml" })))}
        {btn("Export PDF", async () => download("sketch.pdf", await exportPdf()))}
        <div style={{ color: "#555" }}>{status}</div>
      </div>
      <style>{`.om-excalidraw-host .excalidraw, .om-excalidraw-host .excalidraw-container { background: transparent !important; }`}</style>
    </div>
  );
}

function blobToDataUrl(b: Blob) {
  return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });
}
