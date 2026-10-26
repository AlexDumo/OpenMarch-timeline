import type { RgbaColor } from "@openmarch/core";
import { START_INK } from "@/components/timeline/startFlagInk";

/**
 * The snap guide's color (#425, #427): the line along the checkpoint a shape's edge is on, the
 * edge itself, the spots on it and the checkpoint's name tag. The lab tries several, picked with
 * its Version switch; outside the lab it's pink.
 *
 * Each was checked against a white field, a dark one (about rgb 30 30 35) and turf (about rgb 72
 * 112 52), and against the selection blue, the accent and the shape purple. No single color
 * reaches 3:1 on both white and turf, so the guide line has a dark edge under it (as the pivot
 * does) that carries it on turf and images.
 */
export interface GuideInk {
    /** The color as an SVG attribute, for this field background */
    readonly color?: (background: RgbaColor) => string;
    /** Or as class names, for a theme token that follows light and dark */
    readonly classes?: { readonly stroke: string; readonly fill: string };
    /** The name tag's text on this color */
    readonly text: (background: RgbaColor) => string;
}

const fixed = (color: string, text = "white"): GuideInk => ({
    color: () => color,
    text: () => text,
});

/** Relative luminance, 0 to 1 */
const luminance = ({ r, g, b }: RgbaColor) => {
    const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const lightField = (background: RgbaColor) => luminance(background) > 0.4;

export const GUIDE_INKS = {
    /** Pink: 3.5:1 on white, 4.7:1 on dark */
    pink: fixed("#ec4899"),
    /**
     * The timeline's start flag yellow, its own token: ochre in the light app (4.2:1 on white,
     * 3.9:1 on dark), yellow in the dark app (11:1 on dark, but 1.5:1 on a white field, where the
     * dark edge carries the line)
     */
    yellow: {
        classes: { stroke: START_INK.stroke, fill: START_INK.fill },
        text: () => "black",
    },
    /** Teal: 3.7:1 on white, 4.4:1 on dark, 41° of hue from the selection blue */
    teal: fixed("#0d9488"),
    /** Orange: 3.6:1 on white, 4.7:1 on dark */
    orange: fixed("#ea580c"),
    /** Black on a light field, white on a dark one or turf: 5:1 or more on all three */
    contrast: {
        color: (background) => (lightField(background) ? "#111827" : "#ffffff"),
        text: (background) => (lightField(background) ? "white" : "#111827"),
    },
} as const satisfies Record<string, GuideInk>;

export type GuideInkId = keyof typeof GUIDE_INKS;

/** The guide's color for a lab version, pink for none or one this build doesn't know */
export const guideInkFor = (variant: string | null): GuideInk =>
    variant && variant in GUIDE_INKS
        ? GUIDE_INKS[variant as GuideInkId]
        : GUIDE_INKS.pink;

/** An SVG element's stroke or fill in `ink`: an attribute, or a class for a theme token */
export function inkProps(
    ink: GuideInk,
    background: RgbaColor,
    part: "stroke" | "fill",
): { stroke?: string; fill?: string; className?: string } {
    if (ink.classes) return { className: ink.classes[part] };
    return { [part]: ink.color!(background) };
}
