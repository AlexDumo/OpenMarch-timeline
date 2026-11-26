/**
 * What the figure bake (fork #1319) dresses every performer in while it
 * runs: one body and one uniform for everyone, so the 2D field needs one
 * picture per instrument and state, not one per performer. Null fields leave
 * the show's own looks alone; outside a bake both are null.
 */
import { create } from "zustand";
import type { PerformerBody } from "@/view3d/core/marchers/looks";
import type { FigureBakeLook } from "@/view3d/core/marchers/figureDress";

export {
    bakeDressed,
    type FigureBakeLook,
} from "@/view3d/core/marchers/figureDress";

interface FigureBakeState {
    body: PerformerBody | null;
    look: FigureBakeLook | null;
    set(body: PerformerBody | null, look: FigureBakeLook | null): void;
}

export const useFigureBakeStore = create<FigureBakeState>((set) => ({
    body: null,
    look: null,
    set: (body, look) => set({ body, look }),
}));
