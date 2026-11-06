import {
    BufferGeometry,
    Float32BufferAttribute,
    ShapeUtils,
    Vector2,
    Vector3,
} from "three";
import type { SeatRow } from "../../types";
import {
    LOWER,
    profileAt,
    SUITE_H,
    tangentOf,
    type Profile,
    type SegKind,
    type Station,
} from "./bowl";

/** One merged mesh per material. */
export type SweepGroup =
    | "concrete"
    | "wall"
    | "glass"
    | "fascia"
    | "facade"
    | "seatHome"
    | "seatAway"
    | "seatEnd"
    | "seatBand";

export const SWEEP_GROUPS: SweepGroup[] = [
    "concrete",
    "wall",
    "glass",
    "fascia",
    "facade",
    "seatHome",
    "seatAway",
    "seatEnd",
    "seatBand",
];

/** Texture tile sizes in meters; the sweep writes UVs in these units. */
export const TILE = {
    concrete: 6,
    wall: 12,
    seat: 12,
    glass: 16,
    glassH: SUITE_H,
    fascia: 35,
    facade: 14,
    facadeH: 9,
};

export interface Sweep {
    geometries: Record<SweepGroup, BufferGeometry>;
    seatRows: SeatRow[];
    /** The cross-section at full suite weight (the home straight). */
    home: Profile;
    /** The cross-section with no suites (the ends and the away side). */
    plain: Profile;
}

class Buffers {
    pos: number[] = [];
    nor: number[] = [];
    uv: number[] = [];

    /**
     * Adds one quad (corners in order around it) facing `want`. Normals are
     * flat. Skips collapsed quads.
     */
    quad(
        c: [Vector3, Vector3, Vector3, Vector3],
        t: [number, number][],
        want: Vector3,
    ) {
        this.tri(c[0], c[1], c[2], t[0], t[1], t[2], want);
        this.tri(c[0], c[2], c[3], t[0], t[2], t[3], want);
    }

    tri(
        a: Vector3,
        b: Vector3,
        c: Vector3,
        ta: [number, number],
        tb: [number, number],
        tc: [number, number],
        want: Vector3,
    ) {
        const n = new Vector3()
            .subVectors(b, a)
            .cross(new Vector3().subVectors(c, a));
        if (n.lengthSq() < 1e-14) return;
        n.normalize();
        let flip = false;
        if (n.dot(want) < 0) {
            n.negate();
            flip = true;
        }
        const order = flip ? [a, c, b] : [a, b, c];
        const tex = flip ? [ta, tc, tb] : [ta, tb, tc];
        for (let i = 0; i < 3; i++) {
            this.pos.push(order[i].x, order[i].y, order[i].z);
            this.nor.push(n.x, n.y, n.z);
            this.uv.push(tex[i][0], tex[i][1]);
        }
    }

    geometry(): BufferGeometry {
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
        g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
        g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        return g;
    }
}

const seatGroup = (side: Station["side"]): SweepGroup =>
    side === "home" ? "seatHome" : side === "away" ? "seatAway" : "seatEnd";

/** Lower-bowl rows reserved for the band, on the straight of the +x end. */
const BAND_ROWS: [number, number] = [2, 13];

/**
 * Sweeps the cross-section along the stations into merged geometries and
 * collects the seat rows. The profile of every station has the same nodes, so
 * node k of one station joins node k of the next.
 */
export function sweepBowl(stations: Station[]): Sweep {
    const profiles = stations.map((s) => profileAt(s.w));
    const nodeCount = profiles[0].nodes.length;
    const bufs = Object.fromEntries(
        SWEEP_GROUPS.map((g) => [g, new Buffers()]),
    ) as Record<SweepGroup, Buffers>;

    const at = (s: number, k: number): Vector3 => {
        const st = stations[s];
        const nd = profiles[s].nodes[k];
        return new Vector3(st.x + st.nx * nd.off, nd.h, st.z + st.nz * nd.off);
    };

    // Distance along each node's own curve, so textures keep their scale on
    // the long outer arcs.
    const along: number[][] = [];
    for (let k = 0; k < nodeCount; k++) {
        const col = [0];
        for (let s = 1; s < stations.length; s++) {
            const a = at(s - 1, k);
            const b = at(s, k);
            col.push(col[s - 1] + Math.hypot(b.x - a.x, b.z - a.z));
        }
        along.push(col);
    }

    for (let s = 0; s + 1 < stations.length; s++) {
        const st0 = stations[s];
        const st1 = stations[s + 1];
        const side = st0.side === st1.side ? st0.side : "end";
        const straightEnd = Math.abs(st0.nz) < 0.02 && Math.abs(st1.nz) < 0.02;
        const nx = (st0.nx + st1.nx) / 2;
        const nz = (st0.nz + st1.nz) / 2;
        const outward = new Vector3(nx, 0, nz).normalize();
        const inward = outward.clone().negate();
        const up = new Vector3(0, 1, 0);
        for (let k = 0; k + 1 < nodeCount; k++) {
            const p0 = profiles[s].nodes[k];
            const p1 = profiles[s].nodes[k + 1];
            const q0 = profiles[s + 1].nodes[k];
            const q1 = profiles[s + 1].nodes[k + 1];
            const kind: SegKind = p0.seg;
            const corners: [Vector3, Vector3, Vector3, Vector3] = [
                at(s, k),
                at(s, k + 1),
                at(s + 1, k + 1),
                at(s + 1, k),
            ];
            const horizontal =
                Math.abs(p1.h - p0.h) < 1e-6 && Math.abs(q1.h - q0.h) < 1e-6;
            let group: SweepGroup;
            let want: Vector3;
            let uv: [number, number][];
            if (kind === "seat") {
                const isBand =
                    side === "end" &&
                    straightEnd &&
                    st0.nx > 0.9 &&
                    isBandRow(profiles[0], k);
                group = isBand ? "seatBand" : seatGroup(side);
                want = up;
                // v runs across the tread, front (0) to back (1); u uses each
                // node's own length along its curve.
                uv = [
                    [along[k][s] / TILE.seat, 0],
                    [along[k + 1][s] / TILE.seat, 1],
                    [along[k + 1][s + 1] / TILE.seat, 1],
                    [along[k][s + 1] / TILE.seat, 0],
                ];
            } else {
                const dh = p1.h - p0.h;
                want = horizontal ? up : dh < 0 ? outward : inward;
                // Text on a surface that faces the field reads right to left
                // along the path, so mirror U there.
                const sign = kind === "concrete" || want === outward ? 1 : -1;
                const ua = (kk: number, ss: number) => sign * along[kk][ss];
                const mk = (
                    tileU: number,
                    vOf: (node: typeof p0, other: typeof p0) => number,
                ): [number, number][] => [
                    [ua(k, s) / tileU, vOf(p0, p1)],
                    [ua(k + 1, s) / tileU, vOf(p1, p0)],
                    [ua(k + 1, s + 1) / tileU, vOf(q1, q0)],
                    [ua(k, s + 1) / tileU, vOf(q0, q1)],
                ];
                switch (kind) {
                    case "wall":
                        group = "wall";
                        uv = mk(TILE.wall, (n) => n.h / 1.4);
                        break;
                    case "glass":
                        group = "glass";
                        uv = mk(
                            TILE.glass,
                            (n) => (n.h - profiles[s].concourseH) / TILE.glassH,
                        );
                        break;
                    case "fascia":
                        group = "fascia";
                        uv = mk(TILE.fascia, (n, o) => (n.h < o.h ? 0 : 1));
                        break;
                    case "facade":
                        group = "facade";
                        uv = mk(TILE.facade, (n) => n.h / TILE.facadeH);
                        break;
                    default:
                        group = "concrete";
                        uv = mk(TILE.concrete, (n) =>
                            horizontal
                                ? n.off / TILE.concrete
                                : n.h / TILE.concrete,
                        );
                }
            }
            bufs[group].quad(corners, uv, want);
        }
    }

    // Cut faces where the horseshoe stops.
    const cap = (s: number, facing: 1 | -1) => {
        const st = stations[s];
        const [tx, tz] = tangentOf(st);
        const want = new Vector3(tx * facing, 0, tz * facing);
        const raw = profiles[s].nodes;
        const pts: { off: number; h: number }[] = [];
        for (const n of raw) {
            const last = pts[pts.length - 1];
            if (!last || Math.hypot(last.off - n.off, last.h - n.h) > 1e-6) {
                pts.push({ off: n.off, h: n.h });
            }
        }
        const contour = pts.map((p) => new Vector2(p.off, p.h));
        const tris = ShapeUtils.triangulateShape(contour, []);
        const v = (i: number) =>
            new Vector3(
                st.x + st.nx * pts[i].off,
                pts[i].h,
                st.z + st.nz * pts[i].off,
            );
        const t = (i: number): [number, number] => [
            pts[i].off / TILE.concrete,
            pts[i].h / TILE.concrete,
        ];
        for (const [a, b, c] of tris) {
            bufs.concrete.tri(v(a), v(b), v(c), t(a), t(b), t(c), want);
        }
    };
    cap(0, -1);
    cap(stations.length - 1, 1);

    const geometries = Object.fromEntries(
        SWEEP_GROUPS.map((g) => [g, bufs[g].geometry()]),
    ) as Record<SweepGroup, BufferGeometry>;

    // Seat rows: polylines at seat height, split where the side changes.
    const seatRows: SeatRow[] = [];
    for (const ref of profiles[0].seats) {
        let run: [number, number, number][] = [];
        let runSide: Station["side"] | null = null;
        const flush = () => {
            if (run.length >= 2 && runSide) {
                seatRows.push({
                    points: run,
                    closed: false,
                    depth: ref.depth,
                    side:
                        runSide === "home"
                            ? "home"
                            : runSide === "away"
                              ? "away"
                              : "neutral",
                });
            }
        };
        for (let s = 0; s < stations.length; s++) {
            const st = stations[s];
            const a = profiles[s].nodes[ref.node];
            const b = profiles[s].nodes[ref.node + 1];
            const off = (a.off + b.off) / 2;
            const p: [number, number, number] = [
                st.x + st.nx * off,
                a.h,
                st.z + st.nz * off,
            ];
            if (runSide !== st.side) {
                if (runSide) {
                    // share the boundary point so the rows join
                    run.push(p);
                    flush();
                    run = [];
                }
                runSide = st.side;
            }
            run.push(p);
        }
        flush();
    }

    return {
        geometries,
        seatRows,
        home: profileAt(1),
        plain: profileAt(0),
    };
}

/** True when node k is the seat node of a band row. */
function isBandRow(profile: Profile, k: number): boolean {
    const ref = profile.seats.find((r) => r.node === k);
    return (
        !!ref &&
        ref.tier === 0 &&
        ref.row >= BAND_ROWS[0] &&
        ref.row <= BAND_ROWS[1] &&
        ref.row < LOWER.rows
    );
}
