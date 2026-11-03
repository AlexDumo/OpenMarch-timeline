/**
 * The font family (src/styles/text-symbols.css) with text glyphs for symbols a platform
 * could otherwise draw as color emoji, such as ↩ and ↔. `--font-sans` lists it after
 * DM Sans; any other font stack that can show such a symbol must list it too.
 */
export const TEXT_SYMBOLS_FAMILY = "OpenMarch Text Symbols";

/** Font stack for SVG labels drawn over the field (group gaps, guides, box names) */
export const FIELD_LABEL_FONT = `"DM Sans", "${TEXT_SYMBOLS_FAMILY}", sans-serif`;
