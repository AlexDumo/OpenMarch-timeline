import { useFieldLayerRef } from "@/components/canvas/fieldLayers";
import { useTranslate } from "@tolgee/react";
import { TransportTooltipProvider } from "@/components/timeline/ShortcutTooltip";
import { StartFlagPositionsButton } from "./StartFlagPositionsButton";
import SelectToolBar from "./SelectToolBar";
import OverlaysButton from "./OverlaysButton";
import { useShowsSelectTool } from "@/field/fieldSelectTool";

const BAR_CLASS =
    "border-stroke bg-bg-1 text-text rounded-8 pointer-events-auto flex flex-col items-center gap-4 border p-4 shadow-lg";

/**
 * How the field is displayed, apart from the timeline: a small bar at the field's top right (the
 * zoom controls hold the bottom right). It replaced the toolbar's View tab. Two buttons: start
 * flag positions and path overlays (held with N as well as set, so a button of its own), and Show
 * on field, one panel for everything else drawn over the performers and the field (drill
 * numbers, equipment icons, facing, order, shape outlines, the venue). The Select tool's Box and
 * Lasso sit above it in a bar of their own, outside the touch layout (whose pill has its own
 * drag modes).
 */
export default function FieldDisplayBar() {
    const { t } = useTranslate();
    const layerRef = useFieldLayerRef<HTMLDivElement>();
    const showsSelectTool = useShowsSelectTool();
    return (
        <TransportTooltipProvider>
            <div
                ref={layerRef}
                // #927: the pill and the shape editor bar keep off both bars
                data-field-layer="control"
                className="pointer-events-none absolute top-6 right-6 z-10 flex flex-col items-center gap-6"
            >
                {showsSelectTool && <SelectToolBar className={BAR_CLASS} />}
                <div
                    role="group"
                    aria-label={t("fieldDisplay.label")}
                    data-testid="field-display-bar"
                    className={BAR_CLASS}
                >
                    <StartFlagPositionsButton />
                    <OverlaysButton />
                </div>
            </div>
        </TransportTooltipProvider>
    );
}
