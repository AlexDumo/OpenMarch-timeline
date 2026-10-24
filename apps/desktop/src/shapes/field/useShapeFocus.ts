import { useEffect } from "react";
import type { FieldDimming } from "@/field/three/fieldDimming";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useShapeAway, useShapeToolStore } from "../tool/shapeToolStore";

/**
 * Fades everyone who isn't in the open shape (08-shape-system-ux.md, "Marcher styling"): while
 * it's open, or with the View tab's "Fade only while drawing", only while a drag draws it. A
 * selected placed shape fades nobody: selecting one is frequent. Away from the shape's moment
 * (#416) it is hidden, and fades nobody either.
 */
export function useShapeFocus(dimming: FieldDimming): void {
    const focus = useUiSettingsStore((s) => s.uiSettings.shapeFocus ?? "rest");
    const away = useShapeAway();
    const shapeMembers = useShapeToolStore((s) => {
        const tool = s.tool;
        if (!tool) return null;
        if (focus === "drawing" && tool.gesture?.type !== "draw") return null;
        return tool.marchers;
    });
    const members = away ? null : shapeMembers;
    useEffect(() => {
        dimming.setFocus(members ? new Set(members.map((m) => m.id)) : null);
    }, [dimming, members]);
    useEffect(() => () => dimming.setFocus(null), [dimming]);
}
