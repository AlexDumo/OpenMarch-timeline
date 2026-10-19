import { describe, expect, it } from "vitest";
import { DataTexture } from "three";
import { TextBatch, type GlyphAtlas, type TextLabel } from "../sdfText";

/** A glyph atlas without a canvas: every character is 1 unit wide. */
const stubAtlas = () =>
    ({
        texture: new DataTexture(new Uint8Array(4), 1, 1),
        glyph: () => ({ advance: 1 }),
        measure: (text: string) => [...text].length,
        writeGlyph: () => {},
    }) as unknown as GlyphAtlas;

const BLACK = [0, 0, 0, 1] as const;
const FAINT = [0, 0, 0, 0.75] as const;

const label = (text: string, color: TextLabel["color"]): TextLabel => ({
    text,
    size: 14,
    color,
});

const colors = (batch: TextBatch) =>
    Array.from(
        batch.mesh.geometry.getAttribute("aColor").array as Float32Array,
    );

describe("TextBatch.setColors", () => {
    it("recolors every glyph of each label without laying the text out again", () => {
        const batch = new TextBatch(stubAtlas());
        batch.setLabels([
            label("T1", BLACK),
            label("", BLACK),
            label("B", BLACK),
        ]);
        const glyphs = batch.mesh.geometry.getAttribute("aGlyph");
        const color = batch.mesh.geometry.getAttribute("aColor");
        const version = color.version;

        batch.setColors((i) => (i === 0 ? FAINT : BLACK));

        // Same buffers, so nothing is reallocated or re-uploaded but the colors
        expect(batch.mesh.geometry.getAttribute("aGlyph")).toBe(glyphs);
        expect(batch.mesh.geometry.getAttribute("aColor")).toBe(color);
        expect(color.version).toBeGreaterThan(version);
        // T1's two glyphs are faint; B (label 2) stays black
        expect(colors(batch)).toEqual([...FAINT, ...FAINT, ...BLACK]);
    });

    it("does nothing before any labels are laid out", () => {
        const batch = new TextBatch(stubAtlas());
        expect(() => batch.setColors(() => FAINT)).not.toThrow();
    });
});
