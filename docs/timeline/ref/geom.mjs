// Shared, stateless helpers used by both the oracle and the cached resolver.
// Implements spec R-2 (flattening), R-8 (arc), R-13 (sampling / exact destination paths) and §8.10.
// No curve is ever flattened: circles are evaluated from their exact parameterization.

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Smallest meaningful distance (§8.10): a chord shorter than this is treated as a straight line. */
export const EPS_GEOM = 1e-9;
/** Endpoint-exact interpolation (§8.10): t <= 0 returns a, t >= 1 returns b, bit for bit. */
export const lerp = (a, b, t) => (t <= 0 ? a : t >= 1 ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const cumOf = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; };

/** Point at arc length d along a polyline. Zero-length segments are never selected (§8.10). O(log P). */
export function pointAtDist(pts, cum, d) {
  if (d <= 0) return pts[0];
  const L = cum[cum.length - 1];
  if (d >= L) return pts[pts.length - 1];
  let lo = 1, hi = cum.length - 1;               // first i with cum[i] >= d, so cum[i-1] < d
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= d) hi = mid; else lo = mid + 1; }
  return lerp(pts[lo - 1], pts[lo], (d - cum[lo - 1]) / (cum[lo] - cum[lo - 1]));
}

/**
 * R-13: the exact destination path of a path-kind shape: { closed, L, at(s) } with s in [0, L] (clamped).
 * Polylines (line, freehand, box) are exact already; a circle is evaluated from its angle.
 */
export function destPath(shape) {
  const g = shape.geometry;
  if (shape.kind === 'circle') {
    const L = 2 * Math.PI * g.radius, dir = g.clockwise ? -1 : 1;
    return { closed: true, L, at(s) {
      const a = g.start_angle + dir * (Math.max(0, Math.min(L, s)) / g.radius);
      return [g.center[0] + g.radius * Math.cos(a), g.center[1] + g.radius * Math.sin(a)];
    } };
  }
  let pts;
  if (shape.kind === 'line' || shape.kind === 'freehand') pts = g.points;
  else if (shape.kind === 'box') { const [x, y] = g.origin; pts = [[x, y], [x + g.width, y], [x + g.width, y + g.height], [x, y + g.height], [x, y]]; }
  else throw new Error(`${shape.kind} is not a path kind`);
  const cum = cumOf(pts);
  return { closed: shape.kind === 'box', L: cum[cum.length - 1], at: (s) => pointAtDist(pts, cum, s) };
}
export const paramT = (closed, i, n) => (closed ? i / n : (n === 1 ? 0 : i / (n - 1)));

/** R-13: a transition's slot destinations, from its shape or from individually placed points (D-16). */
export function destinationsOf(t, shapes) {
  if (t.dest == null) return t.points.slice(0, t.slots).map((p) => [p[0], p[1]]);
  return sampleDestinations(shapes[t.dest], t.slots);
}

/** R-13 slot destinations sampled from a shape. */
export function sampleDestinations(shape, n) {
  if (shape.kind === 'block') { const g = shape.geometry; return Array.from({ length: n }, (_, i) => [g.origin[0] + (i % g.cols) * g.spacing[0], g.origin[1] + Math.floor(i / g.cols) * g.spacing[1]]); }
  const P = destPath(shape);
  return Array.from({ length: n }, (_, i) => P.at(paramT(P.closed, i, n) * P.L));
}

/**
 * R-8: circular MINOR arc from A to B with signed bulge k = sagitta / chord, |k| <= 1/2, at constant angular speed.
 * Numerically stable: everything is expressed relative to the chord (no far-away centre, no radius
 * subtraction, no division by the chord), endpoints are returned exactly, and finite inputs give finite outputs.
 */
export function arcPoint(A, B, k, p) {
  if (p <= 0) return A;
  if (p >= 1) return B;
  const dx = B[0] - A[0], dy = B[1] - A[1], c = Math.hypot(dx, dy);
  if (c < EPS_GEOM) return lerp(A, B, p);                 // below the geometric scale: straight line
  const h = c / 2, phi = 2 * Math.atan(2 * k);               // signed half-angle at the centre; = 2·atan(k·c/h) without dividing by h
  if (Math.abs(phi) < 1e-12) return lerp(A, B, p);
  const sinPhi = Math.sin(phi);
  const along = (h * Math.sin(phi * (2 * p - 1))) / sinPhi;                      // from chord midpoint, toward B
  const normal = (2 * h * Math.sin(phi * p) * Math.sin(phi * (1 - p))) / sinPhi;  // toward the +90° side for k > 0
  const ux = dx / c, uy = dy / c;
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
  return [mx + ux * along - uy * normal, my + uy * along + ux * normal];
}

/** R-2: rows (one marcher) -> spans partitioning (-inf, +inf). Each span: {row|null, start, end}. */
export function flatten(rows) {
  const cuts = [...new Set(rows.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const raw = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    let win = null;
    for (const r of rows) if (r.start <= s && r.end >= e && (!win || r.layer > win.layer)) win = r;
    raw.push({ row: win, start: s, end: e });
  }
  const all = [{ row: null, start: -Infinity, end: raw.length ? raw[0].start : Infinity }, ...raw];
  if (raw.length) all.push({ row: null, start: raw[raw.length - 1].end, end: Infinity });
  const out = [];
  for (const sp of all) {
    const last = out[out.length - 1];
    if (last && (last.row?.id ?? null) === (sp.row?.id ?? null) && last.end === sp.start) { last.end = sp.end; continue; }
    out.push({ ...sp });
  }
  return out;
}

/**
 * R-9 steps 3-4: an FTL trail = polyline through member origins and waypoints to the destination's
 * start, followed by the EXACT destination path. Returns { destOffset, at(d) }.
 */
export function makeTrail(origins, waypoints, path) {
  const pre = [...origins, ...waypoints, path.at(0)];
  const cum = cumOf(pre), destOffset = cum[cum.length - 1];
  return { cum, destOffset, at: (d) => (d < destOffset ? pointAtDist(pre, cum, d) : path.at(d - destOffset)) };
}

/**
 * R-14 (v0.9 steps 1 and 2): the walked path of a founding route span, from A through the route's inner points to B.
 * Written independently of the app's geometry (linear scans, its own Catmull–Rom and Bézier code), so the two
 * check each other. `pts` are the route's points ({at, tension?}); `F`, `G` its from and to (tangent neighbours).
 */
export function routeWalk(A, pts, B, F = A, G = B) {
  const V = [A], tau = [0], src = [-1];
  pts.forEach((q, i) => { if (dist(V[V.length - 1], q.at) >= EPS_GEOM) { V.push(q.at); tau.push(q.tension > 0 ? q.tension : 0); src.push(i); } });
  while (V.length > 1 && dist(V[V.length - 1], B) < EPS_GEOM) { V.pop(); tau.pop(); src.pop(); }
  V.push(B); tau.push(0); src.push(-1);
  const m = V.length - 2;
  // Tangent neighbours from the route alone: N = [F, P'..., G]; rep[i] is P_i's representative's index in N
  const N = [F], rep = [];
  pts.forEach((q, i) => { if (i === 0 || dist(N[N.length - 1], q.at) >= EPS_GEOM) N.push(q.at); rep.push(N.length - 1); });
  N.push(G);
  const handle = (k) => {
    if (!(tau[k] > 0)) return null;
    const q = V[k], a = N[rep[src[k]] - 1], c = N[rep[src[k]] + 1], t = tau[k];
    let dax = a[0] - q[0], day = a[1] - q[1], dcx = c[0] - q[0], dcy = c[1] - q[1];
    let ra = Math.hypot(dax, day), rc = Math.hypot(dcx, dcy);
    if (ra < EPS_GEOM && rc < EPS_GEOM) return { out: q, in: q };
    if (ra < EPS_GEOM) { dax = -dcx; day = -dcy; ra = rc; } else if (rc < EPS_GEOM) { dcx = -dax; dcy = -day; rc = ra; }
    const d1 = Math.sqrt(ra), d2 = Math.sqrt(rc), wo = 3 * d1 * (d1 + d2), wi = 3 * d2 * (d1 + d2);
    return { out: [q[0] + (t * (ra * dcx - rc * dax)) / wo, q[1] + (t * (ra * dcy - rc * day)) / wo],
             in: [q[0] + (t * (rc * dax - ra * dcx)) / wi, q[1] + (t * (rc * day - ra * dcy)) / wi] };
  };
  const K = 64;
  const bez = (P0, c1, c2, P3, t) => { const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    return [k0 * P0[0] + k1 * c1[0] + k2 * c2[0] + k3 * P3[0], k0 * P0[1] + k1 * c1[1] + k2 * c2[1] + k3 * P3[1]]; };
  const pieces = [], D = [0];
  for (let j = 0; j <= m; j++) {
    const P0 = V[j], P3 = V[j + 1], h0 = handle(j), h3 = handle(j + 1);
    if (!h0 && !h3) { pieces.push(null); D.push(D[j] + Math.hypot(P3[0] - P0[0], P3[1] - P0[1])); continue; }
    const c1 = j === 0 ? [P0[0] + (P3[0] - P0[0]) / 3, P0[1] + (P3[1] - P0[1]) / 3] : h0 ? h0.out : P0;
    const c2 = j === m ? [P3[0] + (P0[0] - P3[0]) / 3, P3[1] + (P0[1] - P3[1]) / 3] : h3 ? h3.in : P3;
    const e = [0];
    for (let i = 1; i <= K; i++) { const a = bez(P0, c1, c2, P3, (i - 1) / K), b = bez(P0, c1, c2, P3, i / K); e.push(e[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    pieces.push({ c1, c2, e });
    D.push(D[j] + e[K]);
  }
  const L = D[D.length - 1];
  return {
    V, D, L, pieces, tau,
    at(p) {
      if (p <= 0) return A;
      if (p >= 1) return B;
      if (V.length === 2 || L < EPS_GEOM) return lerp(A, B, p);   // [A, B] is R-7, bit for bit (QA-RT-2)
      const d = p * L;
      let j = 0;
      while (j < V.length - 2 && !(d < D[j + 1])) j++;
      const x = d - D[j], pc = pieces[j];
      if (!pc) return lerp(V[j], V[j + 1], x / (D[j + 1] - D[j]));
      let i = 1;
      while (i <= K && !(x < pc.e[i])) i++;
      if (i > K) return V[j + 1];
      return bez(V[j], pc.c1, pc.c2, V[j + 1], (i - 1 + (x - pc.e[i - 1]) / (pc.e[i] - pc.e[i - 1])) / K);
    },
  };
}

/**
 * R-14 group schedule (v0.9 step 15): a group path member's walk. `W` is the reference walk from F to G (routeWalk,
 * this file's own code); every member passes its placed copy of W's first and last kept inner points at the moments
 * W reaches them at its steady speed (uFirst, uLast), walks W placed by its offset between them, and walks its own
 * first leg (A onto W_1 + o) and last leg (W_m + o to B) at steady speed each. Written from the spec, not the app.
 */
export function groupWalk(A, pts, B, F, G, o) {
  const W = routeWalk(F, pts, G, F, G), m = W.V.length - 2;
  const add = (q) => [q[0] + o[0], q[1] + o[1]];
  if (m < 1) return { W, uFirst: NaN, uLast: NaN, first: null, last: null, at: (p) => (p <= 0 ? A : p >= 1 ? B : lerp(A, B, p)) };
  const uFirst = W.D[1] / W.L, uLast = W.D[m] / W.L;
  const K = 64;
  const bez = (P0, c1, c2, P3, t) => { const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    return [k0 * P0[0] + k1 * c1[0] + k2 * c2[0] + k3 * P3[0], k0 * P0[1] + k1 * c1[1] + k2 * c2[1] + k3 * P3[1]]; };
  // A leg: a line, or a cubic measured on K samples as R-14's Length
  const leg = (S, E, c1, c2) => {
    if (!c1) return { S, E, len: Math.hypot(E[0] - S[0], E[1] - S[1]), at: (f) => lerp(S, E, f) };
    const e = [0];
    for (let i = 1; i <= K; i++) { const a = bez(S, c1, c2, E, (i - 1) / K), b = i === K ? E : bez(S, c1, c2, E, i / K); e.push(e[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const len = e[K];
    return { S, E, len, at(f) {
      if (len < EPS_GEOM) return lerp(S, E, f);
      const x = f * len;
      let i = 1;
      while (i <= K && !(x < e[i])) i++;
      if (i > K) return E;
      return bez(S, c1, c2, E, (i - 1 + (x - e[i - 1]) / (e[i] - e[i - 1])) / K);
    } };
  };
  const W1 = add(W.V[1]), Wm = add(W.V[m]);
  const p0 = W.pieces[0], pm = W.pieces[m];
  // The piece next to W_1 (W_m) is a cubic exactly when some end of it is smooth; the leg reads W_1's own handle
  // only when W_1 itself is smooth (its `in`, the reference piece's second control), else it is a line (a corner).
  // A leg whose ends are within EPS_GEOM is a line, so a member standing on its point doesn't loop out to a handle
  const near = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < EPS_GEOM;
  const smooth1 = W.tau[1] > 0 && !near(A, W1), smoothM = W.tau[m] > 0 && !near(Wm, B);
  const first = smooth1 ? leg(A, W1, [A[0] + (W1[0] - A[0]) / 3, A[1] + (W1[1] - A[1]) / 3], add(p0.c2)) : leg(A, W1, null, null);
  const last = smoothM ? leg(Wm, B, add(pm.c1), [B[0] + (Wm[0] - B[0]) / 3, B[1] + (Wm[1] - B[1]) / 3]) : leg(Wm, B, null, null);
  return {
    W, uFirst, uLast, first, last,
    at(p) {
      if (p <= 0) return A;
      if (p >= 1) return B;
      if (p < uFirst) return first.at(p / uFirst);
      if (p <= uLast) return add(W.at(p));
      return last.at((p - uLast) / (1 - uLast));
    },
  };
}
