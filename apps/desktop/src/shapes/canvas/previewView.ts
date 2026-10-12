import type { ShapePreview } from "../session";
import {
    defaultShapePreviewView,
    LABEL_SIZE_SCALE,
    type MarcherLabelForm,
    type MarcherLabelSize,
    type ShapePreviewView,
} from "@/stores/UiSettingsStore";

/** Preview labels' size, relative to normal, where spots are tight and the field is on Auto */
const TIGHT_LABEL_SCALE = 0.72;

/** A band bigger than this draws only the walks with a problem, by default */
export const DENSE_BAND = 24;

/** What the preview draws, once each `auto` view option is decided */
export interface ResolvedShapeView {
    readonly paths: "all" | "problems" | "collisions" | "none";
    readonly labels: "names" | "numbers" | "none";
    /** Labels where marchers start, as well as on the new spots */
    readonly startLabels: boolean;
    readonly oldShape: boolean;
    /** Start rings, their labels and the walks drawn strongly */
    readonly strongStarts: boolean;
    /** Start marks hidden altogether */
    readonly noStarts: boolean;
    /** The field's label size, as a scale */
    readonly labelScale: number;
    /** Labels beside the dots rather than above, as on the field */
    readonly labelBeside: boolean;
    /** Only the marchers where they'll stand: no outline, handles, walks or earlier marks */
    readonly showOnly: boolean;
    /** Only the marchers and their walks: no outline, handles, start marks or old shape */
    readonly walksOnly: boolean;
    /** How the outline and handles look while the pointer is away from the shape */
    readonly handlesAway: "fade" | "hide" | "show";
}

/**
 * Decides the Shape tool's view options set to `auto`: a big band draws only the walks with a
 * problem and no labels where marchers start; labels follow the field's label setting, and on
 * its Auto, spots under 3 steps apart get smaller labels; the shape being replaced is hidden.
 */
export function resolveShapeView(
    view: Partial<ShapePreviewView> | undefined,
    band: {
        count: number;
        tight: boolean;
        edited: boolean;
        /** The field's own label setting (View tab), which Auto follows */
        fieldLabels?: MarcherLabelForm;
        fieldLabelSize?: MarcherLabelSize;
        fieldLabelPosition?: "above" | "beside";
    },
): ResolvedShapeView {
    const v = { ...defaultShapePreviewView, ...view };
    const dense = band.count > DENSE_BAND;
    const field = band.fieldLabels ?? "auto";
    // Auto follows the field: off, numbers or full drill numbers. On the field's Auto, full drill
    // numbers, shrunk where spots are tight (owner, 2026-10-11: shrink, don't drop letters)
    const labels: ResolvedShapeView["labels"] =
        v.labels !== "auto"
            ? v.labels
            : field === "off"
              ? "none"
              : field === "numbers"
                ? "numbers"
                : "names";
    const shrink = v.labels === "auto" && field === "auto" && band.tight;
    return {
        paths: v.paths !== "auto" ? v.paths : dense ? "problems" : "all",
        labels,
        // Strong start marks carry their numbers even on a big band (sims, round 8)
        startLabels:
            labels !== "none" &&
            v.starts !== "off" &&
            (v.labels !== "auto" || !dense || v.starts === "strong"),
        // Hidden on Auto (owner, 2026-10-11: every simulated user asked to hide it)
        oldShape: v.oldShape === "show",
        // Strong on a small band (sims, round 8: "darker start rings"), faint on a big one
        strongStarts: v.starts === "auto" ? !dense : v.starts === "strong",
        noStarts: v.starts === "off",
        labelScale:
            LABEL_SIZE_SCALE[band.fieldLabelSize ?? "normal"] *
            (shrink ? TIGHT_LABEL_SCALE : 1),
        labelBeside: band.fieldLabelPosition === "beside",
        showOnly: v.look === "show",
        walksOnly: v.look === "walks",
        handlesAway: v.handles,
    };
}

/**
 * Whether the new spots are too close for full drill numbers ("OT12") to stay apart: any two
 * nearer than three steps.
 */
export function tightSpacing(preview: ShapePreview, stepPx: number): boolean {
    const near = 3 * stepPx;
    const spots = preview.targets.map((t) => t.to);
    for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
            if (
                Math.hypot(
                    spots[i]!.x - spots[j]!.x,
                    spots[i]!.y - spots[j]!.y,
                ) < near
            )
                return true;
        }
    }
    return false;
}
