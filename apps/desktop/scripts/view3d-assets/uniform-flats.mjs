// cspell:ignore gltf krows paintable perim tris verts wsum
// Measures the seven om-pose bodies for uniform artwork drawn as front/back FLATS (docs/3d/uniform-artwork.md,
// "Rendering: the hybrid wrap") and writes, under src/view3d/assets/uniform-flats/:
//
//   regions.json        the flats template in numbers: panels, region outlines (panel inches), side seams every
//                       0.25 in, guides, landmarks and the grey context figure. It is the template's downloadable
//                       uniform-regions.json, written by the template's own code (artworkTemplates/uniform/
//                       regions.ts, regionsJson), plus the figure and `generatedBy`; the template (fork #1256) is
//                       drawn from it and the renderer reads its outlines.
//   layout.json         what the renderer needs: segments, rows, bone frames, joint planes, grade factors per body.
//   lut/<body>.bin      one lookup table per body type: RGBA half floats, LUT_ANGLES columns x rows (see below).
//
//   node scripts/view3d-assets/uniform-flats.mjs        (from apps/desktop; deterministic)
//
// Run it when the bodies change, then commit the result. Ported from the design study's harness
// (tools/build-flats.mjs), with three changes the design asks for:
// - The neck is outside every region: the torso's art stops at the collar line (the palette collar shows).
// - The shoulder tops keep their real length: down the torso the flat coordinate is the arc along the
//   body, not the height, from the chest line up (channel A), so art there no longer stretches vertically.
// - The pant legs meet the hips without a jog: over the top of each thigh its outline on the flats eases from
//   the hips' outline (outer seam on the hips' seam, inseams meeting at the centre) to the spread leg.
//
// The mapping: every jacket and pants point belongs to a SEGMENT (torso and hips around the spine, each upper
// arm, forearm, thigh and shin around its bone). With psi the angle round that axis from the segment's front,
// the front half (|psi| <= 90 deg) samples the front flat and the back half the back flat. Across a half the flat
// coordinate is U = (1 - BLEND) * x_projected + BLEND * arc_from_centre; down a segment it is inches along the
// axis. Each body's rows are rescaled so its side seams land on the median body's outlines (grading).
//
// Table texel (row r, column i), all half floats:
//   R  U on the front flat, inches from the panel's centre line toward the performer's left (+X)
//   G  U on the back flat, the same sense
//   B  torso and hips: the row's centre front to back (m); limbs: how far forward the axis moves (m)
//   A  added to the flat's y (inches): the shoulder tops' extra length, torso only
// Column i is psi = -pi + (i + 0.5) * 2 pi / LUT_ANGLES.
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// the template's own code writes the file, so the renderer's asset and the download agree (Node 24 runs the
// TypeScript as it is)
import {
    flatsRegions,
    regionsJson as templateRegionsJson,
    spanAt,
} from "../../src/view3d/core/artworkTemplates/uniform/regions.ts";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DESKTOP = path.resolve(HERE, "../..");
const BODIES_DIR = path.join(DESKTOP, "src/view3d/assets/om-pose/bodies");
const OUT = path.join(DESKTOP, "src/view3d/assets/uniform-flats");

const BODY_TYPES = [
    "neutral-slim",
    "neutral-average",
    "neutral-athletic",
    "neutral-broad",
    "neutral-full",
    "feminine-average",
    "masculine-average",
];
const MEDIAN = "neutral-average";
const IN = 0.0254;
const BLEND = 0.4; // share of arc length in U (0 = front-on projection, 1 = full unroll)
const N_A = 128; // angle columns
const ROW_M = 0.005; // row spacing along a segment's axis, m
const DPI = 32; // the template PNG's pixels per inch
const GAP = 0.75; // in, between neighboring regions on a flat
const MARGIN = 1.5; // in, round the figure inside a panel
const GUTTER = 4; // in, between panels and round the page
const HEADER = 6; // in, legend band at the top of the page
const Y_CROTCH = 0.845; // m: pants above are the hips (the legs part below about 0.84 on every body)
/** The jacket's standing collar (the neck) is measured from here up, m. */
const Y_NECK_FROM = 1.465;
/** Added to each body's collar radius (m): the neck is what lies closer than that to the neck's axis. */
const NECK_MARGIN = 0.006;
/** The hips' rings are cast down to here (m); below it, to the crotch, the last one carries on. */
const Y_HIPS_RING_FLOOR = 0.87;
/** Above this height the torso's flat y follows the body's surface instead of the height (shoulder tops). */
const Y_ARC_FROM = 1.3;
/** Over this length (m) from the crotch a thigh's outline eases from the hips' outline to the spread leg. */
const LEG_EASE_M = 0.1;
/** The design's page (docs/3d/uniform-artwork.md, "Flats template"); the build checks it still fits. */
const PAGE = { w: 105, h: 88 };
const PANEL = { w: 34, h: 78 };

const PI = Math.PI;
const TAU = 2 * PI;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const toIn = (m) => m / IN;
const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- bodies
async function loadBody(type) {
    const b = fs.readFileSync(path.join(BODIES_DIR, `${type}.glb`));
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const gltf = await new Promise((res, rej) =>
        new GLTFLoader().parse(ab, "", res, rej),
    );
    let mesh = null;
    gltf.scene.traverse((o) => {
        if (!mesh && o.isSkinnedMesh) mesh = o;
    });
    if (!mesh) throw new Error(`${type}: no skinned mesh`);
    return mesh;
}
function meshData(mesh) {
    const g = mesh.geometry;
    const P = g.attributes.position;
    const pa = g.attributes._part;
    const I = g.index;
    const pos = (i) => [P.getX(i), P.getY(i), P.getZ(i)];
    const tris = [];
    for (let t = 0; t < I.count; t += 3) {
        const v = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
        const pts = v.map(pos);
        tris.push({
            pts,
            part: Math.round(pa.getX(v[0])),
            c: mul(add(add(pts[0], pts[1]), pts[2]), 1 / 3),
        });
    }
    const verts = [];
    for (let i = 0; i < P.count; i++)
        verts.push({ p: pos(i), part: Math.round(pa.getX(i)) });
    return { tris, verts };
}
const meshes = {};
for (const t of BODY_TYPES) meshes[t] = await loadBody(t);
const MD = Object.fromEntries(BODY_TYPES.map((t) => [t, meshData(meshes[t])]));

// joints at bind (shared by every body: one skeleton)
const J = {};
{
    const sk = meshes[MEDIAN].skeleton;
    sk.bones.forEach((b, i) => {
        J[b.name] = new THREE.Vector3()
            .setFromMatrixPosition(sk.boneInverses[i].clone().invert())
            .toArray();
    });
}
const joint = (name) => {
    const j = J[name] ?? J[name.replace(/\./g, "")];
    if (!j) throw new Error(`no bone ${name}`);
    return j;
};

// ---------------------------------------------------------------- frames
const Z = [0, 0, 1];
function limbFrame(headName, tailName) {
    const head = joint(headName);
    const tail = joint(tailName);
    const dir = norm(sub(tail, head)); // distal
    const up = mul(dir, -1);
    const fwd = norm(sub(Z, mul(up, dot(Z, up))));
    return {
        head,
        dir,
        fwd,
        side: cross(up, fwd),
        length: Math.hypot(...sub(tail, head)),
    };
}
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
const LIMBS = {
    "upper-arm-L": limbFrame("DEF-upper_arm.L", "DEF-forearm.L"),
    "forearm-L": limbFrame("DEF-forearm.L", "DEF-hand.L"),
    "upper-arm-R": limbFrame("DEF-upper_arm.R", "DEF-forearm.R"),
    "forearm-R": limbFrame("DEF-forearm.R", "DEF-hand.R"),
    "thigh-L": limbFrame("DEF-thigh.L", "DEF-shin.L"),
    "shin-L": limbFrame("DEF-shin.L", "DEF-foot.L"),
    "thigh-R": limbFrame("DEF-thigh.R", "DEF-shin.R"),
    "shin-R": limbFrame("DEF-shin.R", "DEF-foot.R"),
};
// the plane bisecting a joint splits the upper segment from the lower
const jointPlane = (up, lo) => ({
    at: LIMBS[lo].head,
    n: norm(add(LIMBS[up].dir, LIMBS[lo].dir)),
});
const PLANE_ORDER = ["elbowL", "elbowR", "kneeL", "kneeR"];
const PLANES = {
    elbowL: jointPlane("upper-arm-L", "forearm-L"),
    elbowR: jointPlane("upper-arm-R", "forearm-R"),
    kneeL: jointPlane("thigh-L", "shin-L"),
    kneeR: jointPlane("thigh-R", "shin-R"),
};
const below = (p, pl) => dot(sub(p, pl.at), pl.n) > 0;
const partMax = (part, axis) =>
    Math.max(
        ...MD[MEDIAN].verts
            .filter((v) => v.part === part)
            .map((v) => v.p[axis]),
    );
const partMin = (part, axis) =>
    Math.min(
        ...MD[MEDIAN].verts
            .filter((v) => v.part === part)
            .map((v) => v.p[axis]),
    );
const Y_TOP_TORSO = partMax(1, 1);
const Y_TOP_HIPS = partMax(3, 1);

// ---------------------------------------------------------------- the neck
/**
 * Per body, how far from the neck's axis (m) the jacket is still neck: its standing collar's radius plus a
 * margin. The neck is out of every region (palette only); the yoke and shoulder tops round it are paintable.
 */
const NECK_R = {};
for (const bt of BODY_TYPES) {
    const ring = MD[bt].verts.filter(
        (v) => v.part === 1 && v.p[1] >= Y_NECK_FROM,
    );
    const zs = ring.map((v) => v.p[2]);
    const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
    NECK_R[bt] =
        Math.max(...ring.map((v) => Math.hypot(v.p[0], v.p[2] - zc))) +
        NECK_MARGIN;
}

// ---------------------------------------------------------------- segments
function segmentOf(p, part) {
    const s = p[0] >= 0 ? "L" : "R";
    if (part === 1) return "torso";
    if (part === 2)
        return below(p, PLANES["elbow" + s])
            ? "forearm-" + s
            : "upper-arm-" + s;
    if (part === 3) {
        if (p[1] > Y_CROTCH) return "hips";
        return below(p, PLANES["knee" + s]) ? "shin-" + s : "thigh-" + s;
    }
    return null;
}
const SEGMENTS = ["torso", "hips", ...LIMB_ORDER];
/** t of a rest point along its segment (m): down from the top for torso and hips, along the bone for limbs. */
function tOf(seg, p) {
    if (seg === "torso") return Y_TOP_TORSO - p[1];
    if (seg === "hips") return Y_TOP_HIPS - p[1];
    return dot(sub(p, LIMBS[seg].head), LIMBS[seg].dir);
}
const tRange = {};
for (const seg of SEGMENTS) {
    const ts = MD[MEDIAN].verts
        .filter((v) => segmentOf(v.p, v.part) === seg)
        .map((v) => tOf(seg, v.p));
    tRange[seg] = {
        min: Math.min(...ts) - 0.005,
        max: Math.max(...ts) + 0.005,
    };
}
tRange.torso.min = 0;
// the torso stops at the jacket hem, where the hips start: the jacket's last few mm over the pants take the
// hem row's art, and the torso's outline ends on the template's hem line
tRange.torso.max = Y_TOP_TORSO - Y_TOP_HIPS;
tRange.hips.min = 0;
tRange.hips.max = Y_TOP_HIPS - Y_CROTCH;
// a thigh starts where the crotch plane crosses its axis, less a little for the tilt
for (const s of ["L", "R"]) {
    const f = LIMBS["thigh-" + s];
    tRange["thigh-" + s].min = (f.head[1] - Y_CROTCH) / -f.dir[1] - 0.012;
}

// ---------------------------------------------------------------- rings
function rayTri(o, d, a, b, c) {
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const pv = cross(d, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const tv = sub(o, a);
    const u = dot(tv, pv) * inv;
    if (u < 0 || u > 1) return Infinity;
    const qv = cross(tv, e1);
    const v = dot(d, qv) * inv;
    if (v < 0 || u + v > 1) return Infinity;
    const t = dot(e2, qv) * inv;
    return t > 1e-6 ? t : Infinity;
}
const trisCache = new Map();
function segTris(bt, seg) {
    const key = bt + "|" + seg;
    if (trisCache.has(key)) return trisCache.get(key);
    let out;
    if (seg === "torso") out = MD[bt].tris.filter((t) => t.part === 1);
    else if (seg === "hips")
        out = MD[bt].tris.filter(
            (t) => t.part === 3 && t.c[1] > Y_CROTCH - 0.04,
        );
    else {
        const part = seg.includes("arm") ? 2 : 3;
        const s = seg.endsWith("-L") ? 1 : -1;
        out = MD[bt].tris.filter(
            (t) =>
                t.part === part &&
                Math.sign(t.c[0]) === s &&
                (part === 2 || t.c[1] < Y_CROTCH + 0.06),
        );
    }
    out = out.map((t) => {
        const ts = t.pts.map((p) => tOf(seg, p));
        return { ...t, t0: Math.min(...ts), t1: Math.max(...ts) };
    });
    trisCache.set(key, out);
    return out;
}
function frame(seg, t, zc) {
    if (seg === "torso" || seg === "hips")
        return {
            o: [0, (seg === "torso" ? Y_TOP_TORSO : Y_TOP_HIPS) - t, zc],
            fwd: [0, 0, 1],
            side: [1, 0, 0],
        };
    // limbs: zc moves the axis forward (m), so a thigh's side seams meet the hips' (thighOffset)
    const L = LIMBS[seg];
    return {
        o: add(add(L.head, mul(L.dir, t)), mul(L.fwd, zc)),
        fwd: L.fwd,
        side: L.side,
    };
}
const psiOf = (i) => -PI + ((i + 0.5) * TAU) / N_A;
/** Radii at N_A angles (psi from the segment's front, toward +side); misses filled round the ring. */
function castRing(bt, seg, t, zc) {
    const { o, fwd, side } = frame(seg, t, zc);
    const tris = segTris(bt, seg).filter(
        (tr) => tr.t0 <= t + 0.03 && tr.t1 >= t - 0.03,
    );
    const r = new Float64Array(N_A).fill(NaN);
    for (let i = 0; i < N_A; i++) {
        const a = psiOf(i);
        const d = add(mul(fwd, Math.cos(a)), mul(side, Math.sin(a)));
        let best = Infinity;
        for (const tr of tris) best = Math.min(best, rayTri(o, d, ...tr.pts));
        if (best < 0.45) r[i] = best;
    }
    const hits = [...r].filter((x) => !Number.isNaN(x)).length;
    if (hits > 0)
        for (let i = 0; i < N_A; i++) {
            if (!Number.isNaN(r[i])) continue;
            let a = i;
            let b = i;
            while (Number.isNaN(r[(a + N_A) % N_A])) a--;
            while (Number.isNaN(r[(b + N_A) % N_A])) b++;
            const ra = r[(a + N_A) % N_A];
            const rb = r[(b + N_A) % N_A];
            r[i] = ra + ((rb - ra) * (i - a)) / (b - a);
        }
    return { r, coverage: hits / N_A };
}
/** The hips' last row's centre front to back, per body (m), once the hips are measured. */
const HIPS_ZC = {};
/**
 * How far forward (m) a thigh's ring is centred at t: at the crotch on the hips' own centre, so the thigh's
 * side seams (psi = +-90 deg) are the hips' side seams and art down the side of the pants has no jog there;
 * easing back to the bone over LEG_EASE_M.
 */
function thighOffset(bt, seg, t) {
    if (!seg.startsWith("thigh") || HIPS_ZC[bt] === undefined) return 0;
    const L = LIMBS[seg];
    const axisZ = L.head[2] + L.dir[2] * t;
    const w = smooth((t - tRange[seg].min) / LEG_EASE_M);
    return ((HIPS_ZC[bt] - axisZ) / L.fwd[2]) * (1 - w);
}
/** Torso and hips: each row centred front to back on its own cross-section (one re-cast). */
function ringAt(bt, seg, t) {
    if (seg !== "torso" && seg !== "hips") {
        const off = thighOffset(bt, seg, t);
        return { ...castRing(bt, seg, t, off), zc: off };
    }
    let zc = 0;
    let rg = castRing(bt, seg, t, zc);
    if (rg.coverage > 0.3) {
        let z0 = 9;
        let z1 = -9;
        for (let i = 0; i < N_A; i++) {
            const z = zc + rg.r[i] * Math.cos(psiOf(i));
            z0 = Math.min(z0, z);
            z1 = Math.max(z1, z);
        }
        zc = (z0 + z1) / 2;
        rg = castRing(bt, seg, t, zc);
    }
    return { ...rg, zc };
}
/** A ring's flat coordinates per angle (m, +side positive) and its four seam values at psi = +-90 deg. */
function flatCoords(rg) {
    const { r } = rg;
    const P = (i) => {
        const a = psiOf(i);
        return [r[i] * Math.sin(a), r[i] * Math.cos(a)];
    };
    const s = new Float64Array(N_A);
    const first = P(0);
    const last = P(N_A - 1);
    s[0] = Math.hypot(first[0] - last[0], first[1] - last[1]) / 2;
    for (let i = 1; i < N_A; i++) {
        const a = P(i - 1);
        const b = P(i);
        s[i] = s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const perim =
        s[N_A - 1] + Math.hypot(first[0] - last[0], first[1] - last[1]) / 2;
    const at = (arr, psi) => {
        const x = ((psi + PI) / TAU) * N_A - 0.5;
        const i0 = Math.floor(x);
        const f = x - i0;
        return arr[i0] * (1 - f) + arr[i0 + 1] * f;
    };
    const xs = Float64Array.from({ length: N_A }, (_, i) => P(i)[0]);
    const s0 = at(s, 0);
    const UF = new Float64Array(N_A);
    const UB = new Float64Array(N_A);
    for (let i = 0; i < N_A; i++) {
        const psi = psiOf(i);
        UF[i] = (1 - BLEND) * xs[i] + BLEND * (s[i] - s0);
        UB[i] = (1 - BLEND) * xs[i] + BLEND * (psi >= 0 ? perim - s[i] : -s[i]);
    }
    const seamF = (sgn) =>
        (1 - BLEND) * at(xs, (sgn * PI) / 2) +
        BLEND * (at(s, (sgn * PI) / 2) - s0);
    const seamB = (sgn) =>
        (1 - BLEND) * at(xs, (sgn * PI) / 2) +
        BLEND * (sgn > 0 ? perim - at(s, PI / 2) : -at(s, -PI / 2));
    return {
        UF,
        UB,
        r: Float64Array.from(r),
        Fp: seamF(1),
        Fm: seamF(-1),
        Bp: seamB(1),
        Bm: seamB(-1),
        perim,
    };
}

// ---------------------------------------------------------------- rows
const segRows = {};
let rowStart = 0;
for (const seg of SEGMENTS) {
    const { min, max } = tRange[seg];
    const n = Math.max(8, Math.ceil((max - min) / ROW_M) + 1);
    segRows[seg] = { rowStart, rows: n, tStart: min, tEnd: max };
    rowStart += n;
}
const TOTAL_ROWS = rowStart;
const rowT = (seg, k) =>
    segRows[seg].tStart +
    ((segRows[seg].tEnd - segRows[seg].tStart) * k) / (segRows[seg].rows - 1);

/** Per body and segment: each row's flat coordinates, smoothed; misses and folds refilled from neighbors. */
const RAW = {};
const SMOOTH_W = [1, 2, 3, 4, 3, 2, 1];
for (const bt of BODY_TYPES) {
    RAW[bt] = {};
    for (const seg of SEGMENTS) {
        const rows = [];
        for (let k = 0; k < segRows[seg].rows; k++) {
            const rg = ringAt(bt, seg, rowT(seg, k));
            rows.push(
                rg.coverage >= 0.4
                    ? { ...flatCoords(rg), zc: rg.zc, coverage: rg.coverage }
                    : null,
            );
        }
        // a ring whose width jumps away from its neighbors' caught a fold, the crotch or an armhole edge
        const width = rows.map((x) => (x ? x.Fp - x.Fm + x.Bp - x.Bm : NaN));
        const medW = width.map((_, k) => {
            const w = width
                .slice(Math.max(0, k - 3), k + 4)
                .filter((v) => !Number.isNaN(v))
                .sort((a, b) => a - b);
            return w.length ? w[w.length >> 1] : NaN;
        });
        rows.forEach((x, k) => {
            if (x && Math.abs(width[k] - medW[k]) > 0.15 * medW[k])
                rows[k] = null;
        });
        // the hips' lowest rings: by the crotch the spine's axis sits between the legs, and rays from it
        // meet the inner thighs, so below Y_HIPS_RING_FLOOR the last ring above carries on
        if (seg === "hips")
            rows.forEach((_, k) => {
                if (Y_TOP_HIPS - rowT(seg, k) < Y_HIPS_RING_FLOOR)
                    rows[k] = null;
            });
        const good = rows.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
        if (!good.length) throw new Error(`${bt} ${seg}: no ring hits`);
        for (let k = 0; k < rows.length; k++)
            if (!rows[k]) {
                const g = good.reduce(
                    (b, i) => (Math.abs(i - k) < Math.abs(b - k) ? i : b),
                    good[0],
                );
                rows[k] = { ...rows[g], copiedFrom: g };
            }
        RAW[bt][seg] = rows.map((_, k) => {
            const o = {
                UF: new Float64Array(N_A),
                UB: new Float64Array(N_A),
                r: new Float64Array(N_A),
                Fp: 0,
                Fm: 0,
                Bp: 0,
                Bm: 0,
                zc: 0,
            };
            let wsum = 0;
            SMOOTH_W.forEach((w, j) => {
                const r =
                    rows[Math.min(rows.length - 1, Math.max(0, k + j - 3))];
                wsum += w;
                for (let i = 0; i < N_A; i++) {
                    o.UF[i] += w * r.UF[i];
                    o.UB[i] += w * r.UB[i];
                    o.r[i] += w * r.r[i];
                }
                for (const key of ["Fp", "Fm", "Bp", "Bm", "zc"])
                    o[key] += w * r[key];
            });
            for (let i = 0; i < N_A; i++) {
                o.UF[i] /= wsum;
                o.UB[i] /= wsum;
                o.r[i] /= wsum;
            }
            for (const key of ["Fp", "Fm", "Bp", "Bm", "zc"]) o[key] /= wsum;
            return {
                ...o,
                coverage: rows[k].coverage,
                copiedFrom: rows[k].copiedFrom,
            };
        });
        if (seg === "hips")
            HIPS_ZC[bt] = RAW[bt].hips[RAW[bt].hips.length - 1].zc;
    }
    process.stdout.write(`${bt} `);
}
console.log();

// ---------------------------------------------------------------- the outlines every body is normalized to
// the median's seams per row, smoothed down the segment (5 rows)
const M = RAW[MEDIAN];
const TARGET = {};
for (const seg of SEGMENTS) {
    const rows = M[seg];
    TARGET[seg] = rows.map((_, k) => {
        const w = rows.slice(Math.max(0, k - 2), k + 3);
        const avg = (key) => w.reduce((a, r) => a + r[key], 0) / w.length;
        return { Fp: avg("Fp"), Fm: avg("Fm"), Bp: avg("Bp"), Bm: avg("Bm") };
    });
}

// ---------------------------------------------------------------- shoulder tops: flat y along the surface
// Per torso column, the flat y is the arc along the median's surface (in that column's half-plane) measured
// up from the chest line, instead of the height. Below the chest line the two agree. DV[k][i] is what the
// arc adds to the height-based y at torso row k, column i (inches, <= 0: the art starts higher on the flat).
const DV = (() => {
    const rows = M.torso;
    const n = rows.length;
    const kFrom = Math.max(
        0,
        Math.min(
            n - 1,
            Math.round(
                ((Y_TOP_TORSO - Y_ARC_FROM - segRows.torso.tStart) /
                    (segRows.torso.tEnd - segRows.torso.tStart)) *
                    (n - 1),
            ),
        ),
    );
    const dt = (segRows.torso.tEnd - segRows.torso.tStart) / (n - 1);
    const out = rows.map(() => new Float64Array(N_A));
    for (let i = 0; i < N_A; i++) {
        let extra = 0; // arc minus height, from row kFrom upward
        for (let k = kFrom - 1; k >= 0; k--) {
            const dr = rows[k + 1].r[i] - rows[k].r[i];
            // a steep step is a ray jumping between surfaces (neck to shoulder), not surface: cap the slope
            const ds = Math.hypot(dt, Math.max(-3 * dt, Math.min(3 * dt, dr)));
            extra += ds - dt;
            out[k][i] = -toIn(extra);
        }
    }
    return out;
})();

// ---------------------------------------------------------------- page layout (median inches)
const L_UA = LIMBS["upper-arm-L"].length;
const L_TH = LIMBS["thigh-L"].length;
const SHAKO_TOP = partMax(7, 1);
const Y_PANEL_TOP = SHAKO_TOP + MARGIN * IN; // world height at the top edge of a panel
/** Flat y of a segment's t = 0 (inches from the panel's top): flat y = y0 + t / IN. */
function segY0(seg) {
    if (seg === "torso") return toIn(Y_PANEL_TOP - Y_TOP_TORSO);
    if (seg === "hips") return toIn(Y_PANEL_TOP - Y_TOP_HIPS);
    const s = seg.slice(-1);
    if (seg.startsWith("upper-arm") || seg.startsWith("thigh"))
        return toIn(Y_PANEL_TOP - LIMBS[seg].head[1]);
    if (seg.startsWith("forearm"))
        return toIn(Y_PANEL_TOP - LIMBS["upper-arm-" + s].head[1]) + toIn(L_UA);
    return toIn(Y_PANEL_TOP - LIMBS["thigh-" + s].head[1]) + toIn(L_TH);
}
const rowY = (seg, k) => segY0(seg) + toIn(rowT(seg, k));

/**
 * Per segment and row, the affine map from the body's U (m, about the segment's own axis) to the flat's x
 * (inches from the panel's centre line, +X): x = a + b * toIn(U), separately for the front and back flats.
 */
const AFF = {};
const flatX = (seg, k, side, u) => {
    const f = AFF[seg][k];
    return side === "F" ? f.aF + f.bF * toIn(u) : f.aB + f.bB * toIn(u);
};
for (const seg of ["torso", "hips"])
    AFF[seg] = TARGET[seg].map(() => ({ aF: 0, bF: 1, aB: 0, bB: 1 }));
// legs: inner edges at least GAP / 2 from the centre line on both flats
let LEG_OFF = 0;
for (const seg of ["thigh-L", "shin-L"])
    for (const row of TARGET[seg])
        LEG_OFF = Math.max(LEG_OFF, -toIn(Math.min(row.Fm, row.Bm)));
LEG_OFF += GAP / 2;
for (const s of ["L", "R"]) {
    const sgn = s === "L" ? 1 : -1;
    AFF["shin-" + s] = TARGET["shin-" + s].map(() => ({
        aF: sgn * LEG_OFF,
        bF: 1,
        aB: sgn * LEG_OFF,
        bB: 1,
    }));
    // the thigh eases from the hips' outline at the crotch (outer seam on the hips' seam, inseam on the
    // centre line) to the spread leg, so art drawn down the side of the pants has no jog at the crotch
    const hipsEnd = TARGET.hips[TARGET.hips.length - 1];
    AFF["thigh-" + s] = TARGET["thigh-" + s].map((row, k) => {
        const w = smooth(
            (rowT("thigh-" + s, k) - segRows["thigh-" + s].tStart) / LEG_EASE_M,
        );
        const fit = (inner, outer, hipOuter) => {
            // map inner -> 0 and outer -> hipOuter
            const b = toIn(hipOuter) / toIn(outer - inner);
            return { a: -b * toIn(inner), b };
        };
        // performer's left leg: outer seam is the +side seam; right leg: the -side seam
        const f =
            s === "L"
                ? fit(row.Fm, row.Fp, hipsEnd.Fp)
                : fit(row.Fp, row.Fm, hipsEnd.Fm);
        const b =
            s === "L"
                ? fit(row.Bm, row.Bp, hipsEnd.Bp)
                : fit(row.Bp, row.Bm, hipsEnd.Bm);
        return {
            aF: f.a * (1 - w) + sgn * LEG_OFF * w,
            bF: f.b * (1 - w) + w,
            aB: b.a * (1 - w) + sgn * LEG_OFF * w,
            bB: b.b * (1 - w) + w,
        };
    });
}
/** Outer extent (inches from the centre line) of the torso, hips and legs near flat y, on either flat. */
function bodyExtentAt(y) {
    let e = 0;
    for (const seg of ["torso", "hips", "thigh-L", "shin-L"]) {
        TARGET[seg].forEach((row, k) => {
            if (Math.abs(rowY(seg, k) - y) > 0.6) return;
            for (const [side, u] of [
                ["F", row.Fp],
                ["F", row.Fm],
                ["B", row.Bp],
                ["B", row.Bm],
            ])
                e = Math.max(e, Math.abs(flatX(seg, k, side, u)));
        });
    }
    return e;
}
let ARM_OFF = 0;
for (const seg of ["upper-arm-L", "forearm-L"])
    TARGET[seg].forEach((row, k) => {
        ARM_OFF = Math.max(
            ARM_OFF,
            bodyExtentAt(rowY(seg, k)) + GAP - toIn(Math.min(row.Fm, row.Bm)),
        );
    });
for (const s of ["L", "R"])
    for (const seg of ["upper-arm-" + s, "forearm-" + s]) {
        const a = (s === "L" ? 1 : -1) * ARM_OFF;
        AFF[seg] = TARGET[seg].map(() => ({ aF: a, bF: 1, aB: a, bB: 1 }));
    }

// the panel: the figure's extents plus margins, checked against the design's page
let EXT_X = 0;
let EXT_Y = 0;
for (const seg of SEGMENTS)
    TARGET[seg].forEach((row, k) => {
        for (const [side, u] of [
            ["F", row.Fp],
            ["F", row.Fm],
            ["B", row.Bp],
            ["B", row.Bm],
        ])
            EXT_X = Math.max(EXT_X, Math.abs(flatX(seg, k, side, u)));
        EXT_Y = Math.max(EXT_Y, rowY(seg, k));
    });
const FOOT_BOTTOM = toIn(Y_PANEL_TOP - partMin(4, 1));
const needW = Math.ceil(2 * (EXT_X + MARGIN));
const needH = Math.ceil(Math.max(EXT_Y, FOOT_BOTTOM) + MARGIN);
if (needW > PANEL.w || needH > PANEL.h)
    throw new Error(
        `the figure needs a ${needW} x ${needH} in panel; the design's is ${PANEL.w} x ${PANEL.h}`,
    );
const CX = PANEL.w / 2;
// the cape, as the harness measured it: the median's cape (part 12) seen from behind, half an inch round
const capeVerts = MD[MEDIAN].verts.filter((v) => v.part === 12);
const CAPE = (() => {
    const x = Math.max(...capeVerts.map((v) => Math.abs(v.p[0])));
    const y0 = Math.min(...capeVerts.map((v) => v.p[1]));
    const y1 = Math.max(...capeVerts.map((v) => v.p[1]));
    return {
        w: Math.round(((2 * x) / IN + 1) * 10) / 10,
        h: Math.round(((y1 - y0) / IN + 1) * 10) / 10,
        yTop: y1 + 0.5 * IN,
    };
})();
const PANELS = {
    front: { x: GUTTER, y: HEADER, w: PANEL.w, h: PANEL.h },
    back: { x: GUTTER + PANEL.w + GUTTER, y: HEADER, w: PANEL.w, h: PANEL.h },
    cape: {
        x: GUTTER + 2 * (PANEL.w + GUTTER),
        y: HEADER + 4,
        w: CAPE.w,
        h: CAPE.h,
    },
};
if (
    PANELS.cape.x + CAPE.w + GUTTER > PAGE.w ||
    HEADER + PANEL.h + GUTTER > PAGE.h
)
    throw new Error("the panels no longer fit the design's page");

// ---------------------------------------------------------------- per-body tables
// grade factor k per row: the body's girth against the median's at that row, [front, back]
const KROWS = {};
const half = new Uint16Array(1);
const toHalf = (x) => THREE.DataUtils.toHalfFloat(x);
fs.mkdirSync(path.join(OUT, "lut"), { recursive: true });
for (const bt of BODY_TYPES) {
    const buf = new Uint16Array(TOTAL_ROWS * N_A * 4);
    KROWS[bt] = {};
    for (const seg of SEGMENTS) {
        const { rowStart: r0, rows } = segRows[seg];
        KROWS[bt][seg] = [];
        for (let k = 0; k < rows; k++) {
            const b = RAW[bt][seg][k];
            const m = TARGET[seg][k];
            const sc = {
                Fp: m.Fp / b.Fp,
                Fm: m.Fm / b.Fm,
                Bp: m.Bp / b.Bp,
                Bm: m.Bm / b.Bm,
            };
            const mm = M[seg][k];
            KROWS[bt][seg].push([
                r3((b.Fp - b.Fm) / (mm.Fp - mm.Fm)),
                r3((b.Bp - b.Bm) / (mm.Bp - mm.Bm)),
            ]);
            for (let i = 0; i < N_A; i++) {
                const pos = psiOf(i) >= 0;
                const o = ((r0 + k) * N_A + i) * 4;
                buf[o] = toHalf(
                    flatX(seg, k, "F", b.UF[i] * (pos ? sc.Fp : sc.Fm)),
                );
                buf[o + 1] = toHalf(
                    flatX(seg, k, "B", b.UB[i] * (pos ? sc.Bp : sc.Bm)),
                );
                buf[o + 2] = toHalf(b.zc);
                buf[o + 3] = toHalf(seg === "torso" ? DV[k][i] : 0);
            }
        }
    }
    fs.writeFileSync(
        path.join(OUT, "lut", `${bt}.bin`),
        Buffer.from(buf.buffer),
    );
}
void half;

// ---------------------------------------------------------------- outlines (median, panel inches)
/** The flat y of torso row k at column i (the shoulder tops follow the surface). */
const torsoY = (k, i) => rowY("torso", k) + DV[k][i];
/** DV at psi (radians), interpolated between columns. */
const dvAt = (k, psi) => {
    const x = ((psi + PI) / TAU) * N_A - 0.5;
    const i0 = Math.max(0, Math.min(N_A - 2, Math.floor(x)));
    const f = Math.min(1, Math.max(0, x - i0));
    return DV[k][i0] * (1 - f) + DV[k][i0 + 1] * f;
};
/**
 * Per torso column, the first row (from the top) that is not neck on the median body: where the region's top
 * edge is. Rows above it at that angle only meet the standing collar.
 */
const K_TOP = Array.from({ length: N_A }, (_, i) => {
    const k = M.torso.findIndex((row) => row.r[i] > NECK_R[MEDIAN]);
    return k < 0 ? 0 : k;
});
/** The torso column at each side seam on each flat (the one just inside the half). */
const SEAM_COL = {
    F: { p: N_A * 0.75 - 1, m: N_A * 0.25 },
    B: { p: N_A * 0.75, m: N_A * 0.25 - 1 },
};
/**
 * A segment's two side seams on a flat, each a list of [x, y] downward: `left` and `right` as seen on that
 * panel. Front panel: x = CX + flat x; back panel: x = CX - flat x (seen from behind).
 */
/** Column value of a per-angle array at psi, linear between columns, wrapping round the body. */
function atPsi(arr, psi) {
    const x = ((psi + PI) / TAU) * N_A - 0.5;
    const i0 = Math.floor(x);
    const f = x - i0;
    return arr[(i0 + N_A) % N_A] * (1 - f) + arr[(i0 + 1) % N_A] * f;
}
/**
 * Where the shader puts a thigh's side seam (the outer one blended from the hips, the inseam its own) (sgn +1: psi = +90 deg, -1: -90 deg) at row k on the flats:
 * blended from the hips' mapping at the crotch line into the thigh's own over LEG_EASE_M below it, as
 * `omFlatArt` does,
 * so the leg's outline is where the body really samples. Returns x (inches from the centre line, +X sense, as
 * flatX) and y on each flat.
 */
function thighSeam(seg, k, sgn) {
    const L = LIMBS[seg];
    const t = rowT(seg, k);
    const raw = M[seg][k];
    const r = atPsi(raw.r, (sgn * PI) / 2);
    const p = add(
        add(add(L.head, mul(L.dir, t)), mul(L.fwd, raw.zc)),
        mul(L.side, sgn * r),
    );
    const row = TARGET[seg][k];
    const own = {
        F: flatX(seg, k, "F", sgn > 0 ? row.Fp : row.Fm),
        B: flatX(seg, k, "B", sgn > 0 ? row.Bp : row.Bm),
        y: rowY(seg, k),
    };
    const w = smooth((Y_CROTCH - p[1]) / LEG_EASE_M);
    // the hips' mapping, its last row continued below the crotch
    const hk = M.hips.length - 1;
    const hb = M.hips[hk];
    const hm = TARGET.hips[hk];
    const psi = Math.atan2(p[0], p[2] - hb.zc);
    const pos = psi >= 0;
    const hips = {
        F: toIn(atPsi(hb.UF, psi) * (pos ? hm.Fp / hb.Fp : hm.Fm / hb.Fm)),
        B: toIn(atPsi(hb.UB, psi) * (pos ? hm.Bp / hb.Bp : hm.Bm / hb.Bm)),
        y: segY0("hips") + toIn(Y_TOP_HIPS - p[1]),
    };
    // the hips' share: only on the outer side (the inseam's hips mapping folds onto the spine's axis)
    const lateral = sgn * (seg.endsWith("-L") ? 1 : -1) > 0;
    const hw = lateral ? 1 - w : 0;
    const mix = (a, b) => b + (a - b) * hw;
    return {
        F: mix(hips.F, own.F),
        B: mix(hips.B, own.B),
        y: mix(hips.y, own.y),
    };
}
/**
 * A segment's two side seams on a flat, each a list of [x, y] downward: `left` and `right` as seen on that
 * panel. Front panel: x = CX + flat x; back panel: x = CX - flat x (seen from behind).
 */
function seams(seg, panel) {
    const left = [];
    const right = [];
    // the torso's seams start below the neck, at their own column's top row
    const side = panel === "front" ? "F" : "B";
    const kp = seg === "torso" ? K_TOP[SEAM_COL[side].p] : 0;
    const km = seg === "torso" ? K_TOP[SEAM_COL[side].m] : 0;
    const thigh = seg.startsWith("thigh");
    const crotchY = toIn(Y_PANEL_TOP - Y_CROTCH);
    let prev = null;
    TARGET[seg].forEach((row, k) => {
        if (thigh) {
            // the leg starts at the crotch line, where the hips end
            const sp = thighSeam(seg, k, 1);
            const sm = thighSeam(seg, k, -1);
            if (sp.y < crotchY - 1e-6 || sm.y < crotchY - 1e-6) {
                prev = { sp, sm };
                return;
            }
            if (prev && !left.length) {
                // the first point exactly on the crotch line, between the last row above it and this one
                const lerp = (a, b) => {
                    const f = (crotchY - a.y) / (b.y - a.y);
                    return {
                        F: a.F + (b.F - a.F) * f,
                        B: a.B + (b.B - a.B) * f,
                        y: crotchY,
                    };
                };
                const p0 = lerp(prev.sp, sp);
                const m0 = lerp(prev.sm, sm);
                if (panel === "front") {
                    left.push([CX + m0.F, crotchY]);
                    right.push([CX + p0.F, crotchY]);
                } else {
                    left.push([CX - p0.B, crotchY]);
                    right.push([CX - m0.B, crotchY]);
                }
            }
            if (panel === "front") {
                left.push([CX + sm.F, sm.y]);
                right.push([CX + sp.F, sp.y]);
            } else {
                left.push([CX - sp.B, sp.y]);
                right.push([CX - sm.B, sm.y]);
            }
            return;
        }
        const yp =
            seg === "torso" ? rowY(seg, k) + dvAt(k, PI / 2) : rowY(seg, k);
        const ym =
            seg === "torso" ? rowY(seg, k) + dvAt(k, -PI / 2) : rowY(seg, k);
        if (panel === "front") {
            if (k >= km) left.push([CX + flatX(seg, k, "F", row.Fm), ym]);
            if (k >= kp) right.push([CX + flatX(seg, k, "F", row.Fp), yp]);
        } else {
            if (k >= kp) left.push([CX - flatX(seg, k, "B", row.Bp), yp]);
            if (k >= km) right.push([CX - flatX(seg, k, "B", row.Bm), ym]);
        }
    });
    return { left, right };
}
/** The torso's top edge on a flat (round the neck, over the shoulders), right to left. */
function torsoTop(panel) {
    const pts = [];
    const m = (k) => TARGET.torso[k];
    const b = (k) => M.torso[k];
    // front: psi from +90 down to -90 deg; back: from -90 down to -180, then 180 down to 90
    const cols =
        panel === "front"
            ? Array.from({ length: N_A / 2 }, (_, j) => N_A * 0.75 - 1 - j)
            : [
                  ...Array.from({ length: N_A / 4 }, (_, j) => N_A / 4 - 1 - j),
                  ...Array.from({ length: N_A / 4 }, (_, j) => N_A - 1 - j),
              ];
    for (const i of cols) {
        const k = K_TOP[i];
        const pos = psiOf(i) >= 0;
        if (panel === "front") {
            const u =
                b(k).UF[i] * (pos ? m(k).Fp / b(k).Fp : m(k).Fm / b(k).Fm);
            pts.push([CX + flatX("torso", k, "F", u), torsoY(k, i)]);
        } else {
            const u =
                b(k).UB[i] * (pos ? m(k).Bp / b(k).Bp : m(k).Bm / b(k).Bm);
            pts.push([CX - flatX("torso", k, "B", u), torsoY(k, i)]);
        }
    }
    return pts;
}
const REGION_LABEL = {
    torso: "Jacket body, neckline to hem",
    "sleeve-L": "Left sleeve, shoulder to cuff",
    "sleeve-R": "Right sleeve, shoulder to cuff",
    hips: "Pants, belt to crotch",
    "leg-L": "Left pant leg, crotch to hem",
    "leg-R": "Right pant leg, crotch to hem",
};
const REGION_SEGMENTS = {
    torso: ["torso"],
    "sleeve-L": ["upper-arm-L", "forearm-L"],
    "sleeve-R": ["upper-arm-R", "forearm-R"],
    hips: ["hips"],
    "leg-L": ["thigh-L", "shin-L"],
    "leg-R": ["thigh-R", "shin-R"],
};
/** Linear interpolation of a downward polyline's x at y (clamped to its ends). */
function xAt(line, y) {
    if (y <= line[0][1]) return line[0][0];
    for (let j = 1; j < line.length; j++)
        if (line[j][1] >= y) {
            const [x0, y0] = line[j - 1];
            const [x1, y1] = line[j];
            return y1 > y0 ? x0 + ((x1 - x0) * (y - y0)) / (y1 - y0) : x1;
        }
    return line[line.length - 1][0];
}
const REGIONS = [];
for (const panel of ["front", "back"]) {
    for (const part of Object.keys(REGION_SEGMENTS)) {
        const parts = REGION_SEGMENTS[part].map((seg) => seams(seg, panel));
        const left = parts.flatMap((p) => p.left);
        const right = parts.flatMap((p) => p.right);
        const top = part === "torso" ? torsoTop(panel) : [];
        // left seam down, right seam up, then (torso) the top edge from right to left
        const polygon = [
            ...left,
            ...[...right].reverse(),
            ...top.slice(1, -1),
        ].map(([x, y]) => [r2(x), r2(y)]);
        const xs = polygon.map((q) => q[0]);
        const ys = polygon.map((q) => q[1]);
        // the side seams every 0.25 in of height
        const seamY0 = Math.ceil(Math.max(left[0][1], right[0][1]) * 4) / 4;
        const seamY1 =
            Math.floor(
                Math.min(left[left.length - 1][1], right[right.length - 1][1]) *
                    4,
            ) / 4;
        const seamRows = [];
        // above the side seams (the torso's shoulders), the outline's own extent, from the region's top
        const yTop = Math.min(...ys);
        for (
            let y = Math.floor(yTop * 4 + 1e-9) / 4 + 0.25;
            y < seamY0 - 1e-9;
            y += 0.25
        ) {
            const span = spanAt(polygon, y);
            if (span)
                seamRows.push({
                    y: r2(y),
                    left: r2(span.left),
                    right: r2(span.right),
                });
        }
        for (let y = seamY0; y <= seamY1 + 1e-9; y += 0.25)
            seamRows.push({
                y: r2(y),
                left: r2(xAt(left, y)),
                right: r2(xAt(right, y)),
            });
        REGIONS.push({
            id: `${panel}-${part}`,
            panel,
            part,
            label: REGION_LABEL[part],
            segments: REGION_SEGMENTS[part],
            polygon,
            bbox: {
                x: r2(Math.min(...xs)),
                y: r2(Math.min(...ys)),
                w: r2(Math.max(...xs) - Math.min(...xs)),
                h: r2(Math.max(...ys) - Math.min(...ys)),
            },
            seams: seamRows,
        });
    }
}
REGIONS.push({
    id: "cape",
    panel: "cape",
    part: "cape",
    label: "Cape (overlay), back view; optional",
    segments: ["cape"],
    polygon: [
        [0, 0],
        [CAPE.w, 0],
        [CAPE.w, CAPE.h],
        [0, CAPE.h],
    ],
    bbox: { x: 0, y: 0, w: CAPE.w, h: CAPE.h },
});

// guides (panel inches)
const yWorld = (y) => r2(toIn(Y_PANEL_TOP - y));
const GUIDES = [
    {
        id: "collar",
        y: r2(torsoY(K_TOP[N_A / 2], N_A / 2)),
        label: "neckline at the centre front (above it: the neck, palette colors only)",
    },
    { id: "chest", y: yWorld(1.3), label: "chest" },
    { id: "jacketHem", y: yWorld(Y_TOP_HIPS), label: "jacket hem and belt" },
    { id: "crotch", y: yWorld(Y_CROTCH), label: "crotch" },
    {
        id: "knee",
        y: r2(segY0("shin-L") + toIn(rowT("shin-L", 0))),
        label: "knee",
    },
    {
        id: "elbow",
        y: r2(segY0("forearm-L") + toIn(rowT("forearm-L", 0))),
        label: "elbow",
        sleeve: true,
    },
];

// the grey context figure (head, shako, visor, shoes; hands at the cuffs), front panel inches; the back panel
// is its mirror image about the centre line. Triangles as three [x, y] points.
const FIGURE = (() => {
    const proj = (p, dx = 0) => [
        CX + toIn(p[0]) + dx,
        toIn(Y_PANEL_TOP - p[1]),
    ];
    const shinEnd = rowT("shin-L", segRows["shin-L"].rows - 1);
    const legShift =
        LEG_OFF -
        toIn(LIMBS["shin-L"].head[0] + LIMBS["shin-L"].dir[0] * shinEnd);
    const parts = {};
    for (const [name, part] of [
        ["head", 0],
        ["shako", 7],
        ["visor", 9],
        ["shoes", 4],
    ]) {
        const tris = MD[MEDIAN].tris.filter(
            (t) => t.part === part && (part !== 0 || t.c[1] > 1.4),
        );
        parts[name] = tris.map((t) =>
            t.pts.map((p) =>
                proj(p, part === 4 ? Math.sign(t.c[0]) * legShift : 0).map(r2),
            ),
        );
    }
    const hands = ["L", "R"].map((s) => {
        const seg = "forearm-" + s;
        const k = TARGET[seg].length - 1;
        const last = TARGET[seg][k];
        const xl = flatX(seg, k, "F", last.Fm);
        const xr = flatX(seg, k, "F", last.Fp);
        return {
            cx: r2(CX + (xl + xr) / 2),
            cy: r2(rowY(seg, k) + 3.4),
            rx: r2((xr - xl) * 0.42),
            ry: 3.4,
        };
    });
    // head, shako, visor and shoes, in that order, as one list of triangles
    return { shapes: Object.values(parts).flat(), hands };
})();

// regions.json: the template's uniform-regions.json, from the template's own code, plus the figure
const GUIDE = (id) => GUIDES.find((g) => g.id === id).y;
const templateModel = flatsRegions({
    regions: REGIONS.filter((r) => r.panel !== "cape").map((r) => ({
        panel: r.panel,
        part: r.part,
        polygon: r.polygon,
        seams: r.seams,
    })),
    guides: {
        collar: GUIDE("collar"),
        chest: GUIDE("chest"),
        jacketHem: GUIDE("jacketHem"),
        crotch: GUIDE("crotch"),
        knee: GUIDE("knee"),
        elbow: GUIDE("elbow"),
    },
    landmarks: {
        chestCentre: [r2(CX), yWorld(1.3)],
        backNumberCentre: [r2(CX), yWorld(1.22)],
    },
    figure: FIGURE,
});
const regionsJson = {
    ...templateRegionsJson(templateModel),
    generatedBy: "apps/desktop/scripts/view3d-assets/uniform-flats.mjs",
    figure: FIGURE,
};
if (
    regionsJson.dpi !== DPI ||
    regionsJson.page.w !== PAGE.w ||
    regionsJson.page.h !== PAGE.h ||
    regionsJson.centreX !== CX ||
    ["front", "back", "cape"].some((id) =>
        ["x", "y", "w", "h"].some(
            (k) => regionsJson.panels[id][k] !== PANELS[id][k],
        ),
    )
)
    throw new Error(
        "uniform flats: the template's page layout (regions.ts FLATS_LAYOUT) and this script's differ",
    );

const layoutJson = {
    generatedBy: "apps/desktop/scripts/view3d-assets/uniform-flats.mjs",
    angles: N_A,
    rows: TOTAL_ROWS,
    median: MEDIAN,
    bodies: BODY_TYPES,
    sheet: PAGE,
    panels: PANELS,
    centreX: CX,
    segments: SEGMENTS.map((id) => ({
        id,
        rowStart: segRows[id].rowStart,
        rows: segRows[id].rows,
        tStart: r5(segRows[id].tStart),
        tEnd: r5(segRows[id].tEnd),
        y0: r5(segY0(id)),
    })),
    tops: {
        torso: r5(Y_TOP_TORSO),
        hips: r5(Y_TOP_HIPS),
        crotch: Y_CROTCH,
        legEase: LEG_EASE_M,
    },
    /** Per body: how far from the neck's axis (m) the jacket is the neck (no art; the palette collar). */
    neckR: Object.fromEntries(BODY_TYPES.map((bt) => [bt, r5(NECK_R[bt])])),
    limbs: LIMB_ORDER.map((id) => ({
        id,
        head: LIMBS[id].head.map(r5),
        dir: LIMBS[id].dir.map(r5),
        fwd: LIMBS[id].fwd.map(r5),
        side: LIMBS[id].side.map(r5),
        length: r5(LIMBS[id].length),
    })),
    planes: PLANE_ORDER.map((id) => ({
        id,
        at: PLANES[id].at.map(r5),
        n: PLANES[id].n.map(r5),
    })),
    cape: { yTop: r5(CAPE.yTop), w: CAPE.w, h: CAPE.h },
    /** Grade factor per body, segment and row: [front, back]. */
    k: KROWS,
};
// as the template writes its download (index.ts formatJson): each point, seam row or box on one line
fs.writeFileSync(
    path.join(OUT, "regions.json"),
    `${JSON.stringify(regionsJson, null, 1).replace(
        /[[{][^[\]{}]*[\]}]/g,
        (leaf) =>
            leaf
                .replace(/\s*\n\s*/g, " ")
                .replace(/([[{]) /, "$1")
                .replace(/ ([\]}])$/, "$1"),
    )}\n`,
);
fs.writeFileSync(
    path.join(OUT, "layout.json"),
    JSON.stringify(layoutJson) + "\n",
);

// ---------------------------------------------------------------- report
console.log(
    "rows",
    TOTAL_ROWS,
    "table",
    ((TOTAL_ROWS * N_A * 8) / 1024).toFixed(0),
    "KiB per body",
);
console.log(
    "panel needs",
    needW,
    "x",
    needH,
    "of",
    PANEL.w,
    "x",
    PANEL.h,
    "; cape",
    CAPE.w,
    "x",
    CAPE.h,
);
console.log("offsets: arms", r2(ARM_OFF), "legs", r2(LEG_OFF));
console.log("guides", GUIDES.map((g) => `${g.id} ${g.y}`).join(", "));
for (const seg of SEGMENTS) {
    const rows = M[seg];
    const copied = rows.filter((r) => r.copiedFrom !== undefined).length;
    console.log(
        seg.padEnd(12),
        "rows",
        rows.length,
        "t",
        r3(segRows[seg].tStart),
        r3(segRows[seg].tEnd),
        "y0",
        r2(segY0(seg)),
        "min cov",
        r2(Math.min(...rows.map((r) => r.coverage))),
        "copied",
        copied,
    );
}
console.log(
    "shoulder top: deepest raise",
    r2(Math.min(...DV.flatMap((r) => [...r]))),
    "in",
);
for (const bt of BODY_TYPES) {
    const mean = (seg, j) =>
        r2(
            KROWS[bt][seg].reduce((s, x) => s + x[j], 0) /
                KROWS[bt][seg].length,
        );
    console.log(
        bt.padEnd(18),
        SEGMENTS.map((s) => `${s} ${mean(s, 0)}`).join(" | "),
    );
}
