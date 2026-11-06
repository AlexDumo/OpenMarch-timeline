import { ft } from "../environment";
import type { KitBuilder } from "../types";
import { buildSite, type SiteLayout } from "./hs/site";
import { buildStandsKit } from "./stands";

/**
 * High school kit (design.md section 6, P2.3): a Friday night stadium behind
 * a school. Aluminum bleachers on steel frames, a home stand with a press box
 * and filming deck, a smaller visitor stand, a 6-lane track inside a
 * chain-link fence, goal posts, a scoreboard, a podium and four poles, with
 * the school, field house, lots and a tree line around it. Day, dusk and
 * night; default day.
 */

/** Grass of the outer ground, matched to the painted site's base color. */
export const HS_GRASS = 0x587a3c;

/** The campus around the stadium, relative to the field center. */
export const HS_SITE: SiteLayout = {
    size: 640,
    grass: "#587a3c",
    lots: [
        { dx: 0, dz: 118, w: 210, d: 62 },
        { dx: -150, dz: -120, w: 70, d: 70 },
    ],
    pads: [
        // walkway behind the home stand and the gate plaza
        { dx: 0, dz: 72, w: 96, d: 8 },
        { dx: 0, dz: 44, w: 10, d: 8 },
    ],
    walks: [
        { points: [[0, 86], [0, 76]], width: 4 },
        { points: [[-48, 76], [-60, 60], [-66, 44]], width: 3 },
        { points: [[48, 76], [56, 54]], width: 3 },
        { points: [[-100, 0], [-125, 0], [-135, 30], [-135, 86]], width: 3 },
        { points: [[-30, -110], [-30, -158]], width: 3 },
    ],
    fields: [{ dx: -5, dz: -112, w: 110, d: 52 }],
    bandLots: [{ dx: 128, dz: -48, w: 50, d: 30 }],
    diamonds: [{ dx: 150, dz: 62, angle: Math.PI / 4 }],
    buildings: [
        // the school, with its gym wing, behind the visitor side
        { dx: -30, dz: -178, w: 170, d: 26, h: 8 },
        { dx: 82, dz: -172, w: 38, d: 40, h: 9 },
        // field house behind the side-1 end zone
        { dx: -128, dz: -4, w: 18, d: 34, h: 4.6, trim: true },
        // concession stand by the home gate
        { dx: 54, dz: 47, w: 12, d: 7, h: 3.6, awning: -1 },
    ],
    clear: [
        // the stadium itself: track, stands, poles
        { dx: 0, dz: 4, w: 190, d: 150 },
        { dx: -94, dz: 0, w: 14, d: 20 },
    ],
    trees: { ring: 150, clusters: 16, perCluster: 7 },
    scoreboard: { dx: -96, dz: 0, yaw: Math.PI / 2, w: 10.4, bottom: 4 },
    flagpole: { dx: -94, dz: 16 },
    cars: 0.62,
    fence: true,
    goalPosts: true,
    seed: 41,
};

export const buildHs: KitBuilder = (input) =>
    buildStandsKit(
        {
            id: "hs",
            groundColor: HS_GRASS,
            track: true,
            front: {
                gap: ft(52),
                spec: {
                    length: ft(260),
                    rows: 28,
                    depth: ft(2.6),
                    rise: ft(1),
                    base: ft(4),
                    style: "aluminum",
                    pressBox: { width: ft(90), height: ft(12), lift: ft(8) },
                },
            },
            back: {
                gap: ft(52),
                spec: {
                    length: ft(200),
                    rows: 14,
                    depth: ft(2.6),
                    rise: ft(1),
                    base: ft(3),
                    style: "aluminum",
                },
            },
            podium: true,
            poles: {
                height: ft(90),
                spots: [
                    { sx: -1, dx: ft(35), front: true, dz: ft(40) },
                    { sx: 1, dx: ft(35), front: true, dz: ft(40) },
                    { sx: -1, dx: ft(35), front: false, dz: ft(40) },
                    { sx: 1, dx: ft(35), front: false, dz: ft(40) },
                ],
            },
            cameras: {
                pressTargetBack: ft(12),
                endZone: { sx: 1, dx: ft(70), y: ft(28), dz: 5 },
                topDownHeight: ft(620),
            },
            crowdDensity: 0.5,
            defaultLighting: "day",
            decorate: ({ shared, input: i }) =>
                buildSite(i.footprint, HS_SITE, i.params, shared, i.quality),
        },
        input,
    );
