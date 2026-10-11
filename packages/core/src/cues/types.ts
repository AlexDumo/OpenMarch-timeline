/**
 * Show-authored performer behavior: cues on channels, compiled per marcher.
 * The spec is docs/3d/performer-behavior.md; the storage is ADR 0004.
 *
 * Counts: count `c` is the c-th beat in `CompileInput.beats` (from 0), and
 * the number `c` means that count's click, the start of its beat row. A
 * fractional count is a time between clicks, proportional within the beat.
 */

/** One part of a performer's behavior that cues set independently. */
export type CueChannel = "feet" | "horn_equipment" | "facing" | "body";

export const CUE_CHANNELS: readonly CueChannel[] = [
    "feet",
    "horn_equipment",
    "facing",
    "body",
];

/** What a performer carries, which decides the cues that fit them. */
export type PerformerCarry =
    | "winds"
    | "battery"
    | "flag"
    | "rifle"
    | "sabre"
    | "none";

/** Who a cue applies to, broadest first. */
export type CueTarget =
    | { kind: "band" }
    | { kind: "section"; section: string }
    | { kind: "tag"; tagId: number }
    | { kind: "set"; marcherIds: readonly number[] };

export type RippleOrder = "drill" | "left_right" | "right_left" | "down_form";

export interface CueRipple {
    /** Counts the starts are spread over, inclusive. */
    span: number;
    order: RippleOrder;
}

/** A stored cue, as the compile step reads it. */
export interface CueInput {
    id: number;
    channel: CueChannel;
    kind: "state" | "phrase";
    target: CueTarget;
    /** The beat the cue sits on. */
    beatId: number;
    /** A built-in id (`builtin:...`) or a show phrase (`show:<id>`). */
    value: string;
    settings?: Readonly<Record<string, unknown>>;
    /** Phrases: the length in counts, inclusive, at least 2. */
    length?: number | null;
    /** States: the transition length in counts; null is the library default. */
    transitionLength?: number | null;
    ripple?: CueRipple | null;
}

export interface CueMarcher {
    id: number;
    section: string;
    tagIds: readonly number[];
    drillOrder: number;
    carries: PerformerCarry;
}

/** A show-stored phrase asset's metadata (ADR 0004 D-3). */
export interface ShowPhraseAsset {
    id: number;
    name: string;
    label: string;
    /** The channel it plays on and any it takes over. */
    channels: readonly CueChannel[];
}

/** Show-wide defaults the cues fall back to (ADR 0004 D-4). */
export interface CueShowDefaults {
    stepOffFoot?: "left" | "right";
}

export interface CompileInput {
    /** The show's timed beats in order. */
    beats: readonly { id: number; duration: number }[];
    marchers: readonly CueMarcher[];
    cues: readonly CueInput[];
    phraseAssets?: readonly ShowPhraseAsset[];
    showDefaults?: CueShowDefaults;
    /** Whether the marcher's dot travels during count `count`. */
    travels?: (marcherId: number, count: number) => boolean;
    /** The marcher's field position at a count's click (x toward side 2, y toward the front). */
    positionAt?: (marcherId: number, count: number) => { x: number; y: number };
}

export type SegmentKind = "default" | "state" | "transition" | "phrase";

/** What one marcher does on one channel over `[from, to)` counts. */
export interface CueSegment {
    from: number;
    to: number;
    kind: SegmentKind;
    value: string | null;
    label: string;
    settings: Readonly<Record<string, unknown>>;
    /** The cue that set it, or null for the default. */
    cueId: number | null;
    /** A zero-length transition keyed in fixed time, ending on `to`. */
    snap?: boolean;
    /** Set when another channel's cue owns this channel here. */
    takenOverFrom?: CueChannel;
}

export type CueFlagKind =
    | "clash"
    | "phrase_overlap"
    | "takeover_while_moving"
    | "fits_nobody"
    | "kind_not_allowed"
    | "transition_cut";

export interface CueFlag {
    kind: CueFlagKind;
    cueIds: readonly number[];
    marcherIds: readonly number[];
}

export interface CueTrace {
    /** The cue in effect, or null for the default. */
    winner: number | null;
    /** Set when the winner is another channel's cue taking this one over. */
    takenOverFrom?: CueChannel;
    /** Applicable cues it beat, latest and most specific first. */
    beaten: readonly number[];
}

export interface CompiledCues {
    segments(marcherId: number, channel: CueChannel): readonly CueSegment[];
    flags: readonly CueFlag[];
}
