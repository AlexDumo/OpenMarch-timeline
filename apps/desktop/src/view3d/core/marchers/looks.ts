/**
 * What each 3D View marcher looks like: its body (type, skin tone, height
 * class) and its section's uniform (ADR 0002 D-7).
 *
 * The show file stores none of this yet, so the defaults are derived:
 *
 * - body type and skin tone from a stable hash of the marcher ID, so a
 *   marcher looks the same every time the show opens;
 * - height class 1.00 (a 1.80 m figure);
 * - one uniform per section, in the section's 2D fill color, carrying the
 *   section's instrument when om-pose models it.
 *
 * Pure: no three.js, React or database.
 */
import type { RgbaColor } from "@openmarch/core";
import { FAMILIES, getSectionObjectByName } from "@/global/classes/Sections";

/** om-pose's seven body types (`assets/body-v4u/<type>.glb`). */
export const BODY_TYPES = [
    "neutral-slim",
    "neutral-average",
    "neutral-athletic",
    "neutral-broad",
    "neutral-full",
    "feminine-average",
    "masculine-average",
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** The skin tones om-pose's viewers use, light to dark. */
export const SKIN_TONES = [
    0xf1c9a5, 0xe0ac7e, 0xc68863, 0x9c6644, 0x6f4a32, 0x4b3124,
] as const;

/** Height classes: each is a full clip set drawn at that scale. */
export const HEIGHT_CLASSES = [0.9, 0.95, 1, 1.05, 1.1] as const;
export type HeightClass = (typeof HEIGHT_CLASSES)[number];

/** Height of the top of the head at class 1.00, in meters. */
export const CLASS_HEIGHT_M = 1.8;

/** A performer's own body: what belongs to the person, not the uniform. */
export interface PerformerBody {
    bodyType: BodyType;
    /** sRGB as a number, as `writeMarcher` takes it. */
    skinTone: number;
    heightClass: HeightClass;
}

/** The class nearest a performer's height in meters. */
export function heightClassFor(heightM: number): HeightClass {
    const ratio = heightM / CLASS_HEIGHT_M;
    let best: HeightClass = 1;
    for (const h of HEIGHT_CLASSES)
        if (Math.abs(h - ratio) < Math.abs(best - ratio)) best = h;
    return best;
}

/** The clip name suffix for a class: "-h090" ... "-h110", none for 1.00. */
export function classSuffix(h: HeightClass): string {
    return h === 1 ? "" : `-h${String(Math.round(h * 100)).padStart(3, "0")}`;
}

/** The packed clip file's tag for a class: "h090" ... "h110". */
export function classTag(h: HeightClass): string {
    return `h${String(Math.round(h * 100)).padStart(3, "0")}`;
}

// cspell:ignore lowbias
/** A 32-bit integer hash (lowbias32), stable across runs and platforms. */
export function hash32(n: number): number {
    let x = n >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

/** The derived body for a marcher with no stored body. */
export function defaultPerformerBody(marcherId: number): PerformerBody {
    const a = hash32(marcherId);
    const b = hash32(a ^ 0x9e3779b9);
    return {
        bodyType: BODY_TYPES[a % BODY_TYPES.length],
        skinTone: SKIN_TONES[b % SKIN_TONES.length],
        heightClass: 1,
    };
}

/** Instruments the uniform shader can put in a performer's right hand. */
export type Instrument = "none" | "trumpet" | "mellophone" | "baritone";

/** The instrument om-pose models for a section, by the section's name. */
export function instrumentForSection(section: string): Instrument {
    const name = section.trim().toLowerCase();
    if (name === "trumpet" || name === "cornet") return "trumpet";
    if (name === "mellophone" || name === "french horn") return "mellophone";
    if (name === "baritone" || name === "euphonium") return "baritone";
    return "none";
}

/** Color guard sections (the "Guard" family: color guard, rifle, flag, dancer, twirler). */
export function isGuard(section: string): boolean {
    return getSectionObjectByName(section.trim()).family === FAMILIES.Guard;
}

/** A uniform: `createUniformMaterial`'s input. Colors are sRGB numbers. */
export interface UniformLook {
    style: "classic" | "sash" | "plastron" | "military" | "split" | "fade";
    colors: {
        primary: number;
        secondary: number;
        accent: number;
        trim: number;
        pants: number;
        shoes: number;
        gloves: number;
        hat: number;
        plume: number;
        visor: number;
    };
    options: { hat: boolean; hatType: "shako"; instrument: Instrument };
}

/** Used when a section has no fill color: om-pose's "Royal" blue. */
export const DEFAULT_PRIMARY = 0x2d4f9e;

const WHITE = 0xf2f2ee;
const GOLD = 0xd8b04a;
const BLACK = 0x111114;
/** Darker than the pants, so the feet still separate from the legs. */
const SHOE_BLACK = 0x0b0b0d;
/** Lifted from om-pose's 0x1c1f2b, which renders as black legs. */
const NAVY = 0x2b3150;

const rgbToNumber = (c: RgbaColor) =>
    ((Math.round(c.r) & 255) << 16) |
    ((Math.round(c.g) & 255) << 8) |
    (Math.round(c.b) & 255);

/**
 * A section's uniform: om-pose's classic style with the section's fill as
 * the jacket and hat, white and gold trim, navy pants. Guard sections go
 * without the shako.
 */
export function sectionUniform(
    section: string,
    fill: RgbaColor | null | undefined,
): UniformLook {
    const primary = fill ? rgbToNumber(fill) : DEFAULT_PRIMARY;
    return {
        style: "classic",
        colors: {
            primary,
            secondary: WHITE,
            accent: WHITE,
            trim: GOLD,
            pants: NAVY,
            shoes: SHOE_BLACK,
            gloves: WHITE,
            hat: primary,
            plume: WHITE,
            visor: BLACK,
        },
        options: {
            // guard doesn't wear a shako
            hat: !isGuard(section),
            hatType: "shako",
            instrument: instrumentForSection(section),
        },
    };
}

/** Identifies a uniform, so equal looks share one material. */
export function uniformKey(look: UniformLook): string {
    return JSON.stringify(look);
}
