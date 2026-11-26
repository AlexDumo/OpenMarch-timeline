/**
 * The looks a show's performer figures need (ADR 0019): each performer's uniform as the 3D View
 * dresses them, in the figures' one body and slate uniform (`figureDress.ts`), and each look's
 * fingerprint. Everything that changes a figure's shape goes into the fingerprint: what the
 * performer carries and its options (a bass drum's size, the flag's silk shape), the brass
 * finish, the hold, the bake's body and uniform, the picture's scale and the figures' version.
 * Nothing else does: colors, names and drill leave it alone.
 *
 * Pure: no three.js, React or database.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
    bassOptions,
    sectionUniform,
    type UniformLook,
} from "@/view3d/core/marchers/looks";
import {
    FIGURE_BODY,
    FIGURE_LOOK,
    bakeDressed,
} from "@/view3d/core/marchers/figureDress";
import {
    guardUniformPresetOf,
    uniformPresetOf,
} from "@/view3d/core/marchers/uniformPresets";
import { brassFinishOf, tubaModelOf } from "@/view3d/core/venueSettings";
import { silkShapeOf } from "@/view3d/core/sizes/silkShapes";
import { DEFAULT_HOLD } from "@/view3d/window/performers/windowHorn";

/**
 * Raise when the models, the bake's light or how a figure is cut out change what a figure looks
 * like: every show bakes its figures again on open.
 */
export const FIGURE_VERSION = 1;

/** A figure's scale: pixels per meter on the ground. */
export const FIGURE_PX_PER_METER = 250;

/** The dark edge around each figure, so white parts read on a light field, in meters. */
export const FIGURE_EDGE_M = 0.024;

/** The show's settings that change a figure: the venue settings' own fields, unchecked. */
export interface FigureSettings {
    uniforms?: unknown;
    guardUniforms?: unknown;
    brassFinish?: unknown;
    tuba?: unknown;
    silkShape?: unknown;
}

export interface FigurePerformer {
    id: number;
    section: string | null | undefined;
}

export interface ShowFigureLooks {
    /** Each performer's figure, by fingerprint. */
    readonly byPerformer: ReadonlyMap<number, string>;
    /** Each fingerprint's look, as the bake dresses it. */
    readonly looks: ReadonlyMap<string, UniformLook>;
}

/** JSON with every object's keys in order, so equal looks always write alike. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
            .sort()
            .map(
                (k) =>
                    `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value) ?? "null";
}

/** A look's fingerprint: lowercase hex sha256 of everything that draws its figure. */
export function figureFingerprint(look: UniformLook): string {
    const text = canonicalJson({
        figure: FIGURE_VERSION,
        pxPerMeter: FIGURE_PX_PER_METER,
        edge: FIGURE_EDGE_M,
        body: FIGURE_BODY,
        look,
    });
    return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Each performer's figure look and its fingerprint, as the 3D View would dress them. */
export function showFigureLooks(
    performers: readonly FigurePerformer[],
    settings: FigureSettings | null | undefined,
): ShowFigureLooks {
    const sections = performers.map((p) => p.section ?? "");
    const options = bassOptions(
        performers.map((p) => p.id),
        sections,
    );
    const winds = {
        finish: brassFinishOf(settings?.brassFinish),
        tuba: tubaModelOf(settings?.tuba),
        silkShape: silkShapeOf(settings?.silkShape),
        silkArtwork: false,
    };
    const preset = uniformPresetOf(settings?.uniforms);
    const guardPreset = guardUniformPresetOf(settings?.guardUniforms);
    const byPerformer = new Map<number, string>();
    const looks = new Map<string, UniformLook>();
    const fingerprintOf = new Map<string, string>();
    performers.forEach((p, i) => {
        const look = bakeDressed(
            sectionUniform(
                sections[i],
                DEFAULT_HOLD,
                options[i],
                undefined,
                undefined,
                preset,
                guardPreset,
                winds,
            ),
            FIGURE_LOOK,
        );
        const text = canonicalJson(look);
        let fingerprint = fingerprintOf.get(text);
        if (!fingerprint) {
            fingerprint = figureFingerprint(look);
            fingerprintOf.set(text, fingerprint);
            looks.set(fingerprint, look);
        }
        byPerformer.set(p.id, fingerprint);
    });
    return { byPerformer, looks };
}
