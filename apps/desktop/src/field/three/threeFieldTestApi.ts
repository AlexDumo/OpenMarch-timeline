import type {
    FieldTestApi,
    FieldTestGesture,
    FieldTestMarcher,
} from "@/field/fieldTestApi";
import type { FieldMarchers } from "./fieldMarchers";
import { fieldToElement, type FieldView } from "./fieldView";

/** What the field test API reads from the new field. */
export type ThreeFieldState = {
    marchers: FieldMarchers;
    /** Each marcher's drill number, by id. */
    labels(): ReadonlyMap<number, string>;
    view(): FieldView;
    /** The element the field draws into, or null before it mounts. */
    element(): HTMLElement | null;
    pageId(): number | null;
    /** The app's selection, as the editor reads it. */
    selection(): readonly number[];
    activeGesture(): FieldTestGesture | null;
};

/**
 * The field test API over the new field. Read-only. Selection and gestures
 * come from the editor (#193); handles come with #198.
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
        selection: () => [...field.selection()].sort((a, b) => a - b),
        viewport() {
            const { zoom, panX, panY } = field.view();
            return { zoom, pan: { x: panX, y: panY } };
        },
        handles: () => null,
        activeGesture: () => field.activeGesture(),
        pageId: () => field.pageId(),
    };
}
