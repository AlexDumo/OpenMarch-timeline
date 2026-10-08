/**
 * An instrument as rigid geometry on the right hand (docs/3d/instruments.md
 * §4), in the body's bind pose so om-pose's instanced skinning carries it
 * with the hand, colored per vertex in the look's finish, and the smooth
 * metallic material that draws it under the same bake.
 */
import * as THREE from "three";
import {
    BRASS_COLORS,
    type InstrumentModel,
} from "@/view3d/core/instruments/brass";
import type { Finish } from "@/view3d/core/instruments/catalog";
import type { Hold } from "@/view3d/core/instruments/holds";
import { PART_METAL } from "@/view3d/core/instruments/mesh";
import {
    instancedSkinning,
    type Bake,
} from "@/view3d/vendor/om-pose/instanced-marchers.js";
import type { ArmPose } from "./armPose";

/** The metal's sRGB color per finish: gold lacquer, silver lacquer. */
export const FINISH_COLORS: Record<Finish, number> = {
    brass: BRASS_COLORS[PART_METAL],
    silver: 0xd4d8de,
};

/** The instrument frame placed in the body frame by a hold. */
function placement(hold: Hold): THREE.Matrix4 {
    const z = new THREE.Vector3(...hold.instrument.bellAxis).normalize();
    const y = new THREE.Vector3(...hold.instrument.capsAxis).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    return new THREE.Matrix4()
        .makeBasis(x, y, z)
        .setPosition(new THREE.Vector3(...hold.instrument.origin));
}

const linear = (hex: number) => new THREE.Color(hex); // Color converts sRGB hex to linear

export function instrumentGeometry(
    skeleton: THREE.Skeleton,
    pose: ArmPose,
    hold: Hold,
    model: InstrumentModel,
    finish: Finish = "brass",
): THREE.BufferGeometry {
    const handR = skeleton.bones.findIndex((b) => b.name === "DEF-handR");
    if (handR < 0) throw new Error("instrumentGeometry: no DEF-handR bone");
    // body (placed) -> hand-local (posed) -> bind pose
    const bindHand = skeleton.boneInverses[handR].clone().invert();
    const toBind = bindHand
        .multiply(pose.handR.clone().invert())
        .multiply(placement(hold));
    const normalM = new THREE.Matrix3().getNormalMatrix(toBind);
    const metal = linear(FINISH_COLORS[finish]);
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const si: number[] = [];
    const sw: number[] = [];
    const part: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (const piece of model.pieces) {
        const first = pos.length / 3;
        const fallback = linear(
            BRASS_COLORS[piece.part] ?? BRASS_COLORS[PART_METAL],
        );
        for (let i = 0; i < piece.positions.length; i += 3) {
            v.set(
                piece.positions[i],
                piece.positions[i + 1],
                piece.positions[i + 2],
            ).applyMatrix4(toBind);
            pos.push(v.x, v.y, v.z);
            v.set(piece.normals[i], piece.normals[i + 1], piece.normals[i + 2])
                .applyMatrix3(normalM)
                .normalize();
            nrm.push(v.x, v.y, v.z);
            if (piece.part === PART_METAL) col.push(metal.r, metal.g, metal.b);
            else if (piece.colors)
                col.push(
                    piece.colors[i],
                    piece.colors[i + 1],
                    piece.colors[i + 2],
                );
            else col.push(fallback.r, fallback.g, fallback.b);
            si.push(handR, 0, 0, 0);
            sw.push(1, 0, 0, 0);
            part.push(piece.part);
        }
        for (const k of piece.indices) idx.push(first + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute("_part", new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    return g;
}

/**
 * The instruments' material: smooth, metallic, colored per vertex, driven
 * by the same bake as the bodies. One per marcher set.
 */
export function instrumentMaterial(bake: Bake): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.25,
        vertexColors: true,
        flatShading: false,
        envMapIntensity: 1,
        // bells and tube ends are open surfaces: looking into a bell must show its inside
        side: THREE.DoubleSide,
    });
    return instancedSkinning(THREE, material, bake);
}
