import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    RepeatWrapping,
    type CanvasTexture,
    type Vector3Tuple,
} from "three";
import type { LightingPreset } from "../types";
import { lightingValues } from "./lighting";
import { createRng } from "./random";
import { paintCanvasTexture } from "./textures";

/**
 * The world past the stands (docs/3d/design.md section 5): rolling hills fading
 * into haze, a treeline, and a small town whose windows light up at dusk and
 * night. It replaces the flat ground that used to run straight into the fog.
 *
 * Three draw calls in the daytime (hills, trees, town), four at night (the
 * town's lights). Everything is procedural: hills are a displaced ring with
 * baked vertex colors, the trees and town are painted onto canvases. The
 * group is centered on the field and sits on the kit's ground plane: the
 * hills fade in over `HORIZON_FADE_FROM` to `HORIZON_FADE_TO` meters so the
 * seam with whatever ground the kit drew is invisible.
 */
export const HORIZON_FADE_FROM = 330;
export const HORIZON_FADE_TO = 470;
/** Outer edge of the hills. Inside the sky dome and the fog's far plane. */
export const HORIZON_RADIUS = 1500;
const TREE_RADIUS = 440;
const TREE_HEIGHT = 34;
const TOWN_RADIUS = 900;
const TOWN_HEIGHT = 128;

export interface Horizon {
    root: Group;
    /** Tints the land for the preset, lights the town and shows or hides it all. */
    setPreset(preset: LightingPreset): void;
    /** Centers the horizon on the field (x and z of the focus point). */
    setCenter(center: Vector3Tuple): void;
    dispose(): void;
}

const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Periodic ridge profile around the circle, 0..1. Integer frequencies only. */
function ridge(theta: number, seed: number): number {
    const rnd = createRng(seed);
    let v = 0;
    let norm = 0;
    for (let k = 2; k <= 19; k++) {
        const amp = 1 / Math.pow(k, 0.85);
        v += amp * Math.sin(k * theta + rnd() * Math.PI * 2);
        norm += amp;
    }
    return 0.5 + (0.5 * v) / norm / 0.55;
}

/** Ground height of the hills at polar (r meters, theta radians). */
export function horizonHeight(r: number, theta: number): number {
    if (r >= HORIZON_RADIUS + 1) return -8;
    const far = smooth(480, 1400, r);
    const mid = smooth(380, 800, r);
    const big = Math.min(1, Math.max(0, ridge(theta, 11)));
    const small = Math.min(1, Math.max(0, ridge(theta * 3, 5)));
    return (
        0.25 +
        Math.pow(far, 1.5) * (25 + 90 * big) +
        mid * (3 + 10 * small) * (0.4 + 0.6 * big)
    );
}

/** Hills: a ring from the fade-in radius out to the rim, with vertex colors. */
function buildHills(quality: "low" | "high"): BufferGeometry {
    const around = quality === "low" ? 96 : 224;
    const radii = [
        HORIZON_FADE_FROM,
        380,
        430,
        470,
        520,
        580,
        650,
        720,
        800,
        890,
        980,
        1080,
        1180,
        1280,
        1380,
        HORIZON_RADIUS,
        HORIZON_RADIUS + 40,
    ];
    const rings = radii.length;
    const pos = new Float32Array(rings * around * 3);
    const col = new Float32Array(rings * around * 4);
    const rnd = createRng(31);
    const c = new Color();
    const palette = [
        0x6f9448, // mown field
        0x86a04e, // pasture
        0xa39a58, // dry field
        0x3d6030, // woodland
        0x2c4a28, // dense woodland
        0x587a3c, // meadow
    ].map((h) => new Color(h));
    const sunX = -0.5;
    const sunZ = 0.45;
    // Patch field: one palette index per coarse cell, so colors form fields.
    const cellsA = 40;
    const cellsR = 14;
    const patch = Array.from({ length: cellsA * cellsR }, () =>
        Math.floor(rnd() * palette.length),
    );
    const patchAt = (r: number, theta: number) => {
        const a =
            ((Math.floor(((theta / (Math.PI * 2)) % 1) * cellsA) % cellsA) +
                cellsA) %
            cellsA;
        const b = Math.min(cellsR - 1, Math.floor((r - 330) / 85));
        return patch[b * cellsA + a];
    };
    for (let j = 0; j < rings; j++) {
        const r = radii[j];
        for (let i = 0; i < around; i++) {
            const theta = (i / around) * Math.PI * 2;
            const k = j * around + i;
            pos[k * 3] = Math.cos(theta) * r;
            pos[k * 3 + 1] = horizonHeight(r, theta);
            pos[k * 3 + 2] = Math.sin(theta) * r;
            // Slope shading from height differences, light from the fixed sun.
            const e = 14;
            const hx =
                horizonHeight(r, theta + e / r) -
                horizonHeight(r, theta - e / r);
            const hr =
                horizonHeight(r + e, theta) - horizonHeight(r - e, theta);
            // d/dtheta is tangential (-sin, cos); d/dr is radial (cos, sin).
            const gx =
                (-Math.sin(theta) * hx) / (2 * e) +
                (Math.cos(theta) * hr) / (2 * e);
            const gz =
                (Math.cos(theta) * hx) / (2 * e) +
                (Math.sin(theta) * hr) / (2 * e);
            const shade = Math.min(
                1.25,
                Math.max(0.55, 0.95 - (gx * sunX + gz * sunZ) * 3),
            );
            c.copy(palette[patchAt(r, theta)]);
            // Slow tonal variation inside a patch.
            const v = 0.9 + 0.2 * rnd();
            const light = shade * v;
            col[k * 4] = c.r * light;
            col[k * 4 + 1] = c.g * light;
            col[k * 4 + 2] = c.b * light;
            col[k * 4 + 3] = smooth(HORIZON_FADE_FROM, HORIZON_FADE_TO, r);
        }
    }
    const index: number[] = [];
    for (let j = 0; j < rings - 1; j++) {
        for (let i = 0; i < around; i++) {
            const i2 = (i + 1) % around;
            const a = j * around + i;
            const b = j * around + i2;
            const cc = (j + 1) * around + i;
            const d = (j + 1) * around + i2;
            index.push(a, cc, b, b, cc, d);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    geometry.setAttribute("color", new BufferAttribute(col, 4));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
}

/** A curved band (part of a cylinder) that follows the hills' height. */
function buildBand(
    radius: number,
    height: number,
    arcs: { from: number; to: number; u0: number; u1: number }[],
    segmentsPerRadian: number,
): BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (const arc of arcs) {
        const n = Math.max(
            2,
            Math.ceil((arc.to - arc.from) * segmentsPerRadian),
        );
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const theta = arc.from + (arc.to - arc.from) * t;
            const x = Math.cos(theta) * radius;
            const z = Math.sin(theta) * radius;
            const y0 = horizonHeight(radius, theta) - 1.5;
            pos.push(x, y0, z, x, y0 + height, z);
            const u = arc.u0 + (arc.u1 - arc.u0) * t;
            uv.push(u, 0, u, 1);
        }
        for (let i = 0; i < n; i++) {
            const a = base + i * 2;
            index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(pos), 3),
    );
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
}

/** Trees along the bottom of a tileable strip: pines, round trees and gaps. */
function treeTexture(): CanvasTexture {
    const W = 2048;
    const H = 128;
    return paintCanvasTexture(
        W,
        H,
        (g) => {
            const rnd = createRng(77);
            g.clearRect(0, 0, W, H);
            const greens = [
                "#1c2f1d",
                "#233a22",
                "#2b4527",
                "#30502b",
                "#1a2a1b",
                "#3a5a30",
            ];
            // Low-frequency density so the line has tall stands and low gaps.
            const waves = Array.from({ length: 6 }, (_, i) => ({
                k: i + 2,
                p: rnd() * 6.28,
            }));
            const density = (x: number) => {
                let v = 0;
                for (const w of waves)
                    v += Math.sin((x / W) * 6.2832 * w.k + w.p) / w.k;
                return Math.min(1, Math.max(0.15, 0.62 + v * 0.55));
            };
            const drawTree = (x: number, top: number, w: number) => {
                const shade = greens[Math.floor(rnd() * greens.length)];
                g.fillStyle = shade;
                const pine = rnd() < 0.4;
                if (pine) {
                    // Stacked triangles.
                    const tiers = 4;
                    for (let t = 0; t < tiers; t++) {
                        const y0 = top + (t * (H - top)) / (tiers + 1);
                        const ww = (w * (t + 1.4)) / tiers;
                        g.beginPath();
                        g.moveTo(x, y0 - 6);
                        g.lineTo(x - ww / 2, y0 + (H - top) / tiers + 6);
                        g.lineTo(x + ww / 2, y0 + (H - top) / tiers + 6);
                        g.fill();
                    }
                } else {
                    // Lumpy crown on a short trunk.
                    const crown = (H - top) * 0.62;
                    for (let b = 0; b < 5; b++) {
                        g.beginPath();
                        g.ellipse(
                            x + (rnd() - 0.5) * w * 0.7,
                            top + crown * (0.35 + rnd() * 0.45),
                            w * (0.28 + rnd() * 0.18),
                            crown * (0.3 + rnd() * 0.15),
                            0,
                            0,
                            Math.PI * 2,
                        );
                        g.fill();
                    }
                    g.fillRect(x - 1.5, top + crown, 3, H - top - crown);
                }
            };
            for (let x = 0; x < W; x += 5 + rnd() * 9) {
                const d = density(x);
                if (rnd() > d + 0.25) continue;
                const top = H - 26 - d * 78 * (0.55 + rnd() * 0.45);
                const w = 14 + rnd() * 22;
                for (const dx of [0, -W, W]) drawTree(x + dx, top, w);
            }
            // Solid hedge along the base so no sky shows under the crowns.
            g.fillStyle = greens[0];
            g.fillRect(0, H - 14, W, 14);
        },
        { repeat: true, anisotropy: 4 },
    );
}

interface TownTextures {
    body: CanvasTexture;
    lights: CanvasTexture;
}

/** The town's silhouette and, in a second texture, its lit windows and lamps. */
function townTextures(): TownTextures {
    const W = 2048;
    const H = 128;
    // The two textures share a layout, so paint once and keep the windows.
    interface Win {
        x: number;
        y: number;
        w: number;
        h: number;
        lit: number;
    }
    interface Lamp {
        x: number;
        y: number;
        r: number;
        color: string;
    }
    const rnd = createRng(103);
    const buildings: { x: number; w: number; h: number; tone: number }[] = [];
    const windows: Win[] = [];
    const lamps: Lamp[] = [];
    let x = 0;
    while (x < W) {
        // Clusters: tall downtown near the middle, low houses at the edges.
        const mid = 1 - Math.abs(x / W - 0.55) * 2;
        const gap = rnd() < 0.18 ? 8 + rnd() * 22 : rnd() * 3;
        x += gap;
        const w = 9 + rnd() * 20;
        const tall = 10 + Math.max(0, mid) * (10 + rnd() * 30);
        const h = Math.min(70, tall * (0.6 + rnd() * 0.8));
        buildings.push({ x, w, h, tone: rnd() });
        for (let wy = 6; wy < h - 4; wy += 5) {
            for (let wx = 3; wx < w - 4; wx += 5) {
                windows.push({
                    x: x + wx,
                    y: wy,
                    w: 2,
                    h: 2.6,
                    lit: rnd(),
                });
            }
        }
        x += w;
    }
    // Landmarks: a water tower, a steeple and two radio masts with beacons.
    const tower = { x: 1180, h: 62 };
    const steeple = { x: 640, h: 54 };
    for (const m of [
        { x: 300, h: 92 },
        { x: 1710, h: 84 },
    ])
        lamps.push({ x: m.x, y: m.h, r: 1.6, color: "#ff3b2e" });
    for (let lx = 6; lx < W; lx += 24 + rnd() * 50)
        lamps.push({ x: lx, y: 3, r: 1.2, color: "#ffd9a0" });

    const paintSilhouette = (g: CanvasRenderingContext2D) => {
        g.clearRect(0, 0, W, H);
        for (const b of buildings) {
            const v = 78 + b.tone * 70;
            g.fillStyle = `rgb(${v},${v + 4},${v + 12})`;
            // Canvas y runs down; the band's bottom is the canvas bottom.
            g.fillRect(b.x, H - b.h, b.w, b.h);
            if (b.tone > 0.7) {
                g.beginPath();
                g.moveTo(b.x - 1, H - b.h);
                g.lineTo(b.x + b.w / 2, H - b.h - 5);
                g.lineTo(b.x + b.w + 1, H - b.h);
                g.fill();
            }
        }
        g.fillStyle = "#70788c";
        // Water tower: a tank on legs.
        g.fillRect(tower.x - 8, H - tower.h, 16, 11);
        g.fillRect(tower.x - 1, H - tower.h + 11, 2, tower.h - 11);
        g.fillRect(tower.x - 6, H - tower.h + 11, 1.2, tower.h - 11);
        g.fillRect(tower.x + 5, H - tower.h + 11, 1.2, tower.h - 11);
        g.beginPath();
        g.moveTo(tower.x - 9, H - tower.h);
        g.lineTo(tower.x, H - tower.h - 5);
        g.lineTo(tower.x + 9, H - tower.h);
        g.fill();
        // Steeple.
        g.fillRect(steeple.x - 4, H - steeple.h + 18, 8, steeple.h - 18);
        g.beginPath();
        g.moveTo(steeple.x - 4.5, H - steeple.h + 18);
        g.lineTo(steeple.x, H - steeple.h - 6);
        g.lineTo(steeple.x + 4.5, H - steeple.h + 18);
        g.fill();
        // Radio masts.
        for (const m of [300, 1710]) {
            g.fillRect(m - 0.8, H - 90, 1.6, 90);
        }
        // Low houses and trees at the base so nothing floats.
        g.fillStyle = "#586074";
        g.fillRect(0, H - 6, W, 6);
    };
    const body = paintCanvasTexture(W, H, (g) => paintSilhouette(g), {
        repeat: false,
        anisotropy: 4,
    });
    const lights = paintCanvasTexture(
        W,
        H,
        (g) => {
            g.clearRect(0, 0, W, H);
            for (const w of windows) {
                if (w.lit < 0.62) continue;
                g.fillStyle = w.lit > 0.93 ? "#bfe0ff" : "#ffd68a";
                g.globalAlpha = 0.55 + 0.45 * ((w.lit * 37) % 1);
                g.fillRect(w.x, H - w.y - w.h, w.w, w.h);
            }
            g.globalAlpha = 1;
            for (const l of lamps) {
                g.fillStyle = l.color;
                g.beginPath();
                g.arc(l.x, H - l.y, l.r, 0, Math.PI * 2);
                g.fill();
            }
        },
        { repeat: false, anisotropy: 4 },
    );
    return { body, lights };
}

/** Multiplier for the land: the horizon color normalized, half mixed with white. */
function landTint(preset: LightingPreset, out: Color): Color {
    const a = lightingValues(preset).atmosphere;
    out.setHex(a.horizon);
    const m = Math.max(out.r, out.g, out.b, 1e-4);
    out.multiplyScalar(1 / m);
    out.lerp(new Color(1, 1, 1), 0.45);
    return out.multiplyScalar(a.land);
}

export function createHorizon(
    options: { quality?: "low" | "high" } = {},
): Horizon {
    const quality = options.quality ?? "high";
    const root = new Group();
    root.name = "horizon";

    const hillsGeometry = buildHills(quality);
    const hillsMaterial = new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const hills = new Mesh(hillsGeometry, hillsMaterial);
    hills.name = "horizon.hills";
    hills.frustumCulled = false;
    hills.renderOrder = -5;

    const trees = treeTexture();
    trees.wrapS = RepeatWrapping;
    trees.repeat.set(4, 1);
    const treeGeometry = buildBand(
        TREE_RADIUS,
        TREE_HEIGHT,
        [{ from: 0, to: Math.PI * 2, u0: 0, u1: 1 }],
        60,
    );
    // The u range 0..1 covers the circle; the texture repeats 4 times.
    const treeMaterial = new MeshBasicMaterial({
        map: trees,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.05,
        side: DoubleSide,
    });
    const treeMesh = new Mesh(treeGeometry, treeMaterial);
    treeMesh.name = "horizon.trees";
    treeMesh.frustumCulled = false;
    treeMesh.renderOrder = -3;

    const town = townTextures();
    const townGeometry = buildBand(
        TOWN_RADIUS,
        TOWN_HEIGHT,
        [
            { from: 0.7, to: 0.7 + 2.2, u0: 0, u1: 1 },
            { from: 3.9, to: 3.9 + 0.8, u0: 0.12, u1: 0.5 },
        ],
        40,
    );
    const townMaterial = new MeshBasicMaterial({
        map: town.body,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.05,
        side: DoubleSide,
    });
    const townMesh = new Mesh(townGeometry, townMaterial);
    townMesh.name = "horizon.town";
    townMesh.frustumCulled = false;
    townMesh.renderOrder = -4;
    const lightsMaterial = new MeshBasicMaterial({
        map: town.lights,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: DoubleSide,
    });
    const lightsMesh = new Mesh(townGeometry, lightsMaterial);
    lightsMesh.name = "horizon.lights";
    lightsMesh.frustumCulled = false;
    lightsMesh.scale.setScalar(0.998); // just inside the silhouettes
    lightsMesh.renderOrder = 2;

    root.add(hills, treeMesh, townMesh, lightsMesh);

    const tint = new Color();
    return {
        root,
        setPreset(preset) {
            const v = lightingValues(preset);
            root.visible = v.skyVisible;
            landTint(preset, tint);
            hillsMaterial.color.copy(tint);
            treeMaterial.color.copy(tint).multiplyScalar(0.85);
            townMaterial.color.copy(tint).multiplyScalar(1.1);
            lightsMaterial.color.setScalar(v.atmosphere.windows * 0.95);
            lightsMesh.visible = v.atmosphere.windows > 0.01;
        },
        setCenter(center) {
            root.position.set(center[0], 0, center[2]);
        },
        dispose() {
            for (const o of [
                hillsGeometry,
                treeGeometry,
                townGeometry,
                hillsMaterial,
                treeMaterial,
                townMaterial,
                lightsMaterial,
                trees,
                town.body,
                town.lights,
            ])
                o.dispose();
        },
    };
}
