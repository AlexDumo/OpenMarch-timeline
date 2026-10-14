/**
 * PROTOTYPE. What the renderer needs from a show, whether it comes from a
 * .dots file (through the timeline resolver) or is generated for a stress
 * test. Positions are in field pixels, like the 2D canvas.
 */
import type { FieldProperties } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";

export interface ProtoPage {
    name: string;
    /** When marchers reach this page's positions, in ms. */
    timeMs: number;
}

export interface ShowSource {
    name: string;
    field: FieldProperties;
    count: number;
    labels: string[];
    /** Section per marcher, for colors. */
    sections: string[];
    pages: ProtoPage[];
    durationMs: number;
    /** Fills `out` (x0, y0, x1, y1, ...) with every marcher's position at `ms`. */
    positionsAt(ms: number, out: Float64Array): void;
}

const SECTION_COLORS = [
    "#e6194b",
    "#3cb44b",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#42d4f4",
    "#f032e6",
    "#9a6324",
    "#808000",
    "#000075",
    "#469990",
    "#a9a9a9",
];

/** A stable color per section name (prototype only, not the appearance cascade). */
export function sectionColors(sections: string[]): string[] {
    const index = new Map<string, number>();
    return sections.map((s) => {
        if (!index.has(s)) index.set(s, index.size);
        return SECTION_COLORS[index.get(s)! % SECTION_COLORS.length];
    });
}

// ---------------------------------------------------------------------------
// Synthetic stress show
// ---------------------------------------------------------------------------

const STRESS_SECTIONS: [string, string][] = [
    ["Flute", "F"],
    ["Clarinet", "C"],
    ["Alto Sax", "A"],
    ["Trumpet", "T"],
    ["Mellophone", "M"],
    ["Trombone", "B"],
    ["Baritone", "E"],
    ["Tuba", "U"],
    ["Snare", "S"],
    ["Color Guard", "G"],
];

/** Deterministic pseudo-random numbers, so runs compare. */
function mulberry32(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * `count` marchers moving through a set of formations, one page each, with
 * straight-line moves between pages. Formations are sized to fit the field.
 */
export function makeStressShow(count: number): ShowSource {
    const field =
        FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
    const step = field.pixelsPerStep;
    const cx = field.centerFrontPoint.xPixels;
    // Center of the field depth (the front is at yPixels; the field is above it).
    const cy = field.centerFrontPoint.yPixels - field.height / 2 + step * 4;
    const halfW = field.width / 2 - step * 6;
    const halfH = field.height / 2 - step * 8;
    const rand = mulberry32(42);

    const formations: ((i: number) => [number, number])[] = [];
    // Block: as square as fits.
    formations.push((i) => {
        const cols = Math.ceil(Math.sqrt((count * halfW) / halfH));
        const rows = Math.ceil(count / cols);
        const sx = Math.min((2 * halfW) / cols, step * 2);
        const sy = Math.min((2 * halfH) / rows, step * 2);
        const c = i % cols;
        const r = Math.floor(i / cols);
        return [cx + (c - (cols - 1) / 2) * sx, cy + (r - (rows - 1) / 2) * sy];
    });
    // Concentric rings.
    formations.push((i) => {
        const rings = Math.max(1, Math.round(Math.sqrt(count / 20)));
        const ring = i % rings;
        const k = Math.floor(i / rings);
        const perRing = Math.ceil(count / rings);
        const radius = halfH * (0.25 + (0.75 * (ring + 1)) / rings);
        const a = (k / perRing) * Math.PI * 2 + ring * 0.3;
        return [cx + Math.cos(a) * radius * 1.6, cy + Math.sin(a) * radius];
    });
    // Sine waves.
    formations.push((i) => {
        const lines = Math.max(1, Math.round(count / 120));
        const line = i % lines;
        const t = Math.floor(i / lines) / Math.ceil(count / lines);
        const x = cx - halfW + t * 2 * halfW;
        const y =
            cy -
            halfH +
            ((line + 0.5) / lines) * 2 * halfH +
            Math.sin(t * Math.PI * 6 + line) * step * 3;
        return [x, y];
    });
    // Spiral.
    formations.push((i) => {
        const t = i / count;
        const a = t * Math.PI * 2 * 7;
        const r = 0.08 + 0.92 * Math.sqrt(t);
        return [cx + Math.cos(a) * r * halfW, cy + Math.sin(a) * r * halfH];
    });
    // Scatter.
    const scatter = Array.from({ length: count }, () => [
        cx + (rand() * 2 - 1) * halfW,
        cy + (rand() * 2 - 1) * halfH,
    ]);
    formations.push((i) => scatter[i] as [number, number]);
    // Diamond grid, rotated block.
    formations.push((i) => {
        const [x, y] = formations[0](i);
        const a = Math.PI / 4;
        const dx = (x - cx) * 0.7;
        const dy = (y - cy) * 0.7;
        return [
            cx + (dx * Math.cos(a) - dy * Math.sin(a)) * 1.5,
            cy + (dx * Math.sin(a) + dy * Math.cos(a)),
        ];
    });

    const pageCount = 24;
    const pageMs = 8000; // 16 counts at 120 bpm
    const keyframes: Float64Array[] = [];
    for (let p = 0; p < pageCount; p++) {
        const f = formations[p % formations.length];
        const kf = new Float64Array(count * 2);
        // Shuffle which marcher goes where on some pages so paths cross.
        const shift = p % 3 === 2 ? Math.floor(count / 3) : 0;
        for (let i = 0; i < count; i++) {
            const [x, y] = f((i + shift) % count);
            kf[i * 2] = x;
            kf[i * 2 + 1] = y;
        }
        keyframes.push(kf);
    }

    const labels: string[] = [];
    const sections: string[] = [];
    const per = Math.ceil(count / STRESS_SECTIONS.length);
    for (let i = 0; i < count; i++) {
        const [section, prefix] = STRESS_SECTIONS[Math.floor(i / per)];
        sections.push(section);
        labels.push(`${prefix}${(i % per) + 1}`);
    }

    return {
        name: `Stress ${count}`,
        field,
        count,
        labels,
        sections,
        pages: keyframes.map((_, p) => ({
            name: String(p + 1),
            timeMs: p * pageMs,
        })),
        durationMs: (pageCount - 1) * pageMs,
        positionsAt(ms, out) {
            const t = Math.max(0, Math.min(ms / pageMs, pageCount - 1));
            const p = Math.min(Math.floor(t), pageCount - 2);
            const f = t - p;
            const a = keyframes[p];
            const b = keyframes[p + 1];
            for (let i = 0; i < count * 2; i++)
                out[i] = a[i] + (b[i] - a[i]) * f;
        },
    };
}
