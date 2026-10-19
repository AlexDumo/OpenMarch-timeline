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

/**
 * The show's items (props and equipment, C2.1) among the marchers: which ids
 * they are, and whether one is drawn at a beat (it is Off field before the
 * count it was made on, and the user may hide it).
 */
export interface FieldItemSource {
    readonly ids: ReadonlySet<number>;
    drawnAt(id: number, beat: number): boolean;
}

/** The open file's resolver store. */
const resolverStore: PositionSource = {
    marcherIds: timelineMarcherIds,
    positionsAt,
};

/**
 * Where the field draws each marcher, outside React (ADR 0005 D-2.3).
 *
 * The playhead driver fills it from the timeline resolver through the shared
 * {@link PositionBuffer}, as the 3D View samples it. The marcher and label
 * layers copy it into their GPU buffers when its `version` changes, in a
 * frame hook. The field test API reads it too.
 *
 * It also holds each marcher's appearance at the beat drawn: the appearance of
 * the last flag crossed (`appearanceSteps`, as the video export), so layers
 * restyle and hit testing skips hidden marchers.
 *
 * It also marks which of them are selected (`selected`, `selectionVersion`),
 * from the app's selection, for the marchers layer's selection rings.
 *
 * Items (`setItems`) are marchers rows too, so the timeline moves them and
 * the editor selects and drags them like any marcher; `isItem` marks them for
 * the dot and label layers, which leave them to the items layer. One that
 * isn't drawn at the beat is `hidden`.
 *
 * The editor can draw some marchers somewhere else (`setOverrides`): where
 * they're dragged, then where they were dropped until the drop is saved
 * (#196). Every fill keeps them there.
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
    /**
     * Each marcher's appearance stack (highest priority first) at the beat
     * drawn, by index in `ids`; null draws the field theme's default.
     */
    stacks: readonly (AppearanceComponentOptional[] | null)[] = [];
    /** 1 for each marcher in `ids` that is hidden: neither drawn nor hit-testable. */
    hidden: Uint8Array = new Uint8Array(0);
    /** Goes up whenever `stacks`, `hidden` or `isItem` changes. */
    appearanceVersion = 0;
    /** 1 for each marcher in `ids` that is an item: the items layer draws its Outline. */
    isItem: Uint8Array = new Uint8Array(0);

    private items: FieldItemSource | null = null;
    /** `hidden` from the appearances alone, before items not drawn at the beat are added. */
    private appearanceHidden: Uint8Array = new Uint8Array(0);

    private steps: AppearanceStepsByMarcherId | undefined;
    private changeBeats: number[] = [];
    /** The beat last filled, and the isolation plan it was filled with. */
    private beat: number | null = null;
    private isolationPlan: IsolationPlan | null | undefined;
    /** Positions drawn instead of the sampled ones, by marcher id. */
    private overrides: ReadonlyMap<number, { x: number; y: number }> | null =
        null;
    /** The appearance change index and ids the stacks were last sampled for. */
    private sampledFor = { changeIndex: -1, ids: this.ids };

    constructor(source: PositionSource = resolverStore) {
        this.sampled = new PositionBuffer(source);
    }

    /**
     * Samples every marcher at `beat`; with an isolation plan, its members sit
     * where the plan puts them. Returns false, keeping what's drawn, when the
     * resolver isn't ready.
     */
    fill(beat: number, isolationPlan?: IsolationPlan | null): boolean {
        if (!this.sampled.fill(beat)) return false;
        const ids = this.sampled.marcherIds;
        if (isolationPlan)
            applyIsolationPlan(this.sampled.buffer, ids, beat, isolationPlan);
        this.applyOverrides(this.sampled.buffer, ids);
        if (ids !== this.ids) {
            this.ids = ids;
            this.idsVersion++;
            this.markSelected();
        }
        this.positions = this.sampled.buffer;
        this.version++;
        this.beat = beat;
        this.isolationPlan = isolationPlan;
        this.sampleAppearance(false);
        this.markItems(false);
        this.emit();
        return true;
    }

    /** The beat last filled, or null before the first fill. */
    get drawnBeat(): number | null {
        return this.beat;
    }

    /**
     * Which marchers are items, and when each is drawn. Call again when either
     * changes: the marks are made again at the beat last filled.
     */
    setItems(items: FieldItemSource | null) {
        this.items = items;
        this.markItems(true);
        this.emit();
    }

    /**
     * Draws the marchers in `overrides` at those positions, whatever the
     * show says, until it's called again. Marchers left out (all of them, for
     * null) are drawn where the show has them, sampled again at the beat last
     * filled.
     */
    setOverrides(
        overrides: ReadonlyMap<number, { x: number; y: number }> | null,
    ) {
        // A marcher no longer overridden goes back to where the show has it
        const released =
            this.overrides !== null &&
            [...this.overrides.keys()].some((id) => !overrides?.has(id));
        this.overrides = overrides;
        if (released && this.beat !== null) {
            if (this.fill(this.beat, this.isolationPlan)) return;
        }
        this.applyOverrides(this.positions, this.ids);
        this.version++;
        this.emit();
    }

    private applyOverrides(positions: Float64Array, ids: readonly number[]) {
        if (!this.overrides) return;
        for (let i = 0; i < ids.length; i++) {
            const at = this.overrides.get(ids[i]);
            if (!at) continue;
            positions[i * 2] = at.x;
            positions[i * 2 + 1] = at.y;
        }
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
            this.sampledFor.ids === this.ids &&
            this.sampledFor.changeIndex === changeIndex
        )
            return;
        this.sampledFor = { changeIndex, ids: this.ids };
        const hidden = new Uint8Array(this.ids.length);
        this.stacks = this.ids.map((id, i) => {
            const marcherSteps = this.steps?.get(id);
            const stack = marcherSteps
                ? appearanceStackAtBeat(marcherSteps, this.beat!)
                : null;
            if (stack && appearanceIsHidden(stack)) hidden[i] = 1;
            return stack;
        });
        this.appearanceHidden = hidden;
        // Bumps the appearance version
        this.markItems(true);
    }

    /**
     * Marks the items, and hides those not drawn at the beat last filled. A
     * new `hidden` and a new appearance version only when a mark changed,
     * unless `force` (new items or new appearances).
     */
    private markItems(force: boolean) {
        const items = this.items;
        const n = this.ids.length;
        // A show with no items, marked so already: nothing to do on each frame
        if (
            !force &&
            (!items || items.ids.size === 0) &&
            this.isItem.length === n &&
            this.hidden === this.appearanceHidden
        )
            return;
        const isItem = new Uint8Array(n);
        const hidden = Uint8Array.from(
            this.appearanceHidden.length === n
                ? this.appearanceHidden
                : new Uint8Array(n),
        );
        if (items) {
            for (let i = 0; i < n; i++) {
                const id = this.ids[i];
                if (!items.ids.has(id)) continue;
                isItem[i] = 1;
                if (this.beat !== null && !items.drawnAt(id, this.beat))
                    hidden[i] = 1;
            }
        }
        if (
            !force &&
            sameBytes(isItem, this.isItem) &&
            sameBytes(hidden, this.hidden)
        )
            return;
        this.isItem = isItem;
        // With no item hidden, `hidden` is the appearances' own
        this.hidden = sameBytes(hidden, this.appearanceHidden)
            ? this.appearanceHidden
            : hidden;
        this.appearanceVersion++;
    }

    /** Marks the marchers in `ids` as selected, and every other one as not. */
    setSelection(ids: Iterable<number>) {
        this.selectedIds = new Set(ids);
        this.markSelected();
        this.emit();
    }

    /** Where the marchers in `ids` are drawn, skipping any not drawn or hidden. */
    drawn(ids: readonly number[]): Map<number, { x: number; y: number }> {
        const wanted = new Set(ids);
        const out = new Map<number, { x: number; y: number }>();
        for (let i = 0; i < this.ids.length; i++) {
            const id = this.ids[i];
            if (!wanted.has(id) || this.hidden[i]) continue;
            out.set(id, {
                x: this.positions[i * 2],
                y: this.positions[i * 2 + 1],
            });
        }
        return out;
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

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((value, i) => value === b[i]);
