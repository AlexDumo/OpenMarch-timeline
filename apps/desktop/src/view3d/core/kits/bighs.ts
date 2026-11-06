import { ft } from "../environment";
import type { KitBuilder } from "../types";
import { HS_GRASS } from "./hs";
import { buildSite, type SiteLayout } from "./hs/site";
import { buildStandsKit } from "./stands";

/**
 * Big high school kit (design.md section 6, P2.3): the hs track with
 * concrete stands, a three-story press box, a video board behind the side-2
 * end zone, an entry plaza and field house behind the side-1 end zone, big
 * lots and six poles. Default night.
 */

/** The bigger campus: concourses behind both stands and more parking. */
export const BIGHS_SITE: SiteLayout = {
    size: 760,
    grass: "#587a3c",
    lots: [
        { dx: -10, dz: 140, w: 260, d: 80 },
        { dx: 210, dz: 40, w: 70, d: 150 },
        { dx: -40, dz: -150, w: 180, d: 60 },
    ],
    pads: [
        // concourses behind the stands and the entry plaza
        { dx: 0, dz: 90, w: 150, d: 14 },
        { dx: 0, dz: -72, w: 130, d: 10 },
        { dx: -112, dz: 0, w: 50, d: 100 },
    ],
    walks: [
        { points: [[-112, 50], [-112, 100]], width: 5 },
        { points: [[0, 97], [0, 100]], width: 6 },
        { points: [[66, -72], [140, -110]], width: 3 },
    ],
    fields: [{ dx: 160, dz: -120, w: 110, d: 55 }],
    bandLots: [{ dx: 150, dz: -45, w: 52, d: 32 }],
    diamonds: [{ dx: -220, dz: 110, angle: (3 * Math.PI) / 4 }],
    buildings: [
        // field house and ticket gate in the plaza
        { dx: -128, dz: 0, w: 14, d: 44, h: 6, trim: true },
        { dx: -96, dz: 40, w: 8, d: 6, h: 3.4, trim: true },
        { dx: -96, dz: -40, w: 10, d: 7, h: 3.6, awning: 1 },
        // the school beyond the visitor side
        { dx: -60, dz: -238, w: 200, d: 30, h: 8 },
        { dx: 90, dz: -232, w: 50, d: 44, h: 9 },
        { dx: 180, dz: -236, w: 60, d: 30, h: 8 },
    ],
    clear: [
        { dx: 0, dz: 8, w: 200, d: 180 },
        { dx: 96, dz: 0, w: 20, d: 40 },
    ],
    trees: { ring: 170, clusters: 14, perCluster: 7 },
    flagpole: { dx: -108, dz: 46 },
    cars: 0.72,
    fence: true,
    goalPosts: true,
    seed: 57,
};

export const buildBighs: KitBuilder = (input) =>
    buildStandsKit(
        {
            id: "bighs",
            groundColor: HS_GRASS,
            track: true,
            front: {
                gap: ft(52),
                spec: {
                    length: ft(340),
                    rows: 44,
                    depth: ft(2.7),
                    rise: ft(1.1),
                    base: ft(8),
                    style: "concrete",
                    pressBox: {
                        width: ft(180),
                        height: ft(36),
                        lift: ft(4),
                        stories: 3,
                    },
                },
            },
            back: {
                gap: ft(52),
                spec: {
                    length: ft(300),
                    rows: 30,
                    depth: ft(2.7),
                    rise: ft(1.05),
                    base: ft(6),
                    style: "concrete",
                },
            },
            board: {
                w: ft(96),
                h: ft(52),
                legs: ft(34),
                dx: ft(138),
                y: ft(60),
                title: "SPRING SHOW",
            },
            podium: true,
            poles: {
                height: ft(120),
                spots: [
                    { sx: -1, dx: ft(25), front: true, dz: ft(48) },
                    { sx: 1, dx: ft(25), front: true, dz: ft(48) },
                    { sx: -1, dx: ft(25), front: false, dz: ft(48) },
                    { sx: 1, dx: ft(25), front: false, dz: ft(48) },
                    { sx: -1, dx: ft(120), front: true, dz: ft(10) },
                    { sx: -1, dx: ft(120), front: false, dz: ft(10) },
                ],
            },
            cameras: {
                pressTargetBack: ft(16),
                endZone: { sx: -1, dx: ft(150), y: ft(40), dz: 5 },
                topDownHeight: ft(700),
            },
            crowdDensity: 0.56,
            defaultLighting: "night",
            decorate: ({ shared, input: i }) =>
                buildSite(i.footprint, BIGHS_SITE, i.params, shared, i.quality),
        },
        input,
    );
