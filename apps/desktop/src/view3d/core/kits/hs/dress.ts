// cspell:ignore metalness
import {
    BufferGeometry,
    CylinderGeometry,
    Color,
    DoubleSide,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Shape,
    ShapeGeometry,
    Vector2,
    Vector3,
    type CanvasTexture,
    type Object3D,
} from "three";
import { createRng, ft } from "../../environment";
import type { VenueParams } from "../../types";
import {
    GROUND_SIZE,
    stadiumPoints,
    type DressContext,
    type KitDress,
    type StandStyle,
} from "../stands";
import { BoxBatch, merge, resample, texturedBox, wallStrip } from "./parts";
import {
    ASPHALT_TILE,
    asphaltTexture,
    chainLinkTexture,
    facadeTexture,
    GRASS_TILE,
    grassTexture,
    ironFenceTexture,
    parkingTexture,
    parseColor,
    scoreboardTexture,
    shade,
    signTexture,
    trackTexture,
    TRACK_TILE,
} from "./textures";

/**
 * Everything around the stands for the high school kits: textured grass,
 * asphalt and track, the track fence and curb, goal posts, scoreboard,
 * conductor's tower, a school building, parking lot, concession stand and a
 * ring of trees. `hs` is the small-town Friday night; `bighs` is the bigger
 * program: iron fence with brick pillars, a three-story field house on the
 * plaza and flags.
 */

export type DressVariant = "hs" | "bighs";

const TRACK_INNER_GAP = ft(15);
const TRACK_WIDTH = ft(30);

/** Team colors and lettering shared by the stands and the scenery. */
export function teamStyle(
    params: VenueParams,
    kind: StandStyle["kind"],
): { home: StandStyle; away: StandStyle } {
    const home = parseColor(params.homeColor, 0x6442ff);
    const away = parseColor(params.awayColor, 0xc23b3b);
    const text = params.endZoneText.trim().toUpperCase();
    return {
        home: { kind, teamColor: home, label: text || "HOME" },
        away: { kind, teamColor: away, label: "VISITORS" },
    };
}

/** A copy of `tex` that tiles `rx` x `ry` times; `tex` is released. */
function repeated(tex: CanvasTexture, rx: number, ry: number): CanvasTexture {
    const t = tex.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    tex.dispose();
    return t;
}

interface Zone {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

export function buildDress(variant: DressVariant) {
    return (ctx: DressContext): KitDress => {
        const { frame: f, shared, cfg, input } = ctx;
        const big = variant === "bighs";
        const shadows = input.quality === "high";
        const teams = teamStyle(input.params, big ? "concrete" : "aluminum");
        const objects: Object3D[] = [];
        const disposables: { dispose(): void }[] = [];
        const keepOut: Zone[] = [];
        const lampMats: MeshStandardMaterial[] = [];
        const ledMats: MeshStandardMaterial[] = [];
        const unit = shared.unitBox;
        const solid = shared.std(0xffffff, { roughness: 0.75 });

        const add = (o: Object3D | null, name?: string) => {
            if (!o) return;
            if (name) o.name = name;
            objects.push(o);
        };
        const mesh = (
            geo: BufferGeometry,
            mat: MeshStandardMaterial,
            name: string,
            shadow = false,
        ) => {
            const m = new Mesh(geo, mat);
            m.name = name;
            m.castShadow = shadow && shadows;
            m.receiveShadow = true;
            disposables.push(geo);
            add(m);
            return m;
        };

        // --- Surfaces ---------------------------------------------------
        const groundTex = big
            ? repeated(
                  asphaltTexture(0x54565b),
                  GROUND_SIZE / ASPHALT_TILE,
                  GROUND_SIZE / ASPHALT_TILE,
              )
            : repeated(
                  grassTexture(0x4a6b35),
                  GROUND_SIZE / GRASS_TILE,
                  GROUND_SIZE / GRASS_TILE,
              );
        const sizeTex = (
            tex: CanvasTexture,
            w: number,
            d: number,
            tile: number,
        ) => repeated(tex, w / tile, d / tile);
        const aprW = f.halfW * 2 + ft(40);
        const aprD = f.halfD * 2 + ft(40);
        const surfaces: KitDress["surfaces"] = {
            ground: shared.std(0xffffff, { map: groundTex, roughness: 1 }),
            apron: shared.std(0xffffff, {
                map: sizeTex(
                    grassTexture(0x3a7330, 17),
                    aprW,
                    aprD,
                    GRASS_TILE,
                ),
                roughness: 1,
            }),
            track: shared.std(0xffffff, {
                map: (() => {
                    // ShapeGeometry UVs are world meters.
                    const t = trackTexture();
                    t.repeat.set(1 / TRACK_TILE, 1 / TRACK_TILE);
                    return t;
                })(),
                roughness: 0.92,
            }),
        };
        if (cfg.infield) {
            const w = f.halfW * 2 + cfg.infield.extraW;
            const d = f.halfD * 2 + cfg.infield.extraD;
            surfaces.infield = shared.std(0xffffff, {
                map: sizeTex(grassTexture(0x3d6e31, 29), w, d, GRASS_TILE),
                roughness: 1,
            });
        }
        if (cfg.plaza) {
            surfaces.plaza = shared.std(0xffffff, {
                map: sizeTex(
                    asphaltTexture(0x8a8c90, 13),
                    cfg.plaza.w,
                    cfg.plaza.d,
                    ASPHALT_TILE,
                ),
                roughness: 1,
            });
        }

        // --- Track curb and fence ----------------------------------------
        const straight = Math.max(f.halfW - ft(30), ft(30));
        const inner = f.halfD + TRACK_INNER_GAP;
        const outer = inner + TRACK_WIDTH;
        const flip = (pts: Vector2[]) => pts.map((p) => new Vector2(p.x, -p.y));
        const ring = (rIn: number, rOut: number) => {
            const shape = new Shape(
                flip(stadiumPoints(f.cx, f.cz, straight, rOut, 64)),
            );
            shape.holes.push(
                new Shape(
                    flip(
                        stadiumPoints(f.cx, f.cz, straight, rIn, 64),
                    ).reverse(),
                ),
            );
            return new ShapeGeometry(shape);
        };
        const curb = mesh(
            ring(inner - 0.28, inner),
            shared.std(0xe9e6dc, { roughness: 0.8 }),
            "trackCurb",
        );
        curb.rotation.x = -Math.PI / 2;
        curb.position.y = 0.03;

        const fenceR = outer + 0.9;
        const fenceH = big ? 2.0 : 1.25;
        const fencePath = stadiumPoints(f.cx, f.cz, straight, fenceR, 64);
        const fenceTex = big ? ironFenceTexture() : chainLinkTexture();
        const fence = mesh(
            wallStrip(
                fencePath,
                0,
                fenceH,
                big ? 1.2 : 0.6,
                big ? 1 : fenceH / 0.6,
            ),
            shared.std(0xffffff, {
                map: fenceTex,
                alphaTest: 0.5,
                side: DoubleSide,
                roughness: 0.6,
                metalness: 0.3,
            }),
            "trackFence",
        );
        fence.receiveShadow = false;
        const posts = new BoxBatch(unit);
        const postColor = big ? 0x1d1f24 : 0x8d939b;
        for (const p of resample(fencePath, big ? 6 : 3)) {
            posts.add(
                p.x,
                fenceH / 2,
                p.z,
                0.08,
                fenceH + 0.1,
                0.08,
                postColor,
            );
        }
        add(posts.build(solid, "fencePosts", shadows));
        const topRail = mesh(
            wallStrip(fencePath, fenceH - 0.04, 0.06, 4),
            shared.std(postColor, { roughness: 0.6, side: DoubleSide }),
            "fenceRail",
        );
        topRail.receiveShadow = false;
        if (big) {
            // Brick pillars every 12 m, capped with stone.
            const pillar = new BoxBatch(unit);
            for (const p of resample(fencePath, 12)) {
                pillar.add(p.x, 1.2, p.z, 0.55, 2.4, 0.55, 0x8a4a3a);
                pillar.add(p.x, 2.45, p.z, 0.7, 0.12, 0.7, 0xcfcac0);
            }
            add(pillar.build(solid, "fencePillars", shadows));
        }

        // --- Goal posts ---------------------------------------------------
        if (f.halfW > 40) {
            const yellow = shared.std(0xf2c230, {
                roughness: 0.4,
                metalness: 0.4,
            });
            const goal = (x: number, dir: 1 | -1) => {
                const parts = [
                    new CylinderGeometry(0.09, 0.09, 3.05, 8).translate(
                        0,
                        1.52,
                        0,
                    ),
                    new CylinderGeometry(0.07, 0.07, 5.64, 8)
                        .rotateX(Math.PI / 2)
                        .translate(0, 3.05, 0),
                    new CylinderGeometry(0.05, 0.05, 6.1, 6).translate(
                        0,
                        6.1,
                        -2.82,
                    ),
                    new CylinderGeometry(0.05, 0.05, 6.1, 6).translate(
                        0,
                        6.1,
                        2.82,
                    ),
                ];
                const g = merge(parts);
                g.translate(x + dir * 0.4, 0, f.cz);
                return g;
            };
            const goals = merge([goal(f.maxX, 1), goal(f.minX, -1)]);
            mesh(goals, yellow, "goalPosts", true);
        }

        // --- Conductor's tower ---------------------------------------------
        const tower = new BoxBatch(unit);
        const px = f.cx;
        const pz = f.maxZ + ft(26);
        const ph = ft(8);
        const metal = 0x8a8f98;
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                tower.add(
                    px + sx * 0.82,
                    ph / 2,
                    pz + sz * 0.82,
                    0.1,
                    ph,
                    0.1,
                    metal,
                );
                tower.add(
                    px + sx * 0.82,
                    ph + 0.55,
                    pz + sz * 0.82,
                    0.05,
                    1.1,
                    0.05,
                    metal,
                );
            }
        }
        tower.add(px, ph + 0.05, pz, 1.95, 0.1, 1.95, 0xb9a074);
        tower.add(px, ph + 1.05, pz - 0.82, 1.7, 0.05, 0.05, metal);
        tower.add(px - 0.82, ph + 1.05, pz, 0.05, 0.05, 1.7, metal);
        tower.add(px + 0.82, ph + 1.05, pz, 0.05, 0.05, 1.7, metal);
        tower.add(px, ph / 2, pz + 0.95, 0.5, 0.05, 0.05, metal);
        // Ladder on the back.
        for (const sx of [-0.25, 0.25]) {
            tower.add(px + sx, ph / 2, pz + 1.0, 0.04, ph, 0.04, metal);
        }
        for (let r = 0.3; r < ph; r += 0.35) {
            tower.add(px, r, pz + 1.0, 0.5, 0.03, 0.03, metal);
        }
        add(tower.build(solid, "conductorTower", shadows));

        // --- Scoreboard (hs) ---------------------------------------------
        const label = teams.home.label;
        if (!big) {
            const bw = 11;
            const bh = 4.8;
            const fenceEndX = f.cx - (straight + fenceR);
            const sx = fenceEndX - 7;
            const by = 3.4 + bh / 2;
            const sb = new BoxBatch(unit);
            sb.add(sx, by, f.cz, 0.5, bh + 0.5, bw + 0.5, 0x1b1c20);
            sb.add(sx, 1.7, f.cz - bw * 0.38, 0.4, 3.5, 0.4, 0x6a6f78);
            sb.add(sx, 1.7, f.cz + bw * 0.38, 0.4, 3.5, 0.4, 0x6a6f78);
            add(sb.build(solid, "scoreboardFrame", shadows));
            const ledMat = shared.std(0x000000, {
                emissive: 0xffffff,
                emissiveIntensity: 0.9,
                emissiveMap: scoreboardTexture({
                    teamColor: teams.home.teamColor,
                    name: label,
                }),
                roughness: 0.6,
            });
            ledMats.push(ledMat);
            const face = mesh(new PlaneGeometry(bw, bh), ledMat, "scoreboard");
            face.rotation.y = Math.PI / 2;
            face.position.set(sx + 0.27, by, f.cz);
            keepOut.push({
                x0: sx - 3,
                x1: sx + 3,
                z0: f.cz - 8,
                z1: f.cz + 8,
            });
        }

        // --- Buildings -----------------------------------------------------
        const front = cfg.front;
        const back = cfg.back;
        const visitorRear =
            f.minZ - back.gap - back.spec.rows * back.spec.depth;
        const homeRear =
            f.maxZ +
            front.gap +
            front.spec.rows * front.spec.depth +
            ft(14) +
            ft(6);
        const brickTex = (windows: boolean, brick: number, seed: number) =>
            facadeTexture(brick, windows, seed);
        const roofBatch = new BoxBatch(unit);

        const building = (
            name: string,
            cx: number,
            cz: number,
            w: number,
            h: number,
            d: number,
            tex: CanvasTexture,
            tileW: number,
            tileH: number,
        ) => {
            const mat = shared.std(0xffffff, { map: tex, roughness: 0.9 });
            const g = texturedBox(w, h, d, tileW, tileH);
            const m = mesh(g, mat, name, true);
            m.position.set(cx, h / 2, cz);
            roofBatch.add(cx, h + 0.25, cz, w + 0.6, 0.5, d + 0.6, 0x575a61);
            roofBatch.add(cx, h + 0.7, cz, w * 0.96, 0.4, d * 0.9, 0x6a6d73);
            keepOut.push({
                x0: cx - w / 2 - 6,
                x1: cx + w / 2 + 6,
                z0: cz - d / 2 - 6,
                z1: cz + d / 2 + 6,
            });
            return m;
        };

        const schoolW = big ? 130 : 96;
        const schoolH = big ? 12.8 : 8.6;
        const schoolD = big ? 20 : 16;
        const lotD = big ? 44 : 34;
        const lotGap = 9;
        const lotZ1 = visitorRear - lotGap;
        const lotZ0 = lotZ1 - lotD;
        const schoolZ = lotZ0 - 8 - schoolD / 2;
        const schoolX = f.cx + (big ? -8 : 6);
        const floorH = 4.3;
        const brick = big ? 0x8f4f3d : 0x9a4d3a;
        building(
            "school",
            schoolX,
            schoolZ,
            schoolW,
            schoolH,
            schoolD,
            brickTex(true, brick, 9),
            6,
            floorH,
        );
        building(
            "gym",
            schoolX + schoolW * 0.28,
            schoolZ - 2,
            big ? 40 : 30,
            big ? 17 : 12.6,
            big ? 34 : 28,
            brickTex(false, brick, 4),
            6,
            6,
        );
        // Entrance block with a team-colored sign band.
        const entX = schoolX - schoolW * 0.12;
        const entZ = schoolZ + schoolD / 2 + 2;
        roofBatch.add(entX, 3.4, entZ, 14, 0.5, 5, 0x575a61);
        for (const dx of [-6, -2, 2, 6]) {
            roofBatch.add(entX + dx, 1.6, entZ + 2, 0.5, 3.2, 0.5, 0xe6e3dc);
        }
        const signH = 1.6;
        const schoolSign = mesh(
            new PlaneGeometry(12, signH),
            shared.std(0xffffff, {
                map: signTexture(
                    teams.home.teamColor,
                    label,
                    1024,
                    Math.round(1024 * (signH / 12)),
                ),
                roughness: 0.7,
            }),
            "schoolSign",
        );
        schoolSign.position.set(
            entX,
            schoolH - 0.8 - (big ? 0 : 1.6),
            schoolZ + schoolD / 2 + 0.05,
        );

        // Flagpole by the entrance.
        const flag = new BoxBatch(unit);
        flag.add(entX + 12, 5, entZ + 3, 0.12, 10, 0.12, 0xd8dbe0);
        flag.add(
            entX + 12,
            9,
            entZ + 3.7,
            0.03,
            1.1,
            1.8,
            teams.home.teamColor,
        );
        add(flag.build(solid, "flag", false));

        // --- Parking lot -----------------------------------------------------
        const lotW = big ? 150 : 112;
        const lotX = schoolX;
        // One texture tile is 5.2 x 5.4 m.
        const lotMat = shared.std(0xffffff, {
            map: repeated(parkingTexture(), lotW / 5.2, lotD / 5.4),
            roughness: 1,
        });
        const lot = mesh(new PlaneGeometry(lotW, lotD), lotMat, "parkingLot");
        lot.rotation.x = -Math.PI / 2;
        lot.position.set(lotX, 0.02, (lotZ0 + lotZ1) / 2);
        keepOut.push({
            x0: lotX - lotW / 2 - 4,
            x1: lotX + lotW / 2 + 4,
            z0: lotZ0 - 4,
            z1: lotZ1 + 4,
        });
        const bodies = new BoxBatch(unit);
        const cabins = new BoxBatch(unit);
        const rnd = createRng(big ? 91 : 41);
        const carColors = [
            0xc9ccd1, 0x23262b, 0x8a1f1f, 0x2c4a7a, 0xe3e3e1, 0x5b6068,
            0x1f5a3a, 0xb98a2a, 0x303338,
        ];
        for (let row = 0; row * 5.4 + 5.4 <= lotD - 0.5; row++) {
            if (row % 3 === 2) continue;
            for (let c = 0; (c + 1) * 2.6 <= lotW - 1; c++) {
                if (rnd() > (big ? 0.6 : 0.5)) continue;
                const x = lotX - lotW / 2 + (c + 0.5) * 2.6;
                const z = lotZ0 + row * 5.4 + 2.5;
                const color = carColors[Math.floor(rnd() * carColors.length)];
                const yaw = (rnd() - 0.5) * 0.06;
                bodies.add(x, 0.62, z, 1.8, 0.7, 4.4, color, yaw);
                cabins.add(x, 1.2, z + 0.15, 1.62, 0.5, 2.3, 0x1c2128, yaw);
            }
        }
        add(
            bodies.build(
                shared.std(0xffffff, { roughness: 0.4, metalness: 0.5 }),
                "cars",
                shadows,
            ),
        );
        add(
            cabins.build(
                shared.std(0xffffff, { roughness: 0.2, metalness: 0.4 }),
                "carGlass",
                false,
            ),
        );
        // Lot light poles with lamp heads that glow when the lamps are on.
        const lampBatch = new BoxBatch(unit);
        const lotPoles = new BoxBatch(unit);
        for (let i = 0; i < 4; i++) {
            const x = lotX - lotW / 2 + (lotW * (i + 0.5)) / 4;
            const z = lotZ0 + lotD * 0.5;
            lotPoles.add(x, 4.5, z, 0.22, 9, 0.22, 0x4a4d54);
            lampBatch.add(x, 9.1, z, 2.2, 0.25, 0.5, 0xfff0c8);
        }
        add(lotPoles.build(solid, "lotPoles", shadows));
        const lampMat = shared.std(0x303338, {
            emissive: 0xfff0c8,
            emissiveIntensity: 0,
        });
        lampMats.push(lampMat);
        add(lampBatch.build(lampMat, "lotLamps", false));

        // --- Concession stand (hs) / field house on the plaza (bighs) ---------
        if (!big) {
            const cxp = f.maxX + 40;
            const czp = f.cz + 30;
            building(
                "concession",
                cxp,
                czp,
                7,
                3.6,
                15,
                brickTex(false, 0xa89c8a, 6),
                4,
                4,
            );
            const con = new BoxBatch(unit);
            for (const dz of [-4.5, 0, 4.5]) {
                con.add(cxp - 3.52, 1.9, czp + dz, 0.1, 1.1, 1.8, 0x1b2430);
                con.add(cxp - 3.5, 1.3, czp + dz, 0.2, 0.08, 2.0, 0xcfc9bc);
            }
            con.add(
                cxp - 4.2,
                3.0,
                czp,
                1.8,
                0.1,
                14,
                teams.home.teamColor,
                0,
                0,
                0.5,
            );
            con.add(cxp - 3.55, 3.05, czp, 0.12, 0.7, 6, 0xffffff);
            con.add(cxp - 7, 1.2, czp - 8.5, 2.2, 2.4, 2.2, 0xe8e1d1);
            con.add(
                cxp - 7,
                2.55,
                czp - 8.5,
                2.6,
                0.2,
                2.6,
                teams.home.teamColor,
            );
            add(con.build(solid, "concessionDetails", shadows));
        } else if (cfg.plaza) {
            const px0 = f.minX - cfg.plaza.dx;
            const hx = px0 - cfg.plaza.w / 2 - 12;
            building(
                "fieldHouse",
                hx,
                f.cz,
                14,
                9,
                cfg.plaza.d * 0.6,
                brickTex(true, 0x8a4636, 3),
                6,
                4.5,
            );
            const fh = new BoxBatch(unit);
            for (let i = 0; i < 4; i++) {
                const z = f.cz - 12 + i * 8;
                fh.add(
                    px0 - cfg.plaza.w / 2 - 4.9,
                    1.5,
                    z,
                    0.2,
                    3,
                    0.3,
                    0xe6e3dc,
                );
            }
            for (let i = 0; i < 6; i++) {
                const z = f.cz - 20 + i * 8;
                const pole = new Vector3(px0 + 6, 0, z);
                fh.add(pole.x, 5, pole.z, 0.12, 10, 0.12, 0xd8dbe0);
                const c = i % 2 === 0 ? teams.home.teamColor : 0xf2f2f2;
                fh.add(pole.x, 9, pole.z + 0.8, 0.03, 1.1, 1.6, c);
            }
            add(fh.build(solid, "plazaDetails", shadows));
            const sH = 2.2;
            const gateSign = mesh(
                new PlaneGeometry(14, sH),
                shared.std(0xffffff, {
                    map: signTexture(
                        teams.home.teamColor,
                        label,
                        1024,
                        Math.round((1024 * sH) / 14),
                    ),
                    roughness: 0.7,
                }),
                "plazaSign",
            );
            gateSign.rotation.y = Math.PI / 2;
            gateSign.position.set(hx + 7.1, 7.6, f.cz);
        }
        add(roofBatch.build(solid, "roofs", shadows));

        // --- Sidelines: team benches and end zone pylons ---------------------
        const side = new BoxBatch(unit);
        for (const [z, dir, team] of [
            [f.maxZ + 2.4, 1, teams.home.teamColor],
            [f.minZ - 2.4, -1, teams.away.teamColor],
        ] as const) {
            const bx = f.cx + (dir === 1 ? -8 : 8);
            side.add(bx, 0.45, z + dir * 0.9, 12, 0.08, 0.45, 0xb9bec6);
            side.add(bx, 0.75, z + dir * 1.15, 12, 0.5, 0.06, 0xb9bec6);
            for (const dx of [-5.5, 0, 5.5]) {
                side.add(
                    bx + dx,
                    0.22,
                    z + dir * 0.9,
                    0.08,
                    0.44,
                    0.4,
                    0x5d626b,
                );
            }
            side.add(bx + 7.5, 0.4, z + dir * 0.9, 0.9, 0.8, 0.6, team);
            side.add(bx - 7.2, 0.3, z + dir * 0.9, 0.7, 0.6, 0.5, 0xe8e8ea);
        }
        for (const x of [f.minX - 0.3, f.maxX + 0.3]) {
            for (const z of [f.minZ - 0.3, f.maxZ + 0.3]) {
                side.add(x, 0.3, z, 0.12, 0.6, 0.12, 0xff6a1a);
            }
        }
        add(side.build(solid, "sideline", shadows));

        // --- Trees ----------------------------------------------------------
        const trng = createRng(big ? 7 : 3);
        const treeCount = big ? 46 : 78;
        const crownGeo = new IcosahedronGeometry(1, 1);
        const trunkGeo = new CylinderGeometry(0.22, 0.34, 1, 6);
        disposables.push(crownGeo, trunkGeo);
        const crowns = new InstancedMesh(
            crownGeo,
            shared.std(0xffffff, { roughness: 1, flatShading: true }),
            treeCount * 2,
        );
        const trunks = new InstancedMesh(
            trunkGeo,
            shared.std(0x4a3a2a, { roughness: 1 }),
            treeCount,
        );
        crowns.name = "treeCrowns";
        trunks.name = "treeTrunks";
        const mx = new Matrix4();
        const qq = new Quaternion();
        const greens = [
            0x3b6a2e, 0x2f5a2a, 0x4b7a35, 0x56853a, 0x35602f, 0xb5632a,
            0xc98a2c,
        ];
        let n = 0;
        let tries = 0;
        let placed = 0;
        while (placed < treeCount && tries < 4000) {
            tries++;
            const ang = trng() * Math.PI * 2;
            const r = 105 + trng() * 150;
            const x = f.cx + Math.cos(ang) * r * 1.35;
            const z = f.cz + Math.sin(ang) * r;
            if (
                keepOut.some(
                    (k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1,
                )
            )
                continue;
            const tall = 5.5 + trng() * 5;
            const cr = 2.6 + trng() * 2.4;
            const color: number =
                trng() < 0.9
                    ? greens[Math.floor(trng() * 5)]
                    : greens[5 + Math.floor(trng() * 2)];
            mx.compose(
                new Vector3(x, tall * 0.2, z),
                qq,
                new Vector3(1, tall * 0.4, 1),
            );
            trunks.setMatrixAt(placed, mx);
            for (let k = 0; k < 2; k++) {
                const s = cr * (k === 0 ? 1 : 0.7);
                mx.compose(
                    new Vector3(
                        x + (k ? cr * 0.4 : 0),
                        tall * 0.55 + (k ? cr * 0.6 : 0),
                        z + (k ? cr * 0.2 : 0),
                    ),
                    qq,
                    new Vector3(s, s * 1.05, s),
                );
                crowns.setMatrixAt(n, mx);
                crowns.setColorAt(
                    n,
                    tmpColor.setHex(k ? shade(color, 1.1) : color),
                );
                n++;
            }
            placed++;
        }
        crowns.count = n;
        trunks.count = placed;
        crowns.instanceMatrix.needsUpdate =
            trunks.instanceMatrix.needsUpdate = true;
        if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
        crowns.castShadow = trunks.castShadow = false;
        crowns.computeBoundingSphere();
        trunks.computeBoundingSphere();
        add(crowns);
        add(trunks);
        disposables.push(
            { dispose: () => crowns.dispose() },
            { dispose: () => trunks.dispose() },
        );

        return {
            objects,
            surfaces,
            podium: true,
            setLighting(on, scale) {
                for (const m of lampMats)
                    m.emissiveIntensity = on ? 1.4 * scale : 0;
                for (const m of ledMats)
                    m.emissiveIntensity = on ? 0.9 + 0.5 * scale : 0.9;
            },
            dispose() {
                disposables.forEach((d) => d.dispose());
            },
        };
    };
}

const tmpColor = new Color();
