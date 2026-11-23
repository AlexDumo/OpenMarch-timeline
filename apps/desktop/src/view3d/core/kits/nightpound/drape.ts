import {
    BoxGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Vector3,
    type CanvasTexture,
    type BufferGeometry,
    type Material,
} from "three";
import { Members } from "../pro/geometry";
import {
    dieselTexture,
    OM,
    OPENMARCH_TAGLINE,
    OPENMARCH_URL,
    paintLogo,
    paintLogoPanel,
    signText,
    LOGO_ASPECT,
} from "../markDiesel/brand";
import { Cloth, type Row } from "../markDiesel/drape";
import {
    CURTAIN_TUNNEL,
    DRAPE_HEIGHT,
    ENTRY,
    EXIT,
    type NightpoundCtx,
    type NightpoundPart,
} from "./frame";
import {
    DRAPE_RUN,
    DRAPE_TOP,
    DRAPE_Z,
    FLOOR,
    STACK,
    TUNNEL_PLAN,
} from "./plan";

/** The box's cloth roof runs back over the stack to the cross aisle's edge. */
const ROOF_BACK = FLOOR.minZ - 1.2;
/** The folded 100s: eleven rows, each folded seat a nosing on the stack's face. */
const STACK_ROWS = 11;

/** The event's name on the drape's center banner. */
export const NIGHTPOUND_EVENT = "WORLD CHAMPIONSHIPS";
export const NIGHTPOUND_PLACE = "NIGHTPOUND, OH";

/** Black serge, linear albedo (as Mark Diesel's drape). */
const CLOTH: [number, number, number] = [0.026, 0.03, 0.043];
const HEM: [number, number, number] = [0.085, 0.09, 0.105];
const PIPE = 0x22242a;
const TRUSS = 0xb9bdc4;

/** The center banner and the sponsor panels on the drape's face. */
const BANNER = { width: 9.6, height: 1.2, y: DRAPE_HEIGHT - 0.95 };
const PANEL = { width: 2.6, height: 2.6, y: DRAPE_HEIGHT - 1.75 };
/** Where the sponsor panels hang, as a share of the drape's half-run from center. */
const PANEL_AT = [0.52, 0.86];

/** Width over height of the center banner. */
const BANNER_ASPECT = BANNER.width / BANNER.height;

/**
 * The center banner: the OpenMarch logo, a lavender rule and the event's
 * name over the place, white on black, like the drape's banner in the
 * reference photos (where the event's own marks hang).
 */
function paintBanner(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(207,203,230,0.18)";
    g.lineWidth = Math.max(2, h * 0.012);
    g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    const logoH = h * 0.6;
    const logoW = logoH * LOGO_ASPECT;
    const gap = h * 0.4;
    const textW = w - h * 0.9 - logoW - 2 * gap;
    let at = h * 0.45;
    paintLogo(g, at + logoW / 2, h / 2, logoH, OM.white);
    at += logoW + gap;
    g.fillStyle = OM.lavender;
    g.fillRect(at - h * 0.015, h * 0.2, h * 0.03, h * 0.6);
    signText(g, NIGHTPOUND_EVENT, at + gap, h * 0.4, h * 0.27, {
        color: OM.white,
        spacing: 0.06,
        maxWidth: textW,
    });
    signText(g, NIGHTPOUND_PLACE, at + gap, h * 0.74, h * 0.13, {
        color: OM.lavender,
        spacing: 0.2,
        maxWidth: textW,
    });
}

/** A sponsor panel: the app icon over the tagline and the address. */
function paintSponsor(g: CanvasRenderingContext2D, w: number, h: number) {
    paintLogoPanel(g, w, h);
    g.fillStyle = OM.ink;
    g.fillRect(w * 0.06, h * 0.78, w * 0.88, h * 0.18);
    signText(g, OPENMARCH_TAGLINE, w / 2, h * 0.835, h * 0.032, {
        color: OM.white,
        align: "center",
        spacing: 0.08,
        maxWidth: w * 0.84,
    });
    signText(g, OPENMARCH_URL, w / 2, h * 0.9, h * 0.03, {
        color: OM.lavender,
        align: "center",
        spacing: 0.1,
        maxWidth: w * 0.7,
    });
}

/**
 * The back of the floor in WGI trim, in kit-root space:
 *
 * - the drape, 11 ft of pleated black cloth on a pipe along the back of the
 *   safety zone, with the event's banner at its center and sponsor panels
 *   either side;
 * - the box it makes with the curtain tunnel behind it: a black cloth roof
 *   on the tunnel's pipe, and a return panel at each end;
 * - the openings at the back corners, the entry at +X and the exit at -X,
 *   each under a black valance on a truss header, with the dark tunnel and
 *   a lit hallway door beyond.
 *
 * The folds are geometry, as in Mark Diesel's drape, so the floor's light
 * rakes across them.
 */
export function buildDrape(ctx: NightpoundCtx): NightpoundPart {
    const { quality, shared } = ctx;
    const high = quality === "high";
    const object = new Group();
    object.name = "nightpound.drape";
    const geos: BufferGeometry[] = [];
    const mats: Material[] = [];
    const textures: CanvasTexture[] = [];
    const at = (x: number, y: number, z: number) => new Vector3(x, y, z);

    // Cloth: the face, the returns and the valances, one geometry.
    const cloth = new Cloth(high ? 0.14 : 0.4);
    const hemTop = DRAPE_HEIGHT;
    const face: Row[] = [
        { y: 0.02, fold: 1, shade: 0.62, out: 0.06 },
        { y: 1.2, fold: 1, shade: 0.9 },
        { y: hemTop - 0.42, fold: 1, shade: 1 },
        { y: hemTop - 0.42, fold: 0.25, shade: 1.1, tint: HEM },
        { y: hemTop, fold: 0, shade: 1.15, tint: HEM },
    ];
    cloth.hang(
        [at(DRAPE_RUN.minX, 0, DRAPE_Z), at(DRAPE_RUN.maxX, 0, DRAPE_Z)],
        face,
        0.14,
        1,
        3,
    );
    // Returns: from the drape's ends back to the tunnel's back, facing the
    // openings.
    const ret: Row[] = [
        { y: 0.02, fold: 1, shade: 0.55 },
        { y: DRAPE_TOP - 0.3, fold: 1, shade: 0.85 },
        { y: DRAPE_TOP, fold: 0, shade: 0.9 },
    ];
    for (const x of [DRAPE_RUN.minX, DRAPE_RUN.maxX])
        cloth.hang(
            [at(x, 0, DRAPE_Z - 0.02), at(x, 0, TUNNEL_PLAN.back)],
            ret,
            0.08,
            1,
            x > 0 ? 11 : 17,
        );
    // Valances over the openings, from the header down to the opening's top.
    for (const [x0, x1, h] of [
        [FLOOR.minX, DRAPE_RUN.minX, EXIT.height],
        [DRAPE_RUN.maxX, FLOOR.maxX, ENTRY.height],
    ] as const)
        cloth.hang(
            [at(x0, 0, DRAPE_Z), at(x1, 0, DRAPE_Z)],
            [
                { y: h, fold: 0.6, shade: 0.8 },
                { y: DRAPE_TOP, fold: 0, shade: 0.95, tint: HEM },
            ],
            0.06,
            1,
            x0 > 0 ? 5 : 9,
        );
    const clothGeo = cloth.build();
    geos.push(clothGeo);
    const clothMat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        side: DoubleSide,
    });
    mats.push(clothMat);
    const clothMesh = new Mesh(clothGeo, clothMat);
    clothMesh.name = "nightpound.drape.cloth";
    clothMesh.castShadow = high;
    clothMesh.receiveShadow = high;
    object.add(clothMesh);

    // The box's roof: cloth on the tunnel's pipe, sagging between battens.
    const roofW = DRAPE_RUN.maxX - DRAPE_RUN.minX + (EXIT.width + ENTRY.width);
    const roofD = DRAPE_Z - ROOF_BACK;
    const roofGeo = new PlaneGeometry(roofW, roofD, high ? 48 : 12, 4);
    const rp = roofGeo.getAttribute("position");
    for (let i = 0; i < rp.count; i++) {
        const u = rp.getY(i) / roofD + 0.5;
        rp.setZ(
            i,
            -0.12 * Math.sin(Math.PI * u) * (0.8 + 0.2 * Math.sin(rp.getX(i))),
        );
    }
    roofGeo.computeVertexNormals();
    geos.push(roofGeo);
    const roof = new Mesh(
        roofGeo,
        shared.std(0x0b0c10, { roughness: 1, side: DoubleSide }),
    );
    roof.name = "nightpound.drape.roof";
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(
        (FLOOR.minX + FLOOR.maxX) / 2,
        DRAPE_TOP,
        (DRAPE_Z + ROOF_BACK) / 2,
    );
    object.add(roof);

    // Pipe and truss: the drape's pipe, the headers over the openings and
    // their legs, and the tunnel's truss down its back.
    const steel = new Members();
    steel.beam(
        at(FLOOR.minX, DRAPE_TOP, DRAPE_Z),
        at(FLOOR.maxX, DRAPE_TOP, DRAPE_Z),
        0.06,
        PIPE,
    );
    for (const [x0, x1] of [
        [FLOOR.minX + 0.15, DRAPE_RUN.minX],
        [DRAPE_RUN.maxX, FLOOR.maxX - 0.15],
    ] as const) {
        steel.truss(
            at(x0, DRAPE_TOP, DRAPE_Z + 0.25),
            at(x1, DRAPE_TOP, DRAPE_Z + 0.25),
            0.3,
            0.3,
            0.035,
            0.018,
            TRUSS,
        );
        for (const x of [x0, x1])
            steel.beam(
                at(x, 0, DRAPE_Z + 0.25),
                at(x, DRAPE_TOP, DRAPE_Z + 0.25),
                0.3 * 0.6,
                TRUSS,
            );
    }
    steel.truss(
        at(FLOOR.minX + 0.4, CURTAIN_TUNNEL.height, TUNNEL_PLAN.back + 0.3),
        at(FLOOR.maxX - 0.4, CURTAIN_TUNNEL.height, TUNNEL_PLAN.back + 0.3),
        0.3,
        0.3,
        0.035,
        0.018,
        TRUSS,
    );
    // The folded 100s behind the tunnel, seen through the openings: a dark
    // stack with each row's nosing and folded seats stepping back as it rises.
    for (let i = 0; i < STACK_ROWS; i++) {
        const y = 0.35 + (i * (STACK.height - 0.35)) / (STACK_ROWS - 1);
        const z = STACK.front - 0.04 - i * 0.06;
        steel.box(
            at(0, y - 0.12, z - 0.3),
            [FLOOR.maxX - FLOOR.minX - 0.2, 0.24, 0.6],
            0x1b2036,
        );
        steel.box(
            at(0, y, z),
            [FLOOR.maxX - FLOOR.minX - 0.2, 0.05, 0.08],
            0x8a8782,
        );
    }
    const unit = new BoxGeometry(1, 1, 1);
    geos.push(unit);
    const steelMat = shared.std(0xffffff, { metalness: 0.4, roughness: 0.5 });
    const steelMesh = steel.build(unit, steelMat, "nightpound.drape.steel");
    steelMesh.castShadow = high;
    object.add(steelMesh);

    // Beyond each opening: the tunnel's dark mouth and, at its far end, the
    // lit hallway door the groups come down from.
    const darkMat = shared.std(0x050506, { roughness: 1, side: DoubleSide });
    for (const [x0, x1, h, name] of [
        [FLOOR.minX, DRAPE_RUN.minX, EXIT.height, "exit"],
        [DRAPE_RUN.maxX, FLOOR.maxX, ENTRY.height, "entry"],
    ] as const) {
        const w = x1 - x0;
        const cx = (x0 + x1) / 2;
        const back = new PlaneGeometry(w, h);
        geos.push(back);
        const wall = new Mesh(back, darkMat);
        wall.name = `nightpound.${name}.back`;
        wall.position.set(cx, h / 2, FLOOR.minZ + 0.02);
        object.add(wall);
        const doorGeo = new PlaneGeometry(Math.min(2.4, w * 0.5), 2.3);
        geos.push(doorGeo);
        const doorMat = new MeshBasicMaterial({ color: 0xd9d2c3 });
        mats.push(doorMat);
        const door = new Mesh(doorGeo, doorMat);
        door.name = `nightpound.${name}.door`;
        door.position.set(cx, 1.15, FLOOR.minZ + 0.05);
        object.add(door);
    }

    // The banner and the sponsor panels, on the drape's face.
    const bannerTex = dieselTexture(
        2560,
        Math.round(2560 / BANNER_ASPECT),
        paintBanner,
    );
    const sponsorTex = dieselTexture(1024, 1024, paintSponsor);
    textures.push(bannerTex, sponsorTex);
    const sign = (tex: CanvasTexture) => {
        const m = new MeshStandardMaterial({
            map: tex,
            roughness: 0.85,
            emissive: 0xffffff,
            emissiveMap: tex,
            emissiveIntensity: 0.05,
        });
        mats.push(m);
        return m;
    };
    const bannerGeo = new PlaneGeometry(BANNER.width, BANNER.height);
    geos.push(bannerGeo);
    const banner = new Mesh(bannerGeo, sign(bannerTex));
    banner.name = "nightpound.drape.banner";
    banner.position.set(
        (DRAPE_RUN.minX + DRAPE_RUN.maxX) / 2,
        BANNER.y,
        DRAPE_Z + 0.2,
    );
    object.add(banner);
    const panelGeo = new PlaneGeometry(PANEL.width, PANEL.height);
    geos.push(panelGeo);
    const sponsorMat = sign(sponsorTex);
    const half = (DRAPE_RUN.maxX - DRAPE_RUN.minX) / 2;
    const mid = (DRAPE_RUN.minX + DRAPE_RUN.maxX) / 2;
    for (const k of PANEL_AT)
        for (const side of [-1, 1]) {
            const p = new Mesh(panelGeo, sponsorMat);
            p.name = "nightpound.drape.sponsor";
            p.position.set(mid + side * k * half, PANEL.y, DRAPE_Z + 0.2);
            object.add(p);
        }

    return {
        object,
        setLighting() {},
        dispose() {
            geos.forEach((g) => g.dispose());
            mats.forEach((m) => m.dispose());
            textures.forEach((t) => t.dispose());
        },
    };
}
