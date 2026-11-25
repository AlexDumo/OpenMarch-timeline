/**
 * What the figure bake (fork #1319) dresses every performer in while it
 * runs: one body and one uniform for everyone, so the 2D field needs one
 * picture per instrument and state, not one per performer. Null fields leave
 * the show's own looks alone; outside a bake both are null.
 */
import { create } from "zustand";
import type { PerformerBody, UniformLook } from "@/view3d/core/marchers/looks";

export interface FigureBakeLook {
    style: UniformLook["style"];
    colors: UniformLook["colors"];
    /** sRGB: drum shells and plain flag silks. */
    carryColor: number;
}

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

/** `look` dressed as the bake says, or `look` itself outside a bake. */
export function bakeDressed(
    look: UniformLook,
    bake: FigureBakeLook | null,
): UniformLook {
    if (!bake) return look;
    return {
        style: bake.style,
        colors: { ...bake.colors },
        options: {
            ...look.options,
            carryColor: look.options.carry ? bake.carryColor : null,
            silk: null,
            silkArtwork: false,
        },
    };
}
