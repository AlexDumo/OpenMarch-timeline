/**
 * PROTOTYPE. The page: toolbar, field, transport, and the SVG overlay for
 * selection UI. React renders only the chrome; the field is drawn by the
 * editor's own frame loop.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Editor, type FrameStats, type Handle } from "./editor";
import { fetchDemo, loadDotsShow } from "./realShow";
import { makeStressShow, type ShowSource } from "./source";

export const SHOWS = [
    { id: "part1", name: "Part 1 Demo (.dots)", file: "demos/part1-demo.dots" },
    { id: "lhb", name: "LHB Daft Punk pt. 2 (.dots)", file: "demos/lhb-daft-punk-pt2.dots" },
    // Made by cloning LHB's marchers 5x (not committed; see the README).
    { id: "lhbx5", name: "LHB ×5: 1,925 marchers (.dots)", file: "demos/lhb-x5.dots" },
    { id: "stress2000", name: "Stress: 2,000 marchers", count: 2000 },
    { id: "stress5000", name: "Stress: 5,000 marchers", count: 5000 },
] as const;

const params = new URLSearchParams(location.search);
export const renderOpts = {
    antialias: params.get("aa") !== "0",
    dprCap: Number(params.get("dpr") ?? 2),
};

function setParam(key: string, value: string) {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    location.href = url.toString();
}

async function loadShow(id: string): Promise<ShowSource> {
    const show = SHOWS.find((s) => s.id === id) ?? SHOWS[0];
    if ("count" in show) return makeStressShow(show.count);
    return loadDotsShow(await fetchDemo(show.file), show.name);
}

function useEditorVersion(editor: Editor | null) {
    return useSyncExternalStore(
        editor?.subscribe ?? (() => () => {}),
        editor?.getVersion ?? (() => 0),
    );
}

const fmt = (ms: number) => {
    const s = ms / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [showId, setShowId] = useState(params.get("show") ?? "part1");
    const [loading, setLoading] = useState<string | null>("Loading…");
    const [loadMs, setLoadMs] = useState<number | null>(null);
    const [bench, setBench] = useState<Record<string, FrameStats> | null>(null);
    const [benching, setBenching] = useState(false);
    useEditorVersion(editor);

    useEffect(() => {
        const ed = new Editor(containerRef.current!, canvasRef.current!, renderOpts);
        setEditor(ed);
        (window as any).__proto = {
            editor: ed,
            ready: null as Promise<void> | null,
            bench: (kind: Parameters<Editor["bench"]>[0], ms?: number) => ed.bench(kind, ms),
            gl: () => {
                const gl = ed.scene.renderer.getContext();
                const dbg = gl.getExtension("WEBGL_debug_renderer_info");
                return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            },
        };
        return () => ed.scene.dispose();
    }, []);

    useEffect(() => {
        if (!editor) return;
        let cancelled = false;
        setLoading(`Loading ${showId}…`);
        const t0 = performance.now();
        const p = loadShow(showId).then((src) => {
            if (cancelled) return;
            editor.setShow(src);
            setLoadMs(performance.now() - t0);
            setLoading(null);
        });
        (window as any).__proto.ready = p;
        p.catch((e) => setLoading(`Couldn't load: ${String(e)}`));
        const url = new URL(location.href);
        url.searchParams.set("show", showId);
        history.replaceState(null, "", url);
        return () => {
            cancelled = true;
        };
    }, [editor, showId]);

    async function runBenchmarks() {
        if (!editor) return;
        setBenching(true);
        const out: Record<string, FrameStats> = {};
        for (const kind of ["play", "scrub", "zoom", "pan", "drag"] as const) {
            out[kind] = await editor.bench(kind, 4000);
            setBench({ ...out });
        }
        setBenching(false);
    }

    const src = editor?.source;
    const t = editor?.scene.toggles;
    const toggle = (key: keyof NonNullable<typeof t>) => {
        if (!editor || !t) return;
        if (key === "grid") editor.scene.setGrid(!t.grid);
        else {
            t[key] = !t[key];
            editor.scene.applyToggles();
        }
        editor.invalidate(true);
        editor.notify(true);
    };
    const page = editor?.pageIndex ?? -1;
    const pageAt = editor?.pageAtTime ?? 0;

    return (
        <div className="app">
            <header className="toolbar">
                <strong>three.js field prototype</strong>
                <select value={showId} onChange={(e) => setShowId(e.target.value)}>
                    {SHOWS.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name}
                        </option>
                    ))}
                </select>
                <span className="sep" />
                <label title="MSAA. Off = potato mode; dots and text stay smooth anyway">
                    <input type="checkbox" checked={renderOpts.antialias} onChange={(e) => setParam("aa", e.target.checked ? "1" : "0")} /> MSAA
                </label>
                <label title="Caps the device pixel ratio">
                    DPR ≤
                    <select value={String(renderOpts.dprCap)} onChange={(e) => setParam("dpr", e.target.value)}>
                        {["1", "1.5", "2", "3"].map((v) => (
                            <option key={v}>{v}</option>
                        ))}
                    </select>
                </label>
                <span className="sep" />
                {t &&
                    (
                        [
                            ["labels", "Labels"],
                            ["screenSizedLabels", "Fixed-size labels"],
                            ["ghosts", "Prev page"],
                            ["pathways", "Pathways"],
                            ["grid", "Grid"],
                        ] as const
                    ).map(([key, name]) => (
                        <label key={key}>
                            <input type="checkbox" checked={t[key]} onChange={() => toggle(key)} /> {name}
                        </label>
                    ))}
                <span className="sep" />
                <button onClick={() => editor?.undo()} disabled={!editor?.canUndo}>
                    Undo
                </button>
                <button onClick={() => editor?.redo()} disabled={!editor?.canRedo}>
                    Redo
                </button>
                <button onClick={() => editor?.fitField()}>Fit</button>
                <button onClick={runBenchmarks} disabled={benching || !src}>
                    {benching ? "Benchmarking…" : "Run benchmarks"}
                </button>
            </header>

            <div className="stage" ref={containerRef}>
                <canvas ref={canvasRef} />
                {editor && <Overlay editor={editor} />}
                <div className="hud">
                    <div>{src ? `${src.count.toLocaleString()} marchers · ${src.pages.length} pages` : "—"}</div>
                    <div>
                        {editor?.playing || benching ? `${editor?.fpsDisplay.toFixed(0)} fps · ` : ""}
                        CPU {editor?.lastCpuMs.toFixed(2)} ms
                        {editor?.scene.gpuMs != null ? ` · GPU ${editor.scene.gpuMs.toFixed(2)} ms` : ""}
                    </div>
                    <div>
                        {editor?.scene.drawCalls} draw calls · zoom {editor?.scene.view.zoom.toFixed(2)}×
                    </div>
                    <div>
                        MSAA {renderOpts.antialias ? "on" : "off"} · DPR {editor?.scene.renderer.getPixelRatio()}
                        {loadMs != null ? ` · loaded in ${(loadMs / 1000).toFixed(2)} s` : ""}
                    </div>
                    {editor && editor.selectedCount > 0 && <div>{editor.selectedCount} selected</div>}
                </div>
                {loading && <div className="loading">{loading}</div>}
                {bench && <BenchTable bench={bench} onClose={() => setBench(null)} />}
            </div>

            <footer className="transport">
                <button onClick={() => { editor?.stop(); editor?.goToPage((page >= 0 ? page : pageAt) - 1); }}>‹ Page</button>
                <button onClick={() => editor?.togglePlay()} className="play">
                    {editor?.playing ? "Pause" : "Play"}
                </button>
                <button onClick={() => { editor?.stop(); editor?.goToPage((page >= 0 ? page : pageAt) + 1); }}>Page ›</button>
                <span className="readout">
                    Page {src?.pages[pageAt]?.name ?? "—"} · {fmt(editor?.time ?? 0)} / {fmt(src?.durationMs ?? 0)}
                </span>
                <div className="scrub">
                    <input
                        type="range"
                        min={0}
                        max={src?.durationMs ?? 0}
                        step={1}
                        value={editor?.time ?? 0}
                        onChange={(e) => {
                            editor?.stop();
                            editor?.seek(Number(e.target.value));
                        }}
                    />
                    <div className="ticks">
                        {src?.pages.map((p, i) => (
                            <span
                                key={i}
                                style={{ left: `${(p.timeMs / (src.durationMs || 1)) * 100}%` }}
                                onClick={() => { editor?.stop(); editor?.goToPage(i); }}
                            />
                        ))}
                    </div>
                </div>
                <span className="hint">
                    {editor?.editable
                        ? "Drag to move (snaps; Shift = free) · handles scale/rotate · arrows nudge · wheel zooms · two-finger/Alt-drag/H-drag pans"
                        : "Between pages: go to a page (Q/E) to edit"}
                </span>
            </footer>
        </div>
    );
}

function Overlay({ editor }: { editor: Editor }) {
    useSyncExternalStore(editor.subscribeOverlay, editor.getOverlayVersion);
    const v = editor.scene.view;
    const g = editor.gesture;
    let marquee = null;
    if (g?.kind === "marquee") {
        const [x0, y0] = v.fieldToScreen(g.x0, g.y0);
        const [x1, y1] = v.fieldToScreen(g.x1, g.y1);
        marquee = (
            <rect
                x={Math.min(x0, x1)}
                y={Math.min(y0, y1)}
                width={Math.abs(x1 - x0)}
                height={Math.abs(y1 - y0)}
                className="marquee"
            />
        );
    }
    let box = null;
    if (!editor.playing && editor.selectedCount > 1 && g?.kind !== "marquee") {
        const b = editor.selectionBox()!;
        const pts = editor.handlePoints(b);
        const [x0, y0] = v.fieldToScreen(b.minX, b.minY);
        const [x1, y1] = v.fieldToScreen(b.maxX, b.maxY);
        const showHandles = editor.editable;
        box = (
            <g>
                <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} className="selbox" />
                {showHandles && (
                    <>
                        <line x1={pts.n[0]} y1={pts.n[1]} x2={pts.rot[0]} y2={pts.rot[1]} className="selbox" />
                        {(Object.keys(pts) as Handle[]).map((h) =>
                            h === "rot" ? (
                                <circle key={h} cx={pts[h][0]} cy={pts[h][1]} r={6} className="handle" />
                            ) : (
                                <rect key={h} x={pts[h][0] - 5} y={pts[h][1] - 5} width={10} height={10} className="handle" />
                            ),
                        )}
                    </>
                )}
            </g>
        );
    }
    return (
        <svg className="overlay">
            {box}
            {marquee}
        </svg>
    );
}

function BenchTable({ bench, onClose }: { bench: Record<string, FrameStats>; onClose: () => void }) {
    return (
        <div className="bench">
            <button className="close" onClick={onClose}>
                ×
            </button>
            <table>
                <thead>
                    <tr>
                        <th>scenario</th>
                        <th>fps</th>
                        <th>p50 ms</th>
                        <th>p95 ms</th>
                        <th>max ms</th>
                        <th>janky</th>
                        <th>CPU avg</th>
                        <th>CPU p95</th>
                        <th>GPU avg</th>
                    </tr>
                </thead>
                <tbody>
                    {Object.entries(bench).map(([k, s]) => (
                        <tr key={k}>
                            <td>{k}</td>
                            <td>{s.fps.toFixed(1)}</td>
                            <td>{s.intervalP50.toFixed(1)}</td>
                            <td>{s.intervalP95.toFixed(1)}</td>
                            <td>{s.intervalMax.toFixed(1)}</td>
                            <td>
                                {s.jank}/{s.frames}
                            </td>
                            <td>{s.cpuAvg.toFixed(2)}</td>
                            <td>{s.cpuP95.toFixed(2)}</td>
                            <td>{s.gpuAvg == null ? "—" : s.gpuAvg.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
