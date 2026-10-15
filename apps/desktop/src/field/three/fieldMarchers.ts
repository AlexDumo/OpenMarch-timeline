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
        }
        this.positions = this.sampled.buffer;
        this.version++;
        return true;
    }
}
