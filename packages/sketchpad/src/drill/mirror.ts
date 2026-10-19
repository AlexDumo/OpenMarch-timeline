import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { randomId, randomInteger } from "../ids";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type AnyElement = Mutable<ExcalidrawElement> & Record<string, unknown>;

/**
 * Copies of `elements` with new ids, each moved by `place`. Bound text and grouped elements keep
 * their links to each other; arrow bindings to elements outside the copy are dropped.
 */
export function copyElements(
    elements: readonly ExcalidrawElement[],
    place: (source: ExcalidrawElement, copy: AnyElement) => void,
): ExcalidrawElement[] {
    const ids = new Map<string, string>();
    const groups = new Map<string, string>();
    for (const el of elements) ids.set(el.id, randomId());
    const newGroup = (g: string) => {
        if (!groups.has(g)) groups.set(g, randomId());
        return groups.get(g)!;
    };
    return elements.map((source) => {
        const el = { ...source } as AnyElement;
        el.id = ids.get(source.id)!;
        el.seed = randomInteger();
        el.version = 1;
        el.versionNonce = randomInteger();
        el.updated = Date.now();
        el.index = null;
        el.isDeleted = false;
        el.frameId = null;
        el.groupIds = source.groupIds.map(newGroup);
        el.boundElements =
            source.boundElements
                ?.filter((b) => ids.has(b.id))
                .map((b) => ({ ...b, id: ids.get(b.id)! })) ?? null;
        if ("containerId" in source && source.containerId)
            el.containerId = ids.get(source.containerId) ?? null;
        if (source.type === "arrow") {
            const arrow = source as unknown as {
                startBinding: { elementId: string } | null;
                endBinding: { elementId: string } | null;
            };
            const keep = (bind: { elementId: string } | null) =>
                bind && ids.has(bind.elementId)
                    ? { ...bind, elementId: ids.get(bind.elementId)! }
                    : null;
            el.startBinding = keep(arrow.startBinding);
            el.endBinding = keep(arrow.endBinding);
        }
        place(source, el);
        return el as ExcalidrawElement;
    });
}

/**
 * Copies of `elements` flipped across the 50 (scene x = 0, ADR 0006 D-3). Text stays readable:
 * only its position flips.
 */
export function mirrorAcross50(
    elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
    return copyElements(elements, (source, el) => {
        el.angle = (
            source.angle === 0 ? 0 : -source.angle
        ) as AnyElement["angle"];
        const points = (
            source as { points?: readonly (readonly [number, number])[] }
        ).points;
        if (
            points &&
            (source.type === "line" ||
                source.type === "arrow" ||
                source.type === "freedraw")
        ) {
            // Points are relative to x; flip them and the origin
            el.x = -source.x;
            el.points = points.map(([px, py]) => [px === 0 ? 0 : -px, py]);
        } else {
            el.x = -(source.x + source.width);
        }
        if (source.type === "image") {
            const scale = (source as unknown as { scale: [number, number] })
                .scale ?? [1, 1];
            el.scale = [-scale[0], scale[1]];
        }
    });
}

/** Copies of `elements` moved by (dx, dy), as Duplicate makes */
export function offsetCopy(
    elements: readonly ExcalidrawElement[],
    dx: number,
    dy: number,
): ExcalidrawElement[] {
    return copyElements(elements, (source, el) => {
        el.x = source.x + dx;
        el.y = source.y + dy;
    });
}
