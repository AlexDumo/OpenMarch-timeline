// cspell:ignore metalness
import {
    CylinderGeometry,
    Euler,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    Quaternion,
    SpotLight,
    Vector3,
    type Texture,
    type Vector3Tuple,
} from "three";
import { setLightIntensity, type SharedMaterials } from "../../environment";
import { scoreboardTexture } from "./textures";

/** Anything the kit has to dispose later. */
export interface Part {
    object: Object3D;
    dispose(): void;
}

const m4 = new Matrix4();
const quat = new Quaternion();
const euler = new Euler();

/**
 * Two sets of goal posts, just behind the end lines (never inside the
 * performance area): padded base, gooseneck, crossbar 3.05 m up and uprights
 * 18 ft 6 in apart. One instanced draw call.
 */
export function goalPosts(
    minX: number,
    maxX: number,
    cz: number,
    material: MeshStandardMaterial,
    padMaterial: MeshStandardMaterial,
): Part[] {
    const geo = new CylinderGeometry(1, 1, 1, 10);
    const mesh = new InstancedMesh(geo, material, 8);
    const pads = new InstancedMesh(geo, padMaterial, 2);
    mesh.name = "goalPosts";
    pads.name = "goalPostPads";
    const place = (
        im: InstancedMesh,
        i: number,
        p: Vector3Tuple,
        r: number,
        len: number,
        axis: "y" | "z",
    ) => {
        quat.setFromEuler(euler.set(axis === "z" ? Math.PI / 2 : 0, 0, 0));
        m4.compose(new Vector3(...p), quat, new Vector3(r, len, r));
        im.setMatrixAt(i, m4);
    };
    const bar = 3.05;
    const half = 2.82;
    const rise = 6.1;
    [minX - 0.6, maxX + 0.6].forEach((x, n) => {
        place(pads, n, [x, 1, cz], 0.3, 2, "y");
        place(mesh, n * 4, [x, bar / 2 + 1, cz], 0.1, bar - 2, "y");
        place(mesh, n * 4 + 1, [x, bar, cz], 0.07, half * 2, "z");
        place(
            mesh,
            n * 4 + 2,
            [x, bar + rise / 2, cz - half],
            0.055,
            rise,
            "y",
        );
        place(
            mesh,
            n * 4 + 3,
            [x, bar + rise / 2, cz + half],
            0.055,
            rise,
            "y",
        );
    });
    mesh.castShadow = true;
    pads.castShadow = true;
    return [
        { object: mesh, dispose: () => mesh.dispose() },
        {
            object: pads,
            dispose: () => {
                pads.dispose();
                geo.dispose();
            },
        },
    ];
}

export interface BankSpot {
    /** Panel center. */
    position: Vector3Tuple;
    /** The point it lights. */
    target: Vector3Tuple;
    /** Gets a SpotLight; the rest are only lamp faces. */
    light: boolean;
}

export interface LightBanks {
    objects: Object3D[];
    spots: SpotLight[];
    setOn(on: boolean, k: number): void;
    dispose(): void;
}

const BANK_W = 10;
const BANK_H = 5;
/** Legs lift a bank this far above the rim. */
export const BANK_LEG = 4;
export const BANK_SIZE: [number, number] = [BANK_W, BANK_H];

/**
 * Banks of lamps on the rim, instead of four poles: a dark frame and two legs
 * (one instanced box mesh) and the lamp faces (one instanced plane). Banks with
 * `light` also own a SpotLight, aimed like the pole spots.
 */
export function lightBanks(
    spots: BankSpot[],
    shared: SharedMaterials,
    lampMap: Texture,
): LightBanks {
    const faceGeo = new PlaneGeometry(1, 1);
    const faceMat = new MeshStandardMaterial({
        color: 0x2a2b30,
        map: lampMap,
        emissive: 0xffffff,
        emissiveMap: lampMap,
        emissiveIntensity: 0,
        roughness: 0.6,
    });
    const faces = new InstancedMesh(faceGeo, faceMat, spots.length);
    const frames = new InstancedMesh(
        shared.unitBox,
        shared.std(0x24262b, { roughness: 0.6, metalness: 0.4 }),
        spots.length * 3,
    );
    faces.name = "bankFaces";
    frames.name = "bankFrames";
    const lights: SpotLight[] = [];
    const extras: Object3D[] = [];
    spots.forEach((b, i) => {
        const [px, py, pz] = b.position;
        const dx = b.target[0] - px;
        const dy = b.target[1] - py;
        const dz = b.target[2] - pz;
        const yaw = Math.atan2(dx, dz);
        const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.5;
        quat.setFromEuler(euler.set(pitch, yaw, 0, "YXZ"));
        const fwd = new Vector3(0, 0, 1).applyQuaternion(quat);
        const at = (local: Vector3Tuple, size: Vector3Tuple, idx: number) => {
            const p = new Vector3(...local)
                .applyQuaternion(quat)
                .add(new Vector3(px, py, pz));
            m4.compose(p, quat, new Vector3(...size));
            frames.setMatrixAt(idx, m4);
        };
        at([0, 0, -0.45], [BANK_W + 0.8, BANK_H + 0.8, 0.8], i * 3);
        // two legs down to the rim, turned with the bank's yaw
        const yawQ = new Quaternion().setFromEuler(euler.set(0, yaw, 0));
        for (const [k, sx] of [-1, 1].entries()) {
            const lx = new Vector3(
                sx * BANK_W * 0.38,
                -BANK_H / 2 - BANK_LEG / 2,
                -0.9,
            ).applyQuaternion(yawQ);
            m4.compose(
                new Vector3(px + lx.x, py + lx.y, pz + lx.z),
                yawQ,
                new Vector3(0.7, BANK_LEG, 0.7),
            );
            frames.setMatrixAt(i * 3 + 1 + k, m4);
        }
        const face = new Vector3(px, py, pz).addScaledVector(fwd, 0.05);
        m4.compose(face, quat, new Vector3(BANK_W, BANK_H, 1));
        faces.setMatrixAt(i, m4);
        if (b.light) {
            const spot = new SpotLight(0xfff3e0, 0, 0, 0.62, 0.6, 0);
            spot.position.set(px, py, pz).addScaledVector(fwd, 1);
            spot.target.position.set(...b.target);
            spot.visible = false;
            lights.push(spot);
            extras.push(spot, spot.target);
        }
    });
    faces.castShadow = false;
    frames.castShadow = true;
    return {
        objects: [faces, frames, ...extras],
        spots: lights,
        setOn(on, k) {
            faceMat.emissiveIntensity = on ? 2.2 * Math.max(0.6, k) : 0;
            for (const s of lights) setLightIntensity(s, on ? 1.6 * k : 0);
        },
        dispose() {
            faceGeo.dispose();
            faceMat.dispose();
            faces.dispose();
            frames.dispose();
            for (const s of lights) s.dispose();
        },
    };
}

export interface Scoreboard {
    object: Group;
    dispose(): void;
}

/**
 * The line-score panel that sits above the video board. Faces +Z; the caller
 * rotates the group.
 */
export function scorePanel(
    w: number,
    h: number,
    home: string,
    away: string,
    shared: SharedMaterials,
): Scoreboard {
    const object = new Group();
    object.name = "scoreboard";
    const frame = new Mesh(shared.unitBox, shared.std(0x1a1b20));
    frame.scale.set(w + 1.2, h + 1.2, 1.2);
    frame.castShadow = true;
    const map = scoreboardTexture(home, away);
    const mat = new MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: 1.1,
    });
    const geo = new PlaneGeometry(w, h);
    const screen = new Mesh(geo, mat);
    screen.position.z = 0.65;
    object.add(frame, screen);
    return {
        object,
        dispose() {
            geo.dispose();
            map.dispose();
            mat.dispose();
        },
    };
}

/** A flat plane whose UVs run 0..repeatU by 0..repeatV (a box face for glass). */
export function facePlane(
    w: number,
    h: number,
    repeatU: number,
    repeatV: number,
): PlaneGeometry {
    const geo = new PlaneGeometry(w, h);
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i) * repeatV);
    }
    uv.needsUpdate = true;
    return geo;
}
