import { describe, expect, it } from "vitest";
import {
    FLAG_ARTWORK_TEXTURE_PX,
    FLAG_ARTWORK_TILE_PX,
    flagArtworkGrid,
} from "../marchers/flagArtworkAtlas";

describe("the show's flags' texture (fork #985)", () => {
    it("lays the flags out near square, a full-size tile each", () => {
        expect(flagArtworkGrid(1)).toEqual({
            cols: 1,
            rows: 1,
            tile: FLAG_ARTWORK_TILE_PX,
        });
        expect(flagArtworkGrid(2)).toMatchObject({ cols: 2, rows: 1 });
        expect(flagArtworkGrid(20)).toEqual({
            cols: 5,
            rows: 4,
            tile: FLAG_ARTWORK_TILE_PX,
        });
    });

    it("makes tiles smaller once many flags would outgrow the texture", () => {
        const grid = flagArtworkGrid(100);
        expect(grid.cols * grid.tile).toBeLessThanOrEqual(
            FLAG_ARTWORK_TEXTURE_PX,
        );
        expect(grid.rows * grid.tile).toBeLessThanOrEqual(
            FLAG_ARTWORK_TEXTURE_PX,
        );
        expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(100);
    });
});
