import type { SpanInfo } from "@openmarch/core";
import type { XY } from "../types";
import type { OpenSpot } from "./placedBox";

/**
 * Why a placed shape's spot is open at a count (ADR 0006 revision of 2026-11-22, §9.1): its member
 * is listed but stands elsewhere, or a later shape took it. Worked out from where the member stands
 * and from its moves, only for shapes drawn at the playhead, so it costs a few resolver reads per
 * open spot on screen and nothing for the rest of the show. Pure.
 *
 * - **on the way**: at a count the shape is carried onto, moving to its spot and not there yet
 * - **late**: at the shape's own count, it arrives on its spot after it, at `at`
 * - **taken over**: a higher layer cut into its move to the spot at `at`, before it got there
 * - **left**: it stood on its spot and moved off at `at`
 * - **empty**: its marcher joined another shape since
 * - **away**: none of these: it isn't on its spot, and no move of its own explains why
 */
export type OpenSpotStatus =
    | { readonly kind: "onTheWay"; readonly at: number }
    | { readonly kind: "late"; readonly at: number }
    | { readonly kind: "takenOver"; readonly at: number }
    | { readonly kind: "left"; readonly at: number }
    | { readonly kind: "empty" }
    | { readonly kind: "away" };

/** The parts of a resolver span this reads */
export type StatusSpan = Pick<
    SpanInfo,
    "start" | "end" | "kind" | "assignmentEnd"
>;

/** How close a marcher must stand to its spot to be on it, in field units (as `boxesAt`) */
const ON_SPOT = 0.01;
const EPS = 1e-9;
/** How many of its later moves are looked through for an arrival on the spot */
const LOOK_AHEAD = 8;

const onSpot = (p: XY | undefined, spot: XY) =>
    p !== undefined &&
    Math.abs(p.x - spot.x) <= ON_SPOT &&
    Math.abs(p.y - spot.y) <= ON_SPOT;

/**
 * Why `spot` is open at `beat`, for a shape marked at `markBeat` (at or before `beat`).
 *
 * @param spans the member's resolver spans, in time order
 * @param positionAt where the member stands at a beat
 */
export function openSpotStatus({
    spot,
    markBeat,
    beat,
    spans,
    positionAt,
}: {
    spot: Pick<OpenSpot, "x" | "y" | "taken">;
    markBeat: number;
    beat: number;
    spans: readonly StatusSpan[];
    positionAt: (beat: number) => XY | undefined;
}): OpenSpotStatus {
    if (spot.taken) return { kind: "empty" };
    const moves = spans.filter((s) => s.kind !== "hold");

    // Its move to the shape, cut short by a higher layer before it arrived (R-2): the row ends at
    // or after the shape's count, the span where it stopped earlier, by the playhead
    const cut = moves
        .filter(
            (s) =>
                s.assignmentEnd !== null &&
                s.assignmentEnd > s.end + EPS &&
                s.assignmentEnd >= markBeat - EPS &&
                s.start < markBeat - EPS &&
                s.end <= beat + EPS,
        )
        .at(-1);
    if (cut) return { kind: "takenOver", at: cut.end };

    // Still to arrive: the first later move that ends on the spot
    let looked = 0;
    for (const s of moves) {
        if (s.end <= beat + EPS || !Number.isFinite(s.end)) continue;
        if (looked++ >= LOOK_AHEAD) break;
        if (onSpot(positionAt(s.end), spot))
            return beat <= markBeat + EPS
                ? { kind: "late", at: s.end }
                : { kind: "onTheWay", at: s.end };
    }

    // Moved off it: the last move started by the playhead from the spot
    looked = 0;
    for (let i = moves.length - 1; i >= 0; i--) {
        const s = moves[i]!;
        if (!Number.isFinite(s.start) || s.start >= beat - EPS) continue;
        if (looked++ >= LOOK_AHEAD) break;
        if (onSpot(positionAt(s.start), spot))
            return { kind: "left", at: s.start };
    }
    return { kind: "away" };
}

/**
 * The words beside an open ring: "B12 · late, arrives Page 2 count 8". `where` names a beat as the
 * timeline does ("Page 2 count 8"); `t` is Tolgee's.
 */
export function openSpotLabel(
    status: OpenSpotStatus,
    name: string,
    where: (beat: number) => string,
    t: (key: string, params: Record<string, string>) => string,
): string {
    switch (status.kind) {
        case "onTheWay":
            return t("shapes.placed.open.onTheWay", { name });
        case "late":
            return t("shapes.placed.open.late", {
                name,
                where: where(status.at),
            });
        case "takenOver":
            return t("shapes.placed.open.takenOver", {
                name,
                where: where(status.at),
            });
        case "left":
            return t("shapes.placed.open.left", {
                name,
                where: where(status.at),
            });
        case "empty":
            return t("shapes.placed.open.empty", { name });
        case "away":
            return t("shapes.placed.open.away", { name });
    }
}
