import type { Light, Vector3Tuple } from "three";
import type { LightingPreset } from "../types";
import { ft } from "./units";

/**
 * Lighting preset values, ported from the reference demo's `SKY` table and its
 * pro (roof closed) and gym (house, show) presets. Lengths are meters.
 *
 * The shared rig (`createEnvironment`) applies the sky, fog, hemisphere, sun
 * and exposure fields. Kits read `kit` (via `lightingValues(preset).kit`) to
 * drive the extra lights they own.
 */
export interface LightingValues {
    /** The gym hides the sky dome. */
    skyVisible: boolean;
    skyTop: number;
    skyBottom: number;
    /** Fog color. Usually equal to `skyBottom`. */
    fog: number;
    hemisphere: { sky: number; ground: number; intensity: number };
    sun: {
        color: number;
        /** 0 turns the sun off; it then also stops casting shadows. */
        intensity: number;
        /** Offset from the focus point, in meters. */
        offset: Vector3Tuple;
    };
    /** Apply to `renderer.toneMappingExposure`. */
    exposure: number;
    /** Sky and distant-landscape look, read by the sky dome, horizon and env map. */
    atmosphere: Atmosphere;
    kit: KitLightingValues;
}

/** What the procedural sky and the horizon draw for a preset. */
export interface Atmosphere {
    /** Sky color just above the horizon. Matches `fog` so land fades into it. */
    horizon: number;
    /** Color a third of the way up, between horizon and `skyTop`. */
    mid: number;
    /** Color of the glow around the sun (or moon at night). */
    glow: number;
    /** 0 to 1: how far the glow reaches across the sky. */
    glowStrength: number;
    /** Direction toward the sun, unit length. */
    sunDir: Vector3Tuple;
    /** Sun disk color; black hides the disk. */
    sunColor: number;
    /** Cloud cover 0 (clear) to 1 (overcast). */
    cloudCover: number;
    /** Cloud colors on the lit and shadowed sides. */
    cloudLit: number;
    cloudShade: number;
    /** 0 to 1 star brightness. */
    stars: number;
    /** 0 to 1 moon brightness, drawn toward `moonDir`. */
    moon: number;
    moonDir: Vector3Tuple;
    /** Multiplies the horizon land (hills, treeline, town) colors. */
    land: number;
    /** 0 to 1: how many town windows are lit. */
    windows: number;
}

const unit = (x: number, y: number, z: number): Vector3Tuple => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
};

/** Values for lights and emissive parts that kits own. */
export interface KitLightingValues {
    /** Light poles: `lightPole(...).setOn(lampsOn, lampScale)`. */
    lampsOn: boolean;
    lampScale: number;
    /** Pro roof-edge light bar emissive intensity. */
    barEmissive: number;
    /** Pro roof-edge spot intensity. */
    roofSpotIntensity: number;
    /** Pro: whether the sliding roof panels are open. */
    roofOpen: boolean;
    /** Gym ceiling panel emissive intensity. */
    panelEmissive: number;
    /** Gym overhead directional light intensity. */
    overheadIntensity: number;
    /** Gym show spot intensity. */
    showSpotIntensity: number;
}

const kitOff: KitLightingValues = {
    lampsOn: false,
    lampScale: 0,
    barEmissive: 0,
    roofSpotIntensity: 0,
    roofOpen: true,
    panelEmissive: 0,
    overheadIntensity: 0,
    showSpotIntensity: 0,
};

/** Sun offsets in the demo are in feet. */
const sunOffset = (x: number, y: number, z: number): Vector3Tuple => [
    ft(x),
    ft(y),
    ft(z),
];

const day: LightingValues = {
    skyVisible: true,
    skyTop: 0x3d7fd6,
    skyBottom: 0xcfe2f5,
    fog: 0xcfe2f5,
    hemisphere: { sky: 0xcfe3ff, ground: 0x4a5d33, intensity: 1.1 },
    sun: { color: 0xffffff, intensity: 2.3, offset: sunOffset(300, 520, 260) },
    exposure: 1,
    atmosphere: {
        horizon: 0xcfe2f5,
        mid: 0x8db8e8,
        glow: 0xfff2d0,
        glowStrength: 0.35,
        sunDir: unit(300, 520, 260),
        sunColor: 0xfff6e0,
        cloudCover: 0.5,
        cloudLit: 0xffffff,
        cloudShade: 0xa9bcd6,
        stars: 0,
        moon: 0,
        moonDir: unit(-1, 0.5, -1),
        land: 1,
        windows: 0,
    },
    kit: { ...kitOff },
};

const dusk: LightingValues = {
    skyVisible: true,
    skyTop: 0x27306a,
    skyBottom: 0xf2995a,
    fog: 0xf2995a,
    hemisphere: { sky: 0xffc49a, ground: 0x3a3440, intensity: 0.55 },
    sun: { color: 0xffa860, intensity: 1.4, offset: sunOffset(-700, 120, -60) },
    exposure: 1.05,
    atmosphere: {
        horizon: 0xf2995a,
        mid: 0xb4668a,
        glow: 0xff8a3c,
        glowStrength: 1,
        sunDir: unit(-700, 70, -60),
        sunColor: 0xffc27a,
        cloudCover: 0.55,
        cloudLit: 0xffb28a,
        cloudShade: 0x5a4670,
        stars: 0.1,
        moon: 0,
        moonDir: unit(-1, 0.5, -1),
        land: 0.55,
        windows: 0.5,
    },
    kit: {
        ...kitOff,
        lampsOn: true,
        lampScale: 0.6,
        barEmissive: 2,
        roofSpotIntensity: 1.4,
    },
};

const night: LightingValues = {
    skyVisible: true,
    skyTop: 0x04060d,
    skyBottom: 0x17203a,
    fog: 0x17203a,
    hemisphere: { sky: 0x1b2440, ground: 0x0a0a0c, intensity: 0.3 },
    sun: { color: 0x8899cc, intensity: 0, offset: sunOffset(0, 500, 0) },
    exposure: 1.15,
    atmosphere: {
        horizon: 0x17203a,
        mid: 0x0b1226,
        glow: 0x5a78c8,
        glowStrength: 0.5,
        sunDir: unit(-0.45, 0.55, -0.7),
        sunColor: 0x000000,
        cloudCover: 0.3,
        cloudLit: 0x4a5b88,
        cloudShade: 0x0c1226,
        stars: 1,
        moon: 1,
        moonDir: unit(-0.45, 0.55, -0.7),
        land: 0.12,
        windows: 1,
    },
    kit: {
        ...kitOff,
        lampsOn: true,
        lampScale: 1,
        barEmissive: 2,
        roofSpotIntensity: 1.4,
    },
};

/** Pro dome with the roof shut: day sky colors, no sun, warm interior. */
const roofClosed: LightingValues = {
    ...day,
    hemisphere: { sky: 0xfff1e0, ground: 0x554433, intensity: 0.9 },
    sun: { ...day.sun, intensity: 0 },
    exposure: 1,
    kit: { ...kitOff, barEmissive: 2, roofSpotIntensity: 1.4, roofOpen: false },
};

const house: LightingValues = {
    skyVisible: false,
    skyTop: 0x1a1a1f,
    skyBottom: 0x1a1a1f,
    fog: 0x1a1a1f,
    hemisphere: { sky: 0xfff4e0, ground: 0x6b5a44, intensity: 0.9 },
    sun: { color: 0xffffff, intensity: 0, offset: sunOffset(0, 500, 0) },
    exposure: 1,
    atmosphere: { ...day.atmosphere, stars: 0, moon: 0, windows: 0 },
    kit: { ...kitOff, panelEmissive: 1.4, overheadIntensity: 1.1 },
};

const show: LightingValues = {
    ...house,
    hemisphere: { ...house.hemisphere, intensity: 0.12 },
    exposure: 1.2,
    kit: {
        ...kitOff,
        panelEmissive: 0.08,
        overheadIntensity: 0.1,
        showSpotIntensity: 2.4,
    },
};

const LIGHTING: Record<LightingPreset, LightingValues> = {
    day,
    dusk,
    night,
    roofClosed,
    house,
    show,
};

/** Every preset's values. Treat the result as read-only. */
export function lightingValues(preset: LightingPreset): LightingValues {
    return LIGHTING[preset];
}

export const LIGHTING_PRESET_IDS = Object.keys(LIGHTING) as LightingPreset[];

/**
 * Sets a light's intensity and hides the light while it is 0. three.js shades
 * every visible light for every pixel, whatever its intensity, so a light
 * that is off but still visible costs as much as a lit one: by day the four
 * unlit pole spots took a third of the frame's GPU time. Turning a light on
 * or off changes the light count, so the scene's shaders recompile once.
 */
export function setLightIntensity(light: Light, intensity: number): void {
    light.intensity = intensity;
    light.visible = intensity > 0;
}
