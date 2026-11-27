/**
 * Facing cues (ADR 0015 D-3 and its 2026-11-24 amendment; fork #993): where a performer's chest
 * and equipment point, in plain degrees (0 front, 90 side 2, 180 back, 270 or −90 side 1; 360 is
 * a full spin). A cue's turn starts on its count and takes its turn counts (`transition`) at an
 * even speed; a new cue is instant. Each performer turns from their own angle, so the quick picks
 * (Front, Back, the sides) go to the nearest equivalent angle and the 45° turns go from it (core's
 * `facingTargetDegrees`).
 *
 * The rules here are pure, so the commands, the field menu, the Facing lane and their tests read
 * the same answers.
 */
import {
    facingAt,
    facingDegreesAt,
    nearestEquivalentDegrees,
    type CompiledCues,
    type CueSegment,
} from "@openmarch/core";
import type { DatabaseCue } from "@/db-functions/cues";
import {
    editedPerformers,
    emptyPlan,
    landOn,
    sameSetting,
    type EquipmentSet,
} from "./equipment";

/** The quick picks, in menu order: the four directions, then the two 45° turns */
export const FACING_PICKS = [
    "front",
    "back",
    "side1",
    "side2",
    "turnLeft",
    "turnRight",
] as const;
export type FacingPick = (typeof FACING_PICKS)[number];

/** What a Facing command sets: a quick pick, or an exact angle (Angle…) */
export type FacingChoice =
    | { readonly kind: FacingPick }
    | { readonly kind: "angle"; readonly degrees: number };

/** The angle of each direction, before the nearest equivalent is taken */
export const DIRECTION_DEGREES = {
    front: 0,
    back: 180,
    side1: 270,
    side2: 90,
} as const;
export type FacingDirection = keyof typeof DIRECTION_DEGREES;

/** The value and settings a Facing cue for `choice` stores */
export function facingValueOf(choice: FacingChoice): {
    value: string;
    settings: Record<string, unknown>;
} {
    return choice.kind === "angle"
        ? {
              value: "builtin:facing.angle",
              settings: { degrees: choice.degrees },
          }
        : { value: `builtin:facing.${choice.kind}`, settings: {} };
}

/**
 * Setting a facing for `marcherIds` on `beatId` replaces theirs there: they leave the other Facing
 * cues on that count (a cue left with nobody is deleted), then join the cue there that sets the
 * same angle the same way, or a new instant, lasting cue is made. One undo step.
 */
export function planFacingSet({
    cues,
    choice,
    marcherIds,
    beatId,
    labelFor,
    relabelFor = labelFor,
}: {
    cues: readonly DatabaseCue[];
    choice: FacingChoice;
    marcherIds: readonly number[];
    beatId: number;
    labelFor: (marcherIds: readonly number[]) => string | null;
    relabelFor?: (marcherIds: readonly number[]) => string | null;
}): EquipmentSet {
    const plan = emptyPlan();
    if (marcherIds.length === 0) return plan;
    const { value, settings } = facingValueOf(choice);
    const made = { value, settings, transition: null } as DatabaseCue;
    const target = landOn({
        cues,
        type: "facing",
        beatId,
        length: null,
        value,
        matches: (c) => sameSetting(c, made),
        marcherIds,
        relabelFor,
        plan,
    });
    if (target) {
        const joined = editedPerformers(target, marcherIds, "add");
        if (joined)
            plan.modifiedCues.push({
                id: target.id,
                marcherIds: joined,
                label: relabelFor(joined),
            });
    } else
        plan.newCues.push({
            type: "facing",
            beatId,
            value,
            settings,
            marcherIds: [...marcherIds],
            label: labelFor(marcherIds),
        });
    return plan;
}

/**
 * Whether every one of `marcherIds` already faces what `choice` gives at `count`: a direction at
 * any number of spins, an angle exactly. A turn always turns, so it's never already done.
 */
export function facingAlready({
    compiled,
    choice,
    marcherIds,
    count,
}: {
    compiled: CompiledCues;
    choice: FacingChoice;
    marcherIds: readonly number[];
    count: number;
}): boolean {
    if (marcherIds.length === 0) return false;
    if (choice.kind === "turnLeft" || choice.kind === "turnRight") return false;
    const exact = choice.kind === "angle" ? choice.degrees : null;
    const direction =
        choice.kind === "angle" ? 0 : DIRECTION_DEGREES[choice.kind];
    return marcherIds.every((id) => {
        const at = facingAt(compiled, id, count);
        if (exact !== null) return at === exact;
        return Math.abs(nearestEquivalentDegrees(direction, at) - at) < 1e-9;
    });
}

/** One piece of a Facing lane row: a turn over `[from, to)`, or a hold of one angle */
export interface FacingPiece {
    readonly from: number;
    readonly to: number;
    readonly kind: "turn" | "hold";
    readonly fromDegrees: number;
    readonly degrees: number;
    /** The cue that turned them; null for the section's default angle before any cue */
    readonly cueId: number | null;
}

export interface FacingRow {
    readonly key: string;
    readonly marcherIds: readonly number[];
    /** The label of a cue made for exactly these performers, or null (the caller names them) */
    readonly label: string | null;
    readonly pieces: readonly FacingPiece[];
}

/**
 * One keyframe on the lane's top row (fork #1315): a count where anyone's facing changes. Every
 * Facing cue on that count shares it, whatever its performers and its turn.
 */
export interface FacingKey {
    readonly count: number;
    /** The cues on this count, in the order they were made */
    readonly cueIds: readonly number[];
    /** Who changes facing here (the cues' performers on the lane), in id order */
    readonly marcherIds: readonly number[];
}

export interface FacingLaneData {
    readonly rows: readonly FacingRow[];
    readonly marcherIds: readonly number[];
    /** The keyframes, one per count where a Facing cue lands, in count order */
    readonly keys: readonly FacingKey[];
}

/** A performer's Facing as lane pieces; an instant turn draws nothing of its own */
function piecesOf(segments: readonly CueSegment[]): FacingPiece[] {
    const out: FacingPiece[] = [];
    for (const seg of segments) {
        if (seg.to <= seg.from) continue;
        const degrees = seg.degrees ?? facingDegreesAt(segments, seg.to);
        out.push({
            from: seg.from,
            to: seg.to,
            kind: seg.kind === "transition" ? "turn" : "hold",
            fromDegrees:
                seg.kind === "transition"
                    ? (seg.fromDegrees ?? degrees)
                    : degrees,
            degrees,
            cueId: seg.cueId,
        });
    }
    return out;
}

const pieceKey = (p: FacingPiece) =>
    `${p.from}:${p.to}:${p.kind}:${p.fromDegrees}:${p.degrees}:${p.cueId ?? ""}`;

/**
 * The Facing lane: a row per group of performers with one Facing history (only those with a
 * Facing cue), in order of their first cue, then their first performer.
 */
export function facingLane({
    compiled,
    cues,
    marcherIds,
}: {
    compiled: CompiledCues;
    cues: readonly DatabaseCue[];
    /** The show's performers: anyone else a cue names (an item) is left out */
    marcherIds: readonly number[];
}): FacingLaneData {
    const facing = cues.filter((c) => c.type === "facing");
    const known = new Set(marcherIds);
    const inLane = [...new Set(facing.flatMap((c) => c.marcherIds))]
        .filter((id) => known.has(id))
        .sort((a, b) => a - b);
    const groups = new Map<string, { ids: number[]; pieces: FacingPiece[] }>();
    for (const id of inLane) {
        const pieces = piecesOf(compiled.segments(id, "facing"));
        if (!pieces.some((p) => p.cueId !== null)) continue;
        const key = pieces.map(pieceKey).join("|");
        const group = groups.get(key);
        if (group) group.ids.push(id);
        else groups.set(key, { ids: [id], pieces });
    }
    const firstCue = (pieces: readonly FacingPiece[]) =>
        pieces.find((p) => p.cueId !== null)?.from ?? Infinity;
    const rows = [...groups.values()]
        .sort(
            (a, b) =>
                firstCue(a.pieces) - firstCue(b.pieces) ||
                a.ids[0]! - b.ids[0]!,
        )
        .map(({ ids, pieces }): FacingRow => {
            const set = new Set(ids);
            const named = facing.find(
                (c) =>
                    c.label &&
                    c.marcherIds.length === ids.length &&
                    c.marcherIds.every((id) => set.has(id)),
            );
            return {
                key: ids.join(","),
                marcherIds: ids,
                label: named?.label ?? null,
                pieces,
            };
        });
    // A cue is its result on its count: where its hold starts, or where its turn ends (a hold
    // the next turn starts on at once draws nothing)
    const countOf = new Map<number, number>();
    for (const row of rows)
        for (const p of row.pieces)
            if (p.cueId !== null && !countOf.has(p.cueId))
                countOf.set(p.cueId, p.kind === "turn" ? p.to : p.from);
    const keys = new Map<number, { cueIds: number[]; ids: Set<number> }>();
    for (const c of facing) {
        const count = countOf.get(c.id);
        if (count === undefined) continue;
        const key = keys.get(count) ?? { cueIds: [], ids: new Set() };
        key.cueIds.push(c.id);
        for (const id of c.marcherIds) if (known.has(id)) key.ids.add(id);
        keys.set(count, key);
    }
    return {
        rows,
        marcherIds: rows.flatMap((r) => r.marcherIds).sort((a, b) => a - b),
        keys: [...keys]
            .sort(([a], [b]) => a - b)
            .map(([count, { cueIds, ids }]) => ({
                count,
                cueIds,
                marcherIds: [...ids].sort((a, b) => a - b),
            })),
    };
}

/**
 * The rows the lane draws for a selection (fork #1315): each group with a selected performer in
 * it, so a selection that spans groups with different histories shows each of them. Nothing
 * selected, no rows: the lane is its keyframes alone.
 */
export function facingRowsFor(
    rows: readonly FacingRow[],
    selectedIds: readonly number[],
): readonly FacingRow[] {
    if (selectedIds.length === 0) return [];
    const selected = new Set(selectedIds);
    return rows.filter((r) => r.marcherIds.some((id) => selected.has(id)));
}

/**
 * The selection a click on a keyframe leaves (fork #1315), as a click on a marcher does
 * (`selectionAfterClick`): its performers alone; with `add` (Shift, or the touch pill's Add)
 * they join the selection, or leave it when every one of them is in it already.
 */
export function selectionAfterKeyClick(
    current: readonly number[],
    key: Pick<FacingKey, "marcherIds">,
    add: boolean,
): readonly number[] {
    if (!add) return key.marcherIds;
    const theirs = new Set(key.marcherIds);
    if (key.marcherIds.every((id) => current.includes(id)))
        return current.filter((id) => !theirs.has(id));
    return [
        ...current,
        ...key.marcherIds.filter((id) => !current.includes(id)),
    ];
}

/** An angle as the lane and the popover write it: "90°", "−270°" */
export const formatDegrees = (degrees: number): string => {
    const rounded = Math.round(degrees * 10) / 10;
    return `${rounded < 0 ? "−" : ""}${Math.abs(rounded)}°`;
};

/** The direction an angle points, when it's one of the four */
export function directionOf(degrees: number): FacingDirection | null {
    const turned = (((Math.round(degrees * 1000) / 1000) % 360) + 360) % 360;
    for (const [name, at] of Object.entries(DIRECTION_DEGREES))
        if (turned === at) return name as FacingDirection;
    return null;
}

/**
 * A lane piece's words: a turn by its angles ("0° → 90°"), a hold by its direction and angle
 * ("Side 2 · 90°"), or its angle alone between the four directions ("45°").
 */
export function turnLabel(
    piece: Pick<FacingPiece, "kind" | "fromDegrees" | "degrees">,
    names: Readonly<Record<FacingDirection, string>>,
): string {
    if (piece.kind === "turn")
        return `${formatDegrees(piece.fromDegrees)} → ${formatDegrees(piece.degrees)}`;
    const direction = directionOf(piece.degrees);
    return direction
        ? `${names[direction]} · ${formatDegrees(piece.degrees)}`
        : formatDegrees(piece.degrees);
}
