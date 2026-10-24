import type { XY } from "../types";

/**
 * When the open shape changes without a gesture (a press of − or +, a layout picked, a quarter
 * turn), each marcher's spot slides from where it was shown to where it's going over
 * {@link GLIDE_MS}, instead of jumping (#387: the owner picked center + glide in the lab). Pure:
 * the field mode asks it for positions each frame.
 */
export const GLIDE_MS = 150;

export interface GlideTarget {
    readonly id: number;
    readonly to: XY;
}

interface Glide {
    readonly from: ReadonlyMap<number, XY>;
    readonly to: ReadonlyMap<number, XY>;
    readonly t0: number;
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3);

export class SpotGlide {
    private last: { params: unknown; to: Map<number, XY> } | null = null;
    private glide: Glide | null = null;

    /**
     * The shape as it is at `now`: a change of `params` with no gesture starts a glide, from
     * where each marcher is shown now
     */
    update(
        params: unknown,
        gesture: boolean,
        targets: readonly GlideTarget[],
        now: number,
    ): void {
        const to = new Map(targets.map((t) => [t.id, t.to]));
        const changed = this.last !== null && this.last.params !== params;
        if (gesture) this.glide = null;
        else if (changed)
            this.glide = {
                from: this.positions(now) ?? this.last!.to,
                to,
                t0: now,
            };
        this.last = { params, to };
    }

    /** Whether a glide is still running at `now` */
    active(now: number): boolean {
        return this.glide !== null && now - this.glide.t0 < GLIDE_MS;
    }

    /** Where each marcher is shown at `now`, or null when nothing is gliding */
    positions(now: number): Map<number, XY> | null {
        const g = this.glide;
        if (!g || !this.active(now)) return null;
        const k = ease(Math.max(0, (now - g.t0) / GLIDE_MS));
        const out = new Map<number, XY>();
        for (const [id, to] of g.to) {
            const from = g.from.get(id) ?? to;
            out.set(id, {
                x: from.x + (to.x - from.x) * k,
                y: from.y + (to.y - from.y) * k,
            });
        }
        return out;
    }
}
