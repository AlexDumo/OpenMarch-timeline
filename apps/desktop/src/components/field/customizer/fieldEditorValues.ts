import type { Checkpoint, RgbaColor } from "@openmarch/core";
import { RgbaColorSchema } from "../fieldPropertiesSchema";

/**
 * The checkpoints in step order, front to back or side 1 to side 2, as a new array. Checkpoint
 * lists come from the query cache, so sorting them in place would change the cached field.
 */
export function sortedCheckpoints(
    checkpoints: readonly Checkpoint[],
): Checkpoint[] {
    return [...checkpoints].sort(
        (a, b) => a.stepsFromCenterFront - b.stepsFromCenterFront,
    );
}

/** A typed number, or undefined when the text isn't one. */
export function parseNumber(text: string): number | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** A typed step size: a number greater than 0, or undefined. */
export function parseStepSize(text: string): number | undefined {
    const parsed = parseNumber(text);
    return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

/** Keeps only digits and one run of decimal points, for unsigned number inputs. */
export function filterUnsignedNumber(text: string): string {
    return text.replace(/[^\d.]/g, "").replace(/\.+/g, ".");
}

/** Keeps digits, decimal points and a leading minus, for signed number inputs. */
export function filterSignedNumber(text: string): string {
    return text
        .replace(/[^\d.-]/g, "")
        .replace(/\.+/g, ".")
        .replace(/--+/g, "-")
        .replace(/(.+)-/g, "$1");
}

/** Whether a picked color is a full RGBA color, as a field file stores it. */
export function isRgbaColor(color: unknown): color is RgbaColor {
    return RgbaColorSchema.safeParse(color).success;
}

/** Whether two colors are the same. */
export function sameColor(a: RgbaColor, b: RgbaColor): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
