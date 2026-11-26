import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import tolgee from "@/global/singletons/Tolgee";
import { toggleFacingArrows } from "@/cues/useFieldFacing";
import { isFieldShown, toggleFieldShown } from "./fieldShow";

const settings = () => useUiSettingsStore.getState().uiSettings;

/**
 * Show on field's switches as actions (fork #1332): Drill numbers, Equipment icons, Facing,
 * Figures, Shape outlines and the 3D View's camera. The panel's switches, the View menu's ticks and the palette
 * all run these; each is checked while on (the menu's tick), and the palette names what it will
 * do ("Show drill numbers" or "Hide drill numbers"). A switch with a choice beside it turns back
 * on to the choice it last showed (`fieldShow.ts`).
 */
// eslint-disable-next-line max-lines-per-function -- one handler per Show on field switch
export function useFieldShowActionHandlers() {
    const labelsOn = useUiSettingsStore((s) =>
        isFieldShown(s.uiSettings, "marcherLabels"),
    );
    useActionHandler(
        "toggleMarcherLabels",
        () => toggleFieldShown("marcherLabels"),
        {
            checked: labelsOn,
            label: () =>
                tolgee.t(
                    isFieldShown(settings(), "marcherLabels")
                        ? "actions.ui.hideMarcherLabels"
                        : "actions.ui.showMarcherLabels",
                ),
        },
    );
    const iconsOn = useUiSettingsStore((s) =>
        isFieldShown(s.uiSettings, "equipmentIcons"),
    );
    useActionHandler(
        "toggleEquipmentIcons",
        () => toggleFieldShown("equipmentIcons"),
        {
            checked: iconsOn,
            label: () =>
                tolgee.t(
                    isFieldShown(settings(), "equipmentIcons")
                        ? "actions.cues.hideEquipmentIcons"
                        : "actions.cues.showEquipmentIcons",
                ),
        },
    );
    // Facing carets on the field (fork #1316)
    const facingOn = useUiSettingsStore(
        (s) => s.uiSettings.facingArrows === true,
    );
    useActionHandler("toggleFacingArrows", toggleFacingArrows, {
        checked: facingOn,
        label: () =>
            tolgee.t(
                settings().facingArrows === true
                    ? "actions.ui.hideFacingArrows"
                    : "actions.ui.showFacingArrows",
            ),
    });
    // Performers as figures seen from above (fork #1319)
    const figuresOn = useUiSettingsStore((s) =>
        isFieldShown(s.uiSettings, "performerFigures"),
    );
    useActionHandler(
        "togglePerformerFigures",
        () => toggleFieldShown("performerFigures"),
        {
            checked: figuresOn,
            label: () =>
                tolgee.t(
                    isFieldShown(settings(), "performerFigures")
                        ? "actions.ui.hidePerformerFigures"
                        : "actions.ui.showPerformerFigures",
                ),
        },
    );
    const outlinesOn = useUiSettingsStore((s) =>
        isFieldShown(s.uiSettings, "shapes"),
    );
    useActionHandler("toggleShapeOutlines", () => toggleFieldShown("shapes"), {
        checked: outlinesOn,
        label: () =>
            tolgee.t(
                isFieldShown(settings(), "shapes")
                    ? "actions.ui.hideShapeOutlines"
                    : "actions.ui.showShapeOutlines",
            ),
    });
    // Where the 3D View looks (#1207), while it's open
    const cameraOn = useUiSettingsStore(
        (s) => s.uiSettings.view3dCameraOnField === true,
    );
    useActionHandler(
        "toggleView3dCameraOnField",
        () => {
            const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
            setUiSettings({
                ...uiSettings,
                view3dCameraOnField: uiSettings.view3dCameraOnField !== true,
            });
        },
        {
            checked: cameraOn,
            label: () =>
                tolgee.t(
                    settings().view3dCameraOnField === true
                        ? "actions.ui.hideView3dCameraOnField"
                        : "actions.ui.showView3dCameraOnField",
                ),
        },
    );
}
