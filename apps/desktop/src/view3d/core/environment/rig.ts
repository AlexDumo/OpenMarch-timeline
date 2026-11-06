import {
    DirectionalLight,
    Fog,
    Group,
    HemisphereLight,
    type Vector3Tuple,
} from "three";
import type { LightingPreset } from "../types";
import {
    lightingValues,
    setLightIntensity,
    type LightingValues,
} from "./lighting";
import { createHorizon, type Horizon } from "./horizon";
import { createSkyDome, type SkyDome } from "./sky";
import { ft } from "./units";

/**
 * Fog starts past the stands and is total at the hills' rim, so the land
 * fades into the sky's horizon color (aerial perspective).
 */
export const FOG_NEAR = 300;
export const FOG_FAR = 1350;

export interface EnvironmentOptions {
    /** "low" never casts shadows. Default "high". */
    quality?: "low" | "high";
    /** Default look-at point (the sun's target). Default the origin. */
    focus?: Vector3Tuple;
}

export interface Environment {
    /** Sky dome, hemisphere light, sun and the sun's target. Add to the scene. */
    root: Group;
    sky: SkyDome;
    /** Hills, treeline and town past the stands; centered on the focus point. */
    horizon: Horizon;
    hemisphere: HemisphereLight;
    sun: DirectionalLight;
    /** Assign to `scene.fog`. Its color follows the preset. */
    fog: Fog;
    /** Apply to `renderer.toneMappingExposure`; updated by `setLighting`. */
    readonly exposure: number;
    /**
     * Applies a preset to the sky, fog, hemisphere light, sun and exposure and
     * returns the preset's values. Kits drive their own lights from
     * `values.kit`.
     */
    setLighting(preset: LightingPreset, focus?: Vector3Tuple): LightingValues;
    setFocus(focus: Vector3Tuple): void;
    dispose(): void;
}

/**
 * The shared lighting rig: one hemisphere light and one shadow-casting sun,
 * plus the sky dome and fog (design.md section 5). The scene owns it; kits add
 * their own lights and switch them in `KitResult.setLighting`.
 */
export function createEnvironment(
    options: EnvironmentOptions = {},
): Environment {
    const quality = options.quality ?? "high";
    let focus: Vector3Tuple = options.focus ?? [0, 0, 0];

    const root = new Group();
    root.name = "environment";
    const sky = createSkyDome({ quality });
    const horizon = createHorizon({ quality });
    const hemisphere = new HemisphereLight(0xcfe3ff, 0x4a5d33, 1);
    const sun = new DirectionalLight(0xffffff, 2);
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
        left: -ft(420),
        right: ft(420),
        top: ft(420),
        bottom: -ft(420),
        near: ft(10),
        far: ft(2200),
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.camera.updateProjectionMatrix();
    root.add(sky.mesh, horizon.root, hemisphere, sun, sun.target);
    const fog = new Fog(0xcfe2f5, FOG_NEAR, FOG_FAR);

    let exposure = 1;
    const env: Environment = {
        root,
        sky,
        horizon,
        hemisphere,
        sun,
        fog,
        get exposure() {
            return exposure;
        },
        setLighting(preset, f) {
            if (f) focus = f;
            const v = lightingValues(preset);
            sky.setPreset(preset);
            horizon.setPreset(preset);
            horizon.setCenter(focus);
            fog.color.setHex(v.atmosphere.horizon);
            hemisphere.color.setHex(v.hemisphere.sky);
            hemisphere.groundColor.setHex(v.hemisphere.ground);
            hemisphere.intensity = v.hemisphere.intensity;
            sun.color.setHex(v.sun.color);
            setLightIntensity(sun, v.sun.intensity);
            sun.position.set(
                focus[0] + v.sun.offset[0],
                focus[1] + v.sun.offset[1],
                focus[2] + v.sun.offset[2],
            );
            sun.target.position.set(...focus);
            sun.castShadow = quality === "high" && v.sun.intensity > 0;
            exposure = v.exposure;
            return v;
        },
        setFocus(f) {
            focus = f;
            horizon.setCenter(f);
            sun.target.position.set(...f);
        },
        dispose() {
            sky.dispose();
            horizon.dispose();
            sun.shadow.dispose();
        },
    };
    env.setLighting("day");
    return env;
}
