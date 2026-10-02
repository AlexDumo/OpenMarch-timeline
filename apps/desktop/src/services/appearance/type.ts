import type { AppearanceComponentOptional } from "@/entity-components/appearance";

/**
 * One marcher's appearance over the whole show, as a step function of time (ported from the
 * `coordinates-v2` branch; docs/timeline/ui.md UI-9 No selected page, P8.12).
 *
 * Appearance stays per page, but in timeline mode there is no selected page to read it from, so
 * each page's appearance takes effect at its flag (the page's end, where marchers arrive) and lasts
 * until the next flag whose appearance differs.
 */
export interface MarcherAppearanceTimeline {
    /** Ascending times in milliseconds at which the appearance changes; the first is the first flag */
    readonly timestamps: readonly number[];
    /**
     * The appearance stack (`CanvasMarcher.setAppearance`, highest priority first) in effect from
     * the same index's timestamp until the next one. Before the first timestamp, the first applies.
     */
    readonly stacks: readonly AppearanceComponentOptional[][];
}
