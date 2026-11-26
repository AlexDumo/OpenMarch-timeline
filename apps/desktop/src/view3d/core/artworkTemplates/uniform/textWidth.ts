/**
 * Text widths in Helvetica, for placing text where no font is at hand: the
 * PDF writer's centred text, and the template's fit checks.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */

/** Helvetica's widths for ASCII 32–126, in thousandths of an em (the standard AFM). */
// prettier-ignore
const HELVETICA = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** A line of text's width in ems; bold Helvetica is a little wider. */
export function textWidthEm(value: string, bold = false): number {
    let w = 0;
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        w += code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
    }
    return (w / 1000) * (bold ? 1.06 : 1);
}
