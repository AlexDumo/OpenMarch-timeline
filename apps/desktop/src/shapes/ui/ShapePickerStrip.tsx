import { useEffect, useState } from "react";
import { useTolgee } from "@tolgee/react";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { runAction } from "@/shortcuts/registry";
import { LISTED_SHAPE_KINDS, pickerKindOf } from "../registry";
import { useShapeToolStore } from "../shapeToolStore";
import { SHAPE_KIND_ACTIONS } from "../useShapeToolActions";
import { GESTURES } from "../draw/gestures";

/** Keys that pick a kind straight away, shown on its button */
const KIND_KEYS: Partial<Record<string, string>> = { line: "L", circle: "O" };

/** Where the strip sits: just above the selection, in the canvas container's pixels */
type Spot = { left: number; top: number };

/**
 * The shape picker beside the selection (owner decisions, 2026-10-11): one button per kind,
 * where you're about to draw. Picking a kind lays the marchers on it, fitted through where they
 * stand; then a drag on the field draws it there instead (or clicks, for a curve).
 */
export function ShapePickerStrip({
    canvas,
    isPlaying,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
}) {
    const { t } = useTolgee();
    const session = useShapeToolStore((s) => s.session);
    const selected = useSelectedMarchers()?.selectedMarchers.length ?? 0;
    const ui = useUiSettingsStore((s) => s.uiSettings.shapeUi ?? "draw");
    const spot = useSelectionSpot(canvas);
    const show =
        ui === "draw" &&
        !isPlaying &&
        spot !== null &&
        (selected > 0 || session !== null);
    if (!show) return null;
    return (
        <div
            className="rounded-6 border-stroke bg-modal shadow-modal backdrop-blur-32 absolute z-20 flex gap-2 border p-2"
            style={{ left: spot.left, top: spot.top }}
            data-testid="shape-picker-strip"
            // The field's own handlers mustn't see presses on the strip
            onPointerDown={(e) => e.stopPropagation()}
        >
            {LISTED_SHAPE_KINDS.map((kind) => {
                const Icon = kind.icon;
                const active =
                    session !== null &&
                    pickerKindOf(session.kindId, session.params) === kind.id;
                const key = KIND_KEYS[kind.id];
                const how =
                    GESTURES[kind.id] === "clicks"
                        ? t("inspector.shapeTool.draw.byClicks")
                        : t("inspector.shapeTool.draw.byDrag");
                return (
                    <button
                        key={kind.id}
                        type="button"
                        // Named, not just an icon (sims, draw round 1: Curve was taken for Arc)
                        className={`rounded-4 hover:bg-fg-2 relative flex h-40 min-w-40 flex-col items-center justify-center px-4 ${
                            active ? "bg-accent text-text-invert" : "text-text"
                        }`}
                        title={`${kind.label}${key ? ` (${key})` : ""}: ${how}`}
                        aria-label={kind.label}
                        aria-pressed={active}
                        data-testid={`shape-strip-${kind.id}`}
                        onClick={() =>
                            runAction(
                                SHAPE_KIND_ACTIONS[
                                    kind.id as keyof typeof SHAPE_KIND_ACTIONS
                                ],
                            )
                        }
                    >
                        <Icon size={16} />
                        <span className="text-[10px] leading-tight">
                            {kind.label}
                            {key && (
                                <span className="ml-2 font-mono opacity-60">
                                    {key}
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/** The top-left of the selection's box on screen, kept up to date as the field draws */
function useSelectionSpot(canvas: OpenMarchCanvas | null): Spot | null {
    const [spot, setSpot] = useState<Spot | null>(null);
    useEffect(() => {
        if (!canvas) return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const active = canvas.getActiveObject();
            if (!active) {
                setSpot((s) => (s === null ? s : null));
                return;
            }
            const box = active.getBoundingRect();
            const next = {
                left: Math.max(8, Math.round(box.left)),
                top: Math.max(8, Math.round(box.top - STRIP_GAP_PX)),
            };
            setSpot((s) =>
                s && s.left === next.left && s.top === next.top ? s : next,
            );
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        canvas.on("after:render", schedule);
        schedule();
        return () => {
            canvas.off("after:render", schedule as never);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [canvas]);
    return spot;
}

/** How far above the selection the strip sits, in screen pixels */
const STRIP_GAP_PX = 64;
