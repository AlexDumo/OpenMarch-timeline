import {
    LAYOUT_FAMILIES,
    LAYOUT_LABELS,
    type FilesLayout,
    type LayoutFamily,
} from "./distribution";

/**
 * The box's layout catalogue (#387, spec #385): which versions of each layout make a count, how
 * they are labelled, and what a layout does when the count changes. Every layout is a full block
 * minus a pattern, every line centered. Everything here is pure.
 *
 * A layout is laid out as lines, back first (the left file first when turned), the same lines
 * `distribute.ts` centers and spaces.
 */

/** A shape two layouts can make is listed under the more specific one, in this order */
const SPECIFICITY: readonly LayoutFamily[] = [
    "full",
    "stagger",
    "rounded",
    "notched",
    "shortBack",
];

/** The layouts that also come turned, running by file */
const TURNS: ReadonlySet<LayoutFamily> = new Set([
    "stagger",
    "rounded",
    "notched",
]);

/** Short back's lines: full lines of `width`, the back one short (all in one under `width`) */
export function shortBackLines(width: number, n: number): number[] {
    const w = Math.max(1, Math.round(width));
    const count = Math.max(1, n);
    const lines = Math.ceil(count / w);
    return Array.from({ length: lines }, (_, i) =>
        i === 0 ? count - (lines - 1) * w : w,
    );
}

/**
 * The lines of `family` with full lines of `width` making exactly `n`, back first; null when it
 * can't. With the width and count fixed there is at most one: the number of lines follows.
 * Short back here is a strict one (its back line short), as the catalogue lists it.
 */
export function familyLines(
    family: LayoutFamily,
    width: number,
    n: number,
): number[] | null {
    const F = Math.round(width);
    if (F < 1 || n < 1) return null;
    const block = (R: number, cut: (i: number) => number) =>
        Array.from({ length: R }, (_, i) => F - cut(i));
    switch (family) {
        case "full":
            return n % F === 0 ? block(n / F, () => 0) : null;
        case "shortBack": {
            const R = Math.ceil(n / F);
            return R >= 2 && n % F !== 0 ? shortBackLines(F, n) : null;
        }
        case "stagger":
            // Ends out (5/4/5/4/5) or ends in (4/5/4/5/4)
            for (let R = 3; R * (F - 1) <= n; R += 2) {
                if (F < 2) break;
                if (R * F - (R - 1) / 2 === n) return block(R, (i) => i % 2);
                if (R * F - (R + 1) / 2 === n)
                    return block(R, (i) => 1 - (i % 2));
            }
            return null;
        case "rounded":
            for (let R = 3; F * (R - 2) <= n; R++)
                for (const k of [1, 2])
                    if (F - k >= 1 && F * R - 2 * k === n)
                        return block(R, (i) =>
                            i === 0 || i === R - 1 ? k : 0,
                        );
            return null;
        case "notched":
            for (let R = 3; F * (R - 1) <= n; R += 2)
                for (const k of [1, 2])
                    if (F - k >= 1 && F * R - k === n)
                        return block(R, (i) => (i === (R - 1) / 2 ? k : 0));
            return null;
    }
}

/** One version of a layout as the picker shows it */
export interface LayoutVersion {
    readonly layout: FilesLayout;
    /** Marchers in each line, back first (the left file first when turned) */
    readonly lines: readonly number[];
    /** The full block it is cut from, on the box's own axes: side to side, front to back */
    readonly across: number;
    readonly deep: number;
    /** "5 × 5", "6 × 4, 1 short", "5 × 5 staggered" */
    readonly label: string;
    /** The counts: "5 / 4 / 5 / 4 / 5, front to back" */
    readonly tooltip: string;
}

/** How many more or fewer marchers would make a layout; null where none near does */
export interface LayoutHint {
    readonly more: number | null;
    readonly fewer: number | null;
}

/** A row of the picker: its versions wide to deep, or a hint when the count can't make it */
export interface LayoutRow {
    readonly family: LayoutFamily;
    readonly label: string;
    readonly versions: readonly LayoutVersion[];
    /** Present when `versions` is empty */
    readonly hint?: LayoutHint;
}

/** The block's size on the box's axes */
function blockOf(lines: readonly number[], byFile: boolean) {
    const width = Math.max(...lines);
    return byFile
        ? { across: lines.length, deep: width }
        : { across: width, deep: lines.length };
}

/** A line short by an odd count sits half an interval in, between the files */
const between = (width: number, line: number) => (width - line) % 2 === 1;

export function versionOf(
    layout: FilesLayout,
    lines: readonly number[],
): LayoutVersion {
    const { across, deep } = blockOf(lines, layout.byFile);
    const width = Math.max(...lines);
    const n = lines.reduce((a, b) => a + b, 0);
    const marked = (line: number) =>
        between(width, line) ? " staggered" : " straight";
    const note =
        layout.family === "shortBack"
            ? `, ${across * deep - n} short`
            : layout.family === "rounded"
              ? marked(lines[0]!)
              : layout.family === "notched"
                ? marked(lines[(lines.length - 1) / 2]!)
                : "";
    const counts = layout.byFile
        ? `${lines.join(" / ")}, left to right`
        : `${[...lines].reverse().join(" / ")}, front to back`;
    return {
        layout,
        lines,
        across,
        deep,
        label: `${across} × ${deep}${note}`,
        tooltip: counts,
    };
}

/**
 * Which spots the lines make, at one interval both ways, in half intervals: two layouts that make
 * the same key are the same shape
 */
export function shapeKey(lines: readonly number[], byFile: boolean): string {
    const width = Math.max(...lines);
    const R = lines.length;
    const spots: string[] = [];
    lines.forEach((m, i) => {
        for (let j = 0; j < m; j++) {
            const u = 2 * j + width - m - (width - 1);
            const v = 2 * i - (R - 1);
            spots.push(byFile ? `${v},${u}` : `${u},${v}`);
        }
    });
    return spots.sort().join(" ");
}

/** Within 3:1 of square: the long side under three times the short one */
const nearSquare = (v: { across: number; deep: number }) =>
    Math.max(v.across, v.deep) < 3 * Math.min(v.across, v.deep);

/**
 * No lonely marchers: a short line keeps at least 2, and Short back's at least a third of a full
 * line (7 / 7 / 7 / 2 reads as a box with stragglers), as the prototype the owner chose from had it
 */
const noLonely = (family: LayoutFamily, lines: readonly number[]) => {
    const width = Math.max(...lines);
    return lines.every(
        (l) =>
            l === width ||
            (l >= 2 && (family !== "shortBack" || 3 * l >= width)),
    );
};

const cache = new Map<number, readonly LayoutRow[]>();
const CACHE_LIMIT = 400;

/** Each layout's versions for exactly `n`, before hints */
function versionsFor(n: number): Map<LayoutFamily, LayoutVersion[]> {
    const seen = new Set<string>();
    const by = new Map<LayoutFamily, LayoutVersion[]>();
    for (const family of SPECIFICITY) {
        const flat: LayoutVersion[] = [];
        const turned: LayoutVersion[] = [];
        for (let width = 1; width <= n; width++) {
            const lines = familyLines(family, width, n);
            if (!lines || !noLonely(family, lines)) continue;
            flat.push(
                versionOf({ family, files: width, byFile: false }, lines),
            );
            if (TURNS.has(family))
                turned.push(
                    versionOf({ family, files: width, byFile: true }, lines),
                );
        }
        // By rank first, so a shape both ways keeps the plainer one
        const kept = [...flat, ...turned].filter((v) => {
            if (!nearSquare(v)) return false;
            const key = shapeKey(v.lines, v.layout.byFile);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Wide to deep; by rank before turned at the same proportions
        kept.sort(
            (a, b) =>
                b.across / b.deep - a.across / a.deep ||
                Number(a.layout.byFile) - Number(b.layout.byFile),
        );
        by.set(family, kept);
    }
    return by;
}

/** How near a count is that `family` makes: add `more`, or remove `fewer`, within 12 */
export function familyHint(family: LayoutFamily, n: number): LayoutHint {
    let more: number | null = null;
    let fewer: number | null = null;
    for (let k = 1; k <= 12 && (more === null || fewer === null); k++) {
        if (more === null && versionsFor(n + k).get(family)!.length > 0)
            more = k;
        if (
            fewer === null &&
            n - k >= 1 &&
            versionsFor(n - k).get(family)!.length > 0
        )
            fewer = k;
    }
    return { more, fewer };
}

/**
 * The layout picker for `n` marchers: every layout in the fixed order Full · Stagger · Rounded ·
 * Short back · Notched, each with its versions wide to deep, or the nearest counts it makes
 */
export function layoutCatalogue(n: number): readonly LayoutRow[] {
    const count = Math.max(1, Math.round(n));
    const hit = cache.get(count);
    if (hit) return hit;
    const by = versionsFor(count);
    const rows = LAYOUT_FAMILIES.map((family): LayoutRow => {
        const versions = by.get(family)!;
        return versions.length > 0
            ? { family, label: LAYOUT_LABELS[family], versions }
            : {
                  family,
                  label: LAYOUT_LABELS[family],
                  versions,
                  hint: familyHint(family, count),
              };
    });
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(count, rows);
    return rows;
}

/** "add 1 or remove 2" */
export function hintText(hint: LayoutHint): string {
    return [
        hint.more !== null && `add ${hint.more}`,
        hint.fewer !== null && `remove ${hint.fewer}`,
    ]
        .filter(Boolean)
        .join(" or ");
}

/** The rows the count can't make, on one line: "Not for 23: Full (add 1 or remove 2)" */
export function missingLine(
    n: number,
    rows: readonly LayoutRow[],
): string | null {
    const missing = rows.filter((r) => r.versions.length === 0);
    if (missing.length === 0) return null;
    return `Not for ${n}: ${missing
        .map((r) => {
            const text = r.hint ? hintText(r.hint) : "";
            return text ? `${r.label} (${text})` : r.label;
        })
        .join(" · ")}`;
}

/**
 * The version of `family` for `n` nearest `aspect` (across ÷ deep, in spots), the first of
 * equals; null when the family can't make `n`
 */
export function nearestVersion(
    family: LayoutFamily,
    n: number,
    aspect: number,
): LayoutVersion | null {
    const row = layoutCatalogue(n).find((r) => r.family === family)!;
    let best: LayoutVersion | null = null;
    let bestScore = Infinity;
    for (const v of row.versions) {
        const score = Math.abs(Math.log(v.across / v.deep / aspect));
        if (score < bestScore - 1e-9) {
            best = v;
            bestScore = score;
        }
    }
    return best;
}

/** A layout as laid out for a count: the version it is, or Short back when its family can't */
export interface ResolvedLayout {
    readonly layout: FilesLayout;
    /** Marchers in each line, back first (the left file first when turned) */
    readonly lines: readonly number[];
    /** The block's size on the box's axes */
    readonly across: number;
    readonly deep: number;
    /** The layout asked for, when its family can't make the count and Short back stands in */
    readonly fellBack: LayoutFamily | null;
}

function resolved(
    layout: FilesLayout,
    lines: readonly number[],
    fellBack: LayoutFamily | null,
): ResolvedLayout {
    return { layout, lines, ...blockOf(lines, layout.byFile), fellBack };
}

/**
 * How `layout` lays out `n` (spec #385, "Keeping the layout"): as it is when it makes the count;
 * else its family's version nearest its proportions; else Short back as wide, noting the layout
 * it stands in for. Short back makes every count, any width.
 */
export function resolveLayout(layout: FilesLayout, n: number): ResolvedLayout {
    const count = Math.max(1, n);
    const width = Math.max(1, Math.round(layout.files));
    if (layout.family === "shortBack")
        return resolved(
            { ...layout, files: width },
            shortBackLines(width, count),
            null,
        );
    const exact = familyLines(layout.family, width, count);
    if (exact) return resolved({ ...layout, files: width }, exact, null);
    // The block it was, about: `width` along a line, the rest the other way
    const other = Math.max(1, count / width);
    const aspect = layout.byFile ? other / width : width / other;
    const near = nearestVersion(layout.family, count, aspect);
    if (near) return resolved(near.layout, near.lines, null);
    const across = layout.byFile ? Math.max(1, Math.round(other)) : width;
    return resolved(
        { family: "shortBack", files: across, byFile: false },
        shortBackLines(across, count),
        layout.family,
    );
}

/** The chip's note for a layout standing in: "Stagger needs 1 more or 1 fewer" */
export function fallbackNote(family: LayoutFamily, n: number): string {
    const hint = familyHint(family, Math.max(1, n));
    const parts = [
        hint.more !== null && `${hint.more} more`,
        hint.fewer !== null && `${hint.fewer} fewer`,
    ].filter(Boolean);
    return parts.length > 0
        ? `${LAYOUT_LABELS[family]} needs ${parts.join(" or ")}`
        : `${LAYOUT_LABELS[family]} can't make ${n}`;
}
