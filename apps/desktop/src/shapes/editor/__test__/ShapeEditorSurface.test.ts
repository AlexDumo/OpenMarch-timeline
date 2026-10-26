import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The floating editor's fade (#426) in its stylesheet. The browser scenarios can't ask for reduced
 * transparency (Playwright can't emulate it), so the cascade that keeps it solid is checked here.
 */
// Read from disk: the test run stubs CSS imports to nothing
const css = fs.readFileSync(
    path.resolve(__dirname, "../ShapeEditorSurface.css"),
    "utf8",
);

describe("the floating editor's fade", () => {
    it("has no specificity, so reduced transparency always keeps the editor solid", () => {
        const fade = css.slice(0, css.indexOf("opacity: 0.4"));
        const rule = fade.slice(fade.lastIndexOf("@media (hover: hover)"));
        expect(rule).toMatch(/:where\(\s*\.shape-editor-surface/);
        const reduced = css.slice(
            css.indexOf("@media (prefers-reduced-transparency: reduce)"),
        );
        expect(reduced).toMatch(/\.shape-editor-surface[^{]*\{\s*opacity: 1;/);
    });

    it("counts keyboard focus only, not focus handed back after a click", () => {
        expect(css).toContain(":has(:focus-visible:not([data-click-focus]))");
        expect(css).not.toContain(":focus-within");
    });
});
