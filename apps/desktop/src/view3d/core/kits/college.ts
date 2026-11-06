// cspell:ignore metalness
import {
    Euler,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    PlaneGeometry,
    Quaternion,
    Vector3,
    MeshStandardMaterial,
    type BufferGeometry,
    type Texture,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    ft,
    lightingValues,
    videoBoard,
} from "../environment";
import type { CameraSeat, KitBuilder, LightingPreset, SeatRow } from "../types";
import {
    bowlPlanFor,
    LOWER,
    profileAt,
    sampleBowlPath,
    UPPER,
    type BowlPlan,
} from "./college/bowl";
import {
    BANK_LEG,
    BANK_SIZE,
    facePlane,
    goalPosts,
    lightBanks,
    scorePanel,
    type BankSpot,
    type Part,
} from "./college/extras";
import {
    SWEEP_GROUPS,
    sweepBowl,
    TILE,
    type SweepGroup,
} from "./college/sweep";
import {
    bannerTexture,
    concreteTexture,
    facadeTexture,
    glassTexture,
    lampTexture,
    lawnTexture,
    repeatTexture,
    ribbonBoardTexture,
    seatTexture,
    wallTexture,
} from "./college/textures";
import {
    blimpCamera,
    cameraSeat,
    frameOf,
    groundPlane,
    GROUND_SIZE,
    GROUND_Y,
    OUTDOOR_PRESETS,
    topDownCamera,
    APRON_HEIGHT,
} from "./stands";

/**
 * College stadium kit: a continuous horseshoe bowl round the field, open at the
 * -x end where the video board and scoreboard stand. The home side (+z) has a
 * suite level with glass, an upper deck and a press box on the rim; both tiers
 * wrap the +x end. Team-colored wall, ribbon boards, a band block in the end
 * zone seats, goal posts and four light banks on the rim. Default night.
 *
 * The seating is one swept cross-section (`college/bowl.ts`, `sweep.ts`), not
 * the high school stands, so there are no gaps at the corners.
 */
const DEFAULT_LIGHTING: LightingPreset = "night";

export const buildCollege: KitBuilder = (input) => {
    const { params, quality } = input;
    const f = frameOf(input.footprint);
    const plan: BowlPlan = bowlPlanFor(input.footprint);
    const low = quality === "low";
    const shared = createSharedMaterials();
    const root = new Group();
    root.name = "kit:college";
    const geometries: BufferGeometry[] = [];
    const parts: Part[] = [];
    const textures: Texture[] = [];
    const tex = <T extends Texture>(t: T): T => {
        textures.push(t);
        return t;
    };

    // Ground and lawn.
    const ground = groundPlane(
        GROUND_SIZE,
        GROUND_SIZE,
        shared.std(0x5a5c61, { roughness: 1 }),
        f.cx,
        GROUND_Y,
        f.cz,
        "ground",
    );
    root.add(ground.mesh);
    geometries.push(ground.geometry);
    const lawnX0 = f.cx - plan.openX - 24;
    const lawnX1 = f.cx + plan.halfX;
    const lawnTex = tex(lawnTexture());
    repeatTexture(lawnTex, (lawnX1 - lawnX0) / 9.14, 1);
    const lawn = groundPlane(
        lawnX1 - lawnX0,
        plan.halfZ * 2,
        shared.std(0xffffff, { roughness: 1, map: lawnTex }),
        (lawnX0 + lawnX1) / 2,
        APRON_HEIGHT,
        f.cz,
        "apron",
    );
    root.add(lawn.mesh);
    geometries.push(lawn.geometry);

    // The bowl.
    const stations = sampleBowlPath(plan, low ? 8 : 4, low ? 8 : 16);
    const sweep = sweepBowl(stations);
    const concreteMap = tex(concreteTexture());
    const facadeMap = tex(facadeTexture(params.homeColor, false));
    const facadeGlow = tex(facadeTexture(params.homeColor, true));
    const glassMap = tex(glassTexture(false));
    const glassGlow = tex(glassTexture(true));
    const ribbonMap = tex(
        ribbonBoardTexture(
            params.endZoneText || "OPENMARCH",
            params.homeColor,
            params.endZoneColor,
        ),
    );
    const wallMap = tex(
        wallTexture(params.homeColor, params.endZoneText || "OPENMARCH"),
    );
    const materials: Record<SweepGroup, MeshStandardMaterial> = {
        concrete: shared.std(0xffffff, { roughness: 0.95, map: concreteMap }),
        wall: shared.std(0xffffff, { roughness: 0.7, map: wallMap }),
        glass: shared.std(0xffffff, {
            roughness: 0.18,
            metalness: 0.55,
            map: glassMap,
            emissive: 0xffffff,
            emissiveMap: glassGlow,
            emissiveIntensity: 0,
        }),
        fascia: shared.std(0x101014, {
            roughness: 0.5,
            emissive: 0xffffff,
            emissiveMap: ribbonMap,
            emissiveIntensity: 1,
        }),
        facade: shared.std(0xffffff, {
            roughness: 0.9,
            map: facadeMap,
            emissive: 0xffffff,
            emissiveMap: facadeGlow,
            emissiveIntensity: 0,
        }),
        seatHome: shared.std(0xffffff, {
            roughness: 0.75,
            map: tex(seatTexture(params.homeColor, "solid")),
        }),
        seatAway: shared.std(0xffffff, {
            roughness: 0.75,
            map: tex(seatTexture(params.awayColor, "solid")),
        }),
        seatEnd: shared.std(0xffffff, {
            roughness: 0.75,
            map: tex(seatTexture(params.homeColor, "stripe")),
        }),
        seatBand: shared.std(0xffffff, {
            roughness: 0.75,
            map: tex(seatTexture("#2b2d33", "band")),
        }),
    };
    for (const m of Object.values(materials)) {
        for (const t of [m.map, m.emissiveMap]) {
            if (t) repeatTexture(t, 1, 1);
        }
    }
    const pickTargets: Mesh[] = [];
    for (const g of SWEEP_GROUPS) {
        const geo = sweep.geometries[g];
        geometries.push(geo);
        const mesh = new Mesh(geo, materials[g]);
        mesh.name = `bowl:${g}`;
        mesh.castShadow = g !== "wall";
        mesh.receiveShadow = true;
        root.add(mesh);
        if (g.startsWith("seat")) pickTargets.push(mesh);
    }

    // Press box on the home rim: a hollow cab (floor, roof, back wall, two
    // ends) with a glass front, so the camera can sit inside it.
    const home = sweep.home;
    const upperEnd = home.frontOff + UPPER.rows * UPPER.depth;
    const zFront = f.cz + plan.halfZ + upperEnd + 0.4;
    const pbW = 52;
    const pbD = 7.5;
    const floorH = 3.4;
    const pbY = home.rimH;
    const pbMat = shared.std(0xd9d6cd, { roughness: 0.85 });
    const roofMat = shared.std(0x3a3d44, { roughness: 0.7 });
    const box = (
        name: string,
        mat: MeshStandardMaterial,
        size: Vector3Tuple,
        pos: Vector3Tuple,
    ) => {
        const m = new Mesh(shared.unitBox, mat);
        m.name = name;
        m.scale.set(...size);
        m.position.set(...pos);
        m.castShadow = m.receiveShadow = true;
        root.add(m);
    };
    const cabH = floorH * 2;
    box(
        "pressBox:floor",
        pbMat,
        [pbW, 0.8, pbD],
        [f.cx, pbY + 0.4, zFront + pbD / 2],
    );
    box(
        "pressBox:back",
        pbMat,
        [pbW, cabH, 0.6],
        [f.cx, pbY + cabH / 2, zFront + pbD - 0.3],
    );
    for (const sx of [-1, 1]) {
        box(
            "pressBox:end",
            pbMat,
            [0.8, cabH, pbD],
            [f.cx + sx * (pbW / 2 - 0.4), pbY + cabH / 2, zFront + pbD / 2],
        );
    }
    box(
        "pressBox:roof",
        roofMat,
        [pbW + 1.6, 0.9, pbD + 2.6],
        [f.cx, pbY + cabH + 0.45, zFront + pbD / 2 - 0.8],
    );
    const pbGlassGeo = facePlane(
        pbW - 1.6,
        cabH - 0.8,
        (pbW - 1.6) / TILE.glass,
        (cabH - 0.8) / TILE.glassH,
    );
    geometries.push(pbGlassGeo);
    const pbGlass = new Mesh(pbGlassGeo, materials.glass);
    pbGlass.name = "pressBox:glass";
    pbGlass.position.set(f.cx, pbY + 0.8 + (cabH - 0.8) / 2, zFront);
    pbGlass.rotation.y = Math.PI; // faces -z, toward the field
    root.add(pbGlass);

    // Wall tunnels, framed in the home color.
    const frameMat = shared.std(
        Number.parseInt(params.homeColor.replace("#", ""), 16) || 0x6442ff,
        { roughness: 0.6 },
    );
    const darkMat = shared.std(0x08090b, { roughness: 1 });
    const tunnel = (x: number, z: number, yaw: number) => {
        const g = new Group();
        g.name = "tunnel";
        g.position.set(x, 0, z);
        g.rotation.y = yaw;
        const w = 6;
        const h = 3.2;
        const mouthGeo = facePlane(w, h, 1, 1);
        geometries.push(mouthGeo);
        const mouth = new Mesh(mouthGeo, darkMat);
        mouth.position.set(0, h / 2, 0);
        g.add(mouth);
        const part = (sx: number, sy: number, px: number, py: number) => {
            const m = new Mesh(shared.unitBox, frameMat);
            m.scale.set(sx, sy, 0.5);
            m.position.set(px, py, 0.05);
            m.castShadow = true;
            g.add(m);
        };
        part(0.6, h + 0.6, -w / 2 - 0.3, (h + 0.6) / 2 - 0.0);
        part(0.6, h + 0.6, w / 2 + 0.3, (h + 0.6) / 2);
        part(w + 1.2, 0.6, 0, h + 0.3);
        root.add(g);
    };
    tunnel(f.cx + plan.halfX - 0.1, f.cz, -Math.PI / 2);
    tunnel(f.cx + 28, f.cz + plan.halfZ - 0.1, Math.PI);

    // Goal posts, just behind the end lines.
    const posts = goalPosts(
        f.minX,
        f.maxX,
        f.cz,
        shared.std(0xffd21f, { roughness: 0.4, metalness: 0.4 }),
        shared.std(0x1c2c6b, { roughness: 0.9 }),
    );
    for (const p of posts) {
        root.add(p.object);
        parts.push(p);
    }

    // Video board and scoreboard in the open end, facing the field (+x).
    const boardX = f.minX - 24;
    const boardW = 40;
    const boardH = 15;
    const legs = 9;
    const boardY = legs + boardH / 2;
    const board = videoBoard(
        boardW,
        boardH,
        legs,
        "SPRING SHOW",
        "OpenMarch",
        shared,
    );
    board.object.position.set(boardX, boardY, f.cz);
    board.object.rotation.y = Math.PI / 2;
    root.add(board.object);
    parts.push(board);
    const panel = scorePanel(
        24,
        5.5,
        params.homeColor,
        params.awayColor,
        shared,
    );
    panel.object.position.set(boardX, boardY + boardH / 2 + 4.6, f.cz);
    panel.object.rotation.y = Math.PI / 2;
    root.add(panel.object);
    parts.push(panel);

    // Stair towers with team banners, breaking up the outer wall.
    const towerMat = shared.std(0xd6cdb8, { roughness: 0.9 });
    const bannerMap = tex(
        bannerTexture(params.homeColor, params.endZoneText || "OPENMARCH"),
    );
    repeatTexture(bannerMap, 1, 1);
    const bannerMat = shared.std(0xffffff, { roughness: 0.8, map: bannerMap });
    const towerSpots: { x: number; z: number; yaw: number; rimH: number }[] =
        [];
    {
        let run = 0;
        let prev: [number, number] | null = null;
        let next = 16;
        stations.forEach((st, i) => {
            const pr = profileAt(st.w);
            const ox = st.x + st.nx * pr.rimOff;
            const oz = st.z + st.nz * pr.rimOff;
            if (prev) run += Math.hypot(ox - prev[0], oz - prev[1]);
            prev = [ox, oz];
            if (run >= next && i < stations.length - 4) {
                next = run + 30;
                towerSpots.push({
                    x: st.x + st.nx * (pr.rimOff + 1.2),
                    z: st.z + st.nz * (pr.rimOff + 1.2),
                    yaw: Math.atan2(st.nx, st.nz),
                    rimH: pr.rimH,
                });
            }
        });
    }
    const towers = new InstancedMesh(
        shared.unitBox,
        towerMat,
        towerSpots.length,
    );
    const bannerGeo = new PlaneGeometry(1, 1);
    geometries.push(bannerGeo);
    const banners = new InstancedMesh(bannerGeo, bannerMat, towerSpots.length);
    towers.name = "stairTowers";
    banners.name = "towerBanners";
    const tm = new Matrix4();
    towerSpots.forEach((t, i) => {
        const q = new Quaternion().setFromEuler(new Euler(0, t.yaw, 0));
        const h = t.rimH + 3;
        tm.compose(new Vector3(t.x, h / 2, t.z), q, new Vector3(6, h, 3.2));
        towers.setMatrixAt(i, tm);
        const bh = Math.min(15, t.rimH - 3);
        const out = new Vector3(0, 0, 1.65).applyQuaternion(q);
        tm.compose(
            new Vector3(t.x + out.x, t.rimH - 1.5 - bh / 2, t.z + out.z),
            q,
            new Vector3(3.6, bh, 1),
        );
        banners.setMatrixAt(i, tm);
    });
    towers.castShadow = towers.receiveShadow = true;
    root.add(towers, banners);
    parts.push({
        object: towers,
        dispose: () => {
            towers.dispose();
            banners.dispose();
        },
    });

    // Light banks on the rim. Home-side ones sit on the wide rim walkway.
    const plain = sweep.plain;
    const bankY = (rimH: number) => rimH + BANK_LEG + BANK_SIZE[1] / 2;
    const aim = (x: number, z: number): Vector3Tuple => [
        f.cx + 0.25 * (x - f.cx),
        0,
        f.cz + 0.15 * (z - f.cz),
    ];
    const spots: BankSpot[] = [];
    const addBank = (x: number, z: number, rimH: number, light: boolean) =>
        spots.push({ position: [x, bankY(rimH), z], target: aim(x, z), light });
    const homeZ = f.cz + plan.halfZ + home.rimOff - 2.2;
    const awayZ = f.cz - plan.halfZ - plain.rimOff + 1.2;
    for (const dx of [-48, 34]) {
        addBank(f.cx + dx, homeZ, home.rimH, true);
        addBank(f.cx + dx, awayZ, plain.rimH, true);
    }
    const cornerCx = f.cx + plan.halfX - plan.radius;
    const cornerR = plan.radius + plain.rimOff - 1.2;
    for (const sz of [-1, 1]) {
        const a = (sz * 38 * Math.PI) / 180;
        addBank(
            cornerCx + cornerR * Math.cos(a),
            f.cz + sz * (plan.halfZ - plan.radius) + cornerR * Math.sin(a),
            plain.rimH,
            false,
        );
    }
    const lampMap = tex(lampTexture());
    const banks = lightBanks(spots, shared, lampMap);
    root.add(...banks.objects);
    parts.push(banks);

    // Cameras. Offsets are in the profile's own terms so they follow the bowl.
    const lowerSeat = (row: number): [number, number] => [
        LOWER.off0 + row * LOWER.depth + LOWER.depth * 0.7,
        LOWER.h0 + row * LOWER.rise,
    ];
    const [fo, fh] = lowerSeat(1);
    const endOff = plain.frontOff + 3 * UPPER.depth + UPPER.depth * 0.7;
    const endH = plain.upperBase + 4 * UPPER.rise;
    const cams: CameraSeat[] = [
        cameraSeat(
            "pressBox",
            "seat",
            [f.cx, pbY + 4.6, zFront + 2.2],
            [f.cx, 0, f.cz - ft(12)],
        ),
        cameraSeat(
            "frontRow",
            "seat",
            [f.cx - ft(36), fh + 1.25, f.cz + plan.halfZ + fo],
            [f.cx - ft(12), ft(6), f.cz],
        ),
        cameraSeat(
            "endZone",
            "seat",
            [f.cx + plan.halfX + endOff, endH + 1.3, f.cz],
            [f.cx, 0, f.cz],
        ),
        blimpCamera(f),
        topDownCamera(f, ft(700)),
    ];

    if (low) {
        root.traverse((o) => {
            o.castShadow = false;
        });
    }

    const setLighting = (preset: LightingPreset) => {
        if (!OUTDOOR_PRESETS.includes(preset)) return;
        const k = lightingValues(preset).kit;
        banks.setOn(k.lampsOn, k.lampScale);
        const glow = k.lampsOn ? 1.5 * k.lampScale : 0;
        materials.glass.emissiveIntensity = glow;
        materials.facade.emissiveIntensity = glow;
        // LED ribbon: bright by day too, brighter at night.
        materials.fascia.emissiveIntensity = k.lampsOn ? 1.5 : 0.8;
    };
    setLighting(DEFAULT_LIGHTING);
    let scroll = 0;
    const seatRows: SeatRow[] = sweep.seatRows;

    return {
        root,
        focus: [f.cx, 0, f.cz],
        cameras: cams,
        seatRows,
        pickTargets,
        crowdDensity: 0.65,
        lightingPresets: [...OUTDOOR_PRESETS],
        defaultLighting: DEFAULT_LIGHTING,
        setLighting,
        onFrame(ctx) {
            // The ribbon boards crawl along the fascia, about 0.4 m/s.
            scroll = (scroll + ctx.dt * 0.012) % 1;
            ribbonMap.offset.x = -scroll;
        },
        dispose() {
            parts.forEach((p) => p.dispose());
            geometries.forEach((g) => g.dispose());
            textures.forEach((t) => t.dispose());
            shared.dispose();
        },
    };
};
