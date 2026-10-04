import { fabric } from "fabric";
import TimelinePathway from "./TimelinePathway";

/** Screen pixels, divided by the zoom when drawn (as the focus layer's dots are) */
const GHOST_HANDLE_RADIUS = 5;

/** What a ghost end dot edits: one marcher's planned destination in the isolated timeline. */
export interface GhostEndTarget {
    readonly timelineId: number;
    readonly marcherId: number;
}

export type GhostHandleObject = fabric.Circle & { ghostEnd: GhostEndTarget };

/** Whether a canvas object is a ghost end handle (so selection sync leaves marchers alone). */
export function isGhostHandle(object: unknown): object is GhostHandleObject {
    return (
        typeof object === "object" && object !== null && "ghostEnd" in object
    );
}

/** A ghost end handle's position in field units (without the grid offset the dots are drawn at). */
export function ghostHandlePoint(object: fabric.Object): {
    x: number;
    y: number;
} {
    const m = object.calcTransformMatrix();
    return {
        x: m[4]! - TimelinePathway.gridOffset,
        y: m[5]! - TimelinePathway.gridOffset,
    };
}

/**
 * A draggable gray dot where an isolated timeline's plan ends a marcher that another move has
 * at the timeline's end (docs/timeline/research/ownership/09-isolation.md). Dragging it moves
 * that planned destination; `onCommit` gets the field point on release, unless the press was a
 * click. Like the timeline shape handles, it is transparent to the marcher selection.
 */
export function makeGhostHandle({
    target,
    at,
    color,
    zoom,
    onCommit,
}: {
    target: GhostEndTarget;
    at: { x: number; y: number };
    color: string;
    zoom: number;
    /** Resolves false when the edit was refused: the handle goes back */
    onCommit: (
        target: GhostEndTarget,
        point: { x: number; y: number },
    ) => Promise<boolean>;
}): GhostHandleObject {
    const offset = TimelinePathway.gridOffset;
    const handle = new fabric.Circle({
        left: at.x + offset,
        top: at.y + offset,
        originX: "center",
        originY: "center",
        radius: GHOST_HANDLE_RADIUS / zoom,
        fill: "rgba(0,0,0,0)",
        stroke: color,
        strokeWidth: 1.5 / zoom,
        strokeDashArray: [2 / zoom, 2 / zoom],
        hasControls: false,
        hasBorders: false,
        hoverCursor: "move",
        objectCaching: false,
    }) as GhostHandleObject;
    handle.ghostEnd = target;
    let pressedAt: { x: number; y: number } | null = null;
    handle.on("mousedown", () => {
        pressedAt = { x: handle.left ?? 0, y: handle.top ?? 0 };
    });
    handle.on("modified", () => {
        const start = pressedAt;
        pressedAt = null;
        if (
            start &&
            Math.hypot(
                (handle.left ?? 0) - start.x,
                (handle.top ?? 0) - start.y,
            ) < 0.5
        )
            return;
        const home = { left: at.x + offset, top: at.y + offset };
        void onCommit(target, ghostHandlePoint(handle)).then((ok) => {
            if (ok) return;
            handle.set(home);
            handle.setCoords();
            handle.canvas?.requestRenderAll();
        });
    });
    return handle;
}
