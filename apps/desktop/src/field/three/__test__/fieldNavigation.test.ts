import { beforeEach, describe, expect, it } from "vitest";
import { glideTo, isGliding } from "../fieldNavigation";
import { useFieldViewStore } from "../fieldView";

/** The floating editor's glide to keep a shape in view (#441) */

const START = { width: 1000, height: 600, zoom: 2, panX: 0, panY: 0 };

beforeEach(() => {
    useFieldViewStore.setState({
        ...START,
        baseZoom: 2,
        field: { width: 400, height: 200 },
    });
});

const frame = () => new Promise((r) => requestAnimationFrame(r));

async function settle(id: number | null) {
    for (let i = 0; i < 200 && isGliding(id); i++) await frame();
}

describe("glideTo", () => {
    it("glides to the view asked for", async () => {
        const id = glideTo({ ...START, zoom: 1, panX: 40, panY: -30 });
        expect(isGliding(id)).toBe(true);
        await settle(id);
        expect(isGliding(id)).toBe(false);
        const view = useFieldViewStore.getState();
        expect(view.zoom).toBeCloseTo(1);
        expect(view.panX).toBeCloseTo(40);
        expect(view.panY).toBeCloseTo(-30);
    });

    it("keeps the pane's size when it's resized along the way (review)", async () => {
        const id = glideTo({ ...START, panX: 80 });
        await frame();
        await frame();
        // A splitter or window resize while it glides
        useFieldViewStore.setState({ width: 700, height: 450 });
        await frame();
        await frame();
        expect(useFieldViewStore.getState().width).toBe(700);
        expect(useFieldViewStore.getState().height).toBe(450);
        await settle(id);
        const view = useFieldViewStore.getState();
        expect(view.width).toBe(700);
        expect(view.height).toBe(450);
        expect(view.zoom).toBeCloseTo(2);
        expect(view.panX).toBeCloseTo(80);
    });
});
