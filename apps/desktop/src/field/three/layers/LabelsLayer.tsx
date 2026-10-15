import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { FieldTheme } from "@openmarch/core";
import { rgba01 } from "../fieldGeometry";
import type { FieldMarchers } from "../fieldMarchers";
import { useFieldViewStore } from "../fieldView";
import { TextBatch, type GlyphAtlas } from "../sdfText";

/** fabric's marcher label: 14 field units, its center 2.2 dot radii above the dot. */
const LABEL_SIZE = 14;
const LABEL_LIFT = 5 * 2.2;
/** The baseline's offset below the label's center, in em. */
const CENTER_BASELINE = 0.35;
/**
 * Labels scale with the field and fade out when they'd be too small to read:
 * fully drawn from `FADE_TO` CSS pixels per em, gone under `FADE_FROM`.
 */
const FADE_FROM = 4;
const FADE_TO = 7;

/**
 * Every marcher's label (drill number) in one instanced draw of SDF glyphs.
 * The text is laid out again only when the marchers or their labels change;
 * a frame only rewrites the anchors.
 */
export default function LabelsLayer({
    marchers,
    labels,
    theme,
    atlas,
}: {
    marchers: FieldMarchers;
    /** Each marcher's drill number, by id. */
    labels: ReadonlyMap<number, string>;
    theme: FieldTheme;
    atlas: GlyphAtlas;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const text = useMemo(() => {
        const batch = new TextBatch(atlas);
        batch.setOffset(0, -LABEL_LIFT);
        batch.mesh.renderOrder = 3;
        return batch;
    }, [atlas]);
    const drawn = useRef({ version: -1, idsVersion: -1, labels, theme });

    useEffect(() => {
        invalidate();
        return () => text.dispose();
    }, [text, invalidate]);

    // New labels or a new theme lay the text out again on the next frame
    useEffect(() => invalidate(), [labels, theme, invalidate]);

    useFrame(() => {
        const { zoom } = useFieldViewStore.getState();
        text.opacity = Math.min(
            1,
            Math.max(
                0,
                (LABEL_SIZE * zoom - FADE_FROM) / (FADE_TO - FADE_FROM),
            ),
        );
        const last = drawn.current;
        const newLayout =
            marchers.idsVersion !== last.idsVersion ||
            labels !== last.labels ||
            theme !== last.theme;
        if (newLayout) {
            const color = rgba01(theme.defaultMarcher.label);
            text.setLabels(
                marchers.ids.map((id) => ({
                    text: labels.get(id) ?? "",
                    size: LABEL_SIZE,
                    baseline: CENTER_BASELINE,
                    color,
                })),
            );
        }
        if (newLayout || marchers.version !== last.version)
            text.setAnchors(marchers.positions);
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            labels,
            theme,
        };
    });

    return <primitive object={text.mesh} />;
}
