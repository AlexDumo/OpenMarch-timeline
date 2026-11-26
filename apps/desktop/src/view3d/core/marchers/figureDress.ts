/**
 * How the 2D field's performer figures (fork #1319, ADR 0019) dress every performer: one body
 * and one slate uniform for everyone, so the field needs one picture per thing carried, not one
 * per performer. The figures show shape and size, not the show's colors.
 *
 * Pure: no three.js, React or database.
 */
import type { PerformerBody, UniformLook } from "./looks";

/** What a figure bake dresses everyone in, over each performer's own look. */
export interface FigureBakeLook {
    style: UniformLook["style"];
    colors: UniformLook["colors"];
    /** sRGB: drum shells and plain flag silks. */
    carryColor: number;
}

/** The one body every figure wears. */
export const FIGURE_BODY: PerformerBody = {
    bodyType: "neutral-average",
    skinTone: 0xc68863,
    heightClass: 1,
};

/** The one uniform every figure wears: slate, so instruments and white parts read on any field. */
export const FIGURE_LOOK: FigureBakeLook = {
    style: "classic",
    colors: {
        primary: 0x5f6b7a,
        secondary: 0x4a5463,
        accent: 0xc9ced6,
        trim: 0xc9ced6,
        pants: 0x3f4652,
        shoes: 0x1f2226,
        gloves: 0xeef0f2,
        hat: 0x5f6b7a,
        plume: 0xeef0f2,
        visor: 0x1f2226,
    },
    carryColor: 0x7c8796,
};

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
