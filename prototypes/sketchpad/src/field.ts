// High-school football field in scene units. 1 step = 22.5 in, 8 steps per 5 yards.
// Scene origin (0,0) is the back-left corner of the left end zone; front sideline is at the bottom.

export const STEP = 12; // scene units per step
export const YARD = (8 / 5) * STEP;
export const END_ZONE = 10 * YARD;
export const FIELD_W = 120 * YARD; // goal line to goal line plus both end zones
export const FIELD_H = (160 / 3) * YARD; // 53 1/3 yards = 85.33 steps
// HS hashes: 28 steps from the front sideline and 56 from the front (Football.ts uses the same rounding)
export const FRONT_HASH_Y = FIELD_H - 28 * STEP;
export const BACK_HASH_Y = FIELD_H - 56 * STEP;

export interface FieldStyle {
  grid: boolean;
  lineColor: string;
  turf: string;
  /** measurement mode: draw the 50 yard line and front hash row as 12-unit pure blue bands */
  probe?: boolean;
}

export const DEFAULT_FIELD_STYLE: FieldStyle = {
  grid: true,
  lineColor: "#ffffff",
  turf: "#3f7d3a",
};

export const yardX = (yardsFromLeftGoal: number) => END_ZONE + yardsFromLeftGoal * YARD;

/** SVG markup for the field in scene units (no outer <svg>), reused by underlay, image mode and exports. */
export function fieldSvgContent(style: FieldStyle): string {
  const c = style.lineColor;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${FIELD_W}" height="${FIELD_H}" fill="${style.turf}"/>`);
  if (style.grid) {
    parts.push(
      `<defs><pattern id="om-step-grid" x="0" y="${FIELD_H % STEP}" width="${STEP}" height="${STEP}" patternUnits="userSpaceOnUse">` +
        `<path d="M ${STEP} 0 L 0 0 0 ${STEP}" fill="none" stroke="${c}" stroke-opacity="0.18" stroke-width="0.6"/></pattern></defs>`,
      // pattern offset anchors the grid to the front sideline so whole steps count from the front
      `<rect x="0" y="0" width="${FIELD_W}" height="${FIELD_H}" fill="url(#om-step-grid)"/>`,
    );
  }
  // end zones tint
  parts.push(
    `<rect x="0" y="0" width="${END_ZONE}" height="${FIELD_H}" fill="#000" fill-opacity="0.08"/>`,
    `<rect x="${FIELD_W - END_ZONE}" y="0" width="${END_ZONE}" height="${FIELD_H}" fill="#000" fill-opacity="0.08"/>`,
  );
  // yard lines every 5 yards (goal lines heavier)
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = yardX(yd);
    const probe = style.probe && yd === 50;
    const w = probe ? 12 : yd === 0 || yd === 100 ? 4 : yd % 10 === 0 ? 2.4 : 1.6;
    const stroke = probe ? "#0000ff" : c;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${FIELD_H}" stroke="${stroke}" stroke-width="${w}"/>`);
  }
  // hashes every yard at HS positions, plus sideline ticks
  const hashLen = 2 * STEP * 0.6;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = yardX(yd);
    for (const y of [FRONT_HASH_Y, BACK_HASH_Y]) {
      parts.push(`<line x1="${x}" y1="${y - hashLen / 2}" x2="${x}" y2="${y + hashLen / 2}" stroke="${c}" stroke-width="1.2"/>`);
    }
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${STEP}" stroke="${c}" stroke-width="1.2"/>`);
    parts.push(`<line x1="${x}" y1="${FIELD_H - STEP}" x2="${x}" y2="${FIELD_H}" stroke="${c}" stroke-width="1.2"/>`);
  }
  // hash rows across the 5-yard lines (short horizontal dashes)
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = yardX(yd);
    for (const y of [FRONT_HASH_Y, BACK_HASH_Y]) {
      parts.push(`<line x1="${x - STEP}" y1="${y}" x2="${x + STEP}" y2="${y}" stroke="${c}" stroke-width="1.6"/>`);
    }
  }
  // measurement mode: a 12-unit blue band along the front hash row (Excalidraw draws a 4-unit red line on its center)
  if (style.probe) parts.push(`<line x1="0" y1="${FRONT_HASH_Y}" x2="${FIELD_W}" y2="${FRONT_HASH_Y}" stroke="#0000ff" stroke-width="12"/>`);
  // numbers (front upright, back upside down), about 12 steps in from each sideline
  const numSize = 5 * STEP;
  for (let yd = 10; yd <= 90; yd += 10) {
    const label = String(yd <= 50 ? yd : 100 - yd);
    const x = yardX(yd);
    const yFront = FIELD_H - 12 * STEP;
    const yBack = 12 * STEP;
    const font = `font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${numSize}" fill="${c}" text-anchor="middle"`;
    parts.push(`<text x="${x}" y="${yFront}" ${font}>${label}</text>`);
    parts.push(`<text x="${x}" y="${yBack}" ${font} transform="rotate(180 ${x} ${yBack})">${label}</text>`);
  }
  // sideline border
  parts.push(`<rect x="0" y="0" width="${FIELD_W}" height="${FIELD_H}" fill="none" stroke="${c}" stroke-width="4"/>`);
  return parts.join("");
}

/** Standalone SVG document (scene units, optional extra margin around the field). */
export function fieldSvgDocument(style: FieldStyle, bounds = { x: 0, y: 0, w: FIELD_W, h: FIELD_H }, pxScale = 1): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.w * pxScale}" height="${bounds.h * pxScale}" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">` +
    fieldSvgContent(style) +
    `</svg>`
  );
}

/** Line segments for the "field as locked Excalidraw elements" comparison mode. */
export function fieldSegments(style: FieldStyle) {
  const segs: { x1: number; y1: number; x2: number; y2: number; w: number; color: string }[] = [];
  const c = style.lineColor;
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = yardX(yd);
    segs.push({ x1: x, y1: 0, x2: x, y2: FIELD_H, w: yd % 10 === 0 ? 2 : 1, color: style.probe && yd === 50 ? "#0000ff" : c });
  }
  const hashLen = 2 * STEP * 0.6;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = yardX(yd);
    for (const y of [FRONT_HASH_Y, BACK_HASH_Y]) segs.push({ x1: x, y1: y - hashLen / 2, x2: x, y2: y + hashLen / 2, w: 1, color: c });
  }
  if (style.grid) {
    for (let x = 0; x <= FIELD_W; x += STEP) segs.push({ x1: x, y1: 0, x2: x, y2: FIELD_H, w: 0.5, color: "#ffffff40" });
    for (let y = FIELD_H; y >= 0; y -= STEP) segs.push({ x1: 0, y1: y, x2: FIELD_W, y2: y, w: 0.5, color: "#ffffff40" });
  }
  return segs;
}
