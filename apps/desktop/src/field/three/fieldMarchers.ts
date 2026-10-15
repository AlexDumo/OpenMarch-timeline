import { PositionBuffer, type PositionSource } from "@/timeline/positionBuffer";
import {
    applyIsolationPlan,
    type IsolationPlan,
} from "@/timeline/timelineIsolationPlan";
import { positionsAt, timelineMarcherIds } from "@/timeline/timelineStore";
import {
    appearanceIsHidden,
    type AppearanceComponentOptional,
} from "@/entity-components/appearance";
import {
    appearanceChangeBeats,
    appearanceStackAtBeat,
    changeIndexAtBeat,
    type AppearanceStepsByMarcherId,
} from "@/services/appearance/appearanceSteps";

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
 * It also holds each marcher's appearance at the beat drawn: the appearance of
 * the last flag crossed (`appearanceSteps`, as the Fabric field and the video
 * export), so layers restyle and hit testing skips hidden marchers.
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
    /**
     * Each marcher's appearance stack (highest priority first) at the beat
     * drawn, by index in `ids`; null draws the field theme's default.
     */
    stacks: readonly (AppearanceComponentOptional[] | null)[] = [];
    /** 1 for each marcher in `ids` that is hidden: neither drawn nor hit-testable. */
    hidden: Uint8Array = new Uint8Array(0);
    /** Goes up whenever `stacks` or `hidden` changes. */
    appearanceVersion = 0;

    private steps: AppearanceStepsByMarcherId | undefined;
    private changeBeats: number[] = [];
    /** The beat last filled, and what the appearance was sampled for. */
    private beat: number | null = null;
    private styled = { changeIndex: -1, ids: this.ids };

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
        this.beat = beat;
        this.sampleAppearance(false);
        return true;
    }

    /** New appearance steps (or none, until they load): every marcher is restyled. */
    setAppearanceSteps(steps: AppearanceStepsByMarcherId | undefined) {
        this.steps = steps;
        this.changeBeats = steps ? appearanceChangeBeats(steps) : [];
        this.sampleAppearance(true);
    }

    /**
     * Samples the appearances at the beat last filled, unless nobody's can
     * have changed since the last sample (the same marchers, and no
     * appearance change crossed).
     */
    private sampleAppearance(force: boolean) {
        if (this.beat === null) return;
        const changeIndex = changeIndexAtBeat(this.changeBeats, this.beat);
        if (
            !force &&
            this.styled.ids === this.ids &&
            this.styled.changeIndex === changeIndex
        )
            return;
        this.styled = { changeIndex, ids: this.ids };
        const hidden = new Uint8Array(this.ids.length);
        this.stacks = this.ids.map((id, i) => {
            const marcherSteps = this.steps?.get(id);
            const stack = marcherSteps
                ? appearanceStackAtBeat(marcherSteps, this.beat!)
                : null;
            if (stack && appearanceIsHidden(stack)) hidden[i] = 1;
            return stack;
        });
        this.hidden = hidden;
        this.appearanceVersion++;
    }
}
