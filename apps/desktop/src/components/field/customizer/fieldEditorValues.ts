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

/** A plain decimal number: an optional minus, digits and at most one decimal point. */
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * A typed number, or undefined when the text isn't one. Only plain decimals count, so text
 * such as "1.2.3" is refused rather than read as 1.2.
 */
export function parseNumber(text: string): number | undefined {
    const trimmed = text.trim();
    if (!DECIMAL.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A number as an input shows it: rounded to 4 decimal places, which drops float noise such as
 * the 57.150000000000006 cm that 22.5 inches converts to.
 */
export function formatNumber(value: number): string {
    return String(Math.round(value * 10_000) / 10_000);
}

/** A typed step size: a number greater than 0, or undefined. */
export function parseStepSize(text: string): number | undefined {
    const parsed = parseNumber(text);
    return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

/**
 * Keeps only digits and decimal points, for unsigned number inputs. Returns null, refusing the
 * keystroke, when the text would have a second decimal point ("1.2.3").
 */
export function filterUnsignedNumber(text: string): string | null {
    const cleaned = text.replace(/[^\d.]/g, "");
    return oneDecimalPoint(cleaned) ? cleaned : null;
}

/**
 * Keeps digits, decimal points and a leading minus, for signed number inputs. Returns null,
 * refusing the keystroke, when the text would have a second decimal point.
 */
export function filterSignedNumber(text: string): string | null {
    const cleaned = text
        .replace(/[^\d.-]/g, "")
        .replace(/--+/g, "-")
        .replace(/(.+)-/g, "$1");
    return oneDecimalPoint(cleaned) ? cleaned : null;
}

const oneDecimalPoint = (text: string) => text.split(".").length <= 2;

/** Whether a picked color is a full RGBA color, as a field file stores it. */
export function isRgbaColor(color: unknown): color is RgbaColor {
    return RgbaColorSchema.safeParse(color).success;
}

/** Whether two colors are the same. */
export function sameColor(a: RgbaColor, b: RgbaColor): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
