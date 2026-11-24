// Draws the sample flats uniform (an original design, not any real corps or school) from the flats template's
// numbers (src/view3d/assets/uniform-flats/regions.json) into src/view3d/assets/uniform-flats/sample/:
//
//   front.svg, back.svg   the panels (34 x 78 in): a chevron across the chest, a band round each forearm and a
//                         stripe down the side of the pants, from the belt to the hem
//   crest.svg             the chest crest, placed as an item (core/marchers/uniformArtwork.ts SAMPLE_FLATS)
//   number.svg            the back number, placed as an item
//
//   node scripts/view3d-assets/uniform-flats-sample.mjs        (from apps/desktop, after uniform-flats.mjs)
//
// It is also a worked example of drawing flats from regions.json alone: clip to the region polygons, and draw
// anything that goes round a limb or down a side on both panels, meeting at the side seams.
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.resolve(HERE, "../../src/view3d/assets/uniform-flats");
const OUT = path.join(DIR, "sample");
const R = JSON.parse(fs.readFileSync(path.join(DIR, "regions.json"), "utf8"));

const PURPLE = "#6442ff";
const LAVENDER = "#b3a3ff";
const GOLD = "#d8b04a";
const WHITE = "#f2f2ee";
const NIGHT = "#170d4a";

const r2 = (x) => Math.round(x * 100) / 100;
const pts = (poly) => poly.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ");
const region = (panel, part) =>
    R.regions.find((r) => r.panel === panel && r.part === part);
const { w: PW, h: PH } = R.panels.front;
const CX = R.centreX;

/** A band across a region between heights y0 and y1, clipped to the region (goes round a limb on both panels). */
function band(panel, part, y0, y1, fill) {
    const r = region(panel, part);
    return `<rect x="${r2(r.bbox.x - 1)}" y="${r2(y0)}" width="${r2(r.bbox.w + 2)}" height="${r2(y1 - y0)}" fill="${fill}" clip-path="url(#${r.id})"/>`;
}
/** A stripe `w` inches wide inside a region's seam: "left" or "right" as seen on the panel. */
function seamStripe(panel, part, edge, w, fill) {
    const r = region(panel, part);
    const rows = r.seams.rows;
    const x = (row) => (edge === "left" ? row[1] : row[2]);
    const inward = edge === "left" ? w : -w;
    // a little past the seam, so the bleed and filtering stay on the stripe
    const outer = rows.map((row) => [x(row) - inward * 0.5, row[0]]);
    const inner = rows.map((row) => [x(row) + inward, row[0]]).reverse();
    const y0 = rows[0][0];
    const y1 = rows[rows.length - 1][0];
    // extend to the region's top and bottom edges
    outer.unshift([outer[0][0], y0 - 0.6]);
    inner.push([inner[inner.length - 1][0], y0 - 0.6]);
    outer.push([outer[outer.length - 1][0], y1 + 0.6]);
    inner.unshift([inner[0][0], y1 + 0.6]);
    return `<polygon points="${pts([...outer, ...inner])}" fill="${fill}" clip-path="url(#${r.id})"/>`;
}
function clipDefs(panel) {
    return R.regions
        .filter((r) => r.panel === panel)
        .map(
            (r) =>
                `<clipPath id="${r.id}"><polygon points="${pts(r.polygon)}"/></clipPath>`,
        )
        .join("\n");
}
const outerEdge = (panel, part) => {
    // the outer seam is the one farther from the centre line
    const rows = region(panel, part).seams.rows;
    const mid = rows[rows.length >> 1];
    return Math.abs(mid[1] - CX) > Math.abs(mid[2] - CX) ? "left" : "right";
};

function panelSvg(panel) {
    const o = [];
    o.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}in" height="${PH}in" viewBox="0 0 ${PW} ${PH}">`,
    );
    o.push(`<title>OpenMarch sample uniform, ${panel} flat</title>`);
    o.push(`<defs>${clipDefs(panel)}</defs>`);
    if (panel === "front") {
        // a chevron from the shoulders to the sternum, purple edged in gold
        const torso = region("front", "torso");
        const top = torso.bbox.y;
        const apexY = 33;
        const arm = (w) =>
            pts([
                [torso.bbox.x - 1, top + 2.2 - w],
                [CX, apexY - w * 1.6],
                [torso.bbox.x + torso.bbox.w + 1, top + 2.2 - w],
                [torso.bbox.x + torso.bbox.w + 1, top + 2.2 + w],
                [CX, apexY + w * 1.6],
                [torso.bbox.x - 1, top + 2.2 + w],
            ]);
        o.push(`<g clip-path="url(#front-torso)">`);
        o.push(`<polygon points="${arm(1.6)}" fill="${GOLD}"/>`);
        o.push(`<polygon points="${arm(1.25)}" fill="${PURPLE}"/>`);
        o.push(`<polygon points="${arm(0.35)}" fill="${LAVENDER}"/>`);
        o.push(`</g>`);
    } else {
        // a gold line across the shoulders
        const torso = region("back", "torso");
        o.push(
            band("back", "torso", torso.bbox.y + 2.6, torso.bbox.y + 3.1, GOLD),
        );
    }
    // a band round each forearm, a hand's width above the cuff, on both panels
    const cuff = R.landmarks.cuff;
    for (const part of ["sleeve-L", "sleeve-R"]) {
        o.push(band(panel, part, cuff - 5.5, cuff - 4, GOLD));
        o.push(band(panel, part, cuff - 3.6, cuff - 3.2, GOLD));
    }
    // a stripe down each side of the pants, belt to hem, half on each panel
    for (const part of ["leg-L", "leg-R"])
        o.push(seamStripe(panel, part, outerEdge(panel, part), 0.55, GOLD));
    for (const edge of ["left", "right"])
        o.push(seamStripe(panel, "hips", edge, 0.55, GOLD));
    o.push(`</svg>`);
    return o.join("\n") + "\n";
}

/** The crest: a gold ring round an eight-point star. */
function crestSvg() {
    const star = [];
    for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8 - Math.PI / 2;
        const r = i % 2 ? 15 : 34;
        star.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    }
    return (
        [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
            `<title>OpenMarch sample uniform, chest crest</title>`,
            `<circle cx="50" cy="50" r="48" fill="${GOLD}"/>`,
            `<circle cx="50" cy="50" r="42" fill="${NIGHT}"/>`,
            `<circle cx="50" cy="50" r="38" fill="none" stroke="${GOLD}" stroke-width="1.5"/>`,
            `<polygon points="${pts(star)}" fill="${WHITE}"/>`,
            `<circle cx="50" cy="50" r="7" fill="${PURPLE}"/>`,
            `</svg>`,
        ].join("\n") + "\n"
    );
}

/** The back number, "17", in stroked block numerals: white with a purple edge. */
function numberSvg() {
    const one = "M 18 24 L 32 12 L 32 88 M 16 88 L 48 88";
    const seven = "M 72 14 L 124 14 L 92 88";
    const d = `${one} ${seven}`;
    return (
        [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100">`,
            `<title>OpenMarch sample uniform, back number</title>`,
            `<path d="${d}" fill="none" stroke="${PURPLE}" stroke-width="22" stroke-linecap="square" stroke-linejoin="miter"/>`,
            `<path d="${d}" fill="none" stroke="${WHITE}" stroke-width="13" stroke-linecap="square" stroke-linejoin="miter"/>`,
            `</svg>`,
        ].join("\n") + "\n"
    );
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "front.svg"), panelSvg("front"));
fs.writeFileSync(path.join(OUT, "back.svg"), panelSvg("back"));
fs.writeFileSync(path.join(OUT, "crest.svg"), crestSvg());
fs.writeFileSync(path.join(OUT, "number.svg"), numberSvg());
console.log("wrote", fs.readdirSync(OUT).join(", "));
