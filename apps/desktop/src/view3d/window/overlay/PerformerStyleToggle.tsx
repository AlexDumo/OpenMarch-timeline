/**
 * Switches the performers between animated figures and plain blocks. The
 * choice belongs to the window, not the show, so it isn't saved.
 */
import { useTranslate } from "@tolgee/react";
import { PersonSimpleWalkIcon } from "@phosphor-icons/react";
import { useView3dSceneStore } from "../sceneStore";
import { ToggleButton } from "./Panel";

export function PerformerStyleToggle() {
    const { t } = useTranslate();
    const style = useView3dSceneStore((s) => s.performerStyle);
    const setStyle = useView3dSceneStore((s) => s.setPerformerStyle);
    const figures = style === "figures";
    return (
        <ToggleButton
            pressed={figures}
            onClick={() => setStyle(figures ? "blocks" : "figures")}
            icon={<PersonSimpleWalkIcon size={16} />}
            label={t("view3d.overlay.figures")}
            tooltip={t("view3d.overlay.figuresTooltip")}
            testId="view3d-figures-toggle"
        />
    );
}
