import type { CanvasTexture } from "three";
import {
    SIGN,
    creditsTexture,
    drawOpenMarchLogo,
    inFace,
    paintCanvasTexture,
    paintCreditsCard,
    screenGround,
    type CreditsTexture,
} from "../../environment";
import { AUX_BOARD, BOARD, BOARD_ATLAS } from "./boardPlan";

/**
 * What Nightpound's boards show. The main faces carry the show's credits
 * card; the corner wedges, the auxiliary board and the lower ring stay
 * quiet: a near-black ground, the OpenMarch logo in soft white and the brand
 * purple as hairlines (`environment/signage.ts`). No sponsors.
 */

const ATLAS = 1024;

/** A quiet screen in its own `w` x `h`: the logo over a hairline. */
function paintQuiet(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    logoHeight: number,
): void {
    screenGround(g, w, h);
    drawOpenMarchLogo(g, w / 2, h * 0.47, logoHeight, SIGN.mark);
    g.fillStyle = "rgba(140,120,255,0.55)";
    g.fillRect(
        w / 2 - logoHeight * 0.7,
        h * 0.47 + logoHeight,
        logoHeight * 1.4,
        3,
    );
}

/**
 * The board atlas (`BOARD_ATLAS`): the credits card on the top half, a
 * corner wedge and the auxiliary board on the bottom half. Blank credits
 * until `setCredits`.
 */
export function boardAtlasTexture(): CreditsTexture {
    const half = ATLAS / 2;
    const { wedge, aux } = BOARD_ATLAS;
    return creditsTexture(ATLAS, ATLAS, (g, credits) => {
        g.clearRect(0, 0, ATLAS, ATLAS);
        inFace(
            g,
            0,
            0,
            ATLAS,
            half,
            BOARD.faceWidth / BOARD.faceHeight,
            (w, h) => paintCreditsCard(g, w, h, credits),
        );
        // The wedge's region is as wide as its top edge, at the faces' scale.
        const wedgeW = (wedge.u1 - wedge.u0) * ATLAS;
        inFace(
            g,
            wedge.u0 * ATLAS,
            half,
            wedgeW,
            half,
            (wedgeW / ATLAS) * (BOARD.faceWidth / BOARD.faceHeight) * 2,
            (w, h) => paintQuiet(g, w, h, h * 0.09),
        );
        inFace(
            g,
            aux.u0 * ATLAS,
            half,
            (aux.u1 - aux.u0) * ATLAS,
            half,
            AUX_BOARD.width / AUX_BOARD.height,
            (w, h) => paintQuiet(g, w, h, h * 0.2),
        );
    });
}

/**
 * One side of the lower ring, 1024 x 128: hairlines along both edges all the
 * way round and the logo at the middle of each side.
 */
export function boardRingTexture(): CanvasTexture {
    return paintCanvasTexture(1024, 128, (g) => {
        inFace(
            g,
            0,
            0,
            1024,
            128,
            BOARD.ringSide / BOARD.ringHeight,
            (w, h) => {
                g.fillStyle = SIGN.ground;
                g.fillRect(0, 0, w, h);
                g.fillStyle = "rgba(140,120,255,0.5)";
                g.fillRect(0, 0, w, 3);
                g.fillRect(0, h - 3, w, 3);
                drawOpenMarchLogo(g, w / 2, h / 2, h * 0.42, SIGN.mark);
                // A dim rule either side of the logo.
                g.fillStyle = "rgba(140,120,255,0.3)";
                g.fillRect(w * 0.08, h / 2 - 1, w * 0.22, 2);
                g.fillRect(w * 0.7, h / 2 - 1, w * 0.22, 2);
            },
        );
    });
}
