import type { ShapePreview } from "../session";
import {
    defaultShapePreviewView,
    LABEL_SIZE_SCALE,
    type MarcherLabelForm,
    type MarcherLabelSize,
    type ShapePreviewView,
} from "@/stores/UiSettingsStore";

/** A band bigger than this draws only the walks with a problem, by default */
export const DENSE_BAND = 24;

/** What the preview draws, once each `auto` view option is decided */
export interface ResolvedShapeView {
    readonly paths: "all" | "problems" | "none";
    readonly labels: "names" | "numbers" | "none";
    /** Labels where marchers start, as well as on the new spots */
    readonly startLabels: boolean;
    readonly oldShape: boolean;
    /** Start rings, their labels and the walks drawn strongly */
    readonly strongStarts: boolean;
    /** The field's label size, as a scale */
    readonly labelScale: number;
}

/**
 * Decides the Shape tool's view options set to `auto`: a big band draws only the walks with a
 * problem and no labels where marchers start; labels follow the field's label setting, and on
 * its Auto, spots under 3 steps apart get numbers only; the
 * shape being replaced shows until the new one is edited.
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
    },
): ResolvedShapeView {
    const v = { ...defaultShapePreviewView, ...view };
    const dense = band.count > DENSE_BAND;
    const field = band.fieldLabels ?? "auto";
    const labels =
        v.labels !== "auto"
            ? v.labels
            : field !== "auto"
              ? field
              : band.tight
                ? "numbers"
                : "names";
    return {
        paths: v.paths !== "auto" ? v.paths : dense ? "problems" : "all",
        labels,
        // Strong start marks carry their numbers even on a big band (sims, round 8)
        startLabels:
            labels !== "none" &&
            (v.labels !== "auto" || !dense || v.starts === "strong"),
        oldShape: v.oldShape !== "auto" ? v.oldShape === "show" : !band.edited,
        // Strong on a small band (sims, round 8: "darker start rings"), faint on a big one
        strongStarts: v.starts === "auto" ? !dense : v.starts === "strong",
        labelScale: LABEL_SIZE_SCALE[band.fieldLabelSize ?? "normal"],
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
