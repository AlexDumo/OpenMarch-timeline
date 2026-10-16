/**
 * PROTOTYPE (proto/purple-uniforms): candidate default looks in OpenMarch
 * purple (#6442ff). Picked at runtime by localStorage "view3d.uniformDesign";
 * unset or "current" keeps today's navy band and black guard.
 */
import type { UniformLook } from "./looks";

type Base = Pick<UniformLook, "style" | "colors"> & {
    options: Pick<
        UniformLook["options"],
        "stripe" | "collar" | "cuffs" | "gloves" | "hat"
    >;
};

/** sRGB at (u, v): u 0 at the pole to 1 at the fly end, v 0 bottom to 1 top. */
export type SilkPattern = (u: number, v: number) => number;

export interface UniformDesign {
    id: string;
    name: string;
    band: Base;
    guard: Base;
    /** Drum shells, and flag silks without a pattern. */
    carry: number;
    silk?: SilkPattern;
}

// OpenMarch purple and its family
const OM = 0x6442ff;
const OM_DEEP = 0x2e1a99;
const OM_NIGHT = 0x170d4a;
const OM_INK = 0x0d0826;
const LAVENDER = 0xb3a3ff;
const LILAC = 0xe8e3ff;
const WHITE = 0xf2f2ee;
const SILVER = 0xc9cdd8;
const GOLD = 0xd8b04a;
const BLACK = 0x111114;
const SHOE = 0x0b0b0d;

const mix = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, t));
    const ch = (s: number) =>
        Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

const BAND_OPTS = {
    stripe: true,
    collar: true,
    cuffs: true,
    gloves: true,
    hat: true,
};
const GUARD_OPTS = {
    stripe: false,
    collar: false,
    cuffs: false,
    gloves: false,
    hat: false,
};

export const UNIFORM_DESIGNS: UniformDesign[] = [
    {
        // 1. The obvious one, done well: purple jacket and shako, silver
        // trim, white plume; the guard in a matching purple top.
        id: "signature",
        name: "Signature",
        band: {
            style: "classic",
            colors: {
                primary: OM,
                secondary: WHITE,
                accent: WHITE,
                trim: SILVER,
                pants: OM_NIGHT,
                shoes: SHOE,
                gloves: WHITE,
                hat: OM,
                plume: WHITE,
                visor: BLACK,
            },
            options: BAND_OPTS,
        },
        guard: {
            style: "classic",
            colors: {
                primary: OM,
                secondary: OM,
                accent: OM,
                trim: OM,
                pants: OM_NIGHT,
                shoes: SHOE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: OM,
        // purple silk, a white band corner to corner
        silk: (u, v) =>
            Math.abs(u - v) < 0.11
                ? WHITE
                : Math.abs(u - v) < 0.14
                  ? OM_DEEP
                  : OM,
    },
    {
        // 2. Ceremonial: midnight jacket, a purple sash edged in gold.
        id: "sash",
        name: "Royal Sash",
        band: {
            style: "sash",
            colors: {
                primary: OM_NIGHT,
                secondary: WHITE,
                accent: OM,
                trim: GOLD,
                pants: OM_NIGHT,
                shoes: SHOE,
                gloves: WHITE,
                hat: OM_NIGHT,
                plume: OM,
                visor: GOLD,
            },
            options: BAND_OPTS,
        },
        guard: {
            style: "sash",
            colors: {
                primary: OM_NIGHT,
                secondary: OM_NIGHT,
                accent: OM,
                trim: GOLD,
                pants: OM_NIGHT,
                shoes: SHOE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: OM_NIGHT,
        // split on the diagonal: purple at the pole, midnight at the fly,
        // a gold seam between
        silk: (u, v) => {
            const d = u + (1 - v) - 1;
            return Math.abs(d) < 0.035 ? GOLD : d < 0 ? OM : OM_NIGHT;
        },
    },
    {
        // 3. Modern: the jacket fades from near-black at the waist up to
        // purple at the chest; lilac trim; the guard fades the same way.
        id: "fade",
        name: "Ultraviolet Fade",
        band: {
            style: "fade",
            colors: {
                primary: OM,
                secondary: OM_INK,
                accent: LAVENDER,
                trim: LAVENDER,
                pants: OM_INK,
                shoes: SHOE,
                gloves: BLACK,
                hat: OM_INK,
                plume: LAVENDER,
                visor: OM,
            },
            options: { ...BAND_OPTS, stripe: false, collar: false },
        },
        guard: {
            style: "fade",
            colors: {
                primary: LAVENDER,
                secondary: OM_INK,
                accent: OM,
                trim: OM,
                pants: OM_INK,
                shoes: SHOE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: OM_INK,
        // ink at the pole glowing out to purple, then lilac at the fly
        silk: (u) =>
            u < 0.6
                ? mix(OM_INK, OM, u / 0.6)
                : mix(OM, LILAC, (u - 0.6) / 0.4),
    },
    {
        // 4. Bright: a lilac bib on a purple jacket, all-white legs, shoes
        // and shako. Reads well from the press box.
        id: "plastron",
        name: "Lilac Plastron",
        band: {
            style: "plastron",
            colors: {
                primary: OM,
                secondary: LILAC,
                accent: OM,
                trim: OM_DEEP,
                pants: WHITE,
                shoes: WHITE,
                gloves: WHITE,
                hat: WHITE,
                plume: OM,
                visor: OM_DEEP,
            },
            options: BAND_OPTS,
        },
        guard: {
            style: "plastron",
            colors: {
                primary: OM,
                secondary: LILAC,
                accent: OM,
                trim: OM_DEEP,
                pants: WHITE,
                shoes: WHITE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: WHITE,
        // white silk, a purple chevron pointing to the fly
        silk: (u, v) => {
            const c = 0.25 + 0.45 * (1 - 2 * Math.abs(v - 0.5));
            return Math.abs(u - c) < 0.1 ? OM : WHITE;
        },
    },
    {
        // 5. Corps-style military: midnight with purple cross belts,
        // silver buttons and visor.
        id: "military",
        name: "Night Watch",
        band: {
            style: "military",
            colors: {
                primary: OM_NIGHT,
                secondary: OM_INK,
                accent: OM,
                trim: SILVER,
                pants: OM_INK,
                shoes: SHOE,
                gloves: WHITE,
                hat: OM_NIGHT,
                plume: OM,
                visor: SILVER,
            },
            options: BAND_OPTS,
        },
        guard: {
            style: "military",
            colors: {
                primary: OM_NIGHT,
                secondary: OM_INK,
                accent: OM,
                trim: SILVER,
                pants: OM_INK,
                shoes: SHOE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: OM_NIGHT,
        // midnight silk, three purple bars with silver pinstripes
        silk: (u, v) => {
            const bar = (c: number) => Math.abs(v - c);
            const d = Math.min(bar(0.25), bar(0.5), bar(0.75));
            return d < 0.055 ? OM : d < 0.07 ? SILVER : OM_NIGHT;
        },
    },
    {
        // 6. Asymmetric: purple and lavender split on the diagonal; the
        // flags carry a four-shade purple spectrum.
        id: "prism",
        name: "Prism Split",
        band: {
            style: "split",
            colors: {
                primary: OM,
                secondary: LAVENDER,
                accent: WHITE,
                trim: WHITE,
                pants: OM_DEEP,
                shoes: SHOE,
                gloves: WHITE,
                hat: OM_DEEP,
                plume: LAVENDER,
                visor: BLACK,
            },
            options: BAND_OPTS,
        },
        guard: {
            style: "split",
            colors: {
                primary: OM,
                secondary: LILAC,
                accent: OM,
                trim: OM,
                pants: OM_DEEP,
                shoes: SHOE,
                gloves: OM,
                hat: OM,
                plume: OM,
                visor: OM,
            },
            options: GUARD_OPTS,
        },
        carry: OM_DEEP,
        silk: (u, v) => {
            const shades = [OM_NIGHT, OM_DEEP, OM, LAVENDER];
            const t = (u * 0.7 + v * 0.3) * shades.length;
            return shades[Math.min(shades.length - 1, Math.floor(t))];
        },
    },
];

/** The design picked in localStorage, or null for today's defaults. */
export function activeDesign(): UniformDesign | null {
    let id: string | null = null;
    try {
        id = globalThis.localStorage?.getItem("view3d.uniformDesign") ?? null;
    } catch {
        // no storage: today's defaults
    }
    return UNIFORM_DESIGNS.find((d) => d.id === id) ?? null;
}
