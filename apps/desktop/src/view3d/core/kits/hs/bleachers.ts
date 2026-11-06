// cspell:ignore metalness
import {
    CylinderGeometry,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    Quaternion,
    Shape,
    Vector3,
    type Vector3Tuple,
} from "three";
import { ft, type SharedMaterials } from "../../environment";
import type { SeatRow } from "../../types";
import type { Stand, StandPlacement, StandSpec } from "../stands";
import { BoxBatch, merge } from "./parts";
import {
    fasciaTexture,
    plankTexture,
    pressWindowTexture,
    shade,
    signTexture,
} from "./textures";

/**
 * Aluminum and concrete stands with the detail a real one has (hs and bighs):
 * plank rows on a visible frame or solid poured treads, padded team-colored
 * front wall, rails and aisles, and a press box with a window wall, roof gear
 * and a lettered sign. College keeps the plain stands in stands.ts.
 */

const BENCH_LIFT = ft(1.35);
const BENCH_THICK = ft(0.25);
const BENCH_DEPTH = ft(0.9);
const PRESS_BODY_DEPTH = ft(14);
const AISLE_EVERY = 12.2;
const AISLE_W = 1.1;

const RAIL = 0xb9bec6;
const FRAME = 0x5d626b;

/** Evenly spaced x positions, `n + 1` of them, across `length`. */
function bays(length: number, target: number): number[] {
    const n = Math.max(1, Math.round(length / target));
    return Array.from(
        { length: n + 1 },
        (_, i) => -length / 2 + (length * i) / n,
    );
}

export function buildStyledStand(
    spec: StandSpec,
    placement: StandPlacement,
    shared: SharedMaterials,
    quality: "low" | "high",
): Stand {
    const style = spec.style!;
    const { length, rows, depth, rise, base } = spec;
    const shadows = quality === "high";
    const group = new Group();
    group.name = `stand:${spec.side}`;
    group.position.set(placement.x, 0, placement.z);
    group.rotation.y = placement.yaw;
    group.updateMatrix();
    const owned: { dispose(): void }[] = [];
    const q0 = new Quaternion();
    const m = new Matrix4();
    const aluminum = style.kind === "aluminum";
    const top = base + (rows - 1) * rise;
    const zb = rows * depth;
    const toKit = (p: Vector3Tuple): Vector3Tuple => {
        const v = new Vector3(...p).applyMatrix4(group.matrix);
        return [v.x, v.y, v.z];
    };

    // Treads: the pick target. Thin footboards over an open frame (aluminum)
    // or solid poured steps (concrete).
    const stripMat = shared.std(0xffffff, {
        map: plankTexture(length, style.kind),
        roughness: aluminum ? 0.5 : 0.95,
        metalness: aluminum ? 0.35 : 0,
    });
    const treads = new InstancedMesh(shared.unitBox, stripMat, rows);
    treads.name = "treads";
    const seatRows: SeatRow[] = [];
    for (let i = 0; i < rows; i++) {
        const h = base + i * rise;
        if (aluminum) {
            m.compose(
                new Vector3(0, h - 0.03, i * depth + depth / 2),
                q0,
                new Vector3(length, 0.06, depth * 0.94),
            );
        } else {
            m.compose(
                new Vector3(0, h / 2, i * depth + depth / 2),
                q0,
                new Vector3(length, h, depth),
            );
        }
        treads.setMatrixAt(i, m);
        const z = i * depth + depth * 0.42;
        seatRows.push({
            points: [toKit([-length / 2, h, z]), toKit([length / 2, h, z])],
            closed: false,
            depth,
            side: spec.side,
        });
    }
    treads.castShadow = treads.receiveShadow = true;
    group.add(treads);

    // Seat boards (aluminum) or molded seats in the team color (concrete).
    const bench = new InstancedMesh(
        shared.unitBox,
        aluminum
            ? stripMat
            : shared.std(shade(style.teamColor, 0.5), { roughness: 0.9 }),
        rows,
    );
    bench.name = "bench";
    for (let i = 0; i < rows; i++) {
        const h = base + i * rise;
        if (aluminum) {
            m.compose(
                new Vector3(0, h + BENCH_LIFT, i * depth + depth * 0.32),
                q0,
                new Vector3(length, BENCH_THICK, BENCH_DEPTH),
            );
        } else {
            m.compose(
                new Vector3(0, h + BENCH_LIFT + 0.1, i * depth + depth * 0.1),
                q0,
                new Vector3(length * 0.995, 0.26, 0.06),
            );
        }
        bench.setMatrixAt(i, m);
    }
    bench.receiveShadow = true;
    group.add(bench);

    const steel = shared.std(0xffffff, { metalness: 0.5, roughness: 0.45 });

    // Understructure (aluminum): sloped stringers every bay on posts, plus
    // risers so each row reads as a plank step from the side.
    const frame = new BoxBatch(shared.unitBox);
    const slope = Math.atan2(rise, depth);
    const run = Math.hypot(rows * depth, (rows - 1) * rise);
    if (aluminum) {
        for (const x of bays(length, 3.05)) {
            frame.add(
                x,
                base + ((rows - 1) * rise) / 2 - 0.22,
                zb / 2,
                0.1,
                0.28,
                run,
                FRAME,
                0,
                -slope,
            );
            for (let k = 0; k <= rows; k += 4) {
                const i = Math.min(k, rows - 1);
                const hh = base + i * rise - 0.4;
                if (hh < 0.3) continue;
                frame.add(
                    x,
                    hh / 2,
                    i * depth + depth * 0.5,
                    0.12,
                    hh,
                    0.12,
                    FRAME,
                );
            }
        }
        for (let i = 1; i < rows; i++) {
            frame.add(
                0,
                base + i * rise - rise / 2 - 0.03,
                i * depth + 0.03,
                length,
                rise - 0.06,
                0.04,
                0xd7dce2,
            );
        }
        // Cross bracing between the end bays, front and back.
        const xs = bays(length, 3.05);
        for (let s = 0; s + 1 < xs.length; s += 2) {
            const a = xs[s];
            const b = xs[s + 1];
            frame.beam(
                new Vector3(a, 0.1, zb * 0.5),
                new Vector3(b, base + (rows * rise) / 2 - 0.6, zb * 0.5),
                0.05,
                0.05,
                FRAME,
            );
        }
    }
    const frameMesh = frame.build(
        shared.std(0xffffff, { metalness: 0.4, roughness: 0.55 }),
        "frame",
        shadows,
    );
    if (frameMesh) group.add(frameMesh);

    // End plates: the stepped side profile, closing the ends of the stand.
    const profile = new Shape();
    profile.moveTo(0, 0);
    profile.lineTo(0, base);
    for (let i = 0; i < rows; i++) {
        const h = base + i * rise;
        profile.lineTo(i * depth, h);
        profile.lineTo((i + 1) * depth, h);
    }
    profile.lineTo(zb, 0);
    profile.closePath();
    const plateGeo = (dx: number) => {
        const g = new ExtrudeGeometry(profile, {
            depth: 0.05,
            bevelEnabled: false,
        });
        g.rotateY(-Math.PI / 2);
        g.translate(dx, 0, 0);
        return g;
    };
    const ends = merge([plateGeo(-length / 2), plateGeo(length / 2 + 0.05)]);
    const endMat = shared.std(aluminum ? 0xb7bcc4 : 0x94969b, {
        metalness: aluminum ? 0.4 : 0,
        roughness: 0.6,
    });
    const endMesh = new Mesh(ends, endMat);
    endMesh.name = "standEnds";
    endMesh.castShadow = shadows;
    endMesh.receiveShadow = true;
    group.add(endMesh);
    owned.push(ends);

    // Padded front wall in the team color.
    const homeSide = spec.side !== "away";
    const fasciaMat = shared.std(0xffffff, {
        map: fasciaTexture(length, style.teamColor, style.label),
        roughness: 0.8,
    });
    const fascia = new Mesh(shared.unitBox, fasciaMat);
    fascia.name = "frontWall";
    fascia.scale.set(length, base, 0.14);
    fascia.position.set(0, base / 2, -0.07);
    fascia.castShadow = shadows;
    fascia.receiveShadow = true;
    group.add(fascia);

    // Rails: guard rail over the front wall, back rail, aisle steps and
    // aisle handrails.
    const rails = new BoxBatch(shared.unitBox);
    const guard = 0.95;
    const addGuard = (
        z: number,
        y: number,
        h: number,
        x0: number,
        x1: number,
    ) => {
        const span = x1 - x0;
        rails.add((x0 + x1) / 2, y + h, z, span, 0.05, 0.05, RAIL);
        rails.add((x0 + x1) / 2, y + h * 0.5, z, span, 0.03, 0.03, RAIL);
        const n = Math.max(1, Math.round(span / 2.4));
        for (let i = 0; i <= n; i++) {
            rails.add(x0 + (span * i) / n, y + h / 2, z, 0.05, h, 0.05, RAIL);
        }
    };
    addGuard(-0.12, base, guard, -length / 2, length / 2);
    addGuard(zb + 0.02, top, 1.05, -length / 2, length / 2);
    const aisleXs: number[] = [];
    for (
        let x = -length / 2 + AISLE_EVERY;
        x < length / 2 - 3;
        x += AISLE_EVERY
    ) {
        aisleXs.push(x);
    }
    const stepMat = shared.std(aluminum ? 0x7d828a : 0x76787d, {
        roughness: 0.9,
    });
    const aisle = new InstancedMesh(
        shared.unitBox,
        stepMat,
        aisleXs.length * rows,
    );
    aisle.name = "aisles";
    let ai = 0;
    for (const x of aisleXs) {
        for (let i = 0; i < rows; i++) {
            const h = base + i * rise;
            m.compose(
                new Vector3(x, h + 0.015, i * depth + depth / 2),
                q0,
                new Vector3(AISLE_W, 0.03, depth * 0.96),
            );
            aisle.setMatrixAt(ai++, m);
        }
        for (const sx of [-1, 1]) {
            const ex = x + (sx * AISLE_W) / 2;
            rails.beam(
                new Vector3(ex, base + 0.95, 0.4),
                new Vector3(ex, top + 0.95, zb - 0.4),
                0.045,
                0.045,
                RAIL,
            );
            for (let i = 2; i < rows; i += 6) {
                rails.add(
                    ex,
                    base + i * rise + 0.45,
                    i * depth + depth * 0.5,
                    0.045,
                    0.9,
                    0.045,
                    RAIL,
                );
            }
        }
    }
    aisle.receiveShadow = true;
    if (aisleXs.length) group.add(aisle);
    const railMesh = rails.build(steel, "rails", false);
    if (railMesh) group.add(railMesh);

    let pressEye: Vector3Tuple | undefined;
    let glow: Stand["glow"];
    if (spec.pressBox) {
        const pb = buildPressBox(spec, shared, shadows, homeSide, owned);
        group.add(pb.group);
        pressEye = toKit(pb.eye);
        glow = pb.glow;
    }

    return {
        group,
        seatRows,
        pickTarget: treads,
        pressEye,
        rowEye: (i) =>
            toKit([0, base + i * rise + ft(4), i * depth + depth * 0.45]),
        glow,
        dispose() {
            treads.dispose();
            bench.dispose();
            aisle.dispose();
            frameMesh?.dispose();
            railMesh?.dispose();
            owned.forEach((o) => o.dispose());
        },
    };
}

/** The press box: stilts or a solid core, a window wall, roof, gear and sign. */
function buildPressBox(
    spec: StandSpec,
    shared: SharedMaterials,
    shadows: boolean,
    homeSide: boolean,
    owned: { dispose(): void }[],
): { group: Group; eye: Vector3Tuple; glow: Stand["glow"] } {
    const style = spec.style!;
    const pb = spec.pressBox!;
    const { rows, depth, rise, base } = spec;
    const top = base + (rows - 1) * rise;
    const zb = rows * depth;
    const stories = pb.stories ?? 1;
    const storyH = pb.height / stories;
    const y0 = top + pb.lift;
    const g = new Group();
    g.name = "pressBox";
    const batch = new BoxBatch(shared.unitBox);
    const aluminum = style.kind === "aluminum";

    // Walls, with a deck under them.
    const wall = new Mesh(
        shared.unitBox,
        shared.std(aluminum ? 0xe8e6df : 0xd9d6cd),
    );
    wall.scale.set(pb.width, pb.height, PRESS_BODY_DEPTH);
    wall.position.set(0, y0 + pb.height / 2, zb + PRESS_BODY_DEPTH / 2);
    wall.castShadow = shadows;
    wall.receiveShadow = true;
    g.add(wall);

    // Window wall, lit from inside at dusk and night.
    const winW = pb.width - 1.2;
    const winH = pb.height - 0.5;
    const winMat = shared.std(0xffffff, {
        map: pressWindowTexture(winW, stories, false),
        emissiveMap: pressWindowTexture(winW, stories, true),
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: 0.2,
        metalness: 0.3,
    });
    const win = new Mesh(shared.unitBox, winMat);
    win.name = "pressWindows";
    win.scale.set(winW, winH, 0.12);
    win.position.set(0, y0 + pb.height / 2 + 0.05, zb - 0.06);
    g.add(win);

    // Roof slab with an overhang, parapet trim and lettered sign.
    const roofY = y0 + pb.height;
    batch.add(
        0,
        roofY + 0.2,
        zb + ft(6),
        pb.width + ft(4),
        0.4,
        ft(18),
        0x4a4d54,
    );
    batch.add(
        0,
        roofY + 0.5,
        zb + ft(15) - 0.1,
        pb.width + ft(4),
        0.35,
        0.2,
        0x4a4d54,
    );
    batch.add(0, roofY - 0.05, zb - 0.25, pb.width + 0.6, 0.12, 0.4, 0xbfbab0);

    // Support: steel stilts (aluminum) or a solid core down to the ground (concrete).
    if (aluminum) {
        for (const x of bays(pb.width * 0.9, 4.5)) {
            for (const z of [zb + 0.5, zb + PRESS_BODY_DEPTH - 0.5]) {
                batch.add(
                    x,
                    (y0 - 0.15) / 2,
                    z,
                    0.32,
                    y0 - 0.15,
                    0.32,
                    0x6a6f78,
                );
            }
        }
        const ys = [y0 * 0.45];
        for (const y of ys) {
            batch.add(0, y, zb + 0.5, pb.width * 0.9, 0.18, 0.18, 0x6a6f78);
            batch.add(
                0,
                y,
                zb + PRESS_BODY_DEPTH - 0.5,
                pb.width * 0.9,
                0.18,
                0.18,
                0x6a6f78,
            );
        }
    } else {
        batch.add(
            0,
            (y0 - 0.15) / 2,
            zb + ft(7),
            pb.width * 0.9,
            y0 - 0.15,
            ft(12),
            0x9a9ca0,
        );
    }
    batch.add(
        0,
        y0 - 0.12,
        zb + PRESS_BODY_DEPTH / 2 - 0.2,
        pb.width + 0.4,
        0.3,
        PRESS_BODY_DEPTH + 0.6,
        0x7c7f86,
    );
    // Walkway rail in front of the box.
    batch.add(0, y0 + 0.55, zb - 0.55, pb.width + 0.2, 0.05, 0.05, RAIL);

    // Roof gear: two air units, an antenna mast, a camera deck and a dish.
    const gear = new BoxBatch(shared.unitBox);
    gear.add(
        -pb.width * 0.32,
        roofY + 0.4 + 0.5,
        zb + ft(9),
        2.2,
        1,
        1.6,
        0xa6a9ae,
    );
    gear.add(
        pb.width * 0.18,
        roofY + 0.4 + 0.5,
        zb + ft(9),
        1.8,
        1,
        1.4,
        0xa6a9ae,
    );
    gear.add(
        pb.width * 0.42,
        roofY + 0.4 + 0.45,
        zb + ft(8),
        3.0,
        0.9,
        2.2,
        0x4a4d54,
    );
    const gearMesh = gear.build(shared.std(0xffffff), "roofGear", shadows);
    if (gearMesh) g.add(gearMesh);
    const mastGeo = merge([
        new CylinderGeometry(0.05, 0.07, 6, 6).translate(0, 3, 0),
        new CylinderGeometry(0.03, 0.03, 2.4, 5)
            .rotateZ(Math.PI / 2)
            .translate(0, 5.2, 0),
        new CylinderGeometry(0.03, 0.03, 1.6, 5)
            .rotateZ(Math.PI / 2)
            .translate(0, 4.2, 0),
    ]);
    const mast = new Mesh(
        mastGeo,
        shared.std(0x9a9da4, { metalness: 0.6, roughness: 0.4 }),
    );
    mast.position.set(-pb.width * 0.45, roofY + 0.4, zb + ft(12));
    mast.name = "mast";
    g.add(mast);
    owned.push(mastGeo);

    // Lettered sign standing on the roof, facing the field.
    const signW = Math.min(pb.width * 0.5, 9);
    const signH = Math.max(1.3, signW * 0.17);
    const sign = new Mesh(
        shared.unitBox,
        shared.std(0xffffff, {
            map: signTexture(
                style.teamColor,
                homeSide ? style.label : "",
                1024,
                Math.round(1024 * (signH / signW)),
            ),
            roughness: 0.7,
        }),
    );
    sign.name = "pressSign";
    sign.scale.set(signW, signH, 0.12);
    sign.position.set(0, roofY + 0.4 + signH / 2 + 0.35, zb + ft(1));
    sign.castShadow = shadows;
    batch.add(-signW * 0.4, roofY + 0.6, zb + ft(1), 0.12, 0.6, 0.12, 0x4a4d54);
    batch.add(signW * 0.4, roofY + 0.6, zb + ft(1), 0.12, 0.6, 0.12, 0x4a4d54);
    g.add(sign);

    const mesh = batch.build(
        shared.std(0xffffff, { roughness: 0.7 }),
        "pressFrame",
        shadows,
    );
    if (mesh) g.add(mesh);
    owned.push(
        { dispose: () => mesh?.dispose() },
        { dispose: () => gearMesh?.dispose() },
    );

    return {
        group: g,
        eye: [0, y0 + storyH * (stories - 1 + 0.55), zb - ft(2)],
        glow: (k: number) => {
            winMat.emissiveIntensity = k;
        },
    };
}
