import { describe, expect, it } from "vitest";
import OpenMarchCanvas from "../OpenMarchCanvas";
import CanvasMarcher from "../CanvasMarcher";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type Marcher from "@/global/classes/Marcher";
import { defaultSettings } from "@/stores/UiSettingsStore";

const marcher = (id: number) =>
    ({
        id,
        name: null,
        section: "Brass",
        year: null,
        notes: null,
        drill_prefix: "B",
        drill_order: id,
        drill_number: `B${id}`,
        type: "marcher",
    }) as unknown as Marcher;

const setup = () => {
    const canvas = new OpenMarchCanvas({
        canvasRef: null,
        fieldProperties:
            FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES,
        uiSettings: defaultSettings,
    });
    const marchers = [1, 2].map(
        (id) =>
            new CanvasMarcher({
                marcher: marcher(id),
                coordinate: { x: id * 20, y: 40 },
            }),
    );
    for (const m of marchers) {
        canvas.add(m);
        canvas.add(m.textLabel);
    }
    return { canvas, marchers };
};

describe("CanvasMarcher.setLiveCoordinates", () => {
    it("puts the marcher and its label where the full update does", () => {
        const { marchers } = setup();
        const [live, full] = marchers;
        live!.setLiveCoordinates({ x: 123.5, y: 77.25 });
        full!.setMarcherCoords({ x: 123.5, y: 77.25 });
        expect(live!.left).toBeCloseTo(full!.left!, 9);
        expect(live!.top).toBeCloseTo(full!.top!, 9);
        expect(live!.getMarcherCoords()).toEqual(full!.getMarcherCoords());
        expect(live!.textLabel.left).toBeCloseTo(full!.textLabel.left!, 9);
        expect(live!.textLabel.top).toBeCloseTo(full!.textLabel.top!, 9);
        // bounding coords follow, for offscreen culling and hit tests
        expect(live!.aCoords!.tl.x).toBeCloseTo(full!.aCoords!.tl.x, 9);
        expect(live!.textLabel.aCoords!.br.y).toBeCloseTo(
            full!.textLabel.aCoords!.br.y,
            9,
        );
    });
});

describe("OpenMarchCanvas.getLiveCanvasMarchers", () => {
    it("keeps the list until a marcher is added or removed", () => {
        const { canvas, marchers } = setup();
        const first = canvas.getLiveCanvasMarchers();
        expect(first).toHaveLength(2);
        expect(canvas.getLiveCanvasMarchers()).toBe(first);
        canvas.remove(marchers[0]!.textLabel);
        expect(canvas.getLiveCanvasMarchers()).toBe(first);
        canvas.remove(marchers[0]!);
        expect(canvas.getLiveCanvasMarchers()).toEqual([marchers[1]]);
        const third = new CanvasMarcher({
            marcher: marcher(3),
            coordinate: { x: 0, y: 0 },
        });
        canvas.add(third);
        expect(canvas.getLiveCanvasMarchers()).toContain(third);
    });
});
