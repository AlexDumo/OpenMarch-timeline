// cspell:words Hopcroft Karp
// Remap prototype: compares assignment objectives on synthetic drill transitions.
// Run: node docs/timeline/research/remap/proto/remap-proto.mjs [--json]
// Units are steps (8 to 5: 1 step = 22.5 in). A move lasts `counts` counts, and every marcher
// leaves at the start flag and arrives at the playhead together (a `direct` move), so a
// marcher's stride is distance / counts steps per count.
/* eslint-disable */

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** A seeded PRNG so every run prints the same numbers. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------------------------
// Solvers. Each returns `assign[i] = j`: marcher i takes spot j.
// ---------------------------------------------------------------------------------------------

/** A copy of core's `hungarianAlgorithm` (packages/core/src/shapes/utils.ts), 0-based result. */
function hungarian(cost) {
    const n = cost.length;
    const u = new Float64Array(n + 1);
    const v = new Float64Array(n + 1);
    const p = new Int32Array(n + 1); // p[j] = row (1-based) on column j
    const way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minCost = new Float64Array(n + 1).fill(Infinity);
        const used = new Uint8Array(n + 1);
        do {
            used[j0] = 1;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;
            const row = cost[i0 - 1];
            for (let j = 1; j <= n; j++) {
                if (used[j]) continue;
                const cur = row[j - 1] - u[i0] - v[j];
                if (cur < minCost[j]) {
                    minCost[j] = cur;
                    way[j] = j0;
                }
                if (minCost[j] < delta) {
                    delta = minCost[j];
                    j1 = j;
                }
            }
            for (let j = 0; j <= n; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else minCost[j] -= delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0);
    }
    const assign = new Array(n);
    for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
    return assign;
}

const costMatrix = (A, B, f) => A.map((a) => B.map((b) => f(a, b)));

/**
 * Drill order: marcher i (drill number order) takes spot i (the shape's slot order). This is the
 * Shape tool's "Drill number" mode; its "Keep order" projects current positions onto the shape
 * instead, which for a line-to-arc move equals the nearest answer.
 */
const keepOrder = (A) => A.map((_, i) => i);

/** Pyware 3DX "Proximity Matching": closest pair first, then the next closest, until done. */
function greedy(A, B) {
    const pairs = [];
    for (let i = 0; i < A.length; i++)
        for (let j = 0; j < B.length; j++) pairs.push([d2(A[i], B[j]), i, j]);
    pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    const assign = new Array(A.length).fill(-1);
    const taken = new Uint8Array(B.length);
    let left = A.length;
    for (const [, i, j] of pairs) {
        if (assign[i] !== -1 || taken[j]) continue;
        assign[i] = j;
        taken[j] = 1;
        if (--left === 0) break;
    }
    return assign;
}

const sumDistance = (A, B) => hungarian(costMatrix(A, B, dist));
const sumSquared = (A, B) => hungarian(costMatrix(A, B, d2));

/**
 * Least squared travel, with exact ties broken toward keeping order: a tiny extra cost for
 * marcher rank i taking spot rank j, (i - j)^2, far below any real travel difference. Ranks are
 * the drill order and the shape's slot order, so the answer doesn't depend on input order.
 */
function sumSquaredKeepTies(
    A,
    B,
    rankA = A.map((_, i) => i),
    rankB = B.map((_, j) => j),
) {
    const n = A.length;
    const eps = 1e-6 / (n * n);
    return hungarian(
        A.map((a, i) =>
            B.map((b, j) => d2(a, b) + eps * (rankA[i] - rankB[j]) ** 2),
        ),
    );
}

/**
 * The recommended cost: least squared travel first; among exact ties, the smaller longest moves
 * (a tiny d^4 term); among ties still, drill order (a tinier (i - j)^2 term). Deterministic for
 * any input order because ranks travel with the marchers.
 */
function recommended(
    A,
    B,
    rankA = A.map((_, i) => i),
    rankB = B.map((_, j) => j),
) {
    const n = A.length;
    let scale = 1;
    for (const a of A) for (const b of B) scale = Math.max(scale, d2(a, b));
    const e1 = 1e-7 / scale;
    const e2 = 1e-9 / (n * n);
    return hungarian(
        A.map((a, i) =>
            B.map((b, j) => {
                const c = d2(a, b);
                return c + e1 * c * c + e2 * (rankA[i] - rankB[j]) ** 2;
            }),
        ),
    );
}

/**
 * Pinned marchers keep a fixed spot; the rest are solved among the spots left. Here the pins are
 * the marchers already standing on a spot of the new form ("stay if you're already there").
 */
function withPins(A, B, solve) {
    const pinned = new Map();
    const usedSpots = new Set();
    A.forEach((a, i) => {
        const j = B.findIndex((b, k) => !usedSpots.has(k) && d2(a, b) < 1e-9);
        if (j !== -1) {
            pinned.set(i, j);
            usedSpots.add(j);
        }
    });
    const freeA = A.map((_, i) => i).filter((i) => !pinned.has(i));
    const freeB = B.map((_, j) => j).filter((j) => !usedSpots.has(j));
    const sub = solve(
        freeA.map((i) => A[i]),
        freeB.map((j) => B[j]),
        freeA,
        freeB,
    );
    const assign = new Array(A.length);
    for (const [i, j] of pinned) assign[i] = j;
    freeA.forEach((i, k) => (assign[i] = freeB[sub[k]]));
    return assign;
}

/** Hopcroft-Karp: is there a perfect matching using only pairs with d2 <= limit? */
function perfectWithin(D, limit) {
    const n = D.length;
    const adj = D.map((row) => {
        const out = [];
        for (let j = 0; j < n; j++) if (row[j] <= limit) out.push(j);
        return out;
    });
    const matchL = new Int32Array(n).fill(-1);
    const matchR = new Int32Array(n).fill(-1);
    const level = new Int32Array(n);
    let matched = 0;
    const bfs = () => {
        const q = [];
        let found = false;
        for (let i = 0; i < n; i++) {
            if (matchL[i] === -1) {
                level[i] = 0;
                q.push(i);
            } else level[i] = -1;
        }
        for (let h = 0; h < q.length; h++) {
            const i = q[h];
            for (const j of adj[i]) {
                const k = matchR[j];
                if (k === -1) found = true;
                else if (level[k] === -1) {
                    level[k] = level[i] + 1;
                    q.push(k);
                }
            }
        }
        return found;
    };
    const dfs = (i) => {
        for (const j of adj[i]) {
            const k = matchR[j];
            if (k === -1 || (level[k] === level[i] + 1 && dfs(k))) {
                matchL[i] = j;
                matchR[j] = i;
                return true;
            }
        }
        level[i] = -1;
        return false;
    };
    while (bfs())
        for (let i = 0; i < n; i++) if (matchL[i] === -1 && dfs(i)) matched++;
    return matched === n;
}

/**
 * Bottleneck, then least squared travel: the smallest possible longest move (binary search over
 * the distinct distances, a matching check each), then the least sum of squares among the
 * assignments that keep under it (Hungarian with the longer pairs priced out).
 */
function bottleneckThenSquared(A, B) {
    const D = costMatrix(A, B, d2);
    const values = [...new Set(D.flat())].sort((x, y) => x - y);
    let lo = 0;
    let hi = values.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (perfectWithin(D, values[mid] + 1e-9)) hi = mid;
        else lo = mid + 1;
    }
    const limit = values[lo] + 1e-9;
    const BIG = 1e12;
    return hungarian(
        D.map((row) => row.map((c) => (c <= limit ? c : BIG + c))),
    );
}

/** Least squared travel plus a pull toward the section's region of the new form. */
function sectionAware(A, B, sections, lambda = 1) {
    const box = (P) => {
        const xs = P.map((p) => p[0]);
        const ys = P.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        return [x0, y0, Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1];
    };
    const [ax, ay, aw, ah] = box(A);
    const [bx, by, bw, bh] = box(B);
    const anchor = new Map();
    for (const s of new Set(sections)) {
        const members = A.filter((_, i) => sections[i] === s);
        const cx = members.reduce((t, p) => t + p[0], 0) / members.length;
        const cy = members.reduce((t, p) => t + p[1], 0) / members.length;
        anchor.set(s, [bx + ((cx - ax) / aw) * bw, by + ((cy - ay) / ah) * bh]);
    }
    return hungarian(
        A.map((a, i) =>
            B.map((b) => d2(a, b) + lambda * d2(anchor.get(sections[i]), b)),
        ),
    );
}

// ---------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------

/** Segments ab and cd cross properly (not just touching at an end). */
function segmentsCross(a, b, c, d) {
    const o = (p, q, r) =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const o1 = o(a, b, c);
    const o2 = o(a, b, d);
    const o3 = o(c, d, a);
    const o4 = o(c, d, b);
    return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

/** Closest approach of two marchers moving in straight lines over the same counts. */
function closestApproach(a0, a1, b0, b1) {
    const rx = a0[0] - b0[0];
    const ry = a0[1] - b0[1];
    const vx = a1[0] - a0[0] - (b1[0] - b0[0]);
    const vy = a1[1] - a0[1] - (b1[1] - b0[1]);
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? -(rx * vx + ry * vy) / vv : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(rx + t * vx, ry + t * vy);
}

function kNearest(P, i, k) {
    return P.map((p, j) => [d2(P[i], p), j])
        .filter(([, j]) => j !== i)
        .sort((x, y) => x[0] - y[0] || x[1] - y[1])
        .slice(0, k)
        .map(([, j]) => j);
}

/** `collide` is the closest two marchers may pass, in steps (1 step: about shoulder to shoulder). */
function metrics(A, B, assign, counts, sections, collide = 1) {
    const n = A.length;
    const end = assign.map((j) => B[j]);
    const lens = A.map((a, i) => dist(a, end[i]));
    const maxLen = Math.max(...lens);
    const stride = maxLen / counts;
    let crossings = 0;
    let close = 0;
    let minSep = Infinity;
    for (let i = 0; i < n; i++)
        for (let k = i + 1; k < n; k++) {
            if (
                lens[i] > 1e-9 &&
                lens[k] > 1e-9 &&
                segmentsCross(A[i], end[i], A[k], end[k])
            )
                crossings++;
            const sep = closestApproach(A[i], end[i], A[k], end[k]);
            if (sep < minSep) minSep = sep;
            if (sep < collide - 1e-9) close++;
        }
    // Neighbors kept: of each marcher's 4 nearest neighbors before, how many are among its 4 after
    let kept = 0;
    for (let i = 0; i < n; i++) {
        const before = kNearest(A, i, 4);
        const after = new Set(kNearest(end, i, 4));
        kept += before.filter((j) => after.has(j)).length / before.length;
    }
    // Marchers that stood on some spot of the new form but were sent elsewhere
    let leftTheirSpot = 0;
    for (let i = 0; i < n; i++)
        if (B.some((b) => d2(A[i], b) < 1e-9) && lens[i] > 1e-9)
            leftTheirSpot++;
    let sameSection = null;
    if (sections) {
        let s = 0;
        for (let i = 0; i < n; i++)
            s +=
                kNearest(end, i, 4).filter((j) => sections[j] === sections[i])
                    .length / 4;
        sameSection = s / n;
    }
    return {
        maxStride: stride, // steps per count
        toFive: stride > 1e-9 ? 8 / stride : Infinity, // "X to 5": smaller is a bigger step
        over2: lens.filter((l) => l / counts > 2 + 1e-9).length, // past 4 to 5 (45 in, the app's warning)
        total: lens.reduce((t, l) => t + l, 0),
        sumSq: lens.reduce((t, l) => t + l * l, 0),
        crossings,
        close,
        minSep,
        neighborsKept: kept / n,
        leftTheirSpot,
        sameSection,
    };
}

// ---------------------------------------------------------------------------------------------
// Synthetic cases (spots listed in each shape's natural order; marchers in drill order)
// ---------------------------------------------------------------------------------------------
const line = (n, x0, y0, dx, dy) =>
    Array.from({ length: n }, (_, i) => [x0 + i * dx, y0 + i * dy]);
const block = (cols, rows, x0, y0, gap = 2) => {
    const out = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out.push([x0 + c * gap, y0 + r * gap]);
    return out;
};
const arc = (n, cx, cy, r, from, to) =>
    Array.from({ length: n }, (_, i) => {
        const t = from + ((to - from) * i) / (n - 1);
        return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    });
const circle = (n, cx, cy, r, phase = 0) =>
    Array.from({ length: n }, (_, i) => {
        const t = phase + (2 * Math.PI * i) / n;
        return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    });
const wedge = (rows, x0, y0, gap = 2) => {
    // rows of 1, 3, 5, ... marchers, point at the front
    const out = [];
    for (let r = 0; r < rows; r++) {
        const k = 2 * r + 1;
        for (let c = 0; c < k; c++)
            out.push([x0 + (c - r) * gap, y0 + r * gap]);
    }
    return out;
};

function cases() {
    const list = [];
    list.push({
        name: "line to arc (16, 16 counts)",
        A: line(16, 0, 0, 2, 0),
        B: arc(16, 15, 4, 14, Math.PI * 1.15, Math.PI * 1.85),
        counts: 16,
    });
    list.push({
        name: "line to arc, reversed numbering (16)",
        A: line(16, 0, 0, 2, 0).reverse(),
        B: arc(16, 15, 4, 14, Math.PI * 1.15, Math.PI * 1.85),
        counts: 16,
    });
    list.push({
        name: "line slides one interval (16, 8 counts)",
        A: line(16, 0, 0, 2, 0),
        B: line(16, 2, 0, 2, 0),
        counts: 8,
    });
    list.push({
        name: "block shifted 6 right 4 up (8x6, 8 counts)",
        A: block(8, 6, 0, 0),
        B: block(8, 6, 6, 4),
        counts: 8,
    });
    list.push({
        name: "block turned 90 degrees (8x6 to 6x8, 16 counts)",
        A: block(8, 6, 0, 0),
        B: block(6, 8, 2, -2),
        counts: 16,
    });
    list.push({
        name: "circle to line (24, 16 counts)",
        A: circle(24, 0, 0, 10),
        B: line(24, -23, 14, 2, 0),
        counts: 16,
    });
    list.push({
        name: "block to wedge (6x6 to 36, 16 counts)",
        A: block(6, 6, 0, 0),
        B: wedge(6, 5, 2),
        counts: 16,
    });
    list.push({
        name: "circle rotates half a spot (24, 8 counts, ties)",
        A: circle(24, 0, 0, 10),
        B: circle(24, 0, 0, 10, Math.PI / 24),
        counts: 8,
    });
    list.push({
        name: "line to perpendicular line through its middle (16, 16 counts, all tie)",
        A: line(16, -15, 0, 2, 0),
        B: line(16, 0, -15, 0, 2),
        counts: 16,
    });
    {
        // Half the band is already on its spot: the left 4 columns of an 8x4 block stay, the
        // right 4 columns' spots become a line in front
        const A = block(8, 4, 0, 0);
        const B = [...A.filter((p) => p[0] < 8), ...line(16, -8, -8, 2, 0)];
        list.push({
            name: "half already in place (32, 8 counts)",
            A,
            B,
            counts: 8,
            inPlace: true,
        });
    }
    {
        // 64 marchers: 4 sections side by side in a 16x4 block, to a circle of 64
        const A = block(16, 4, 0, 0);
        const sections = A.map((p) => Math.floor(p[0] / 8)); // 4 columns of 4 wide
        list.push({
            name: "mixed sections: 16x4 block to circle (64, 16 counts)",
            A,
            B: circle(64, 15, 3, 16),
            counts: 16,
            sections,
        });
    }
    {
        // Very short move: a 4x4 block spreads into a 4x4 at 4-step intervals in 2 counts
        list.push({
            name: "short move: 4x4 opens to 4-step intervals (16, 2 counts)",
            A: block(4, 4, 0, 0),
            B: block(4, 4, -3, -3, 4),
            counts: 2,
        });
    }
    return list;
}

const SOLVERS = {
    drill: (c) => keepOrder(c.A),
    greedy: (c) => greedy(c.A, c.B),
    sumDist: (c) => sumDistance(c.A, c.B),
    sumSq: (c) => sumSquared(c.A, c.B),
    bottleneck: (c) => bottleneckThenSquared(c.A, c.B),
    sumSqKeepTies: (c) => sumSquaredKeepTies(c.A, c.B),
    recommended: (c) => recommended(c.A, c.B),
    stayIfThere: (c) => withPins(c.A, c.B, recommended),
};

function time(fn) {
    const t0 = performance.now();
    const out = fn();
    return [out, performance.now() - t0];
}

function runCases() {
    const rows = [];
    for (const c of cases()) {
        const solvers = { ...SOLVERS };
        if (c.sections)
            solvers.section = (cc) => sectionAware(cc.A, cc.B, cc.sections, 1);
        for (const [name, solve] of Object.entries(solvers)) {
            const [assign, ms] = time(() => solve(c));
            rows.push({
                case: c.name,
                solver: name,
                ms,
                ...metrics(c.A, c.B, assign, c.counts, c.sections),
            });
        }
    }
    return rows;
}

/** Ties: shuffle the input order and count distinct answers (spot per marcher). */
function tieStudy() {
    const out = {};
    for (const prefix of ["circle rotates", "line to perpendicular"]) {
        const c = cases().find((x) => x.name.startsWith(prefix));
        const r = rng(7);
        const row = (out[prefix] = {});
        for (const [name, solve] of Object.entries({
            greedy,
            sumDist: sumDistance,
            sumSq: sumSquared,
            // ranks travel with the marchers, so shuffling the input can't change the answer
            sumSqKeepTies: (A, B, perm) => sumSquaredKeepTies(A, B, perm),
            recommended: (A, B, perm) => recommended(A, B, perm),
        })) {
            const answers = new Set();
            for (let trial = 0; trial < 30; trial++) {
                const perm = c.A.map((_, i) => i).sort(() => r() - 0.5);
                const A = perm.map((i) => c.A[i]);
                const assign = solve(A, c.B, perm);
                const byMarcher = new Array(A.length);
                perm.forEach((orig, k) => (byMarcher[orig] = assign[k]));
                answers.add(byMarcher.join(","));
            }
            row[name] = answers.size;
        }
    }
    return out;
}

/** Runtime at scale: random scatter to a block at 2-step intervals. */
function scaleStudy() {
    const out = [];
    for (const n of [100, 200, 400]) {
        const r = rng(n);
        // A scatter with at least 2 steps between marchers (the spacing CAPT's guarantee needs)
        const A = [];
        while (A.length < n) {
            const p = [r() * 100, r() * 53];
            if (A.every((q) => d2(p, q) >= 4)) A.push(p);
        }
        const cols = Math.ceil(Math.sqrt(n * 2));
        const B = block(cols, Math.ceil(n / cols), 20, 10).slice(0, n);
        const c = { A, B, counts: 32 };
        for (const [name, solve] of Object.entries(SOLVERS)) {
            if (name === "drill") continue;
            const [assign, ms] = time(() => solve(c));
            const m = metrics(A, B, assign, c.counts);
            out.push({
                n,
                solver: name,
                ms,
                maxStride: m.maxStride,
                total: m.total,
                crossings: m.crossings,
                close: m.close,
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
const fmt = (x, d = 2) =>
    x === Infinity ? "-" : x === null ? "" : Number(x).toFixed(d);
const results = { cases: runCases(), ties: tieStudy(), scale: scaleStudy() };
if (process.argv.includes("--json"))
    console.log(JSON.stringify(results, null, 2));
else {
    console.log(
        "| Case | Order | Longest stride (steps/count) | As X to 5 | Over 4 to 5 | Total travel (steps) | Sum of squares | Crossing paths | Pairs passing < 1 step | Closest pass | 4 neighbors kept | Same-section neighbors | Left own spot | ms |",
    );
    console.log(
        "| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
    );
    for (const r of results.cases)
        console.log(
            `| ${r.case} | ${r.solver} | ${fmt(r.maxStride)} | ${fmt(r.toFive, 1)} | ${r.over2} | ${fmt(r.total, 0)} | ${fmt(r.sumSq, 0)} | ${r.crossings} | ${r.close} | ${fmt(r.minSep)} | ${fmt(r.neighborsKept * 100, 0)}% | ${r.sameSection === null ? "" : fmt(r.sameSection * 100, 0) + "%"} | ${r.leftTheirSpot} | ${fmt(r.ms, 1)} |`,
        );
    console.log(
        "\nDistinct answers over 30 shuffles of the input order:",
        JSON.stringify(results.ties),
    );
    console.log(
        "\n| n | Order | ms | Longest stride | Total travel | Crossing paths | Pairs passing < 1 step |",
    );
    console.log("| --: | --- | --: | --: | --: | --: | --: |");
    for (const r of results.scale)
        console.log(
            `| ${r.n} | ${r.solver} | ${fmt(r.ms, 0)} | ${fmt(r.maxStride)} | ${fmt(r.total, 0)} | ${r.crossings} | ${r.close} |`,
        );
}
