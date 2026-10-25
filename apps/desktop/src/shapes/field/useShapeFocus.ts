import { useEffect } from "react";
import type { FieldDimming } from "@/field/three/fieldDimming";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useShapeToolStore } from "../tool/shapeToolStore";

/**
 * Fades everyone who isn't in the open shape (08-shape-system-ux.md, "Marcher styling"): while
 * it's open, or with Settings › Field "Fade only while drawing", only while a drag draws it. A
 * selected placed shape fades nobody: selecting one is frequent.
 */
export function useShapeFocus(dimming: FieldDimming): void {
    const focus = useUiSettingsStore((s) => s.uiSettings.shapeFocus ?? "rest");
    const members = useShapeToolStore((s) => {
        const tool = s.tool;
        if (!tool) return null;
        if (focus === "drawing" && tool.gesture?.type !== "draw") return null;
        return tool.marchers;
    });
    useEffect(() => {
        dimming.setFocus(members ? new Set(members.map((m) => m.id)) : null);
    }, [dimming, members]);
    useEffect(() => () => dimming.setFocus(null), [dimming]);
}
