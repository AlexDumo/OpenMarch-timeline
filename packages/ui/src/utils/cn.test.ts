import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, THEME_COLORS, THEME_FONT_SIZES, THEME_RADII } from "./cn";

/** Token names declared as `--<prefix>-<name>:` inside the `@theme` block. */
function themeTokens(prefix: string): string[] {
    const css = readFileSync(
        new URL("../tailwind.css", import.meta.url),
        "utf8",
    );
    const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const re = new RegExp(`^\\s*--${prefix}-([\\w-]+)\\s*:`, "gm");
    return [...theme.matchAll(re)].map((m) => m[1]);
}

describe("cn", () => {
    it("keeps a theme font size next to a text color, in either order", () => {
        expect(cn("text-body", "text-fg-1")).toBe("text-body text-fg-1");
        expect(cn("text-text-invert", "text-body")).toBe(
            "text-text-invert text-body",
        );
        expect(cn("text-body", "text-text-invert")).toBe(
            "text-body text-text-invert",
        );
        expect(cn("text-sub", "text-red")).toBe("text-sub text-red");
    });

    it("still collapses two font sizes or two colors to the last one", () => {
        expect(cn("text-body", "text-sub")).toBe("text-sub");
        expect(cn("text-h1 text-body", "text-micro")).toBe("text-micro");
        expect(cn("text-text", "text-accent")).toBe("text-accent");
        expect(cn("text-body text-text-subtitle", "text-sub text-red")).toBe(
            "text-sub text-red",
        );
    });

    it("merges theme radii", () => {
        expect(cn("rounded-6", "rounded-full")).toBe("rounded-full");
        expect(cn("rounded-full", "rounded-8")).toBe("rounded-8");
    });

    it("lists every token in the theme", () => {
        expect([...THEME_FONT_SIZES].sort()).toEqual(
            themeTokens("text").sort(),
        );
        expect([...THEME_COLORS].sort()).toEqual(themeTokens("color").sort());
        expect([...THEME_RADII].sort()).toEqual(themeTokens("radius").sort());
    });
});
