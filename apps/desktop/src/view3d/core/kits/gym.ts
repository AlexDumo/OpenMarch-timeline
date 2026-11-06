// cspell:ignore metalness
import {
    AdditiveBlending,
    BackSide,
    BoxGeometry,
    CylinderGeometry,
    DirectionalLight,
    Euler,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Quaternion,
    SpotLight,
    Vector3,
    type Object3D,
    type Texture,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    lightingValues,
    setLightIntensity,
    type SharedMaterials,
} from "../environment";
import type {
    CameraSeat,
    FrameContext,
    KitBuilder,
    LightingPreset,
    SeatRow,
} from "../types";
import {
    bannerTexture,
    beamTexture,
    deckTexture,
    floorTexture,
    matTexture,
    scoreboardTexture,
    WALL_TILE,
    wallTexture,
    windowTexture,
    woodTexture,
    wordmarkTexture,
} from "./gym/textures";

/** Room and bleacher dimensions in meters (design.md section 6, "gym"). */
export const GYM_ROOM_MARGIN = 9;
export const GYM_ROOM_HEIGHT = 11;
export const GYM_BLEACHER_ROWS = 12;
export const GYM_BLEACHER_TREAD = 0.73;
export const GYM_BLEACHER_RISE = 0.35;
export const GYM_BLEACHER_BASE = 0.43;
/** Gap between the performance area's front edge and the first bleacher row. */
export const GYM_BLEACHER_GAP = 3;
/** Wall clearance behind the top row. */
const BLEACHER_WALL_GAP = 0.6;
const EYE_ABOVE_TREAD = 1.22;

const BANNERS: [string[], string][] = [
    [["REGIONAL", "FINALIST", "2024"], "#6442ff"],
    [["STATE", "CHAMPIONS", "2025"], "#1f2a5c"],
    [["WINTER", "GUARD", "A CLASS"], "#a33a3a"],
    [["INDOOR", "PERCUSSION", "2025"], "#1f5c46"],
    [["DISTRICT", "CHAMPIONS", "2023"], "#7a4a16"],
    [["ALL", "CONFERENCE", "2022"], "#2a5f8f"],
    [["SECTIONAL", "CHAMPS", "2019"], "#5b2a6e"],
    [["STATE", "FINALIST", "2018"], "#8a2f3d"],
];

const m4 = new Matrix4();
const quat = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const place = (
    mesh: InstancedMesh,
    i: number,
    p: Vector3Tuple,
    s: Vector3Tuple,
    q: Quaternion = quat,
): void => {
    m4.compose(pos.set(...p), q, scl.set(...s));
    mesh.setMatrixAt(i, m4);
};
/** Instances of a unit box between two points, `thick` square. */
const placeBar = (
    mesh: InstancedMesh,
    i: number,
    a: Vector3Tuple,
    b: Vector3Tuple,
    thick: number,
    depth = thick,
): void => {
    const from = new Vector3(...a);
    const to = new Vector3(...b);
    const dir = to.clone().sub(from);
    const q = new Quaternion().setFromUnitVectors(
        new Vector3(1, 0, 0),
        dir.clone().normalize(),
    );
    const mid = from.add(to).multiplyScalar(0.5);
    place(mesh, i, [mid.x, mid.y, mid.z], [dir.length(), thick, depth], q);
};

/**
 * Indoor high school gym: painted cinder-block walls with a school-color
 * wainscot, a lacquered maple floor, wooden pull-out bleachers on the front
 * side, folded bleachers and championship banners on the back wall, steel
 * trusses with joists, ductwork and high-bay lamps overhead, clerestory
 * windows, a scoreboard, wall mats, folded-up hoops, doors with exit signs and
 * house and show lighting. The tarp is the field surface (P2.1); the floor
 * sits at y = 0 so the surface at y = 0.02 lies on top. The room extends past
 * the footprint by 9 m on the sides and back, and further in front so its
 * front wall clears the bleachers.
 */
export const buildGym: KitBuilder = ({ footprint, params, quality }) => {
    const fp = footprint;
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const w = fp.maxX - fp.minX;
    const d = fp.maxZ - fp.minZ;
    const RH = GYM_ROOM_HEIGHT;
    const homeCss = params.homeColor;

    const bleacherDepth = GYM_BLEACHER_ROWS * GYM_BLEACHER_TREAD;
    const frontPad = Math.max(
        GYM_ROOM_MARGIN,
        GYM_BLEACHER_GAP + bleacherDepth + BLEACHER_WALL_GAP,
    );
    const room = {
        minX: fp.minX - GYM_ROOM_MARGIN,
        maxX: fp.maxX + GYM_ROOM_MARGIN,
        minZ: fp.minZ - GYM_ROOM_MARGIN,
        maxZ: fp.maxZ + frontPad,
    };
    const roomW = room.maxX - room.minX;
    const roomD = room.maxZ - room.minZ;
    const roomCz = (room.minZ + room.maxZ) / 2;

    const shared: SharedMaterials = createSharedMaterials();
    const { std, unitBox } = shared;
    const geometries: { dispose(): void }[] = [];
    const extras: { dispose(): void }[] = [];
    const root = new Group();
    root.name = "gym";
    const rotY = (a: number) =>
        new Quaternion().setFromEuler(new Euler(0, a, 0));
    const tex = <T extends Texture>(t: T): T => {
        extras.push(t);
        return t;
    };

    // Room shell, seen from inside. Walls are painted block, the ceiling is
    // ribbed roof deck.
    const wallBase = tex(wallTexture(RH, homeCss));
    const wallSide = wallBase.clone();
    wallSide.repeat.set(roomD / WALL_TILE, 1);
    wallSide.needsUpdate = true;
    tex(wallSide);
    const wallEnd = wallBase.clone();
    wallEnd.repeat.set(roomW / WALL_TILE, 1);
    wallEnd.needsUpdate = true;
    tex(wallEnd);
    const deck = tex(deckTexture());
    deck.repeat.set(roomW / 1.6, roomD / 1.6);
    // Painted surfaces glow faintly with their own texture so the room reads
    // as lit by the bay lamps: bright in house, near dark in show.
    const glowing: ReturnType<typeof std>[] = [];
    const glow = (m: ReturnType<typeof std>) => {
        m.emissive.set(0xffffff);
        m.emissiveMap = m.map;
        glowing.push(m);
        return m;
    };
    const wallMat = (map: Texture) =>
        glow(std(0xffffff, { map, side: BackSide, roughness: 0.92 }));
    const roomGeo = new BoxGeometry(roomW, RH, roomD);
    geometries.push(roomGeo);
    const shell = new Mesh(roomGeo, [
        wallMat(wallSide),
        wallMat(wallSide),
        glow(std(0xffffff, { map: deck, side: BackSide, roughness: 0.6 })),
        std(0x2a2b31, { side: BackSide }),
        wallMat(wallEnd),
        wallMat(wallEnd),
    ]);
    shell.name = "gym-room";
    shell.position.set(cx, RH / 2 - 0.1, roomCz);
    shell.receiveShadow = true;
    root.add(shell);

    // Maple floor with court lines and safety tape.
    const floorGeo = new PlaneGeometry(roomW, roomD);
    geometries.push(floorGeo);
    const floor = new Mesh(
        floorGeo,
        std(0xffffff, {
            map: floorTexture({
                ...room,
                footprint: fp,
                homeColor: homeCss,
                text: params.endZoneText.toUpperCase().slice(0, 9),
                maxSize: quality === "high" ? 4096 : 2048,
            }),
            roughness: 0.32,
        }),
    );
    floor.name = "gym-floor";
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, roomCz);
    floor.receiveShadow = true;
    root.add(floor);

    // Overhead structure, hidden when the camera is above the ceiling.
    const ceiling = new Group();
    ceiling.name = "gym-ceiling";
    root.add(ceiling);
    const steel = std(0x4b5058, { metalness: 0.4, roughness: 0.6 });
    const nT = Math.max(3, Math.round(roomD / 6.5));
    const trussZ = (k: number) => room.minZ + ((k + 0.5) * roomD) / nT;
    const nP = Math.max(4, Math.round(roomW / 3.2));
    const panelX = (i: number) => room.minX + (i * roomW) / nP;
    const topY = RH - 0.4;
    const botY = RH - 1.5;
    const trusses = new InstancedMesh(unitBox, steel, nT * (2 + nP));
    trusses.name = "gym-trusses";
    let ti = 0;
    for (let k = 0; k < nT; k++) {
        const z = trussZ(k);
        place(trusses, ti++, [cx, topY, z], [roomW - 0.2, 0.14, 0.2]);
        place(trusses, ti++, [cx, botY, z], [roomW - 0.2, 0.14, 0.2]);
        for (let i = 0; i < nP; i++) {
            const up = i % 2 === 0;
            placeBar(
                trusses,
                ti++,
                [panelX(i), up ? botY : topY, z],
                [panelX(i + 1), up ? topY : botY, z],
                0.07,
            );
        }
    }
    trusses.frustumCulled = false;
    const joists = new InstancedMesh(
        unitBox,
        std(0x6a6f76, { metalness: 0.3, roughness: 0.7 }),
        nP + 1,
    );
    joists.name = "gym-joists";
    for (let i = 0; i <= nP; i++)
        place(
            joists,
            i,
            [
                Math.min(room.maxX - 0.2, Math.max(room.minX + 0.2, panelX(i))),
                RH - 0.24,
                roomCz,
            ],
            [0.12, 0.14, roomD - 0.2],
        );
    ceiling.add(trusses, joists);

    // Round ductwork and a sprinkler main along x, hung between trusses.
    const ductGeo = new CylinderGeometry(1, 1, 1, 14);
    ductGeo.rotateZ(Math.PI / 2);
    geometries.push(ductGeo);
    const ducts = new InstancedMesh(
        ductGeo,
        std(0xb9bdc4, { metalness: 0.7, roughness: 0.4 }),
        2,
    );
    ducts.name = "gym-ducts";
    const duct = (z: number, r: number, y: number, i: number) =>
        place(ducts, i, [cx, y, z], [roomW - 1, r, r]);
    duct((trussZ(1) + trussZ(2)) / 2, 0.5, RH - 2.0, 0);
    duct((trussZ(nT - 3) + trussZ(nT - 2)) / 2, 0.3, RH - 1.7, 1);
    const pipe = new InstancedMesh(
        ductGeo,
        std(0xb02a22, { roughness: 0.5 }),
        1,
    );
    pipe.name = "gym-sprinkler";
    place(
        pipe,
        0,
        [cx, RH - 1.0, (trussZ(0) + trussZ(1)) / 2],
        [roomW - 1, 0.07, 0.07],
    );
    ceiling.add(ducts, pipe);

    // High-bay lamps hung from the trusses.
    const nL = Math.max(2, Math.round(roomW / 6));
    const lampXs = Array.from(
        { length: nL },
        (_, i) => room.minX + ((i + 0.5) * roomW) / nL,
    );
    const lampY = RH - 2.45;
    const shadeGeo = new CylinderGeometry(0.2, 0.55, 0.36, 14, 1, true);
    geometries.push(shadeGeo);
    const shades = new InstancedMesh(
        shadeGeo,
        std(0x8a8e95, { metalness: 0.6, roughness: 0.45, side: BackSide }),
        nL * nT,
    );
    shades.name = "gym-lamp-shades";
    const discGeo = new CylinderGeometry(0.45, 0.45, 0.04, 14);
    geometries.push(discGeo);
    const panelMat = std(0x222222, {
        emissive: 0xfff1d6,
        emissiveIntensity: lightingValues("house").kit.panelEmissive,
    });
    const panels = new InstancedMesh(discGeo, panelMat, nL * nT);
    panels.name = "gym-panels";
    const stems = new InstancedMesh(unitBox, steel, nL * nT);
    stems.name = "gym-lamp-stems";
    for (let k = 0; k < nT; k++)
        for (let i = 0; i < nL; i++) {
            const n = k * nL + i;
            const p: Vector3Tuple = [lampXs[i], lampY, trussZ(k)];
            place(shades, n, p, [1, 1, 1]);
            place(panels, n, [p[0], lampY - 0.17, p[2]], [1, 1, 1]);
            place(
                stems,
                n,
                [p[0], (botY + lampY + 0.18) / 2, p[2]],
                [0.03, botY - lampY - 0.18, 0.03],
            );
        }
    ceiling.add(shades, panels, stems);

    // Clerestory windows on the side walls: daylight in house, blackout in show.
    const winTex = tex(windowTexture());
    winTex.repeat.set(roomD / 3, 1);
    const windowMat = new MeshBasicMaterial({ map: winTex, color: 0xffffff });
    extras.push(windowMat);
    const winGeo = new PlaneGeometry(roomD - 1, 1.9);
    geometries.push(winGeo);
    for (const sg of [-1, 1]) {
        const m = new Mesh(winGeo, windowMat);
        m.name = sg < 0 ? "gym-windows-west" : "gym-windows-east";
        m.position.set(
            sg < 0 ? room.minX + 0.04 : room.maxX - 0.04,
            8.2,
            roomCz,
        );
        m.rotation.y = sg < 0 ? Math.PI / 2 : -Math.PI / 2;
        root.add(m);
    }

    // Bleachers: front side only, rising toward +z.
    const bleacherLength = Math.min(roomW - 1, w + 9);
    const bz0 = fp.maxZ + GYM_BLEACHER_GAP;
    const treadTop = (i: number) => GYM_BLEACHER_BASE + i * GYM_BLEACHER_RISE;
    const rowZ = (i: number) =>
        bz0 + i * GYM_BLEACHER_TREAD + GYM_BLEACHER_TREAD / 2;
    const rowsMesh = new InstancedMesh(
        unitBox,
        std(0x5a5f68, { roughness: 0.8, metalness: 0.3 }),
        GYM_BLEACHER_ROWS,
    );
    rowsMesh.name = "gym-bleachers";
    const wood = tex(woodTexture());
    const woodMat = std(0xffffff, { map: wood, roughness: 0.6 });
    const treads = new InstancedMesh(unitBox, woodMat, GYM_BLEACHER_ROWS);
    treads.name = "gym-bleacher-treads";
    const benches = new InstancedMesh(unitBox, woodMat, GYM_BLEACHER_ROWS);
    benches.name = "gym-bleacher-benches";
    const seatRows: SeatRow[] = [];
    for (let i = 0; i < GYM_BLEACHER_ROWS; i++) {
        const h = treadTop(i);
        place(
            rowsMesh,
            i,
            [cx, h / 2 - 0.02, rowZ(i) - 0.01],
            [bleacherLength - 0.1, h - 0.04, GYM_BLEACHER_TREAD - 0.06],
        );
        place(
            treads,
            i,
            [cx, h - 0.01, rowZ(i)],
            [bleacherLength, 0.04, GYM_BLEACHER_TREAD - 0.02],
        );
        place(
            benches,
            i,
            [cx, h + 0.41, bz0 + i * GYM_BLEACHER_TREAD + 0.23],
            [bleacherLength, 0.05, 0.27],
        );
        const z = bz0 + i * GYM_BLEACHER_TREAD + GYM_BLEACHER_TREAD * 0.42;
        seatRows.push({
            points: [
                [cx - bleacherLength / 2 + 0.5, h, z],
                [cx + bleacherLength / 2 - 0.5, h, z],
            ],
            closed: false,
            depth: GYM_BLEACHER_TREAD,
            side: "home",
        });
    }
    rowsMesh.castShadow = rowsMesh.receiveShadow = quality === "high";
    treads.receiveShadow = benches.receiveShadow = quality === "high";
    root.add(rowsMesh, treads, benches);

    // Bleacher rails: sloped end rails with posts, and a guard rail behind the top row.
    const railMat = std(0xc9ccd2, { metalness: 0.7, roughness: 0.35 });
    const guardX = Math.floor(bleacherLength / 2 / 2);
    const nGuard = guardX * 2 + 1;
    const rails = new InstancedMesh(
        unitBox,
        railMat,
        2 + 2 * GYM_BLEACHER_ROWS + 1 + nGuard,
    );
    rails.name = "gym-bleacher-rails";
    let ri = 0;
    const railTop = (i: number) => treadTop(i) + 0.95;
    for (const sg of [-1, 1]) {
        const x = cx + (sg * bleacherLength) / 2;
        placeBar(
            rails,
            ri++,
            [x, railTop(0), rowZ(0) - 0.25],
            [x, railTop(GYM_BLEACHER_ROWS - 1), rowZ(GYM_BLEACHER_ROWS - 1)],
            0.05,
        );
        for (let i = 0; i < GYM_BLEACHER_ROWS; i++)
            place(
                rails,
                ri++,
                [x, (treadTop(i) + railTop(i)) / 2, rowZ(i) - 0.25],
                [0.04, railTop(i) - treadTop(i), 0.04],
            );
    }
    const backZ = bz0 + GYM_BLEACHER_ROWS * GYM_BLEACHER_TREAD + 0.12;
    const topH = treadTop(GYM_BLEACHER_ROWS - 1);
    place(rails, ri++, [cx, topH + 1.07, backZ], [bleacherLength, 0.05, 0.05]);
    for (let i = -guardX; i <= guardX; i++)
        place(rails, ri++, [cx + i * 2, topH + 0.55, backZ], [0.04, 1.1, 0.04]);
    root.add(rails);

    // Folded bleachers against the back wall, a stack of wood with steel frames.
    const foldedW = Math.min(roomW - 4, w + 6);
    const folded = new Mesh(unitBox, woodMat);
    folded.name = "gym-folded-bleachers";
    folded.scale.set(foldedW, 4, 1.2);
    folded.position.set(cx, 2, room.minZ + 0.7);
    folded.castShadow = quality === "high";
    const SLATS = 8;
    const slats = new InstancedMesh(
        unitBox,
        std(0x2f2a24, { roughness: 0.9 }),
        SLATS,
    );
    slats.name = "gym-folded-slats";
    for (let i = 0; i < SLATS; i++)
        place(
            slats,
            i,
            [cx, 0.3 + i * 0.5, room.minZ + 1.31],
            [foldedW - 0.2, 0.05, 0.05],
        );
    const nFrames = Math.floor(foldedW / 3) + 1;
    const frames = new InstancedMesh(unitBox, railMat, nFrames);
    frames.name = "gym-folded-frames";
    for (let i = 0; i < nFrames; i++)
        place(
            frames,
            i,
            [
                cx - foldedW / 2 + (i * foldedW) / (nFrames - 1),
                2,
                room.minZ + 1.34,
            ],
            [0.08, 4, 0.06],
        );
    root.add(folded, slats, frames);

    // Championship banners in a row on the back wall, above the folded bleachers.
    const bannerGeo = new PlaneGeometry(2.1, 3);
    geometries.push(bannerGeo);
    const spacing = Math.min(3.2, (roomW - 4) / BANNERS.length);
    BANNERS.forEach(([lines, color], i) => {
        const m = new Mesh(
            bannerGeo,
            std(0xffffff, {
                map: tex(bannerTexture(lines, color)),
                roughness: 0.9,
                transparent: true,
                alphaTest: 0.5,
            }),
        );
        m.name = `gym-banner-${i}`;
        m.position.set(
            cx + (i - (BANNERS.length - 1) / 2) * spacing,
            6.9,
            room.minZ + 0.06,
        );
        root.add(m);
    });

    // Wall hardware: scoreboard, mascot lettering, mats, doors and exit signs.
    const wallAt = (
        side: "back" | "west" | "east",
        along: number,
        y: number,
        inset: number,
    ): { p: Vector3Tuple; q: Quaternion } => {
        if (side === "back")
            return { p: [along, y, room.minZ + inset], q: rotY(0) };
        if (side === "east")
            return { p: [room.maxX - inset, y, along], q: rotY(-Math.PI / 2) };
        return { p: [room.minX + inset, y, along], q: rotY(Math.PI / 2) };
    };
    const planeGeo = (wd: number, ht: number) => {
        const g = new PlaneGeometry(wd, ht);
        geometries.push(g);
        return g;
    };
    const wallPlane = (
        name: string,
        geo: PlaneGeometry,
        mat: MeshBasicMaterial | ReturnType<typeof std>,
        side: "back" | "west" | "east",
        along: number,
        y: number,
        inset: number,
    ) => {
        const t = wallAt(side, along, y, inset);
        const m = new Mesh(geo, mat);
        m.name = name;
        m.position.set(...t.p);
        m.quaternion.copy(t.q);
        root.add(m);
    };
    // Scoreboard (east wall) and its backing box.
    const board = std(0xffffff, {
        map: tex(scoreboardTexture()),
        emissive: 0xffffff,
        emissiveIntensity: 0.55,
        roughness: 0.5,
    });
    board.emissiveMap = board.map;
    const boardZ = cz;
    wallPlane(
        "gym-scoreboard",
        planeGeo(5.2, 1.95),
        board,
        "east",
        boardZ,
        5.3,
        0.3,
    );
    const backing = new Mesh(unitBox, std(0x1a1b1f, { roughness: 0.6 }));
    backing.name = "gym-scoreboard-body";
    backing.scale.set(0.28, 2.1, 5.4);
    backing.position.set(room.maxX - 0.14, 5.3, boardZ);
    root.add(backing);
    // Painted lettering on the west wall.
    const lettering = (params.endZoneText || "WARRIORS")
        .toUpperCase()
        .slice(0, 12);
    wallPlane(
        "gym-wordmark",
        planeGeo(9, 2.25),
        std(0xffffff, {
            map: tex(wordmarkTexture(lettering, homeCss)),
            transparent: true,
            alphaTest: 0.4,
            roughness: 0.9,
        }),
        "west",
        cz,
        4.7,
        0.03,
    );
    // Wall mats behind the (folded-up) baskets.
    const matCount = 4;
    const mats = new InstancedMesh(
        unitBox,
        std(0xffffff, { map: tex(matTexture(homeCss)), roughness: 0.55 }),
        matCount,
    );
    mats.name = "gym-wall-mats";
    for (let i = 0; i < matCount; i++) {
        const side = i < 2 ? "west" : "east";
        const t = wallAt(side, cz + ((i % 2) - 0.5) * 2.6, 1.05, 0.1);
        place(mats, i, t.p, [2.55, 2.1, 0.2], t.q);
    }
    root.add(mats);
    // Doors: double steel doors with a push bar, window slits and an exit sign.
    const doorSpots: ["back" | "west" | "east", number][] = [
        ["back", cx - foldedW / 2 - 1.8],
        ["back", cx + foldedW / 2 + 1.8],
        ["east", fp.maxZ + 8],
        ["west", room.minZ + 6],
    ].filter(([side, a]) =>
        side !== "back"
            ? true
            : (a as number) > room.minX + 1.5 &&
              (a as number) < room.maxX - 1.5,
    ) as ["back" | "west" | "east", number][];
    const nDoor = doorSpots.length;
    const doorFrames = new InstancedMesh(
        unitBox,
        std(0x30343a, { roughness: 0.6 }),
        nDoor,
    );
    const doorLeaves = new InstancedMesh(
        unitBox,
        std(0x7d8996, { metalness: 0.5, roughness: 0.5 }),
        nDoor * 2,
    );
    const doorGlass = new InstancedMesh(
        unitBox,
        std(0x0f1620, { roughness: 0.2, metalness: 0.4 }),
        nDoor * 2,
    );
    const doorBars = new InstancedMesh(unitBox, railMat, nDoor * 2);
    const exitSigns = new InstancedMesh(
        unitBox,
        std(0x300606, { emissive: 0xff2a1c, emissiveIntensity: 1.6 }),
        nDoor,
    );
    doorFrames.name = "gym-door-frames";
    doorLeaves.name = "gym-door-leaves";
    doorGlass.name = "gym-door-glass";
    doorBars.name = "gym-door-bars";
    exitSigns.name = "gym-exit-signs";
    doorSpots.forEach(([side, along], n) => {
        const t = wallAt(side, along, 0, 0);
        const at = (lx: number, ly: number, lz: number): Vector3Tuple => {
            const v = new Vector3(lx, ly, lz).applyQuaternion(t.q);
            return [t.p[0] + v.x, ly, t.p[2] + v.z];
        };
        place(doorFrames, n, at(0, 1.18, 0.06), [2.3, 2.36, 0.12], t.q);
        for (const [j, lx] of [-0.5, 0.5].entries()) {
            place(
                doorLeaves,
                n * 2 + j,
                at(lx, 1.05, 0.1),
                [0.98, 2.1, 0.06],
                t.q,
            );
            place(
                doorGlass,
                n * 2 + j,
                at(lx, 1.45, 0.14),
                [0.22, 0.85, 0.02],
                t.q,
            );
            place(
                doorBars,
                n * 2 + j,
                at(lx * 0.9, 1.0, 0.16),
                [0.7, 0.05, 0.05],
                t.q,
            );
        }
        place(exitSigns, n, at(0, 2.7, 0.1), [0.55, 0.22, 0.08], t.q);
    });
    root.add(doorFrames, doorLeaves, doorGlass, doorBars, exitSigns);

    // Hoops folded up to the trusses at both baselines.
    const hoopX = [cx - 14.33, cx + 14.33].filter(
        (x) => x > room.minX + 2 && x < room.maxX - 2,
    );
    const boards = new InstancedMesh(
        unitBox,
        std(0xe9edf2, { roughness: 0.3 }),
        hoopX.length,
    );
    boards.name = "gym-hoops";
    const cables = new InstancedMesh(unitBox, steel, hoopX.length * 2);
    cables.name = "gym-hoop-cables";
    hoopX.forEach((x, n) => {
        place(boards, n, [x, botY - 1.2, cz], [0.06, 1.05, 1.8]);
        for (const [j, dz] of [-0.8, 0.8].entries())
            place(
                cables,
                n * 2 + j,
                [x, (botY + botY - 1.2) / 2, cz + dz],
                [0.03, 1.2, 0.03],
            );
    });
    root.add(boards, cables);

    // Lights: four show spots with visible haze beams and one overhead directional.
    const spotX = Math.max(6, w * 0.44);
    const spotZs = [fp.maxZ + 7.6, fp.minZ - 7.6];
    const showSpots: SpotLight[] = [];
    const beams: Mesh[] = [];
    const beamMat = new MeshBasicMaterial({
        color: 0xd8ceff,
        transparent: true,
        opacity: 0.07,
        alphaMap: tex(beamTexture()),
        blending: AdditiveBlending,
        depthWrite: false,
        side: BackSide,
        fog: false,
    });
    extras.push(beamMat);
    for (const sx of [-1, 1]) {
        for (const sz of spotZs) {
            const sp = new SpotLight(0xf3eaff, 0, 0, 0.42, 0.7, 0);
            sp.position.set(cx + sx * spotX, RH - 0.6, sz);
            sp.target.position.set(cx + sx * spotX * 0.3, 0, cz);
            root.add(sp, sp.target);
            showSpots.push(sp);
            const len = sp.position.distanceTo(sp.target.position);
            const beamGeo = new CylinderGeometry(
                0.12,
                Math.tan(0.42) * len * 0.45,
                len,
                20,
                1,
                true,
            );
            beamGeo.translate(0, -len / 2, 0);
            beamGeo.rotateX(-Math.PI / 2);
            geometries.push(beamGeo);
            const beam = new Mesh(beamGeo, beamMat);
            beam.name = "gym-beam";
            beam.position.copy(sp.position);
            beam.lookAt(sp.target.position);
            beam.visible = false;
            beam.renderOrder = 3;
            root.add(beam);
            beams.push(beam);
        }
    }
    const overhead = new DirectionalLight(0xfff4e6, 1);
    overhead.position.set(cx + 9, 61, cz + 6);
    overhead.target.position.set(cx, 0, cz);
    overhead.castShadow = quality === "high";
    overhead.shadow.mapSize.set(2048, 2048);
    const half = Math.max(w, d) * 0.6 + 6;
    Object.assign(overhead.shadow.camera, {
        left: -half,
        right: half,
        top: half,
        bottom: -half,
        near: 15,
        far: 125,
    });
    overhead.shadow.camera.updateProjectionMatrix();
    root.add(overhead, overhead.target);

    const rowEye = (i: number, dx = 0): Vector3Tuple => [
        cx + dx,
        treadTop(i) + EYE_ABOVE_TREAD,
        rowZ(i),
    ];
    // High enough to frame the whole room at a 50 degree field of view, 16:9.
    const aboveY =
        Math.max(
            (d + 2 * frontPad) / (2 * Math.tan(Math.PI / 7.2)),
            roomW / (2 * Math.tan(Math.PI / 7.2) * 1.6),
            30,
        ) * 1.02;
    const cameras: CameraSeat[] = [
        {
            id: "geJudge",
            labelKey: "view3d.camera.geJudge",
            kind: "seat",
            position: rowEye(9),
            target: [cx, 0, cz - 0.6],
        },
        {
            id: "frontRow",
            labelKey: "view3d.camera.frontRow",
            kind: "seat",
            position: rowEye(0, -Math.min(4.3, bleacherLength * 0.2)),
            target: [cx - 1.8, 1.2, cz],
        },
        {
            id: "corner",
            labelKey: "view3d.camera.corner",
            kind: "aerial",
            position: [room.minX + 1.8, 7.3, fp.maxZ + 6],
            target: [cx, 0, cz],
        },
        {
            id: "floor",
            labelKey: "view3d.camera.floor",
            kind: "floor",
            position: [cx, 1.68, fp.minZ - 1],
            target: [cx, 1.83, fp.maxZ + 6.1],
        },
        {
            id: "topDown",
            labelKey: "view3d.camera.topDown",
            kind: "topDown",
            position: [cx, aboveY, cz + 0.06],
            target: [cx, 0, cz],
        },
    ];

    const lightingPresets: LightingPreset[] = ["house", "show"];
    const setLighting = (preset: LightingPreset): void => {
        if (!lightingPresets.includes(preset)) return;
        const k = lightingValues(preset).kit;
        panelMat.emissiveIntensity = k.panelEmissive;
        // Windows read as daylight in house and are blacked out for the show.
        glowing.forEach(
            (m) => (m.emissiveIntensity = preset === "show" ? 0.03 : 0.34),
        );
        windowMat.color.setScalar(preset === "show" ? 0.05 : 1);
        board.emissiveIntensity = preset === "show" ? 1.4 : 0.55;
        setLightIntensity(overhead, k.overheadIntensity);
        showSpots.forEach((s) => setLightIntensity(s, k.showSpotIntensity));
        beams.forEach((b) => (b.visible = k.showSpotIntensity > 0));
    };
    setLighting("house");

    const pickTargets: Object3D[] = [rowsMesh];
    return {
        root,
        focus: [cx, 0, cz],
        cameras,
        seatRows,
        pickTargets,
        crowdDensity: 0.75,
        lightingPresets,
        defaultLighting: "house",
        setLighting,
        onFrame({ cameraPosition }: FrameContext) {
            const inside = cameraPosition[1] < RH - 0.5;
            ceiling.visible = inside;
            panels.visible = inside;
        },
        dispose() {
            geometries.forEach((g) => g.dispose());
            root.traverse((o) => {
                if (o instanceof InstancedMesh) o.dispose();
            });
            extras.forEach((e) => e.dispose());
            overhead.shadow.map?.dispose();
            shared.dispose();
            root.clear();
        },
    };
};
