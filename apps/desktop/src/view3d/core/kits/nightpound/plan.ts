import {
    AREA,
    CURTAIN_TUNNEL,
    DRAPE_HEIGHT,
    ENTRY,
    EXIT,
    SAFETY,
} from "./frame";

/**
 * Nightpound's plan in WGI trim, kit-root space (`frame.ts`): the floor
 * between the stands, the back drape and the tunnel behind it, and the
 * openings at the back corners.
 */

/** Clearance from the safety zone's edge to a stand's front wall. */
const WALL_GAP = 0.3;

/** The arena floor, wall to wall, in WGI trim. */
export const FLOOR = {
    /** The end stands' front walls. */
    minX: -(AREA.halfX + SAFETY + 0.9),
    maxX: AREA.halfX + SAFETY + 0.9,
    /** The front stand's wall: row A of the front sections, at the safety zone. */
    maxZ: AREA.halfZ + SAFETY + WALL_GAP,
    /** The folded back bleachers, behind the curtain tunnel. */
    minZ: -(AREA.halfZ + SAFETY + WALL_GAP + CURTAIN_TUNNEL.width + 2.2),
};

/** The back drape's line: along the back edge of the safety zone. */
export const DRAPE_Z = -(AREA.halfZ + SAFETY + WALL_GAP);

/**
 * The drape runs between the two back-corner openings. The entry is at +X,
 * the exit at -X; each opening lies between the drape box's end and the end
 * stand's front wall.
 */
export const DRAPE_RUN = {
    minX: FLOOR.minX + EXIT.width,
    maxX: FLOOR.maxX - ENTRY.width,
};

/** The curtain tunnel behind the drape: its back (folded bleachers side) and roof. */
export const TUNNEL_PLAN = {
    front: DRAPE_Z - 0.05,
    back: DRAPE_Z - 0.05 - CURTAIN_TUNNEL.width,
    roof: CURTAIN_TUNNEL.height,
};

/** The drape box's top: black cloth over the tunnel's pipe, a little above the hem. */
export const DRAPE_TOP = Math.max(DRAPE_HEIGHT, CURTAIN_TUNNEL.height) + 0.15;
