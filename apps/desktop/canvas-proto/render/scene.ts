/**
 * PROTOTYPE. The WebGL side of the field editor: one renderer, one scene,
 * a handful of draw calls whatever the marcher count:
 *
 *   field background, grid/yard/hash lines (one call per stroke style),
 *   field text, pathways, ghost dots, dots (+ selection rings), labels.
 *
 * Nothing here knows about React or editing. The editor writes positions and
 * selection, then calls `render()` once per frame that changed.
 */
import { Color, Scene, Vector2, WebGLRenderer } from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ShowSource } from "../source";
import { sectionColors } from "../source";
import { DotLayer } from "./dotLayer";
import { FieldLayer } from "./fieldLayer";
import { GlyphAtlas, TextBatch } from "./sdfText";
import { View } from "./view";

export interface RenderOptions {
    antialias: boolean;
    /** Upper limit for devicePixelRatio. */
    dprCap: number;
}

export interface LayerToggles {
    labels: boolean;
    /** Labels keep a fixed size on screen instead of scaling with the field. */
    screenSizedLabels: boolean;
    ghosts: boolean;
    pathways: boolean;
    grid: boolean;
}

const DOT_RADIUS = 5; // field px, as DEFAULT_DOT_RADIUS
const LABEL_SIZE = 14; // field px, as CanvasMarcher's label
const LABEL_SCREEN_PX = 11;

export class FieldScene {
    readonly renderer: WebGLRenderer;
    readonly view = new View();
    readonly scene = new Scene();
    private readonly atlas: GlyphAtlas;
    private field: FieldLayer | null = null;
    dots: DotLayer | null = null;
    private ghosts: DotLayer | null = null;
    private labels: TextBatch | null = null;
    private pathways: LineSegments2 | null = null;
    private readonly pathMaterial: LineMaterial;
    private labelAnchors = new Float32Array(0);
    private readonly resolution = new Vector2();
    toggles: LayerToggles = {
        labels: true,
        screenSizedLabels: false,
        ghosts: true,
        pathways: true,
        grid: true,
    };
    source: ShowSource | null = null;

    /** GPU time of the last measured frame (ms), when the timer query works. */
    gpuMs: number | null = null;
    private timerExt: any = null;
    private pendingQuery: WebGLQuery | null = null;

    constructor(
        readonly canvas: HTMLCanvasElement,
        readonly options: RenderOptions,
    ) {
        this.renderer = new WebGLRenderer({
            canvas,
            antialias: options.antialias,
            powerPreference: "high-performance",
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.dprCap));
        this.renderer.setClearColor(new Color("#2a2a2e"));
        this.atlas = new GlyphAtlas();
        this.pathMaterial = new LineMaterial({
            color: 0x6b6b6b,
            linewidth: 1.25,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
        });
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        this.timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    }

    setShow(source: ShowSource) {
        this.disposeShow();
        this.source = source;
        this.field = new FieldLayer(source.field, this.atlas, {
            gridLines: this.toggles.grid,
            halfLines: true,
        });
        this.scene.add(this.field.group);

        this.ghosts = new DotLayer(source.count, { opacity: 0.28 });
        this.ghosts.mesh.renderOrder = 6;
        this.ghosts.setColors(source.sections.map(() => "#7a7a7a"));
        this.scene.add(this.ghosts.mesh);

        this.dots = new DotLayer(source.count);
        this.dots.mesh.renderOrder = 8;
        this.dots.setColors(sectionColors(source.sections));
        this.scene.add(this.dots.mesh);

        const theme = source.field.theme;
        const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;
        // Label color from the field theme, with a halo of the field color.
        this.labels = new TextBatch(
            this.atlas,
            rgb(theme.defaultMarcher.label),
            rgb(theme.background),
        );
        this.labels.setLabels(
            source.labels.map((text) => ({ text, baselineEm: 0 })),
        );
        this.labels.mesh.renderOrder = 9;
        this.scene.add(this.labels.mesh);
        this.labelAnchors = new Float32Array(source.count * 2);

        this.applyToggles();
    }

    setGrid(on: boolean) {
        if (!this.source || on === this.toggles.grid) return;
        this.toggles.grid = on;
        if (this.field) {
            this.scene.remove(this.field.group);
            this.field.dispose();
        }
        this.field = new FieldLayer(this.source.field, this.atlas, {
            gridLines: on,
            halfLines: true,
        });
        this.scene.add(this.field.group);
    }

    applyToggles() {
        if (this.labels) this.labels.mesh.visible = this.toggles.labels;
        if (this.ghosts) this.ghosts.mesh.visible = this.toggles.ghosts;
        if (this.pathways) this.pathways.visible = this.toggles.pathways;
    }

    resize(width: number, height: number) {
        this.renderer.setSize(width, height, false);
        this.view.resize(width, height);
    }

    /**
     * Writes marcher positions (field px, x/y interleaved) into the dot and
     * label layers. The per-frame path of playback: no allocation.
     */
    setPositions(xy: Float64Array) {
        const dots = this.dots;
        if (!dots) return;
        const p = dots.positions;
        const a = this.labelAnchors;
        const n = p.length;
        // The label baseline sits above the dot (CanvasMarcher: top = y - 2.2r).
        const lift = DOT_RADIUS * 1.6;
        for (let i = 0; i < n; i += 2) {
            const x = xy[i];
            const y = -xy[i + 1];
            p[i] = x;
            p[i + 1] = y;
            a[i] = x;
            a[i + 1] = y + lift;
        }
        dots.commitPositions();
        if (this.labels && this.toggles.labels) this.labels.setAnchors(a);
    }

    setGhostPositions(xy: Float64Array | null) {
        const ghosts = this.ghosts;
        if (!ghosts) return;
        ghosts.mesh.visible = this.toggles.ghosts && xy !== null;
        if (!xy) return;
        for (let i = 0; i < xy.length; i += 2) {
            ghosts.positions[i] = xy[i];
            ghosts.positions[i + 1] = -xy[i + 1];
        }
        ghosts.commitPositions();
    }

    /**
     * Lines from `from` to `to` for each marcher (null hides them). One
     * segment slot per marcher, allocated once per show and rewritten in
     * place, so a drag updates them every frame without new GPU buffers.
     * A marcher that doesn't move gets a NaN segment, which the GPU drops.
     */
    setPathways(from: Float64Array | null, to: Float64Array | null) {
        if (!from || !to) {
            if (this.pathways) this.pathways.visible = false;
            return;
        }
        const n = from.length / 2;
        if (!this.pathways || this.pathways.geometry.userData.n !== n) {
            if (this.pathways) {
                this.scene.remove(this.pathways);
                this.pathways.geometry.dispose();
            }
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(new Float32Array(n * 6));
            geometry.userData.n = n;
            this.pathways = new LineSegments2(geometry, this.pathMaterial);
            this.pathways.renderOrder = 5;
            this.pathways.frustumCulled = false;
            this.scene.add(this.pathways);
        }
        const attr = this.pathways.geometry.getAttribute("instanceStart") as unknown as {
            data: { array: Float32Array; needsUpdate: boolean };
        };
        const buf = attr.data.array;
        for (let i = 0; i < n; i++) {
            const x0 = from[i * 2];
            const y0 = from[i * 2 + 1];
            const x1 = to[i * 2];
            const y1 = to[i * 2 + 1];
            const o = i * 6;
            if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 0.01) {
                buf.fill(NaN, o, o + 6);
                continue;
            }
            buf[o] = x0;
            buf[o + 1] = -y0;
            buf[o + 2] = 0;
            buf[o + 3] = x1;
            buf[o + 4] = -y1;
            buf[o + 5] = 0;
        }
        attr.data.needsUpdate = true;
        this.pathways.visible = this.toggles.pathways;
    }

    setSelected(selected: Uint8Array) {
        this.dots?.setSelected(selected);
    }

    render() {
        const v = this.view;
        this.resolution.set(v.width, v.height);
        this.field?.update(v.zoom, this.resolution);
        this.pathMaterial.resolution.copy(this.resolution);
        // Dots never shrink below ~2 screen px, so a zoomed-out show stays readable.
        this.dots?.setRadius(DOT_RADIUS, 2 / v.zoom);
        this.ghosts?.setRadius(DOT_RADIUS, 2 / v.zoom);
        if (this.labels) {
            if (this.toggles.screenSizedLabels) {
                this.labels.emToWorld = LABEL_SCREEN_PX / v.zoom;
                this.labels.opacity = 1;
            } else {
                this.labels.emToWorld = LABEL_SIZE;
                // Fade labels out when they'd be under ~5 screen px tall.
                const px = LABEL_SIZE * v.zoom;
                this.labels.opacity = Math.max(0, Math.min(1, (px - 4) / 3));
            }
        }
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const ext = this.timerExt;
        let query: WebGLQuery | null = null;
        if (ext && !this.pendingQuery) {
            query = gl.createQuery();
            if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        }
        this.renderer.render(this.scene, v.camera);
        if (query) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            this.pendingQuery = query;
        }
        this.pollGpuTimer();
    }

    private pollGpuTimer() {
        const q = this.pendingQuery;
        if (!q) return;
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
        const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
        if (available) {
            if (!disjoint) this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
            gl.deleteQuery(q);
            this.pendingQuery = null;
        }
    }

    get drawCalls() {
        return this.renderer.info.render.calls;
    }

    private disposeShow() {
        for (const obj of [this.dots?.mesh, this.ghosts?.mesh, this.labels?.mesh]) {
            if (!obj) continue;
            this.scene.remove(obj);
            obj.geometry.dispose();
            obj.material.dispose();
        }
        if (this.field) {
            this.scene.remove(this.field.group);
            this.field.dispose();
        }
        if (this.pathways) {
            this.scene.remove(this.pathways);
            this.pathways.geometry.dispose();
            this.pathways = null;
        }
        this.field = null;
        this.dots = this.ghosts = null;
        this.labels = null;
    }

    dispose() {
        this.disposeShow();
        this.renderer.dispose();
    }
}
