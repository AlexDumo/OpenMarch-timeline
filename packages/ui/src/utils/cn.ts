import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Names of the custom tokens in the `@theme` block of `../tailwind.css`.
 * `cn.test.ts` reads that file and fails if these lists drift from it.
 */
export const THEME_FONT_SIZES = [
    "micro",
    "sub",
    "body",
    "h5",
    "h4",
    "h3",
    "h2",
    "h1",
] as const;

export const THEME_COLORS = [
    "bg-1",
    "modal-shadow",
    "modal-overlay",
    "stroke",
    "text",
    "text-subtitle",
    "text-disabled",
    "text-invert",
    "accent",
    "red",
    "yellow",
    "green",
] as const;

export const THEME_RADII = [
    "4",
    "6",
    "8",
    "12",
    "16",
    "20",
    "24",
    "32",
    "full",
] as const;

/**
 * tailwind-merge that knows this theme. Plain `twMerge` reads every unknown
 * `text-*` class as a text color, so `text-body` and `text-text-invert`
 * would knock each other out. Here the theme's font sizes merge only with
 * other font sizes, and its colors only with other colors.
 */
export const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            colors: [...THEME_COLORS],
            borderRadius: [...THEME_RADII],
        },
        classGroups: {
            "font-size": [{ text: [...THEME_FONT_SIZES] }],
        },
    },
});

/** `clsx` plus the theme-aware {@link twMerge}. */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
