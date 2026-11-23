import { Group, type Vector3Tuple } from "three";
import { createSharedMaterials } from "../environment";
import type {
    CameraSeat,
    KitBuilder,
    LightingPreset,
    ShowCredits,
} from "../types";
import { buildDrape } from "./nightpound/drape";
import { buildFloor } from "./nightpound/floor";
import {
    AREA,
    SAFETY,
    type NightpoundCtx,
    type NightpoundPart,
} from "./nightpound/frame";
import { DRAPE_Z, FLOOR } from "./nightpound/plan";

/**
 * The Nightpound kit: Nightpound, OH, a fictional arena modeled on the
 * University of Dayton Arena as WGI dresses it for its World Championships.
 * Unlike the other venues it doesn't grow to fit the field: the floor is
 * WGI's 106 by 78 ft competition area, and only a field that fits it can be
 * shown here (`KIT_FIXED_FLOOR`). The show's floor lies at its center.
 *
 * `nightpound/frame.ts` holds the shared dimensions and `nightpound/plan.ts`
 * the floor plan; the parts each build one object around the competition
 * area's center, and this module places them on the field's center.
 */

export const NIGHTPOUND_PRESETS: LightingPreset[] = ["show", "house"];

/** A part that can show the show's credits (the center-hung board). */
type CreditsPart = NightpoundPart & { setCredits(credits: ShowCredits): void };
const showsCredits = (part: NightpoundPart): part is CreditsPart =>
    typeof (part as Partial<CreditsPart>).setCredits === "function";

export const buildNightpound: KitBuilder = ({ footprint, params, quality }) => {
    const shared = createSharedMaterials();
    const ctx: NightpoundCtx = { footprint, params, quality, shared };
    const cx = (footprint.minX + footprint.maxX) / 2;
    const cz = (footprint.minZ + footprint.maxZ) / 2;

    const root = new Group();
    root.name = "kit.nightpound";
    const placed = new Group();
    placed.name = "nightpound.frame";
    placed.position.set(cx, 0, cz);
    root.add(placed);

    const parts: NightpoundPart[] = [buildFloor(ctx), buildDrape(ctx)];
    parts.forEach((part) => placed.add(part.object));

    const toWorld = ([x, y, z]: Vector3Tuple): Vector3Tuple => [
        x + cx,
        y,
        z + cz,
    ];
    const setLighting = (preset: LightingPreset) => {
        if (!NIGHTPOUND_PRESETS.includes(preset)) return;
        parts.forEach((part) => part.setLighting(preset));
    };
    const defaultLighting: LightingPreset = "show";
    setLighting(defaultLighting);

    return {
        root,
        focus: toWorld([0, 0, 0]),
        cameras: nightpoundCameras().map((seat) => ({
            ...seat,
            position: toWorld(seat.position),
            target: toWorld(seat.target),
        })),
        seatRows: [],
        pickTargets: parts.flatMap((part) => part.pickTargets ?? []),
        surroundings: false,
        lightingPresets: [...NIGHTPOUND_PRESETS],
        defaultLighting,
        setLighting,
        setShowCredits(credits) {
            parts.filter(showsCredits).forEach((p) => p.setCredits(credits));
        },
        onFrame({ cameraPosition: [x, y, z], dt }) {
            const local = {
                cameraPosition: [x - cx, y, z - cz] as Vector3Tuple,
                dt,
            };
            parts.forEach((part) => part.onFrame?.(local));
        },
        dispose() {
            parts.forEach((part) => part.dispose());
            shared.dispose();
            root.clear();
        },
    };
};

/** Named cameras, in kit-root space. */
export function nightpoundCameras(): CameraSeat[] {
    const cam = (
        id: string,
        kind: CameraSeat["kind"],
        position: Vector3Tuple,
        target: Vector3Tuple,
        label = id,
    ): CameraSeat => ({
        id,
        labelKey: `view3d.camera.${label}`,
        kind,
        position,
        target,
    });
    return [
        cam("judges", "seat", [0, 9, FLOOR.maxZ + 9], [0, 0, -3]),
        cam("floor", "floor", [0, 1.6, AREA.halfZ + SAFETY], [0, 1.2, DRAPE_Z]),
        cam(
            "tunnel",
            "floor",
            [FLOOR.maxX - 1.6, 1.7, DRAPE_Z - 1],
            [-4, 1.2, 4],
        ),
        cam("topDown", "topDown", [0, 120, 0.15], [0, 0, 0]),
    ];
}
