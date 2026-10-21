import type { RingShape } from "./ringMachine";

const NO_STARS: readonly RingShape[] = [];

/**
 * The user's starred shapes, in their order, for the ring and the Shapes tab. Stars come with the
 * library (#352); until then nothing is starred, so the ring holds the basic kinds.
 */
export function useStarredShapes(): readonly RingShape[] {
    return NO_STARS;
}
