import { PositionBuffer, type PositionSource } from "@/timeline/positionBuffer";
import {
    applyIsolationPlan,
    type IsolationPlan,
} from "@/timeline/timelineIsolationPlan";
import { positionsAt, timelineMarcherIds } from "@/timeline/timelineStore";

/** The open file's resolver store. */
const resolverStore: PositionSource = {
    marcherIds: timelineMarcherIds,
    positionsAt,
};

/**
 * Where the new field draws each marcher, outside React (ADR 0005 D-2.3).
 *
 * The playhead driver fills it from the timeline resolver through the shared
 * {@link PositionBuffer}, as the Fabric field and the 3D View sample
 * it. The marcher and label layers copy it into their GPU buffers when its
 * `version` changes, in a frame hook. The field test API reads it too.
 *
 * It also marks which of them are selected (`selected`, `selectionVersion`),
 * from the app's selection, for the marchers layer's selection rings.
 */
export class FieldMarchers {
    private readonly sampled: PositionBuffer;
    /** The ids drawn, ascending: the resolver's ids at the last successful fill. */
    ids: readonly number[] = [];
    /** x, y per marcher in `ids`, in field units. */
    positions: Float64Array = new Float64Array(0);
    /** Goes up on every fill that changed what's drawn. */
    version = 0;
    /** Goes up whenever `ids` changes: layers then resize their buffers. */
    idsVersion = 0;
    /** 1 for each marcher in `ids` that's selected, else 0. */
    selected: Uint8Array = new Uint8Array(0);
    /** Goes up whenever `selected` changes. */
    selectionVersion = 0;
    private selectedIds: ReadonlySet<number> = new Set();
    private readonly listeners = new Set<() => void>();

    constructor(source: PositionSource = resolverStore) {
        this.sampled = new PositionBuffer(source);
    }

    /**
     * Samples every marcher at `beat`; with an isolation plan, its members sit
     * where the plan puts them (as the Fabric field's static render). Returns
     * false, keeping what's drawn, when the resolver isn't ready.
     */
    fill(beat: number, isolationPlan?: IsolationPlan | null): boolean {
        if (!this.sampled.fill(beat)) return false;
        const ids = this.sampled.marcherIds;
        if (isolationPlan)
            applyIsolationPlan(this.sampled.buffer, ids, beat, isolationPlan);
        if (ids !== this.ids) {
            this.ids = ids;
            this.idsVersion++;
            this.markSelected();
        }
        this.positions = this.sampled.buffer;
        this.version++;
        this.emit();
        return true;
    }

    /** Marks the marchers in `ids` as selected, and every other one as not. */
    setSelection(ids: Iterable<number>) {
        this.selectedIds = new Set(ids);
        this.markSelected();
        this.emit();
    }

    /**
     * Calls `listener` after every fill and selection change, for what draws
     * outside the WebGL frame (the SVG overlay). Returns the unsubscribe.
     */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private markSelected() {
        this.selected = Uint8Array.from(this.ids, (id) =>
            this.selectedIds.has(id) ? 1 : 0,
        );
        this.selectionVersion++;
    }

    private emit() {
        for (const listener of this.listeners) listener();
    }
}
