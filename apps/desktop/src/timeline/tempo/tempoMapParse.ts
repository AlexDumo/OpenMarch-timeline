/**
 * What the tempo map's cells accept, and how they show values: beat units (♩, ♩., ♪), meters with
 * groupings ("7/8 2+2+3") and tempo marks ("♩=152.5", "dq=176", "♩.=♩"). Pure.
 */

/** A note value a tempo is counted in. */
export type BeatUnit = "s" | "e" | "de" | "q" | "dq" | "h" | "dh";

/** The length of each unit in sixteenth notes. */
export const UNIT_SIXTEENTHS: Readonly<Record<BeatUnit, number>> = {
    s: 1,
    e: 2,
    de: 3,
    q: 4,
    dq: 6,
    h: 8,
    dh: 12,
};

/** How each unit is shown. */
export const UNIT_GLYPH: Readonly<Record<BeatUnit, string>> = {
    s: "𝅘𝅥𝅯",
    e: "♪",
    de: "♪.",
    q: "♩",
    dq: "♩.",
    h: "𝅗𝅥",
    dh: "𝅗𝅥.",
};

export const BEAT_UNITS = Object.keys(UNIT_SIXTEENTHS) as BeatUnit[];

/** Spellings typed for each plain unit (lower case); a "." after or a "d" before dots it. */
const PLAIN_UNIT_NAMES: Readonly<Record<"s" | "e" | "q" | "h", string[]>> = {
    s: ["s", "𝅘𝅥𝅯", "sixteenth"],
    e: ["e", "♪", "𝅘𝅥𝅮", "eighth", "8th"],
    q: ["q", "♩", "𝅘𝅥", "quarter", "crotchet"],
    h: ["h", "𝅗𝅥", "half", "minim"],
};

/** Reads a unit such as "q", "♩", "♩.", "q.", "dq", "e", "♪." or "dh"; null if it isn't one. */
export function parseBeatUnit(text: string): BeatUnit | null {
    let t = text.trim().toLowerCase();
    let dotted = false;
    if (t.endsWith(".")) {
        dotted = true;
        t = t.slice(0, -1).trim();
    } else if (t.startsWith("dotted ")) {
        dotted = true;
        t = t.slice("dotted ".length).trim();
    } else if (t.length > 1 && t.startsWith("d")) {
        const rest = t.slice(1);
        if (Object.values(PLAIN_UNIT_NAMES).some((n) => n.includes(rest))) {
            dotted = true;
            t = rest;
        }
    }
    for (const [plain, names] of Object.entries(PLAIN_UNIT_NAMES) as [
        "s" | "e" | "q" | "h",
        string[],
    ][]) {
        if (!names.includes(t)) continue;
        if (!dotted) return plain;
        return plain === "s" ? null : (`d${plain}` as BeatUnit);
    }
    return null;
}

/** Highest tempo a cell accepts, in beats of its unit per minute. */
export const MAX_TYPED_BPM = 2000;

const NUMBER = /^(\d+(?:[.,]\d*)?|[.,]\d+)$/;

/** "152.5" or "152,5" as a number; null if it isn't a plain decimal. */
function parseDecimal(text: string): number | null {
    const t = text.trim();
    if (!NUMBER.test(t)) return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

export type TempoCellError = "empty" | "unreadable" | "notPositive" | "tooFast";

/**
 * What a tempo cell says:
 * - `tempo`: a number, in `unit` if one was typed ("♩.=176"), else in the row's unit ("152.5");
 * - `relation`: "♩.=♩": this row's `unit` lasts as long as the previous row's `previousUnit`;
 * - `previous`: "=prev": the same pulse as the previous row, in this row's unit.
 */
export type TempoCell =
    | { kind: "tempo"; bpm: number; unit: BeatUnit | null }
    | { kind: "relation"; unit: BeatUnit; previousUnit: BeatUnit }
    | { kind: "previous" }
    | { kind: "error"; error: TempoCellError };

const PREVIOUS_WORDS = new Set(["=", "prev", "=prev", "previous", "same"]);

/**
 * Reads a tempo cell. Accepts "152.5", "152,5", "152.5 bpm", "♩=152.5", "q=152.5", "dq=176",
 * "♩.=176", "e=352", "♪=352", relations such as "♩.=♩" or "e=e", and "=prev".
 */
export function parseTempoCell(text: string): TempoCell {
    const t = text
        .trim()
        .replace(/\s*bpm$/i, "")
        .trim();
    if (t === "") return { kind: "error", error: "empty" };
    if (PREVIOUS_WORDS.has(t.toLowerCase().replace(/\s+/g, "")))
        return { kind: "previous" };
    const eq = t.indexOf("=");
    let unit: BeatUnit | null = null;
    let value = t;
    if (eq >= 0) {
        const left = t.slice(0, eq).trim();
        value = t.slice(eq + 1).trim();
        if (left !== "") {
            unit = parseBeatUnit(left);
            if (unit === null) return { kind: "error", error: "unreadable" };
        }
        const right = parseBeatUnit(value);
        if (right !== null) {
            if (unit === null) return { kind: "error", error: "unreadable" };
            return { kind: "relation", unit, previousUnit: right };
        }
    }
    const bpm = parseDecimal(value);
    if (bpm === null) return { kind: "error", error: "unreadable" };
    if (!(bpm > 0)) return { kind: "error", error: "notPositive" };
    if (bpm > MAX_TYPED_BPM) return { kind: "error", error: "tooFast" };
    return { kind: "tempo", bpm, unit };
}

/**
 * What a rit./accel. cell says: `clear` ("", "-", "none", "a tempo") removes the ramp; `ramp` ends
 * it at `bpm` ("100", "rit. to ♩=100", "accel 140").
 */
export type RampCell =
    | { kind: "clear" }
    | { kind: "ramp"; bpm: number; unit: BeatUnit | null }
    | { kind: "error"; error: TempoCellError };

const CLEAR_WORDS = new Set(["", "-", "–", "none", "no", "a tempo", "off"]);

export function parseRampCell(text: string): RampCell {
    const t = text.trim().toLowerCase();
    if (CLEAR_WORDS.has(t)) return { kind: "clear" };
    const rest = t
        .replace(
            /^(ritardando|ritard|rit|rallentando|rall|accelerando|accel)\.?\s*/,
            "",
        )
        .replace(/^to\s+/, "")
        .trim();
    const cell = parseTempoCell(rest);
    if (cell.kind === "tempo")
        return { kind: "ramp", bpm: cell.bpm, unit: cell.unit };
    if (cell.kind === "error") return cell;
    return { kind: "error", error: "unreadable" };
}

/**
 * A meter: `top`/`bottom`, and how its notes group into counts. `groups` are in `1/bottom`
 * notes ([2, 2, 3] for 7/8 counted 2+2+3); null means one count per `1/bottom` note (4/4).
 */
export interface Meter {
    readonly top: number;
    readonly bottom: number;
    readonly groups: readonly number[] | null;
}

/** The number of counts in a measure of `meter`. */
export const meterCounts = (meter: Meter): number =>
    meter.groups?.length ?? meter.top;

/** Each count's length in sixteenth notes. */
export const meterWeights = (meter: Meter): number[] =>
    meter.groups
        ? meter.groups.map((g) => (g * 16) / meter.bottom)
        : Array<number>(meter.top).fill(16 / meter.bottom);

/** Whether two meters are the same, grouping included. */
export const sameMeter = (a: Meter, b: Meter): boolean =>
    a.top === b.top &&
    a.bottom === b.bottom &&
    (a.groups ?? []).join("+") === (b.groups ?? []).join("+");

/** The meter of counts with these lengths in sixteenths, as the tempo map names it. */
export function meterFromWeights(weights: readonly number[]): Meter {
    if (weights.every((w) => w === 4))
        return { top: weights.length, bottom: 4, groups: null };
    if (weights.every((w) => w === 8))
        return { top: weights.length, bottom: 2, groups: null };
    if (weights.every((w) => w % 2 === 0)) {
        const groups = weights.map((w) => w / 2);
        return {
            top: groups.reduce((a, b) => a + b, 0),
            bottom: 8,
            groups,
        };
    }
    return {
        top: weights.reduce((a, b) => a + b, 0),
        bottom: 16,
        groups: [...weights],
    };
}

/** Whether a meter's groups are all 3 (6/8, 9/8, 12/8), so its grouping goes without saying. */
const isCompound = (m: Meter) =>
    m.groups !== null && m.groups.length > 1 && m.groups.every((g) => g === 3);

/** "4/4", "6/8", "7/8 2+2+3". */
export function formatMeter(meter: Meter): string {
    const sig = `${meter.top}/${meter.bottom}`;
    if (!meter.groups || isCompound(meter)) return sig;
    if (meter.groups.every((g) => g === 1)) return sig;
    return `${sig} ${meter.groups.join("+")}`;
}

/** The unit a tempo in this meter is counted in when nobody typed one. */
export function defaultUnit(meter: Meter): BeatUnit {
    if (isCompound(meter)) return meter.bottom === 8 ? "dq" : "q";
    if (meter.groups && meter.groups.every((g) => g === 1))
        return meter.bottom === 8 ? "e" : meter.bottom === 16 ? "s" : "q";
    if (meter.groups) return "q";
    return meter.bottom === 2 ? "h" : meter.bottom === 8 ? "e" : "q";
}

export type MeterCellError = "empty" | "unreadable" | "groupsDoNotAdd";

export type MeterCell =
    | { kind: "meter"; meter: Meter }
    | { kind: "error"; error: MeterCellError };

const BOTTOMS = new Set([1, 2, 4, 8, 16]);

/**
 * Reads a meter cell: "4/4", "6/8" (in 2: groups of 3), "12/8", "7/8 2+2+3", "7/8 (2+2+3)",
 * or a grouping alone ("2+2+3", in eighths). An n/8 that isn't a multiple of 3 and has no
 * grouping counts every eighth.
 */
export function parseMeterCell(text: string): MeterCell {
    const t = text.trim().replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    if (t === "") return { kind: "error", error: "empty" };
    const match = /^(?:(\d+)\s*\/\s*(\d+))?\s*((?:\d+\s*\+\s*)+\d+)?$/.exec(t);
    if (!match || (match[1] === undefined && match[3] === undefined))
        return { kind: "error", error: "unreadable" };
    const groups =
        match[3]?.split("+").map((g) => Number(g.trim())) ?? undefined;
    if (groups?.some((g) => !Number.isInteger(g) || g < 1))
        return { kind: "error", error: "unreadable" };
    const bottom = match[2] !== undefined ? Number(match[2]) : 8;
    const top =
        match[1] !== undefined
            ? Number(match[1])
            : groups!.reduce((a, b) => a + b, 0);
    if (!BOTTOMS.has(bottom) || top < 1 || top > 64)
        return { kind: "error", error: "unreadable" };
    if (groups) {
        if (groups.reduce((a, b) => a + b, 0) !== top)
            return { kind: "error", error: "groupsDoNotAdd" };
        return { kind: "meter", meter: { top, bottom, groups } };
    }
    if (bottom >= 8 && top > 3 && top % 3 === 0)
        return {
            kind: "meter",
            meter: { top, bottom, groups: Array<number>(top / 3).fill(3) },
        };
    if (bottom >= 8)
        return {
            kind: "meter",
            meter: { top, bottom, groups: Array<number>(top).fill(1) },
        };
    return { kind: "meter", meter: { top, bottom, groups: null } };
}

/** "152.5", "117.333", "176": at most three decimals, no trailing zeros. */
export function formatBpm(bpm: number): string {
    const rounded = Math.round(bpm * 1000) / 1000;
    return String(rounded);
}

/** "♩=152.5", or "♩≈131.4" when the tempo isn't exact. */
export function formatTempo(
    unit: BeatUnit,
    bpm: number,
    exact: boolean,
): string {
    return `${UNIT_GLYPH[unit]}${exact ? "=" : "≈"}${
        exact ? formatBpm(bpm) : String(Math.round(bpm * 10) / 10)
    }`;
}

/** A tempo given in `from` units, in `to` units (the same pulse). */
export const convertBpm = (bpm: number, from: BeatUnit, to: BeatUnit) =>
    (bpm * UNIT_SIXTEENTHS[from]) / UNIT_SIXTEENTHS[to];
