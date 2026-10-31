import tolgee from "@/global/singletons/Tolgee";
import type { ToolGroup } from "../tool/toolKind";

/**
 * How the floating editor names a shape's interval groups when it has two or more (owner feedback
 * on #526): `words` says "Multiple intervals", `numbers` sums them up compactly ("2·3 + 4·2").
 * Both open the same group menu. Words by default; the other is kept so the two can be compared.
 */
export type GroupSummaryStyle = "words" | "numbers";
export const GROUP_SUMMARY_STYLE: GroupSummaryStyle = "words";

/** Where the summary style can be switched for a comparison, without a new build */
const STYLE_KEY = "openmarch:groupSummary";

/** The summary style in use: {@link GROUP_SUMMARY_STYLE}, unless switched for a comparison */
export function groupSummaryStyle(): GroupSummaryStyle {
    try {
        const stored = globalThis.localStorage?.getItem(STYLE_KEY);
        if (stored === "words" || stored === "numbers") return stored;
    } catch {
        // No storage (a locked-down browser): the default
    }
    return GROUP_SUMMARY_STYLE;
}

/** How many groups the compact summary names before it ends with "…" */
export const SUMMARY_GROUPS = 3;

/**
 * The groups in a few characters: `2·3 + 4·2`, each count · interval in steps, "the rest" as
 * `rest·4`. Groups dropped off the end aren't named; past `max` groups it ends with "…".
 */
export function groupSummary(
    groups: readonly ToolGroup[],
    max = SUMMARY_GROUPS,
): string {
    const parts = groups
        .filter((g) => !g.dropped)
        .map(
            (g) =>
                `${g.rest ? tolgee.t("shapes.groups.restShort", "rest") : g.count}·${g.interval}`,
        );
    const shown = parts.slice(0, max);
    if (parts.length > max) shown.push("…");
    return shown.join(" + ");
}

/** The marchers a group takes, numbered along the shape from 1: null for a dropped group */
export interface GroupRange {
    readonly from: number;
    readonly to: number;
}

/** Each group's marchers, numbered along the shape from 1, in order */
export function groupRanges(
    groups: readonly ToolGroup[],
): (GroupRange | null)[] {
    let next = 1;
    return groups.map((g) => {
        const count = Number(g.count);
        if (!(count > 0)) return null;
        const range = { from: next, to: next + count - 1 };
        next += count;
        return range;
    });
}

/** A group's marchers in words: "Marchers 1–2", "Marcher 3", "No marchers left" */
export function rangeText(range: GroupRange | null): string {
    if (range === null)
        return tolgee.t("shapes.groups.noMarchers", "No marchers left");
    if (range.from === range.to)
        return tolgee.t("shapes.groups.oneMarcher", "Marcher {n}", {
            n: range.from,
        });
    return tolgee.t("shapes.groups.marchers", "Marchers {from}–{to}", {
        from: range.from,
        to: range.to,
    });
}
