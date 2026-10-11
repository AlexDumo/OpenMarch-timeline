// cspell:words choreo

/**
 * The built-in cue library v1: metadata only (docs/3d/performer-behavior.md
 * section 4). The animation data lives with the 3D View.
 */
import type { CueChannel, PerformerCarry, ShowPhraseAsset } from "./types";

export interface CueLibraryValue {
    id: string;
    channel: CueChannel;
    kind: "state" | "phrase";
    name: string;
    label: string;
    /** Who it fits; a cue skips everyone else. */
    fits: readonly PerformerCarry[];
    /** Other channels it owns while it applies. */
    takesOver?: readonly CueChannel[];
    /** States: the default transition length in counts (1 is a snap). */
    defaultTransition?: number;
    /** Phrases: the lengths it stretches to. */
    minLength?: number;
    maxLength?: number;
    /** Only valid while the dot holds. */
    standingOnly?: boolean;
}

/** Every carry: values that fit any performer. */
export const ALL_CARRIES: readonly PerformerCarry[] = [
    "winds",
    "battery",
    "flag",
    "rifle",
    "sabre",
    "none",
];
const GUARD: readonly PerformerCarry[] = ["flag", "rifle", "sabre"];

const state = (
    id: string,
    channel: CueChannel,
    name: string,
    label: string,
    fits: readonly PerformerCarry[],
    defaultTransition = 1,
    extra: Partial<CueLibraryValue> = {},
): CueLibraryValue => ({
    id: `builtin:${id}`,
    channel,
    kind: "state",
    name,
    label,
    fits,
    defaultTransition,
    ...extra,
});

const phrase = (
    id: string,
    channel: CueChannel,
    name: string,
    label: string,
    fits: readonly PerformerCarry[],
    minLength: number,
    maxLength: number,
    extra: Partial<CueLibraryValue> = {},
): CueLibraryValue => ({
    id: `builtin:${id}`,
    channel,
    kind: "phrase",
    name,
    label,
    fits,
    minLength,
    maxLength,
    ...extra,
});

export const CUE_LIBRARY: readonly CueLibraryValue[] = [
    state("feet.step", "feet", "Step", "Step", ALL_CARRIES),
    state("horn.up", "horn_equipment", "Horns up", "HU", ["winds"]),
    state("horn.down", "horn_equipment", "Horns down", "HD", ["winds"]),
    state("horn.trail", "horn_equipment", "Trail", "Trail", ["winds"]),
    state("battery.playing", "horn_equipment", "Playing", "Play", ["battery"]),
    state("battery.sticksIn", "horn_equipment", "Sticks in", "In", ["battery"]),
    state("battery.sticksDown", "horn_equipment", "Sticks down", "Down", [
        "battery",
    ]),
    state("flag.set", "horn_equipment", "Flag set", "Set", GUARD),
    state("flag.port", "horn_equipment", "Flag port", "Port", GUARD),
    phrase(
        "flag.dropSpin",
        "horn_equipment",
        "Flag drop spin",
        "Drop",
        GUARD,
        2,
        16,
    ),
    phrase(
        "flag.toss1",
        "horn_equipment",
        "Flag single toss",
        "1x",
        GUARD,
        2,
        8,
    ),
    state("rifle.portArms", "horn_equipment", "Port arms", "Port", GUARD),
    state("rifle.present", "horn_equipment", "Present", "Pres", GUARD),
    phrase(
        "rifle.dropSpin",
        "horn_equipment",
        "Rifle drop spin",
        "Drop",
        GUARD,
        2,
        16,
    ),
    phrase(
        "rifle.toss1",
        "horn_equipment",
        "Rifle single toss",
        "1x",
        GUARD,
        2,
        8,
    ),
    phrase(
        "rifle.toss2",
        "horn_equipment",
        "Rifle double toss",
        "2x",
        GUARD,
        2,
        8,
    ),
    state("sabre.set", "horn_equipment", "Sabre set", "Set", GUARD),
    phrase(
        "sabre.toss1",
        "horn_equipment",
        "Sabre single toss",
        "1x",
        GUARD,
        2,
        8,
    ),
    state("facing.front", "facing", "Front", "Front", ALL_CARRIES, 2),
    state("facing.back", "facing", "Back", "Back", ALL_CARRIES, 2),
    state("facing.side1", "facing", "Side 1", "S1", ALL_CARRIES, 2),
    state("facing.side2", "facing", "Side 2", "S2", ALL_CARRIES, 2),
    state(
        "facing.travel",
        "facing",
        "Direction of travel",
        "Travel",
        ALL_CARRIES,
        2,
    ),
    state("facing.angle", "facing", "Angle", "Angle", ALL_CARRIES, 2),
    state("facing.point", "facing", "Toward a point", "Point", ALL_CARRIES, 2),
    state("body.neutral", "body", "Neutral", "—", ALL_CARRIES),
    state("body.kneel", "body", "Kneel", "Kneel", ALL_CARRIES, 3, {
        takesOver: ["feet"],
        standingOnly: true,
    }),
    phrase("body.choreo", "body", "Choreography", "Choreo", ALL_CARRIES, 8, 8, {
        takesOver: ["horn_equipment"],
    }),
];

const BY_ID = new Map(CUE_LIBRARY.map((v) => [v.id, v]));

export function cueLibraryValue(id: string): CueLibraryValue | undefined {
    return BY_ID.get(id);
}

/** Looks a cue value up in the built-in library or the show's phrase assets. */
export type CueValueLookup = (id: string) => CueLibraryValue | undefined;

/**
 * A lookup over the built-ins plus the show's phrase assets, which fit every
 * performer and take over every channel they list.
 */
export function cueValueLookup(
    phraseAssets: readonly ShowPhraseAsset[] = [],
): CueValueLookup {
    const shown = new Map<string, CueLibraryValue>(
        phraseAssets.map((asset) => [
            `show:${asset.id}`,
            {
                id: `show:${asset.id}`,
                channel: asset.channels[0] ?? "body",
                kind: "phrase",
                name: asset.name,
                label: asset.label,
                fits: ALL_CARRIES,
                takesOver: asset.channels,
                minLength: 2,
            },
        ]),
    );
    return (id) => BY_ID.get(id) ?? shown.get(id);
}

const DEFAULT_CARRY_VALUE: Record<PerformerCarry, string | null> = {
    winds: "builtin:horn.up",
    battery: "builtin:battery.playing",
    flag: "builtin:flag.set",
    rifle: "builtin:rifle.portArms",
    sabre: "builtin:sabre.set",
    none: null,
};

/** The built-in default, never stored, on a channel for what a performer carries. */
export function defaultCueValue(
    channel: CueChannel,
    carries: PerformerCarry,
): string | null {
    switch (channel) {
        case "feet":
            return "builtin:feet.step";
        case "horn_equipment":
            return DEFAULT_CARRY_VALUE[carries];
        case "facing":
            return "builtin:facing.front";
        case "body":
            return "builtin:body.neutral";
    }
}
