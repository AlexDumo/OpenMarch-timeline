import type { FieldTestApi, FieldTestMarcher } from "@/field/fieldTestApi";
import { useFieldQualityStore } from "@/field/fieldQuality";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, type FieldView } from "./fieldView";
import type { CurrentFieldQuality } from "./useFieldQuality";

/** What the field test API reads from the new field. */
export type ThreeFieldState = {
    marchers: FieldMarchers;
    /** Each marcher's drill number, by id. */
    labels(): ReadonlyMap<number, string>;
    view(): FieldView;
    /** The element the field draws into, or null before it mounts. */
    element(): HTMLElement | null;
    pageId(): number | null;
    quality(): CurrentFieldQuality;
    contextLost(): boolean;
};

/**
 * The field test API over the new field. Read-only. Selection, handles and
 * gestures come with the editor (#193 onward); until then the field has none.
 */
export function createThreeFieldTestApi(field: ThreeFieldState): FieldTestApi {
    return {
        marchers() {
            const element = field.element();
            if (!element) return [];
            const rect = element.getBoundingClientRect();
            const view = field.view();
            const labels = field.labels();
            const { ids, positions } = field.marchers;
            return ids.map((id, i): FieldTestMarcher => {
                const x = positions[i * 2];
                const y = positions[i * 2 + 1];
                const at = fieldToElement(view, x, y);
                const screen = { x: rect.x + at.x, y: rect.y + at.y };
                return {
                    id,
                    label: labels.get(id) ?? "",
                    x,
                    y,
                    screen,
                    onScreen:
                        screen.x > rect.left &&
                        screen.x < rect.right &&
                        screen.y > rect.top &&
                        screen.y < rect.bottom,
                };
            });
        },
        selection: () => [],
        viewport() {
            const { zoom, panX, panY } = field.view();
            return { zoom, pan: { x: panX, y: panY } };
        },
        handles: () => null,
        activeGesture: () => null,
        pageId: () => field.pageId(),
        quality() {
            const { mode, reason, settings } = field.quality();
            const gl = useFieldQualityStore.getState().gl;
            const element = field.element();
            const width = element?.getBoundingClientRect().width ?? 0;
            return {
                mode,
                reason,
                gl: gl?.kind ?? null,
                renderer: gl?.renderer ?? null,
                pixelRatio:
                    element instanceof HTMLCanvasElement && width > 0
                        ? element.width / width
                        : null,
                labelsHiddenBelow: settings.labelFadeFrom,
                contextLost: field.contextLost(),
            };
        },
    };
}
