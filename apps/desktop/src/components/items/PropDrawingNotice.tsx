import { Button } from "@openmarch/ui";
import { InfoIcon } from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import type { OutlineType } from "@/db-functions/items";

const INSTRUCTION_KEYS: Record<OutlineType, string> = {
    rectangle: "props.draw.instructions.drag",
    circle: "props.draw.instructions.circle",
    polygon: "props.draw.instructions.polygon",
    arc: "props.draw.instructions.arc",
    freehand: "props.draw.instructions.drag",
};

/** How to draw the chosen Outline, with a way out, while the prop drawing tool is on. */
export default function PropDrawingNotice() {
    const { t } = useTranslate();
    const drawingMode = useItemDrawingStore((s) => s.drawingMode);
    const reset = useItemDrawingStore((s) => s.resetDrawingState);
    if (!drawingMode) return null;
    return (
        <div className="rounded-6 border-stroke bg-modal text-text shadow-modal fixed bottom-[140px] left-1/2 z-[999] flex max-w-[27.5rem] min-w-[18.75rem] -translate-x-1/2 flex-col gap-16 border p-20 font-sans backdrop-blur-lg">
            <div className="flex items-center gap-16">
                <InfoIcon size={24} />
                <span className="text-body text-text flex-1">
                    {t(INSTRUCTION_KEYS[drawingMode])}
                </span>
            </div>
            <Button size="compact" variant="secondary" onClick={reset}>
                <T keyName="props.draw.cancel" />
            </Button>
        </div>
    );
}
