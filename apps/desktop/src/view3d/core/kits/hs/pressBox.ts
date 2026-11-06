import { Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { ft, type SharedMaterials } from "../../environment";
import type { BoxBatch } from "./geometry";
import { pressBoxFacade } from "./textures";

/**
 * A press box that reads as a building: a siding body, a home-colored fascia
 * with the show's text, glass with mullions and people inside, an overhanging
 * roof with a filming deck railing, steel columns down to the ground and a
 * switchback stair tower at the side-2 end. Built in the stand's own frame
 * (front edge at z = 0, rising toward +z).
 */

export interface PressBoxInput {
    width: number;
    height: number;
    lift: number;
    stories: number;
    /** Height of the stand's top tread. */
    top: number;
    /** Back edge of the stand (rows x depth). */
    back: number;
    homeColor: string;
    text: string;
    shared: SharedMaterials;
    /** Columns, railings and stairs go into the stand's steel batch. */
    steel: BoxBatch;
}

export interface PressBox {
    group: Group;
    /** Eye position in the stand frame, in front of the top story's glass. */
    eye: [number, number, number];
    /** Window glow, 0 (day) to 1 (night). */
    setGlow(k: number): void;
    dispose(): void;
}

export function buildPressBox(p: PressBoxInput): PressBox {
    const { width: W, height: H, stories } = p;
    const depth = stories > 1 ? ft(24) : ft(14);
    const y0 = p.top + p.lift;
    const zb = p.back;
    const storyH = H / stories;
    const group = new Group();
    group.name = "pressBox";

    const body = new Mesh(p.shared.unitBox, p.shared.std(0xd9d3c7));
    body.name = "pressBoxBody";
    body.scale.set(W, H, depth);
    body.position.set(0, y0 + H / 2, zb + depth / 2);

    const roof = new Mesh(p.shared.unitBox, p.shared.std(0x3b3e45));
    roof.name = "pressBoxRoof";
    const overhang = ft(4);
    roof.scale.set(W + ft(3), ft(1.2), depth + overhang + ft(1));
    roof.position.set(0, y0 + H + ft(0.6), zb + depth / 2 - overhang / 2);

    // A slab under the floor so the lifted box doesn't float on nothing.
    const slab = new Mesh(p.shared.unitBox, p.shared.concrete);
    slab.name = "pressBoxSlab";
    slab.scale.set(W + ft(1), ft(1.4), depth + ft(1));
    slab.position.set(0, y0 - ft(0.7), zb + depth / 2);

    const tex = pressBoxFacade(W, H, stories, p.homeColor, p.text);
    const faceMat = new MeshStandardMaterial({
        map: tex.map,
        emissive: 0xffffff,
        emissiveMap: tex.emissive,
        emissiveIntensity: 0,
        roughness: 0.35,
        metalness: 0.15,
    });
    const faceGeo = new PlaneGeometry(W, H);
    const face = new Mesh(faceGeo, faceMat);
    face.name = "pressBoxFace";
    face.rotation.y = Math.PI;
    face.position.set(0, y0 + H / 2, zb - 0.03);

    for (const part of [body, roof, slab]) {
        part.castShadow = part.receiveShadow = true;
    }
    group.add(body, roof, slab, face);

    const s = p.steel;
    const col = stories > 1 ? ft(2.2) : ft(1);
    // Columns from the ground at the back, from the top tread at the front.
    const nCols = Math.max(2, Math.round(W / 7) + 1);
    for (let i = 0; i < nCols; i++) {
        const x = -W / 2 + col + ((W - 2 * col) * i) / (nCols - 1);
        const zBack = zb + depth - col;
        s.add([x, (y0 - ft(1.4)) / 2, zBack], [col, y0 - ft(1.4), col]);
        const zMid = zb + depth * 0.45;
        s.add([x, (y0 - ft(1.4)) / 2, zMid], [col * 0.8, y0 - ft(1.4), col * 0.8]);
        if (i < nCols - 1 && i % 2 === 0) {
            const x2 = -W / 2 + col + ((W - 2 * col) * (i + 1)) / (nCols - 1);
            s.beam([x, 0.3, zBack], [x2, y0 - ft(2), zBack], ft(0.5));
            s.beam([x2, 0.3, zBack], [x, y0 - ft(2), zBack], ft(0.5));
        }
    }

    // Filming deck railing on the roof.
    const yr = y0 + H + ft(1.2);
    const rail = ft(3.5);
    const postEvery = ft(8);
    const zf = zb - overhang + ft(0.5);
    const zr = zb + depth;
    for (let x = -W / 2; x <= W / 2 + 1e-3; x += postEvery) {
        s.add([x, yr + rail / 2, zf], [ft(0.25), rail, ft(0.25)]);
    }
    s.beam([-W / 2, yr + rail, zf], [W / 2, yr + rail, zf], ft(0.3));
    s.beam([-W / 2, yr + rail * 0.5, zf], [W / 2, yr + rail * 0.5, zf], ft(0.2));
    for (const sx of [-1, 1]) {
        const x = (sx * W) / 2;
        s.beam([x, yr + rail, zf], [x, yr + rail, zr], ft(0.3));
        s.add([x, yr + rail / 2, zr], [ft(0.25), rail, ft(0.25)]);
    }
    // Two camera tripods on the deck: the band's video crew.
    for (const x of [-W * 0.18, W * 0.12]) {
        s.add([x, yr + ft(2.5), zf + ft(2)], [ft(0.3), ft(5), ft(0.3)]);
        s.add([x, yr + ft(5.3), zf + ft(2)], [ft(1.6), ft(1), ft(0.9)], [0, 0, 0], 0x2a2c31);
    }

    // Switchback stair tower at the side-2 end, from the ground to the floor.
    const flight = ft(6);
    const sw = ft(4);
    const xs = W / 2 + ft(1) + sw / 2;
    const run = Math.min(depth - ft(1), ft(12));
    const z0 = zb + (depth - run) / 2;
    const flights = Math.max(1, Math.ceil(y0 / flight));
    const rise = y0 / flights;
    for (let k = 0; k < flights; k++) {
        const ya = k * rise;
        const yb = ya + rise;
        const forward = k % 2 === 0;
        const za = forward ? z0 : z0 + run;
        const zc = forward ? z0 + run : z0;
        const x = xs + (forward ? -sw / 4 : sw / 4);
        s.beam([x, ya, za], [x, yb, zc], ft(0.4));
        // the flight's tread plate
        const len = Math.hypot(run, rise);
        const pitch = Math.atan2(rise, run) * (forward ? -1 : 1);
        s.add([x, (ya + yb) / 2, (za + zc) / 2], [sw / 2, ft(0.15), len], [pitch, 0, 0]);
        // landing
        s.add([xs, yb, zc], [sw, ft(0.25), ft(3)]);
    }
    for (const dx of [-sw / 2, sw / 2]) {
        for (const z of [z0, z0 + run]) {
            s.add([xs + dx, (y0 + rail) / 2, z], [ft(0.35), y0 + rail, ft(0.35)]);
        }
    }

    return {
        group,
        eye: [0, y0 + storyH * (stories - 1 + 0.55), zb - ft(2)],
        setGlow(k) {
            faceMat.emissiveIntensity = k;
        },
        dispose() {
            faceGeo.dispose();
            faceMat.dispose();
            tex.map.dispose();
            tex.emissive.dispose();
        },
    };
}
