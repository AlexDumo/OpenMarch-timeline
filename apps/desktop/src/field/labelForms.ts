/** A marcher's label as drawn: its center, and the size of its full drill number */
export interface LabelBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Which labels would touch another label, both written in full. With `auto` field labels, those
 * show the number only ("12" for "OT12"), so a band at 2-step intervals stays readable while a
 * spread-out one keeps full drill numbers (sims: "OT1OT2OT3" soup).
 */
export function crowdedLabels(boxes: readonly LabelBox[], gap = 2): boolean[] {
    const crowded = boxes.map(() => false);
    if (boxes.length < 2) return crowded;
    const cell = Math.max(1, ...boxes.map((b) => b.width + gap));
    const cells = new Map<string, number[]>();
    boxes.forEach((box, i) => {
        const cx = Math.floor(box.x / cell);
        const cy = Math.floor(box.y / cell);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
                    const other = boxes[j]!;
                    if (
                        Math.abs(box.x - other.x) <
                            (box.width + other.width) / 2 + gap &&
                        Math.abs(box.y - other.y) <
                            (box.height + other.height) / 2
                    ) {
                        crowded[i] = true;
                        crowded[j] = true;
                    }
                }
            }
        }
        const key = `${cx},${cy}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(i);
        else cells.set(key, [i]);
    });
    return crowded;
}

/** The sizes Auto tries, largest first, when labels crowd; the last is the smallest readable */
export const AUTO_LABEL_SCALES = [1, 0.85, 0.72, 0.6] as const;

/**
 * How Auto sizes the labels: the largest of {@link AUTO_LABEL_SCALES} at which no two labels
 * touch, else the smallest. Full drill numbers stay (section letters matter when sections share
 * numbers); every label shrinks together (owner, 2026-10-11: shrink rather than drop letters).
 */
export function autoLabelScale(
    boxesAt: (scale: number) => readonly LabelBox[],
): number {
    for (const scale of AUTO_LABEL_SCALES)
        if (!crowdedLabels(boxesAt(scale)).some(Boolean)) return scale;
    return AUTO_LABEL_SCALES[AUTO_LABEL_SCALES.length - 1];
}
