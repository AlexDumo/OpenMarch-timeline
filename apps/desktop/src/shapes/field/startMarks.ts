import { useLabVariant } from "@/lab/labVariant";

/**
 * How an open shape marks where its marchers start (#417 lab, owner comparing):
 * - `rings`: hollow circles in the shape color
 * - `ghost`: faint, see-through solid dots in each marcher's own color
 * - `ghost-labels`: small faint dots with the marchers' labels
 *
 * TEMPORARY: the lab's Version switch picks one. This is the only place that reads it, so the
 * winner is a one-line change here (and the losers' drawing in `FieldOverlay` goes).
 */
export type StartMarkStyle = "rings" | "ghost" | "ghost-labels";

const STYLES: readonly StartMarkStyle[] = ["rings", "ghost", "ghost-labels"];

/** The style for lab version `variant`: rings unless it names another */
export function startMarkStyle(variant: string | null): StartMarkStyle {
    return STYLES.find((s) => s === variant) ?? "rings";
}

export const useStartMarkStyle = (): StartMarkStyle =>
    startMarkStyle(useLabVariant());
