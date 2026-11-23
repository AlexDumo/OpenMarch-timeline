import { Group, Mesh, PlaneGeometry, type CanvasTexture } from "three";
import {
    GROUND_LAYER,
    paintCanvasTexture,
    setGroundLayer,
} from "../../environment";
import { AREA, TARP, type NightpoundCtx, type NightpoundPart } from "./frame";
import { FLOOR } from "./plan";

/** Pixels per meter of the tarp's texture. */
const TARP_PX = 48;

/**
 * The tarp's look: charcoal vinyl strips laid front to back, each a shade
 * off its neighbors, with taped seams, a little scuffing from the day's
 * floors and props, white tape at the competition area's corners and center
 * marks, and the red interval-timeline marks at center front and back (the
 * line the next group may not cross while the last one is on the floor).
 */
export function paintTarp(g: CanvasRenderingContext2D, W: number, H: number) {
    const sx = W / (2 * TARP.halfX);
    const sz = H / (2 * TARP.halfZ);
    g.fillStyle = "#26272b";
    g.fillRect(0, 0, W, H);
    // Strips front to back, centered on the area's center line.
    const strip = TARP.strip * sx;
    const first = W / 2 - Math.ceil(W / 2 / strip) * strip;
    for (let x = first, i = 0; x < W; x += strip, i++) {
        const k = (i * 7) % 5;
        g.fillStyle = `rgba(255,255,255,${0.008 + 0.006 * k})`;
        g.fillRect(x, 0, strip, H);
        // The taped seam: a darker band with a faint sheen beside it.
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(x - 0.025 * sx, 0, 0.05 * sx, H);
        g.fillStyle = "rgba(255,255,255,0.035)";
        g.fillRect(x + 0.025 * sx, 0, 0.06 * sx, H);
    }
    // Scuffs: soft pale arcs where floors were dragged on and off.
    let seed = 7;
    const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    g.lineCap = "round";
    for (let i = 0; i < 260; i++) {
        g.strokeStyle = `rgba(200,200,210,${0.01 + rand() * 0.025})`;
        g.lineWidth = (0.02 + rand() * 0.08) * sx;
        const x = rand() * W;
        const y = rand() * H;
        const len = (0.4 + rand() * 2.5) * sx;
        const a = rand() * Math.PI;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(
            x + Math.cos(a) * len * 0.6 + len * 0.2,
            y + Math.sin(a) * len * 0.6,
            x + Math.cos(a) * len,
            y + Math.sin(a) * len,
        );
        g.stroke();
    }
    // White tape: L marks at the competition area's corners, ticks at the
    // centers of its edges.
    const X = (x: number) => (x + TARP.halfX) * sx;
    const Z = (z: number) => (z + TARP.halfZ) * sz;
    const tape = 0.05 * sx;
    const arm = 0.9 * sx;
    g.fillStyle = "rgba(236,236,232,0.9)";
    for (const cx of [-1, 1])
        for (const cz of [-1, 1]) {
            const x = X(cx * AREA.halfX);
            const y = Z(cz * AREA.halfZ);
            g.fillRect(cx < 0 ? x : x - arm, y - tape / 2, arm, tape);
            g.fillRect(x - tape / 2, cz < 0 ? y : y - arm, tape, arm);
        }
    for (const cz of [-1, 1]) {
        const y = Z(cz * AREA.halfZ);
        g.fillRect(
            X(0) - tape / 2,
            cz < 0 ? y : y - arm * 0.6,
            tape,
            arm * 0.6,
        );
    }
    for (const cx of [-1, 1]) {
        const x = X(cx * AREA.halfX);
        g.fillRect(
            cx < 0 ? x : x - arm * 0.6,
            Z(0) - tape / 2,
            arm * 0.6,
            tape,
        );
    }
    // The interval timeline's marks, red, at the center of the front and back.
    g.fillStyle = "rgba(214,40,40,0.95)";
    for (const cz of [-1, 1]) {
        const y = Z(cz * (AREA.halfZ + 0.5));
        g.fillRect(X(0) - 0.06 * sx, y - 0.45 * sz, 0.12 * sx, 0.9 * sz);
    }
}

/**
 * The arena floor: bare concrete from wall to wall, under the black tarp
 * that covers the competition area and its safety zone. The show's own
 * floor lies on the tarp (the field surface, drawn by the scene).
 */
export function buildFloor(ctx: NightpoundCtx): NightpoundPart {
    const { shared } = ctx;
    const object = new Group();
    object.name = "nightpound.floor";
    const geos: PlaneGeometry[] = [];
    const textures: CanvasTexture[] = [];

    const w = FLOOR.maxX - FLOOR.minX;
    const d = FLOOR.maxZ - FLOOR.minZ;
    const concreteGeo = new PlaneGeometry(w, d);
    geos.push(concreteGeo);
    const concrete = new Mesh(
        concreteGeo,
        setGroundLayer(
            shared.std(0x3d3e42, { roughness: 0.92 }),
            GROUND_LAYER.site,
        ),
    );
    concrete.name = "nightpound.concrete";
    concrete.rotation.x = -Math.PI / 2;
    concrete.position.set(
        (FLOOR.minX + FLOOR.maxX) / 2,
        0,
        (FLOOR.minZ + FLOOR.maxZ) / 2,
    );
    concrete.receiveShadow = true;
    object.add(concrete);

    const tarpTex = paintCanvasTexture(
        Math.round(2 * TARP.halfX * TARP_PX),
        Math.round(2 * TARP.halfZ * TARP_PX),
        paintTarp,
        { anisotropy: 8 },
    );
    textures.push(tarpTex);
    const tarpGeo = new PlaneGeometry(2 * TARP.halfX, 2 * TARP.halfZ);
    geos.push(tarpGeo);
    const tarp = new Mesh(
        tarpGeo,
        setGroundLayer(
            shared.std(0xffffff, { map: tarpTex, roughness: 0.62 }),
            GROUND_LAYER.track,
        ),
    );
    tarp.name = "nightpound.tarp";
    tarp.rotation.x = -Math.PI / 2;
    tarp.receiveShadow = true;
    object.add(tarp);

    return {
        object,
        setLighting() {},
        dispose() {
            geos.forEach((g) => g.dispose());
            textures.forEach((t) => t.dispose());
        },
    };
}
