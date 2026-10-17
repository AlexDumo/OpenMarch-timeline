// Positions are derived on every client from the synced moves, never synced themselves. This is
// a tiny stand-in for the @openmarch/core resolver: spans, holds, and "who wins" by the
// 2026-10-16 layer rule (later start wins; on the same start, the shorter move wins).

/** Higher wins. */
export function priority(move) {
    // later start first, then shorter
    return move.start_beat * 1e6 - (move.end_beat - move.start_beat);
}

/** True if `a` beats `b` for the same marcher. */
export function wins(a, b) {
    const pa = priority(a);
    const pb = priority(b);
    return pa !== pb ? pa > pb : a.id > b.id;
}

/**
 * Builds a position function over a show snapshot.
 *
 * @param {{marchers: any[], moves: any[]}} show
 */
export function createResolver(show) {
    const homes = new Map(show.marchers.map((m) => [m.id, m]));
    const movesOf = new Map();
    for (const mv of show.moves) {
        if (!movesOf.has(mv.marcher_id)) movesOf.set(mv.marcher_id, []);
        movesOf.get(mv.marcher_id).push(mv);
    }

    /** Position of marcher `id` at beat `t` (real). */
    function positionAt(id, t, memo = new Map()) {
        const cacheKey = t;
        if (memo.has(cacheKey)) return memo.get(cacheKey);
        const home = homes.get(id);
        const moves = movesOf.get(id) ?? [];
        let out;
        // the winning move covering t (start < t <= end)
        let winner = null;
        for (const mv of moves) {
            if (mv.start_beat < t && t <= mv.end_beat) {
                if (!winner || wins(mv, winner)) winner = mv;
            }
        }
        if (winner) {
            // the span of the winner that holds t starts after the last higher-priority move
            // overlapping it ended (an override hands control back mid-move)
            let spanStart = winner.start_beat;
            for (const mv of moves) {
                if (mv === winner || !wins(mv, winner)) continue;
                if (mv.end_beat < t && mv.end_beat > spanStart)
                    spanStart = mv.end_beat;
            }
            const origin = positionAt(id, spanStart, memo);
            const f = (t - spanStart) / (winner.end_beat - spanStart);
            out = {
                x: origin.x + (winner.x - origin.x) * f,
                y: origin.y + (winner.y - origin.y) * f,
            };
        } else {
            // holding: where the last move to end left the marcher
            let last = null;
            for (const mv of moves) {
                if (mv.end_beat > t) continue;
                if (
                    !last ||
                    mv.end_beat > last.end_beat ||
                    (mv.end_beat === last.end_beat && wins(mv, last))
                )
                    last = mv;
            }
            out = last
                ? { x: last.x, y: last.y }
                : { x: home?.home_x ?? 0, y: home?.home_y ?? 0 };
        }
        memo.set(cacheKey, out);
        return out;
    }

    return {
        positionAt: (id, t) => positionAt(id, t),
        movesOf: (id) =>
            [...(movesOf.get(id) ?? [])].sort(
                (a, b) => a.start_beat - b.start_beat || a.end_beat - b.end_beat,
            ),
    };
}

/** Page flags in order, always starting at beat 0. */
export function flagBeats(pages) {
    const beats = [...new Set([0, ...pages.map((p) => p.beat)])];
    return beats.sort((a, b) => a - b);
}

/** The page box holding beat `t`: (previous flag, flag]. Beat 0 belongs to the first box. */
export function pageBoxAt(flags, t) {
    for (let i = 1; i < flags.length; i++) {
        if (t <= flags[i]) return { index: i, start: flags[i - 1], end: flags[i] };
    }
    if (flags.length < 2) return null;
    const i = flags.length - 1;
    return { index: i, start: flags[i - 1], end: flags[i] };
}

const PALETTE = [
    "#e4572e",
    "#17bebb",
    "#ffc914",
    "#76b041",
    "#a06cd5",
    "#ff6fb5",
    "#2e86ab",
    "#f18f01",
];

export function colorFor(seed) {
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

const SECTION_COLORS = {
    Winds: "#8ab4f8",
    Brass: "#f6c26b",
    Battery: "#f28b82",
    "Front Ensemble": "#c58af9",
    Guard: "#81c995",
};

export function sectionColor(section) {
    return SECTION_COLORS[section] ?? colorFor(section);
}
