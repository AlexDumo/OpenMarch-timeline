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
//       lut,             // the body's table: a 128 x rows RGBA half-float DataTexture (flatsLutTexture)
//       atlas,           // the composed art, premultiplied alpha
//       atlasRect,       // { w, h, front: [x, y], back: [x, y], cape: [x, y] | null } in inches (flatsAtlasLayout)
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
uniform vec4 uFlatTops;           // torso top, hips top, crotch, collar (m)
uniform vec2 uFlatPanF, uFlatPanB, uFlatPanC; // where each panel's origin sits in the atlas (in)
uniform float uFlatCx;            // the panels' centre line (in)
uniform vec4 uFlatCape;           // cape grade, cape mid-plane z, cape top (m), 1 when the atlas has a cape
uniform vec2 uFlatWrist;          // t along the left and right forearm (m) below which the glove is sleeve
const float OM_FLAT_IN = 0.0254;
const float OM_FLAT_PI = 3.14159265;
float omFlatRow(int s, float t) {
  vec4 g = uFlatSeg[s];
  float f = clamp((t - g.z) / (g.w - g.z), 0.0, 1.0);
  return (g.x + 0.5 + f * (g.y - 1.0)) / uFlatLutRows;
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
// The art over the palette (premultiplied), or transparent where the part takes palette colors only.
vec4 omFlatArt() {
  int part = omFlatPart();
  vec3 p = vRest;
  int s = -1;
  float t = 0.0, psi = 0.0, valid = 1.0;
  vec2 q = vec2(0.0), org = uFlatPanF;
  bool front = true;
  if (part == 1 || (part == 3 && p.y > uFlatTops.z)) {
    s = part == 1 ? 0 : 1;
    t = (part == 1 ? uFlatTops.x : uFlatTops.y) - p.y;
    // the neck: above the collar line the palette collar shows
    if (part == 1 && p.y > uFlatTops.w) valid = 0.0;
    float zc = textureLod(uFlatLut, vec2(0.5, omFlatRow(s, t)), 0.0).b;
    psi = atan(p.x, p.z - zc);
  } else if (part == 2 || part == 3) {
    int side = p.x >= 0.0 ? 0 : 1;
    int pl = (part == 2 ? 0 : 2) + side;
    int i = (part == 2 ? 0 : 4) + side * 2 + (dot(p - uFlatPlaneAt[pl], uFlatPlaneN[pl]) > 0.0 ? 1 : 0);
    vec3 d = p - uFlatHead[i];
    t = dot(d, uFlatDir[i]);
    s = 2 + i;
    // the ring's centre moves forward at the top of each thigh, onto the hips' (table B)
    float off = textureLod(uFlatLut, vec2(0.5, omFlatRow(s, t)), 0.0).b;
    vec3 r = d - uFlatDir[i] * t - uFlatFwd[i] * off;
    psi = atan(dot(r, uFlatSide[i]), dot(r, uFlatFwd[i]));
  } else if (part == 12) {
    org = uFlatPanC;
    q = vec2(0.5 * OM_FLAT_CAPE_W - p.x / uFlatCape.x / OM_FLAT_IN, (uFlatCape.z - p.y) / OM_FLAT_IN);
    if (p.z >= uFlatCape.y || uFlatCape.w < 0.5) valid = 0.0;
  } else valid = 0.0;
  if (s >= 0) {
    vec4 g = uFlatSeg[s];
    float row = omFlatRow(s, t);
    vec4 lut = textureLod(uFlatLut, vec2((psi + OM_FLAT_PI) / (2.0 * OM_FLAT_PI), row), 0.0);
    front = abs(psi) <= 0.5 * OM_FLAT_PI;
    org = front ? uFlatPanF : uFlatPanB;
    // down the segment: inches along its axis, kept to its rows so ends (the sleeve cap over the shoulder,
    // the cuff) never reach past the region into a neighbor's art
    float y = uFlatY0[s] + clamp(t, g.z, g.w) / OM_FLAT_IN + lut.a;
    q = vec2(uFlatCx + (front ? lut.r : -lut.g), y);
  }
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
export function flatsUniforms(THREE, { layout, lut, atlas, atlasRect, cape }) {
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
                layout.tops.collar,
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
        if (at < 0 || partAt < 0 || !fs.includes(FLATS_DIFFUSE_LINE))
            throw new Error(
                "uniform flats: the uniform shader changed; uniformColor() or its diffuse line was not found",
            );
        // uniformColor() takes its part from omFlatPart(), declared just before it
        shader.fragmentShader = (
            fs.slice(0, at) +
            code +
            "\n" +
            fs.slice(at, partAt) +
            "int part = omFlatPart();" +
            fs.slice(partAt + PART_LINE.length)
        ).replace(
            FLATS_DIFFUSE_LINE,
            "vec4 omArt = omFlatArt();\n  vec4 diffuseColor = vec4( uniformColor() * (1.0 - omArt.a) + omArt.rgb, opacity );",
        );
    };
    material.customProgramCacheKey = () => key + "|flats";
    material.userData.flatUniforms = u;
    return material;
}
