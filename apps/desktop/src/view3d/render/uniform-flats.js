// cspell:ignore glsl nvec
// Uniform artwork drawn as front/back FLATS, on top of the uniform shader (uniform-shader.js), by the hybrid
// wrap (docs/3d/uniform-artwork.md, "Rendering: the hybrid wrap"). Plain JS like the shader it patches, so the
// design study's harness can load it unchanged.
//
// Every jacket and pants fragment belongs to a segment: the torso and the hips around the spine, each upper
// arm, forearm, thigh and shin around its bone (elbow and knee split by the plane bisecting the joint). With psi
// the angle round that axis from the segment's front, the front half samples the front flat and the back half
// the back flat; across a half the flat's x comes from the body's lookup table (U, already graded to the median
// outlines), down the segment its y is inches along the axis. The cape samples the cape panel by back
// projection. Art goes over the palette color by its alpha, so transparent art shows the palette.
//
//   const mat = withFlats(THREE, createUniformMaterial(THREE, look), {
//       layout,          // assets/uniform-flats/layout.json
//       body,            // the body type the table is for (its neck radius)
//       lut,             // the body's table: a 128 x rows RGBA half-float DataTexture (flatsLutTexture)
//       atlas,           // the composed art, premultiplied alpha
//       atlasRect,       // { w, h, front: [x, y], back: [x, y], cape: [x, y] | null } in inches (flatsAtlasLayout),
//                        // and its dpi (pixels per inch)
//       cape,            // optional { k, midZ }: the cape's grade and mid-plane z (m)
//   });
//
// Looks without flats never call this, so their program and pixels are unchanged.

const FLATS_GLSL = /* glsl */ `
uniform sampler2D uFlatArt;
uniform vec2 uFlatAtlas;          // atlas size, inches
uniform sampler2D uFlatLut;       // R U front, G U back (in, from the centre line, +X); B row centre z or axis shift (m); A extra y (in)
uniform float uFlatLutRows;
uniform vec4 uFlatSeg[10];        // rowStart, rows, tStart, tEnd (m)
uniform float uFlatY0[10];        // flat y (in) of the segment's t = 0
uniform vec3 uFlatHead[8], uFlatDir[8], uFlatFwd[8], uFlatSide[8];
uniform vec3 uFlatPlaneAt[4], uFlatPlaneN[4];
uniform vec4 uFlatTops;           // torso top, hips top, crotch (m), how far below the crotch the thigh blends from the hips (m)
uniform vec2 uFlatPanF, uFlatPanB, uFlatPanC; // where each panel's origin sits in the atlas (in)
uniform float uFlatCx;            // the panels' centre line (in)
uniform vec4 uFlatCape;           // cape grade, cape mid-plane z, cape top (m), 1 when the atlas has a cape
uniform vec2 uFlatWrist;          // t along the left and right forearm (m) below which the glove is sleeve
uniform float uFlatNeckR;         // the jacket closer than this (m) to the neck's axis is the neck
uniform float uFlatPx;            // one atlas pixel (in): 1 / the atlas's pixels per inch
const float OM_FLAT_IN = 0.0254;
const float OM_FLAT_PI = 3.14159265;
// The torso's rows end on the jacket hem, where the hips' rows start on the flats (the hips' y0 is the
// template's hem line). The jacket's lowest few mm hang below it and clamp to its last row, and the pants' top
// edge clamps to the hips' first: each is kept at least this far (in) from the hem, and at least one atlas pixel
// (uFlatPx), so the jacket takes only the jacket's art and the pants only the pants', never a filtered blend of
// both along the boundary.
const float OM_FLAT_HEM_INSET = 0.05;
// The most (in) a sample's filter footprint keeps the torso and the hips off the hem (omFlatArt).
const float OM_FLAT_HEM_FOOTPRINT_MAX = 0.5;
// How far (in) along the flat's y a sample with gradients gx, gy (in per pixel) reads: the texel size at the
// coarser of the two mip levels a trilinear, 4x anisotropic lookup blends (the level as the GPU picks it, from
// the footprint's longer axis over its anisotropy), 1.5 texels so a texel straddling the hem stays clear
// wherever the hem falls in it, plus half the footprint's vertical extent, along which the anisotropic
// probes spread. Sideways extent doesn't count: the hem runs across the flats.
float omFlatHemReach(vec2 gx, vec2 gy) {
  float rx = length(gx) / uFlatPx, ry = length(gy) / uFlatPx;
  float rLong = max(rx, ry), rShort = max(min(rx, ry), 1e-6);
  float lod = max(0.0, ceil(log2(max(rLong / min(4.0, rLong / rShort), 1.0))));
  return 1.5 * exp2(lod) * uFlatPx + 0.5 * max(abs(gx.y), abs(gy.y));
}
// The hem inset (in) at this atlas's resolution.
float omFlatHemInset() {
  return max(OM_FLAT_HEM_INSET, uFlatPx);
}
float omFlatRow(int s, float t) {
  vec4 g = uFlatSeg[s];
  float f = clamp((t - g.z) / (g.w - g.z), 0.0, 1.0);
  return (g.x + 0.5 + f * (g.y - 1.0)) / uFlatLutRows;
}
// The table at angle psi (S repeats round the body) and row.
vec4 omFlatLut(float psi, float row) {
  return textureLod(uFlatLut, vec2((psi + OM_FLAT_PI) / (2.0 * OM_FLAT_PI), row), 0.0);
}
// Whether jacket point p lies on upper arm i: past the shoulder joint, close to the bone and not on its
// inner side. The bodies' jacket reaches over the top of each arm in a wedge, which the sleeve's art covers.
bool omFlatOnArm(vec3 p, int i) {
  vec3 d = p - uFlatHead[i];
  float t = dot(d, uFlatDir[i]);
  vec3 r = d - uFlatDir[i] * t;
  float outward = dot(r, uFlatSide[i]) * (i == 0 ? 1.0 : -1.0);
  return t > 0.01 && outward > -0.012 && length(r) < 0.1;
}
// The part a fragment is drawn as. The bodies' jacket reaches over the top of each arm and their gloves
// reach halfway up each forearm in thin slivers: both are sleeve, for the art and the palette.
int omFlatPart() {
  int part = int(vPart + 0.5);
  vec3 p = vRest;
  if (part == 1 && omFlatOnArm(p, p.x >= 0.0 ? 0 : 2)) return 2;
  if (part == 5) {
    int i = p.x >= 0.0 ? 1 : 3;
    if (dot(p - uFlatHead[i], uFlatDir[i]) < (i == 1 ? uFlatWrist.x : uFlatWrist.y)) return 2;
  }
  return part;
}
// How far jacket point p is from the neck's axis at its height (m).
float omFlatNeckDist(vec3 p) {
  float zc = omFlatLut(0.0, omFlatRow(0, uFlatTops.x - p.y)).b;
  return length(vec2(p.x, p.z - zc));
}
// 1 on the neck (the jacket's standing collar), antialiased: it takes the palette collar and no art. Worked
// out in uniform control flow before uniformColor() runs (fwidth needs every pixel of the quad), which reads
// it from omFlatNeckW inside its part branches.
float omFlatNeckW = 0.0;
float omFlatNeckWeight() {
  float d = uFlatNeckR - omFlatNeckDist(vRest);
  float fw = fwidth(d) + 1e-5;
  float w = smoothstep(-fw, fw, d);
  return omFlatPart() == 1 ? w : 0.0;
}
float omFlatNeck() {
  return omFlatNeckW;
}
// A spine segment (0 torso, 1 hips) at t (m down from its top): its point on the flats.
vec2 omFlatSpine(int s, vec3 p, float t, out bool front) {
  vec4 g = uFlatSeg[s];
  float row = omFlatRow(s, t);
  float zc = omFlatLut(0.0, row).b;
  float psi = atan(p.x, p.z - zc);
  vec4 lut = omFlatLut(psi, row);
  front = abs(psi) <= 0.5 * OM_FLAT_PI;
  // down the segment: inches, kept to its rows so its ends never reach past the region, and off the hem
  // between the torso and the hips
  float y = uFlatY0[s] + clamp(t, g.z, g.w) / OM_FLAT_IN + lut.a;
  float hem = uFlatY0[1];
  y = s == 0 ? min(y, hem - omFlatHemInset()) : max(y, hem + omFlatHemInset());
  return vec2(uFlatCx + (front ? lut.r : -lut.g), y);
}
// Limb segment i (0..7, as uFlatHead): its point on the flats, and t along its bone (m).
vec2 omFlatLimb(int i, vec3 p, out float t, out float psi, out bool front) {
  int s = 2 + i;
  vec4 g = uFlatSeg[s];
  vec3 d = p - uFlatHead[i];
  t = dot(d, uFlatDir[i]);
  float row = omFlatRow(s, t);
  // the ring's centre moves forward at the top of each thigh, onto the hips' (table B)
  vec3 r = d - uFlatDir[i] * t - uFlatFwd[i] * omFlatLut(0.0, row).b;
  psi = atan(dot(r, uFlatSide[i]), dot(r, uFlatFwd[i]));
  vec4 lut = omFlatLut(psi, row);
  front = abs(psi) <= 0.5 * OM_FLAT_PI;
  return vec2(uFlatCx + (front ? lut.r : -lut.g), uFlatY0[s] + clamp(t, g.z, g.w) / OM_FLAT_IN + lut.a);
}
// The art over the palette (premultiplied), or transparent where the part takes palette colors only.
vec4 omFlatArt() {
  int part = omFlatPart();
  vec3 p = vRest;
  int s = -1;
  float valid = 1.0;
  vec2 q = vec2(0.0), org = uFlatPanF;
  bool front = true;
  if (part == 1 || (part == 3 && p.y > uFlatTops.z)) {
    s = part == 1 ? 0 : 1;
    q = omFlatSpine(s, p, (part == 1 ? uFlatTops.x : uFlatTops.y) - p.y, front);
    if (part == 1 && omFlatNeckDist(p) < uFlatNeckR) valid = 0.0;
  } else if (part == 2 || part == 3) {
    int side = p.x >= 0.0 ? 0 : 1;
    int pl = (part == 2 ? 0 : 2) + side;
    int i = (part == 2 ? 0 : 4) + side * 2 + (dot(p - uFlatPlaneAt[pl], uFlatPlaneN[pl]) > 0.0 ? 1 : 0);
    s = 2 + i;
    float t, psi;
    q = omFlatLimb(i, p, t, psi, front);
    // The outer side of each thigh's top blends from the hips' mapping (continued below the crotch) into its
    // own, so art down the side of the pants has no step or barbs at the crotch line. The weight runs by
    // height below the crotch (0 on the line all round) and fades out toward the inseam, where the hips'
    // mapping folds onto the spine's axis.
    if (i == 4 || i == 6) {
      float lateral = sin(psi) * (i == 4 ? 1.0 : -1.0);
      float hw = (1.0 - smoothstep(0.0, uFlatTops.w, uFlatTops.z - p.y)) * smoothstep(0.0, 0.5, lateral);
      if (hw > 0.0) {
        bool hipsFront;
        float th = uFlatTops.y - p.y;
        vec2 qh = omFlatSpine(1, p, th, hipsFront);
        qh.y = uFlatY0[1] + th / OM_FLAT_IN;
        if (hipsFront == front) q = mix(q, qh, hw);
        else if (hw > 0.5) { q = qh; front = hipsFront; }
        if (hw > 0.5) s = 1;
      }
    }
  } else if (part == 12) {
    org = uFlatPanC;
    q = vec2(0.5 * OM_FLAT_CAPE_W - p.x / uFlatCape.x / OM_FLAT_IN, (uFlatCape.z - p.y) / OM_FLAT_IN);
    if (p.z >= uFlatCape.y || uFlatCape.w < 0.5) valid = 0.0;
  } else valid = 0.0;
  if (s >= 0) org = front ? uFlatPanF : uFlatPanB;
  // screen-space gradients in uniform control flow, capped by the rest-pose footprint so a segment change
  // inside a pixel quad can't blow the filter up
  vec2 gx = dFdx(q), gy = dFdy(q);
  float lim = 6.0 * max(length(dFdx(vRest)), length(dFdy(vRest))) / OM_FLAT_IN + 1e-5;
  if (length(gx) > lim) gx *= lim / length(gx);
  if (length(gy) > lim) gy *= lim / length(gy);
  // where a pixel block straddles a side seam or a segment's end, q jumps across the page: filter by the
  // body's own footprint instead (the flats are drawn at about body scale)
  if (fwidth(float(s) * 2.0 + (front ? 1.0 : 0.0)) > 0.0) {
    gx = vec2(length(dFdx(vRest)) / OM_FLAT_IN, 0.0);
    gy = vec2(0.0, length(dFdy(vRest)) / OM_FLAT_IN);
  }
  // off the hem by what the filter reads too: at a coarser mip level a texel can straddle the hem
  if (s == 0 || s == 1) {
    float hem = uFlatY0[1];
    float keep = max(omFlatHemInset(), min(OM_FLAT_HEM_FOOTPRINT_MAX, omFlatHemReach(gx, gy)));
    q.y = s == 0 ? min(q.y, hem - keep) : max(q.y, hem + keep);
  }
  if (valid < 0.5) return vec4(0.0);
  return textureGrad(uFlatArt, (org + q) / uFlatAtlas, gx / uFlatAtlas, gy / uFlatAtlas);
}
`;

const LIMB_ORDER = [
    "upper-arm-L",
    "forearm-L",
    "upper-arm-R",
    "forearm-R",
    "thigh-L",
    "shin-L",
    "thigh-R",
    "shin-R",
];
const PLANE_ORDER = ["elbowL", "elbowR", "kneeL", "kneeR"];
const SEGMENT_ORDER = ["torso", "hips", ...LIMB_ORDER];
/** m short of the wrist joint where the glove starts being glove. */
const WRIST_MARGIN = 0.025;
/** The uniform shader's part line in `uniformColor`. */
const PART_LINE = "int part = int(vPart + 0.5);";
/** The uniform shader's palette collar: everything above its collar line. Flats looks put it on the neck. */
const COLLAR_LINE = /c = mix\(c, uTrim, over\(p\.y - [0-9.]+\) \* uCollar\);/;
/** The uniform shader's line the art is mixed into. */
export const FLATS_DIFFUSE_LINE =
    "vec4 diffuseColor = vec4( uniformColor(), opacity );";

/**
 * The fragment code for `layout` (the cape panel's width is a constant in it).
 * @param {{ cape: { w: number } }} layout
 */
export function flatsGlsl(layout) {
    return FLATS_GLSL.replace("OM_FLAT_CAPE_W", layout.cape.w.toFixed(4));
}

/**
 * The uniforms for one body's table and one atlas.
 */
export function flatsUniforms(
    THREE,
    { layout, body, lut, atlas, atlasRect, cape },
) {
    const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const seg = SEGMENT_ORDER.map((id) => {
        const s = layout.segments.find((x) => x.id === id);
        if (!s) throw new Error(`uniform flats: layout has no segment ${id}`);
        return s;
    });
    const limb = LIMB_ORDER.map((id) => {
        const l = layout.limbs.find((x) => x.id === id);
        if (!l) throw new Error(`uniform flats: layout has no limb ${id}`);
        return l;
    });
    const plane = PLANE_ORDER.map((id) => {
        const p = layout.planes.find((x) => x.id === id);
        if (!p) throw new Error(`uniform flats: layout has no plane ${id}`);
        return p;
    });
    const at = (o) => new THREE.Vector2(o ? o[0] : 0, o ? o[1] : 0);
    return {
        uFlatArt: { value: atlas },
        uFlatAtlas: { value: new THREE.Vector2(atlasRect.w, atlasRect.h) },
        uFlatLut: { value: lut },
        uFlatLutRows: { value: layout.rows },
        uFlatSeg: {
            value: seg.map(
                (s) => new THREE.Vector4(s.rowStart, s.rows, s.tStart, s.tEnd),
            ),
        },
        uFlatY0: { value: seg.map((s) => s.y0) },
        uFlatHead: { value: limb.map((l) => v3(l.head)) },
        uFlatDir: { value: limb.map((l) => v3(l.dir)) },
        uFlatFwd: { value: limb.map((l) => v3(l.fwd)) },
        uFlatSide: { value: limb.map((l) => v3(l.side)) },
        uFlatPlaneAt: { value: plane.map((p) => v3(p.at)) },
        uFlatPlaneN: { value: plane.map((p) => v3(p.n)) },
        uFlatTops: {
            value: new THREE.Vector4(
                layout.tops.torso,
                layout.tops.hips,
                layout.tops.crotch,
                layout.tops.legEase,
            ),
        },
        uFlatPanF: { value: at(atlasRect.front) },
        uFlatPanB: { value: at(atlasRect.back) },
        uFlatPanC: { value: at(atlasRect.cape) },
        uFlatCx: { value: layout.centreX },
        uFlatWrist: {
            // just short of the wrist joint: the hand itself stays glove
            value: new THREE.Vector2(
                limb[1].length - WRIST_MARGIN,
                limb[3].length - WRIST_MARGIN,
            ),
        },
        uFlatNeckR: {
            value: layout.neckR[body] ?? layout.neckR[layout.median],
        },
        uFlatPx: { value: 1 / atlasRect.dpi },
        uFlatCape: {
            value: new THREE.Vector4(
                cape?.k ?? 1,
                cape?.midZ ?? 0,
                layout.cape.yTop,
                atlasRect.cape ? 1 : 0,
            ),
        },
    };
}

/**
 * Patches a material from `createUniformMaterial` so its jacket, sleeves, pants and cape show the flats art
 * over the palette. Call it before `composedSkinning`. Returns the material.
 */
export function withFlats(THREE, material, params) {
    const u = flatsUniforms(THREE, params);
    const code = flatsGlsl(params.layout);
    const base = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
        base.call(material, shader, renderer);
        Object.assign(shader.uniforms, u);
        const head = "vec3 uniformColor() {";
        const fs = shader.fragmentShader;
        const at = fs.indexOf(head);
        const partAt = at < 0 ? -1 : fs.indexOf(PART_LINE, at);
        if (
            at < 0 ||
            partAt < 0 ||
            !fs.includes(FLATS_DIFFUSE_LINE) ||
            !COLLAR_LINE.test(fs)
        )
            throw new Error(
                "uniform flats: the uniform shader changed; uniformColor() or its diffuse line was not found",
            );
        // uniformColor() takes its part from omFlatPart(), declared just before it, and its collar color
        // only on the neck (the yoke and shoulders take art)
        shader.fragmentShader = (
            fs.slice(0, at) +
            code +
            "\n" +
            fs.slice(at, partAt) +
            "int part = omFlatPart();" +
            fs.slice(partAt + PART_LINE.length)
        )
            .replace(COLLAR_LINE, "c = mix(c, uTrim, omFlatNeck() * uCollar);")
            .replace(
                FLATS_DIFFUSE_LINE,
                "omFlatNeckW = omFlatNeckWeight();\n  vec4 omArt = omFlatArt();\n  vec4 diffuseColor = vec4( uniformColor() * (1.0 - omArt.a) + omArt.rgb, opacity );",
            );
    };
    material.customProgramCacheKey = () => key + "|flats";
    material.userData.flatUniforms = u;
    return material;
}
