/**
 * Hold gallery: one marcher per section, standing in its `up` hold with its
 * instrument, drawn from several sides so the hands can be checked against
 * the instrument. Uses the real body, `poseArms` and the instrument models;
 * the instrument is placed by the hold exactly as the window places it.
 * Hands are drawn orange. See README.md.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import bodyUrl from "@/view3d/assets/om-pose/bodies/neutral-average.glb?url";
import {
    carryForSection,
    finishFor,
    guardCarry,
    tubaCarry,
    type Carry,
} from "@/view3d/core/instruments/catalog";
import { hold, type HoldState } from "@/view3d/core/instruments/holds";
import { instrumentModel } from "@/view3d/core/instruments";
import {
    PART_BLACK,
    PART_CHROME,
    PART_HEAD,
    PART_METAL,
    PART_SHELL,
    PART_SILK,
    PART_WOOD,
} from "@/view3d/core/instruments/mesh";
import { PART as BODY_PART } from "@/view3d/core/marchers/looks";
import { poseArms } from "@/view3d/window/performers/marchers/armPose";

export interface Entry {
    name: string;
    carry: Carry;
}

const section = (name: string): Entry => ({
    name,
    carry: carryForSection(name)!,
});
export const ENTRIES: Entry[] = [
    section("Trumpet"),
    section("Mellophone"),
    section("Baritone"),
    section("Euphonium"),
    section("Trombone"),
    section("Bass Trombone"),
    { name: "Tuba (marching tuba)", carry: tubaCarry("contra") },
    { name: "Tuba (sousaphone)", carry: tubaCarry("sousaphone") },
    section("Piccolo"),
    section("Flute"),
    section("Clarinet"),
    section("Bass Clarinet"),
    section("Soprano Sax"),
    section("Alto Sax"),
    section("Tenor Sax"),
    section("Bari Sax"),
    section("Snare"),
    section("Tenors"),
    section("Bass Drum"),
    section("Cymbals"),
    section("Color Guard"),
    { name: "Swing flag", carry: guardCarry("swingFlag") },
    { name: "Rifle", carry: guardCarry("rifle") },
    { name: "Sabre", carry: guardCarry("sabre") },
];

export const VIEWS = [
    "front",
    "right side",
    "top",
    "front-right",
    "front-left",
    "front, horn see-through",
];
const TILE = 440;

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(TILE * VIEWS.length, TILE);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-1.5, 3, 2.5);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.8);
fill.position.set(2, 1, -1);
scene.add(fill);

const HAND = new THREE.Color(0xff7a1a);
const SKIN = new THREE.Color(0xa7b0ba);
const PART_COLORS: Record<number, number> = {
    [PART_METAL]: 0xd9a93a,
    [PART_CHROME]: 0xdedede,
    [PART_BLACK]: 0x202022,
    [PART_WOOD]: 0xffffff,
    [PART_SHELL]: 0x2f56b0,
    [PART_HEAD]: 0xeeeeee,
    [PART_SILK]: 0x3b6fd1,
};

let body: THREE.SkinnedMesh;
let instrument: THREE.Mesh | null = null;

async function loadBody() {
    const gltf = await new GLTFLoader().loadAsync(bodyUrl);
    gltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh)
            body = o as THREE.SkinnedMesh;
    });
    // hands orange, everything else grey, by each vertex's heaviest bone
    const g = body.geometry;
    const si = g.getAttribute("skinIndex");
    const sw = g.getAttribute("skinWeight");
    const handBones = new Set(
        body.skeleton.bones
            .map((b, i) => (/DEF-hand[LR]/.test(b.name) ? i : -1))
            .filter((i) => i >= 0),
    );
    const col = new Float32Array(si.count * 3);
    for (let i = 0; i < si.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++)
            if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
        const c = handBones.has(si.getComponent(i, best)) ? HAND : SKIN;
        col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // as the window draws a band look: no placeholder instruments, aussie hat or cape
    const hidden = new Set<number>([
        ...BODY_PART.instruments,
        ...BODY_PART.aussie,
        BODY_PART.cape,
    ]);
    const part = g.getAttribute("_part");
    const index = g.index!;
    const keep: number[] = [];
    for (let t = 0; t < index.count; t += 3)
        if (!hidden.has(Math.round(part.getX(index.getX(t)))))
            keep.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    g.setIndex(keep);
    body.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
    });
    body.frustumCulled = false;
    scene.add(gltf.scene);
}

function placement(h: ReturnType<typeof hold>): THREE.Matrix4 {
    const z = new THREE.Vector3(...h.instrument.bellAxis).normalize();
    const y = new THREE.Vector3(...h.instrument.capsAxis);
    y.sub(z.clone().multiplyScalar(y.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    return new THREE.Matrix4()
        .makeBasis(x, y, z)
        .setPosition(new THREE.Vector3(...h.instrument.origin));
}

function show(entry: Entry, state: HoldState) {
    const h = hold(entry.carry.family, state);
    const pose = poseArms(body.skeleton, h);
    // every bone at bind first (from the inverse bind matrices), then the arms
    const sk = body.skeleton;
    const world = sk.boneInverses.map((m) => m.clone().invert());
    sk.bones.forEach((bone, i) => {
        const p = bone.parent as THREE.Bone;
        const pi = p && p.isBone ? sk.bones.indexOf(p) : -1;
        const parentWorld =
            pi >= 0
                ? world[pi]
                : (bone.parent?.matrixWorld ?? new THREE.Matrix4());
        new THREE.Matrix4()
            .copy(parentWorld)
            .invert()
            .multiply(world[i])
            .decompose(bone.position, bone.quaternion, bone.scale);
        const q = pose.local.get(bone.name);
        if (q && !(window as unknown as { bind?: boolean }).bind)
            bone.quaternion.copy(q);
    });
    body.skeleton.bones[0].updateMatrixWorld(true);
    if (instrument) {
        scene.remove(instrument);
        instrument.geometry.dispose();
    }
    const model = instrumentModel(
        entry.carry.model,
        "high",
        entry.carry.options,
    );
    const silver = finishFor(entry.carry, "brass") === "silver";
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (const p of model.pieces) {
        const first = pos.length / 3;
        const base = new THREE.Color(
            p.part === PART_METAL && silver
                ? 0xeeeeea
                : (PART_COLORS[p.part] ?? 0x888888),
        );
        for (let i = 0; i < p.positions.length; i += 3) {
            pos.push(p.positions[i], p.positions[i + 1], p.positions[i + 2]);
            nrm.push(p.normals[i], p.normals[i + 1], p.normals[i + 2]);
            if (p.colors && p.part !== PART_METAL)
                col.push(p.colors[i], p.colors[i + 1], p.colors[i + 2]);
            else col.push(base.r, base.g, base.b);
        }
        for (const i of p.indices) idx.push(first + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.applyMatrix4(placement(h));
    instrument = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.35,
            roughness: 0.4,
            side: THREE.DoubleSide,
        }),
    );
    scene.add(instrument);

    // frame the upper body and the instrument
    const box = new THREE.Box3()
        .setFromObject(instrument)
        .union(
            new THREE.Box3(
                new THREE.Vector3(-0.4, 0.85, -0.2),
                new THREE.Vector3(0.4, 1.8, 0.35),
            ),
        );
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const half = (Math.max(size.x, size.y, size.z) / 2) * 1.08;
    const dirs: [THREE.Vector3, THREE.Vector3][] = [
        [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
        [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
        [
            new THREE.Vector3(-1, 0.45, 1.1).normalize(),
            new THREE.Vector3(0, 1, 0),
        ],
        [
            new THREE.Vector3(1, 0.45, 1.1).normalize(),
            new THREE.Vector3(0, 1, 0),
        ],
        [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    ];
    const mat = instrument.material as THREE.MeshStandardMaterial;
    dirs.forEach(([dir, up], i) => {
        const cam = new THREE.OrthographicCamera(
            -half,
            half,
            half,
            -half,
            0.01,
            20,
        );
        cam.position.copy(center).addScaledVector(dir, 6);
        cam.up.copy(up);
        cam.lookAt(center);
        renderer.setViewport(i * TILE, 0, TILE, TILE);
        renderer.setScissor(i * TILE, 0, TILE, TILE);
        renderer.setClearColor(i % 2 ? 0x2b3440 : 0x323c4a);
        const seeThrough = i === dirs.length - 1;
        mat.transparent = seeThrough;
        mat.opacity = seeThrough ? 0.3 : 1;
        mat.depthWrite = !seeThrough;
        renderer.render(scene, cam);
    });
    return {
        hold: h,
    };
}

declare global {
    interface Window {
        holds: {
            entries: string[];
            views: string[];
            show: (i: number, state: HoldState) => unknown;
        };
    }
}

await loadBody();
window.holds = {
    entries: ENTRIES.map((e) => e.name),
    views: VIEWS,
    show: (i, state) => show(ENTRIES[i], state),
};
document.title = "holds-ready";
