/**
 * Record path on the field (prototype): while a take counts in or records, every edit press is the
 * take's. The press can be anywhere; the selected marchers follow the pointer from where they are.
 * Nothing selects, moves or opens a menu. See `recordPathStore.ts`.
 *
 * In Record mode, between takes, the field shows the move's start: a click on a marcher arms it
 * (selects it; Shift adds or takes it away), and a drag moves nobody, since at the start it would
 * change the page before. The armed marchers are ringed red, with their current path to a dashed
 * ring at its end.
 */
import type {
    FieldCursor,
    FieldMode,
    FieldModeDrawing,
    FieldPointer,
} from "@/field/editor/fieldEditor";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { currentShapeField } from "@/shapes/field/shapeField";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import tolgee from "@/global/singletons/Tolgee";
import {
    armedMove,
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
        return isRecordingPath() || armedOnly();
    }

    press(pointer: FieldPointer): void {
        if (armedOnly()) return;
        recordPress(pointer.field);
    }

    move(pointer: FieldPointer): void {
        if (armedOnly()) return;
        recordMove(pointer.field);
    }

    release(
        pointer: FieldPointer,
        click: { double: boolean; ownFirst: boolean } | null,
    ): void {
        if (armedOnly()) {
            if (click) armAt(pointer);
            return;
        }
        recordRelease();
    }

    cancel(): void {
        if (armedOnly()) return;
        recordRelease();
    }

    cursorAt(pointer: FieldPointer): FieldCursor {
        if (!armedOnly()) return "grab";
        return marcherAt(pointer) === null ? "default" : "pointer";
    }

    /** The drawing for the store's frame it was made on: the same object until something moves */
    private last: { frame: number; drawing: FieldModeDrawing | null } | null =
        null;

    drawing(): FieldModeDrawing | null {
        const { frame, phase } = useRecordPathStore.getState();
        if (phase === "armed") {
            const key = armedKey();
            if (this.lastArmed?.key === key) return this.lastArmed.drawing;
            const drawing = armedDrawing();
            this.lastArmed = { key, drawing };
            return drawing;
        }
        const key = phase === "idle" || phase === "saving" ? -1 : frame;
        if (this.last?.frame === key) return this.last.drawing;
        const drawing = this.makeDrawing();
        this.last = { frame: key, drawing };
        return drawing;
    }

    /** Record mode's drawing, for what it was made of (`armedKey`) */
    private lastArmed: {
        key: string;
        drawing: FieldModeDrawing | null;
    } | null = null;

    private makeDrawing(): FieldModeDrawing | null {
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
        const offTake = useRecordPathStore.subscribe(listener);
        // A take saved (or an undo) changes the armed marchers' paths
        const offResolver = useTimelineResolverStore.subscribe(listener);
        return () => {
            offTake();
            offResolver();
        };
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

/** In Record mode between takes (armed, not counting in or recording) */
const armedOnly = (): boolean =>
    useRecordPathStore.getState().phase === "armed" && armedMove() !== null;

/** The marcher whose spot at the armed move's start is under `pointer` (within a step), or null */
function marcherAt(pointer: FieldPointer): number | null {
    const move = armedMove();
    const resolver = useTimelineResolverStore.getState().resolver;
    if (!move || !resolver) return null;
    const reach = currentShapeField()?.fieldProperties.pixelsPerStep ?? 11.25;
    let best: number | null = null;
    let bestDistance = reach;
    for (const id of resolver.marcherIds()) {
        const [x, y] = resolver.positionAt(id, move.start);
        const d = Math.hypot(x - pointer.field.x, y - pointer.field.y);
        if (d <= bestDistance) {
            best = id;
            bestDistance = d;
        }
    }
    return best;
}

/** A click in Record mode: arms the marcher under it (Shift adds it or takes it away) */
function armAt(pointer: FieldPointer): void {
    const editor = activeFieldEditor();
    const id = marcherAt(pointer);
    if (!editor || id === null) return;
    const selected = editor.selected();
    if (!pointer.shift) editor.select([id]);
    else if (selected.includes(id))
        editor.select(selected.filter((other) => other !== id));
    else editor.select([...selected, id]);
}

const armedKey = (): string => {
    const move = armedMove();
    const { version } = useTimelineResolverStore.getState();
    const ids = activeFieldEditor()?.selected() ?? [];
    return `${move?.timelineId}:${move?.start}:${move?.end}:${version}:${ids.join(",")}`;
};

/** Each armed marcher ringed at the start, its path through the move, and a dashed ring at its end */
function armedDrawing(): FieldModeDrawing | null {
    const move = armedMove();
    const resolver = useTimelineResolverStore.getState().resolver;
    const ids = [...(activeFieldEditor()?.selected() ?? [])];
    if (!move || !resolver || ids.length === 0) return null;
    const label = tolgee.t("pathways.record.armedRing");
    const lanes: { x: number; y: number }[][] = [];
    const ends: { x: number; y: number }[] = [];
    const memberRings: NonNullable<FieldModeDrawing["memberRings"]>[number][] =
        [];
    const step = 1 / 8;
    for (const id of ids) {
        const lane: { x: number; y: number }[] = [];
        for (let b = move.start; b < move.end; b += step) {
            const [x, y] = resolver.positionAt(id, b);
            lane.push({ x, y });
        }
        const [ex, ey] = resolver.positionAt(id, move.end);
        lane.push({ x: ex, y: ey });
        lanes.push(lane);
        ends.push({ x: ex, y: ey });
        memberRings.push({
            at: lane[0]!,
            marcherId: id,
            kind: "record",
            label,
        });
    }
    return {
        outline: null,
        spots: [],
        walks: [],
        handles: [],
        lanes,
        laneIds: ids,
        lanesWeight: "quiet",
        emptySpots: ends,
        memberRings,
    };
}
