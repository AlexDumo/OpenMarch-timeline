/**
 * Record path on the field (prototype): while a take counts in or records, every edit press is the
 * take's. The press can be anywhere; the selected marchers follow the pointer from where they are.
 * Nothing selects, moves or opens a menu. See `recordPathStore.ts`.
 */
import type {
    FieldCursor,
    FieldMode,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import {
    isRecordingPath,
    recordDrawing,
    recordMove,
    recordPress,
    recordRelease,
    useRecordPathStore,
} from "./recordPathStore";

class RecordPathMode implements FieldMode {
    readonly ownsSelectionBox = true;
    readonly locksSelection = true;
    readonly blocksFieldMenu = true;
    readonly gesture = { kind: "path" as const, always: false };

    claims(): boolean {
        return isRecordingPath();
    }

    press(pointer: FieldPointer): void {
        recordPress(pointer.field);
    }

    move(pointer: FieldPointer): void {
        recordMove(pointer.field);
    }

    release(): void {
        recordRelease();
    }

    cancel(): void {
        recordRelease();
    }

    cursorAt(): FieldCursor {
        return "grab";
    }

    drawing(): FieldModeDrawing | null {
        const drawn = recordDrawing();
        if (!drawn || drawn.ids.length === 0) return null;
        return {
            outline: null,
            spots: [],
            walks: [],
            handles: [],
            marchersAt: { ids: drawn.ids, spots: drawn.spots },
            lanes: drawn.trails,
            laneIds: drawn.ids,
            lanesWeight: "quiet",
        };
    }

    subscribe(listener: () => void): () => void {
        return useRecordPathStore.subscribe(listener);
    }

    /** A click changes nothing while recording */
    takeClick(): boolean {
        return true;
    }

    /** A long press stays the take's drag */
    longPress(): boolean {
        return false;
    }
}

export const recordPathMode = new RecordPathMode();
