import { currentShapeField } from "../field/shapeFieldContext";

/** A marcher's drill number, else its id */
export function nameOf(marcherId: number): string {
    const m = currentShapeField()
        ?.marchers()
        .find((marcher) => marcher.id === marcherId);
    return m?.drill_number ?? `#${marcherId}`;
}
