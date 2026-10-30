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

/** What of the open shape's frame is drawn, which glides with its marchers */
export interface FramePoints {
    readonly outline: readonly XY[] | null;
    readonly handles: readonly XY[];
    readonly knob?: { readonly at: XY; readonly stem: XY };
    readonly centerDot?: XY;
    readonly gaps?: readonly XY[];
    readonly pivotMark?: XY;
    readonly pivotPreview?: XY;
}

/** One frame point's glide id: below every marcher's id, which are positive */
const FRAME_ID = {
    outline: -1,
    handles: -100_000,
    gaps: -200_000,
    knob: -300_000,
    stem: -300_001,
    center: -300_002,
    pivotMark: -300_003,
    pivotPreview: -300_004,
} as const;

const listOf = (frame: FramePoints) => [
    ...(frame.outline ?? []).map((to, k) => ({ id: FRAME_ID.outline - k, to })),
    ...frame.handles.map((to, k) => ({ id: FRAME_ID.handles - k, to })),
    ...(frame.gaps ?? []).map((to, k) => ({ id: FRAME_ID.gaps - k, to })),
    ...(frame.knob
        ? [
              { id: FRAME_ID.knob, to: frame.knob.at },
              { id: FRAME_ID.stem, to: frame.knob.stem },
          ]
        : []),
    ...(frame.centerDot ? [{ id: FRAME_ID.center, to: frame.centerDot }] : []),
    ...(frame.pivotMark
        ? [{ id: FRAME_ID.pivotMark, to: frame.pivotMark }]
        : []),
    ...(frame.pivotPreview
        ? [{ id: FRAME_ID.pivotPreview, to: frame.pivotPreview }]
        : []),
];

/** Which frame points there are, so a glide only pairs a point with the same one before */
const shapeOf = (frame: FramePoints) =>
    [
        frame.outline?.length ?? -1,
        frame.handles.length,
        frame.gaps?.length ?? 0,
        frame.knob ? 1 : 0,
        frame.centerDot ? 1 : 0,
        frame.pivotMark ? 1 : 0,
        frame.pivotPreview ? 1 : 0,
    ].join(",");

/**
 * The open shape's glide: its marchers' spots ({@link SpotGlide}) and its frame with them, so a
 * change of size (Even out, owner on #459) slides too. A new shape (another `session`: opened,
 * reopened, brought back) starts afresh, gliding nothing from the last one. The frame glides only
 * when the kind, the turn and which points it draws are as before: a turn's corners would cut
 * across, another kind's outline doesn't pair up point for point.
 */
export class ShapeGlide {
    private spots = new SpotGlide();
    private last: {
        session: unknown;
        kind: unknown;
        rotation: number;
        shape: string;
    } | null = null;

    /** Nothing open: the next shape starts afresh */
    reset(): void {
        this.spots = new SpotGlide();
        this.last = null;
    }

    update(
        shape: {
            readonly session: unknown;
            readonly kind: unknown;
            readonly params: unknown;
            readonly rotation: number;
            readonly gesture: boolean;
        },
        targets: readonly GlideTarget[],
        frame: FramePoints,
        now: number,
    ): void {
        if (this.last && this.last.session !== shape.session) this.reset();
        const was = this.last;
        const fits =
            was !== null &&
            was.kind === shape.kind &&
            was.rotation === shape.rotation &&
            was.shape === shapeOf(frame);
        this.spots.update(
            shape.params,
            shape.gesture,
            fits || was === null ? [...targets, ...listOf(frame)] : targets,
            now,
        );
        this.last = {
            session: shape.session,
            kind: shape.kind,
            rotation: shape.rotation,
            shape: shapeOf(frame),
        };
    }

    active(now: number): boolean {
        return this.spots.active(now);
    }

    /** Where each marcher is shown at `now`, or null when nothing is gliding */
    positions(now: number): Map<number, XY> | null {
        return this.spots.positions(now);
    }

    /** `frame` as shown at `now`: each point part way from where it was, while a glide runs */
    frame(now: number, frame: FramePoints): FramePoints {
        const at = this.spots.positions(now);
        if (!at) return frame;
        const shown = (id: number, to: XY) => at.get(id) ?? to;
        return {
            outline:
                frame.outline?.map((p, k) => shown(FRAME_ID.outline - k, p)) ??
                null,
            handles: frame.handles.map((p, k) =>
                shown(FRAME_ID.handles - k, p),
            ),
            ...(frame.gaps
                ? {
                      gaps: frame.gaps.map((p, k) =>
                          shown(FRAME_ID.gaps - k, p),
                      ),
                  }
                : {}),
            ...(frame.knob
                ? {
                      knob: {
                          at: shown(FRAME_ID.knob, frame.knob.at),
                          stem: shown(FRAME_ID.stem, frame.knob.stem),
                      },
                  }
                : {}),
            ...(frame.centerDot
                ? { centerDot: shown(FRAME_ID.center, frame.centerDot) }
                : {}),
            ...(frame.pivotMark
                ? { pivotMark: shown(FRAME_ID.pivotMark, frame.pivotMark) }
                : {}),
            ...(frame.pivotPreview
                ? {
                      pivotPreview: shown(
                          FRAME_ID.pivotPreview,
                          frame.pivotPreview,
                      ),
                  }
                : {}),
        };
    }
}
