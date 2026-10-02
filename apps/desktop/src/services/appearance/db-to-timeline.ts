import type {
    MarcherIdsByTagId,
    SectionAppearance,
    TagAppearance,
    TagAppearanceIdsByPageId,
} from "@/db-functions";
import {
    resolveAppearanceFromStack,
    type AppearanceComponentOptional,
    type ResolvedPerformerAppearance,
} from "@/entity-components/appearance";
import type Marcher from "@/global/classes/Marcher";
import type { FieldProperties } from "@openmarch/core";
import { _combineMarcherAppearances } from "@/hooks/queries/useMarcherAppearances";
import type { MarcherAppearanceTimeline } from "./type";

/** The fields of a page this reads. `Page` satisfies it. */
export interface AppearancePage {
    readonly id: number;
    /** Start time in seconds */
    readonly timestamp: number;
    /** Length in seconds */
    readonly duration: number;
}

const appearancesEqual = (
    a: ResolvedPerformerAppearance,
    b: ResolvedPerformerAppearance,
): boolean =>
    a.fillRgba === b.fillRgba &&
    a.strokeRgba === b.strokeRgba &&
    a.strokeWidth === b.strokeWidth &&
    a.visible === b.visible &&
    a.textVisible === b.textVisible &&
    a.shape === b.shape;

/**
 * Every marcher's appearance as a step function of time, for timeline mode (ported from
 * `coordinates-v2`'s `dbToMarcherAppearanceTimeline`; docs/timeline/ui.md UI-9 No selected page,
 * P8.12).
 *
 * Each page's appearance stack is the one the canvas used for that page before: tag appearances in
 * effect on the page (by priority), then the section appearance, then the field theme
 * (`_combineMarcherAppearances`). The per-marcher-page overrides of `marcher_pages` are left out,
 * as everywhere in timeline mode (P7.14). A page's stack takes effect at its flag, its end time
 * (`timestamp + duration`), matching the page-mode keyframes; a page whose appearance resolves the
 * same as the one before adds no keyframe.
 *
 * @param pages every page, in show order
 * @param tagAppearanceIdsByPageId the tag appearances in effect on each page
 *   (`tagAppearanceByPageIdMapQueryOptions`)
 */
export function dbToMarcherAppearanceTimelines({
    pages,
    marchers,
    sectionAppearances,
    marcherIdsByTagId,
    tagAppearances,
    tagAppearanceIdsByPageId,
    fieldProperties,
}: {
    pages: readonly AppearancePage[];
    marchers: Marcher[];
    sectionAppearances: SectionAppearance[];
    marcherIdsByTagId: MarcherIdsByTagId;
    tagAppearances: TagAppearance[];
    tagAppearanceIdsByPageId: TagAppearanceIdsByPageId;
    fieldProperties: FieldProperties;
}): Map<number, MarcherAppearanceTimeline> {
    const timestamps = new Map<number, number[]>();
    const stacks = new Map<number, AppearanceComponentOptional[][]>();
    const last = new Map<number, ResolvedPerformerAppearance>();
    for (const marcher of marchers) {
        timestamps.set(marcher.id, []);
        stacks.set(marcher.id, []);
    }
    for (const page of pages) {
        const ids = tagAppearanceIdsByPageId.get(page.id);
        const byMarcher = _combineMarcherAppearances({
            marchers,
            sectionAppearances,
            marcherIdsByTagId,
            tagAppearances: ids
                ? tagAppearances.filter((a) => ids.has(a.id))
                : [],
            marcherPages: {},
            fieldProperties,
        });
        const flagMs = (page.timestamp + page.duration) * 1000;
        for (const marcher of marchers) {
            const stack = byMarcher[marcher.id];
            if (!stack) continue;
            const resolved = resolveAppearanceFromStack(
                stack,
                fieldProperties.theme,
            );
            const previous = last.get(marcher.id);
            if (previous && appearancesEqual(previous, resolved)) continue;
            last.set(marcher.id, resolved);
            timestamps.get(marcher.id)!.push(flagMs);
            stacks.get(marcher.id)!.push(stack);
        }
    }
    const out = new Map<number, MarcherAppearanceTimeline>();
    for (const marcher of marchers)
        out.set(marcher.id, {
            timestamps: timestamps.get(marcher.id)!,
            stacks: stacks.get(marcher.id)!,
        });
    return out;
}
