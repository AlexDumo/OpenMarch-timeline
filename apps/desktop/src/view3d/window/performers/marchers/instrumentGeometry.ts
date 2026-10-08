/**
 * An instrument as rigid geometry on the right hand (docs/3d/instruments.md
 * §4), in the body's bind pose so om-pose's instanced skinning carries it
 * with the hand, and the merge of a body's visible triangles with it.
 */
import * as THREE from "three";
import type { InstrumentModel } from "@/view3d/core/instruments/brass";
import type { Hold } from "@/view3d/core/instruments/holds";
import type { ArmPose } from "./armPose";

/** The instrument frame placed in the body frame by a hold. */
function placement(hold: Hold): THREE.Matrix4 {
    const z = new THREE.Vector3(...hold.instrument.bellAxis).normalize();
    const y = new THREE.Vector3(...hold.instrument.capsAxis).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    return new THREE.Matrix4()
        .makeBasis(x, y, z)
        .setPosition(new THREE.Vector3(...hold.instrument.origin));
}

export function instrumentGeometry(
    skeleton: THREE.Skeleton,
    pose: ArmPose,
    hold: Hold,
    model: InstrumentModel,
): THREE.BufferGeometry {
    const handR = skeleton.bones.findIndex((b) => b.name === "DEF-handR");
    if (handR < 0) throw new Error("instrumentGeometry: no DEF-handR bone");
    // body (placed) -> hand-local (posed) -> bind pose
    const bindHand = skeleton.boneInverses[handR].clone().invert();
    const toBind = bindHand
        .multiply(pose.handR.clone().invert())
        .multiply(placement(hold));
    const normalM = new THREE.Matrix3().getNormalMatrix(toBind);
    const pos: number[] = [];
    const nrm: number[] = [];
    const si: number[] = [];
    const sw: number[] = [];
    const part: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (const piece of model.pieces) {
        const first = pos.length / 3;
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
            si.push(handR, 0, 0, 0);
            sw.push(1, 0, 0, 0);
            part.push(piece.part);
        }
        for (const k of piece.indices) idx.push(first + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute("_part", new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    return g;
}

const ATTRIBUTES = [
    "position",
    "normal",
    "skinIndex",
    "skinWeight",
    "_part",
] as const;

/** The body's triangles in `index` (or all of them) followed by the instrument's, as one new geometry. */
export function withInstrument(
    body: THREE.BufferGeometry,
    index: THREE.BufferAttribute | null,
    instrument: THREE.BufferGeometry,
): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const bodyCount = body.getAttribute("position").count;
    for (const name of ATTRIBUTES) {
        const a = body.getAttribute(name) as THREE.BufferAttribute;
        const b = instrument.getAttribute(name) as THREE.BufferAttribute;
        const size = a.itemSize;
        const Ctor = a.array.constructor as new (n: number) => typeof a.array;
        const out = new Ctor((a.count + b.count) * size);
        out.set(a.array as ArrayLike<number>, 0);
        out.set(b.array as ArrayLike<number>, a.count * size);
        g.setAttribute(name, new THREE.BufferAttribute(out, size));
    }
    const bodyIndex = index ?? body.index!;
    const merged: number[] = [];
    for (let i = 0; i < bodyIndex.count; i++) merged.push(bodyIndex.getX(i));
    const hornIndex = instrument.index!;
    for (let i = 0; i < hornIndex.count; i++)
        merged.push(bodyCount + hornIndex.getX(i));
    g.setIndex(merged);
    return g;
}
