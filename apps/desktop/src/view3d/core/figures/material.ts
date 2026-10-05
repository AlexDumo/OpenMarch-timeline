/**
 * Instanced GPU skinning for baked figures (`bake.ts`).
 *
 * Each instance carries `figureAnim = (rowA, rowB, blend)`: two rows of the
 * bone table and how far to blend from the first to the second. The vertex
 * shader skins the vertex with each row's four bone influences and mixes the
 * two results; with `blend` 0 or 1 it reads one row only.
 *
 * The patch replaces three.js's `skinning_vertex` chunk, so it works on any
 * built-in material that includes it. `createFigureMaterials` patches a
 * `MeshStandardMaterial` for the color pass and a `MeshDepthMaterial` for
 * shadow maps, which three.js uses through `customDepthMaterial`.
 */
import {
    DataTexture,
    FloatType,
    MeshDepthMaterial,
    MeshStandardMaterial,
    NearestFilter,
    RGBADepthPacking,
    RGBAFormat,
    type Material,
    type WebGLProgramParametersWithUniforms,
} from "three";
import { TEXELS_PER_BONE, type BakedFigure } from "./bake";

/** Name of the per-instance attribute: rowA, rowB, blend. */
export const FIGURE_ANIM_ATTRIBUTE = "figureAnim";

const VERTEX_PARS = /* glsl */ `
uniform highp sampler2D figureBones;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 ${FIGURE_ANIM_ATTRIBUTE};

mat4 figureBone( const in int row, const in float bone ) {
    int x = int( bone ) * ${TEXELS_PER_BONE};
    return mat4(
        texelFetch( figureBones, ivec2( x, row ), 0 ),
        texelFetch( figureBones, ivec2( x + 1, row ), 0 ),
        texelFetch( figureBones, ivec2( x + 2, row ), 0 ),
        texelFetch( figureBones, ivec2( x + 3, row ), 0 )
    );
}

mat4 figureSkin( const in int row ) {
    return skinWeight.x * figureBone( row, skinIndex.x )
        + skinWeight.y * figureBone( row, skinIndex.y )
        + skinWeight.z * figureBone( row, skinIndex.z )
        + skinWeight.w * figureBone( row, skinIndex.w );
}
`;

// A fully blended instance (blend 1, such as a performer mid-move) reads only
// the second row, so only instances easing between the rows read two.
const VERTEX_SKINNING = /* glsl */ `
{
    float figureBlend = ${FIGURE_ANIM_ATTRIBUTE}.z;
    float figureRow = figureBlend >= 1.0 ? ${FIGURE_ANIM_ATTRIBUTE}.y : ${FIGURE_ANIM_ATTRIBUTE}.x;
    mat4 figureMatrix = figureSkin( int( figureRow + 0.5 ) );
    if ( figureBlend > 0.0 && figureBlend < 1.0 ) {
        mat4 figureOther = figureSkin( int( ${FIGURE_ANIM_ATTRIBUTE}.y + 0.5 ) );
        figureMatrix = figureMatrix * ( 1.0 - figureBlend ) + figureOther * figureBlend;
    }
    transformed = ( figureMatrix * vec4( transformed, 1.0 ) ).xyz;
}
`;

/** Wires the bone table into a material's vertex shader. */
export function patchFigureMaterial(
    material: Material,
    bones: DataTexture,
): void {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        shader.uniforms.figureBones = { value: bones };
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
            .replace("#include <skinning_vertex>", VERTEX_SKINNING);
    };
    material.customProgramCacheKey = () => "openmarch-figure";
}

/** The bone table as a texture the shader reads with `texelFetch`. */
export function createBoneTexture(figure: BakedFigure): DataTexture {
    const texture = new DataTexture(
        figure.bones,
        figure.boneCount * TEXELS_PER_BONE,
        figure.rows,
        RGBAFormat,
        FloatType,
    );
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

export interface FigureMaterials {
    bones: DataTexture;
    /** Color pass; per-instance colors tint it. */
    body: MeshStandardMaterial;
    /** Shadow maps; set it as the mesh's `customDepthMaterial`. */
    depth: MeshDepthMaterial;
    dispose: () => void;
}

/** Materials for one baked figure. */
export function createFigureMaterials(figure: BakedFigure): FigureMaterials {
    const bones = createBoneTexture(figure);
    const body = new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0,
        // Faceted look from screen-space derivatives, so the geometry needs no
        // normals and no split corners.
        flatShading: true,
    });
    patchFigureMaterial(body, bones);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    patchFigureMaterial(depth, bones);
    return {
        bones,
        body,
        depth,
        dispose: () => {
            bones.dispose();
            body.dispose();
            depth.dispose();
        },
    };
}
