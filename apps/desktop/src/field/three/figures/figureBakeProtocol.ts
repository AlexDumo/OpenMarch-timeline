/** Messages between the editor and the figure bake worker (`figureBake.worker.ts`). */
import type { UniformLook } from "@/view3d/core/marchers/looks";
import type { BakedFigure } from "./bakeFigures";

export interface FigureBakeRequest {
    looks: readonly UniformLook[];
}

export type FigureBakeReply =
    /** Each look's figure, in order: null for a look that drew nothing */
    | { type: "baked"; figures: (BakedFigure | null)[]; reports: string[] }
    /** This worker can't draw (no `OffscreenCanvas` or no WebGL 2 in workers) */
    | { type: "unsupported" }
    | { type: "error"; message: string; reports: string[] };
