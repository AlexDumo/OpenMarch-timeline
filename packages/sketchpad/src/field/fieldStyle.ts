import {
    FieldProperties,
    fieldSvg,
    svgNum,
    type FieldTheme,
} from "@openmarch/core";
import type {
    FieldColors,
    FieldPropertiesJson,
    FieldSnapshot,
    FieldStyle,
    FieldStylePreset,
    RgbaColor,
} from "../types";

const rgb = (r: number, g: number, b: number, a = 1): RgbaColor => ({
    r,
    g,
    b,
    a,
});

/** The colors of each preset, except "show", which takes the show's theme */
export const FIELD_PRESET_COLORS: Record<
    Exclude<FieldStylePreset, "show">,
    FieldColors
> = {
    paper: {
        background: rgb(255, 255, 255),
        lines: rgb(0, 0, 0),
        hashes: rgb(150, 150, 150),
        grid: rgb(225, 225, 225),
        numbers: rgb(120, 120, 120),
        labels: rgb(136, 136, 136),
    },
    turf: {
        background: rgb(58, 120, 54),
        lines: rgb(255, 255, 255),
        hashes: rgb(235, 245, 235),
        grid: rgb(255, 255, 255, 0.16),
        numbers: rgb(255, 255, 255, 0.9),
        labels: rgb(150, 160, 150),
    },
    dark: {
        background: rgb(30, 31, 38),
        lines: rgb(150, 150, 165),
        hashes: rgb(110, 110, 125),
        grid: rgb(255, 255, 255, 0.06),
        numbers: rgb(105, 105, 120),
        labels: rgb(120, 120, 135),
    },
};

export const FIELD_PRESET_LABELS: Record<FieldStylePreset, string> = {
    show: "Show theme",
    paper: "Paper",
    turf: "Turf",
    dark: "Dark",
};

export const DEFAULT_FIELD_STYLE: FieldStyle = {
    preset: "show",
    colors: {},
    grid: true,
    halfLines: true,
    yardNumbers: true,
    labels: true,
    opacity: 1,
};

/** Fills in anything an older or hand-made style leaves out */
export function normalizeFieldStyle(
    style: Partial<FieldStyle> | undefined,
): FieldStyle {
    return {
        ...DEFAULT_FIELD_STYLE,
        ...style,
        colors: { ...(style?.colors ?? {}) },
        opacity: Math.min(1, Math.max(0, style?.opacity ?? 1)),
    };
}

/** The show theme's colors in the Field panel's terms */
export function themeColors(theme: FieldTheme): FieldColors {
    return {
        background: theme.background,
        lines: theme.primaryStroke,
        hashes: theme.secondaryStroke,
        grid: theme.tertiaryStroke,
        numbers: theme.fieldLabel,
        labels: theme.externalLabel,
    };
}

/** A field style's colors: the preset's, then the changed ones */
export function resolvedFieldColors(
    fieldProperties: FieldProperties,
    style: FieldStyle,
): FieldColors {
    const base =
        style.preset === "show"
            ? themeColors(fieldProperties.theme)
            : FIELD_PRESET_COLORS[style.preset];
    return { ...base, ...style.colors };
}

/** The snapshot's field properties, painted with the style's colors */
export function styledFieldProperties(
    snapshot: FieldSnapshot,
): FieldProperties {
    const fieldProperties = new FieldProperties(snapshot.fieldProperties);
    const colors = resolvedFieldColors(fieldProperties, snapshot.style);
    return new FieldProperties({
        ...snapshot.fieldProperties,
        // The sketch shows no field image (the floor lives in the show)
        showFieldImage: false,
        theme: {
            ...fieldProperties.theme,
            background: colors.background,
            primaryStroke: colors.lines,
            secondaryStroke: colors.hashes,
            tertiaryStroke: colors.grid,
            fieldLabel: colors.numbers,
            externalLabel: colors.labels,
        },
    });
}

/** The field properties of a snapshot */
export function snapshotFieldProperties(
    snapshot: FieldSnapshot,
): FieldProperties {
    return new FieldProperties(snapshot.fieldProperties);
}

/** The field as SVG markup in scene units: origin at the centre front point */
export function fieldUnderlayMarkup(snapshot: FieldSnapshot): string {
    const fp = styledFieldProperties(snapshot);
    const { style } = snapshot;
    const markup = fieldSvg(fp, {
        gridLines: style.grid,
        halfLines: style.halfLines,
        hideTexts: {
            yardNumbers: !style.yardNumbers,
            checkpointLabels: !style.labels,
        },
    });
    const { xPixels, yPixels } = fp.centerFrontPoint;
    // The snapshot comes from a file: only numbers reach the markup
    const opacity = Math.min(1, Math.max(0, Number(style.opacity) || 0));
    const opacityAttr = opacity < 1 ? ` opacity="${svgNum(opacity)}"` : "";
    return `<g data-om-field="1" transform="translate(${-xPixels} ${-yPixels})"${opacityAttr}>${markup}</g>`;
}

/** A standalone SVG document of the field over `bounds` (scene units) */
export function fieldSvgDocument(
    snapshot: FieldSnapshot,
    bounds: { x: number; y: number; width: number; height: number },
    scale = 1,
): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${bounds.width * scale}" height="${bounds.height * scale}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">` +
        fieldUnderlayMarkup(snapshot) +
        `</svg>`
    );
}

/** A new field snapshot of the host's field, with a style */
export function createFieldSnapshot(
    fieldProperties: FieldPropertiesJson | FieldProperties,
    style: Partial<FieldStyle> = {},
): FieldSnapshot {
    return {
        fieldProperties: toFieldPropertiesJson(fieldProperties),
        style: normalizeFieldStyle(style),
    };
}

/** Plain JSON for a `FieldProperties`, as the show stores it */
export function toFieldPropertiesJson(
    fieldProperties: FieldPropertiesJson | FieldProperties,
): FieldPropertiesJson {
    return JSON.parse(JSON.stringify(fieldProperties)) as FieldPropertiesJson;
}

/** Whether two field layouts differ in anything that moves lines (names and theme aside) */
export function sameFieldLayout(
    a: FieldPropertiesJson,
    b: FieldPropertiesJson,
): boolean {
    const layout = (f: FieldPropertiesJson) =>
        JSON.stringify({
            x: f.xCheckpoints,
            y: f.yCheckpoints,
            step: f.stepSizeInches ?? 22.5,
            numbers: f.yardNumberCoordinates ?? {},
            hashes: f.useHashes ?? false,
        });
    return layout(a) === layout(b);
}
