import { useSyncExternalStore } from "react";
import type { FieldPoint } from "./editor/fieldEditor";

/**
 * Asking for a point on the field (performer-behavior.md section 7.2, a
 * Facing cue toward a point): the next edit press on the field goes to the
 * asker as field coordinates, the dots' space, and does nothing else
 * (`takeFieldPress`). One request at a time; a new one replaces the old.
 */
type PointListener = (point: FieldPoint) => void;

let pending: PointListener | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function requestFieldPoint(onPoint: PointListener): void {
    pending = onPoint;
    emit();
}

export function cancelFieldPoint(): void {
    if (!pending) return;
    pending = null;
    emit();
}

/** Hands `point` to the asker, if any; true when it was taken. */
export function takeFieldPoint(point: FieldPoint): boolean {
    const onPoint = pending;
    if (!onPoint) return false;
    pending = null;
    emit();
    onPoint(point);
    return true;
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** Whether something is waiting for a point on the field. */
export function useIsPickingFieldPoint(): boolean {
    return useSyncExternalStore(subscribe, () => pending !== null);
}
