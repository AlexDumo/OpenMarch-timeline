// Show snapshots: a generated demo, and an importer for real OpenMarch `.dots` files (page model,
// user_version 7, and timeline model, 8). A snapshot is plain rows, the same shape the server
// stores and the clients mirror.

/** @typedef {{name: string, marchers: any[], pages: any[], moves: any[], meta: {key: string, value: string}[]}} Snapshot */

const STEP = 12; // pixels per 8-to-5 step, roughly the app's default
const FIELD = { width: 160 * STEP, height: 85 * STEP };
export { FIELD };

/** A generated band: four sections, six pages of 16 counts, a few moves already written. */
export function demoShow() {
    const sections = [
        ["Winds", "W", 16],
        ["Brass", "B", 12],
        ["Battery", "D", 10],
        ["Guard", "G", 8],
    ];
    const marchers = [];
    let id = 1;
    const cx = FIELD.width / 2;
    const cy = FIELD.height / 2;
    sections.forEach(([section, prefix, count], s) => {
        for (let i = 0; i < count; i++) {
            marchers.push({
                id: id++,
                name: `${section} ${i + 1}`,
                section,
                drill_prefix: prefix,
                drill_order: i + 1,
                home_x: cx + (i - (count - 1) / 2) * 4 * STEP,
                home_y: cy - 24 * STEP + s * 14 * STEP,
            });
        }
    });
    const pages = [];
    for (let p = 1; p <= 6; p++) pages.push({ id: p, beat: p * 16 });
    const moves = [];
    let moveId = 1;
    // page 1: everyone steps forward 4; page 2: battery forms an arc
    for (const m of marchers) {
        moves.push({
            id: moveId++,
            marcher_id: m.id,
            start_beat: 0,
            end_beat: 16,
            x: m.home_x,
            y: m.home_y + 4 * STEP,
        });
    }
    marchers
        .filter((m) => m.section === "Battery")
        .forEach((m, i, all) => {
            const a = Math.PI * (0.15 + (0.7 * i) / (all.length - 1));
            moves.push({
                id: moveId++,
                marcher_id: m.id,
                start_beat: 16,
                end_beat: 32,
                x: cx - Math.cos(a) * 16 * STEP,
                y: cy + 14 * STEP - Math.sin(a) * 10 * STEP,
            });
        });
    return {
        name: "Demo show",
        marchers,
        pages,
        moves,
        meta: [
            { key: "name", value: "Demo show" },
            { key: "total_beats", value: "96" },
            { key: "grid_version", value: "1" },
        ],
    };
}

/**
 * Reads a `.dots` file with sql.js. Motion becomes moves where a marcher's position changes
 * (the converter's defined-coordinates rule, ADR 0001 2026-10-08). Timeline files keep their
 * shapeless moves; moves into shapes are skipped (the prototype has no shape resolver).
 *
 * @param {any} SQL sql.js module
 * @param {Uint8Array} bytes
 * @param {string} fileName
 * @returns {Snapshot & {notes: string[]}}
 */
export function importDots(SQL, bytes, fileName) {
    const db = new SQL.Database(bytes);
    const notes = [];
    const all = (sql) => {
        const res = db.exec(sql);
        if (res.length === 0) return [];
        const { columns, values } = res[0];
        return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
    };
    const has = (table) =>
        all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).length > 0;
    const version = all("PRAGMA user_version")[0]?.user_version ?? 0;

    // beat ordinals and page flags (a page is named by its end flag)
    const beats = all("SELECT id, position FROM beats ORDER BY position");
    const ordinal = new Map(beats.map((b, i) => [b.id, i]));
    const pageRows = all("SELECT id, start_beat FROM pages");
    const starts = pageRows
        .map((p) => ({ id: p.id, start: ordinal.get(p.start_beat) ?? 0 }))
        .sort((a, b) => a.start - b.start);
    const lastCounts = has("utility")
        ? (all("SELECT last_page_counts FROM utility")[0]?.last_page_counts ?? 8)
        : 8;
    // page i's box ends where page i+1 starts; the last page runs `last_page_counts`
    const pageEnd = new Map();
    starts.forEach((p, i) => {
        pageEnd.set(
            p.id,
            i + 1 < starts.length ? starts[i + 1].start : p.start + lastCounts,
        );
    });
    // every page's end is a flag (beat 0 is implicit)
    const pages = [];
    let pageId = 1;
    for (const p of starts) {
        const end = pageEnd.get(p.id);
        if (end > 0 && !pages.some((q) => q.beat === end))
            pages.push({ id: pageId++, beat: end });
    }
    const lastEnd = starts.length ? pageEnd.get(starts[starts.length - 1].id) : 16;

    const marcherCols = has("marchers")
        ? all("PRAGMA table_info(marchers)").map((c) => c.name)
        : [];
    const hasHomes = marcherCols.includes("home_x");
    const marchers = all(
        `SELECT id, name, section, drill_prefix, drill_order${hasHomes ? ", home_x, home_y" : ""} FROM marchers`,
    ).map((m) => ({ home_x: 0, home_y: 0, ...m }));

    const moves = [];
    let moveId = 1;
    if (has("marcher_pages")) {
        // page model: page 0 is the home, then a move per page where the position changed
        const mps = all("SELECT marcher_id, page_id, x, y FROM marcher_pages");
        const at = new Map(mps.map((r) => [`${r.marcher_id}:${r.page_id}`, r]));
        for (const m of marchers) {
            let prev = null;
            starts.forEach((p, i) => {
                const here = at.get(`${m.id}:${p.id}`);
                if (!here) return;
                if (i === 0) {
                    m.home_x = here.x;
                    m.home_y = here.y;
                } else if (
                    prev &&
                    (here.x !== prev.x || here.y !== prev.y) &&
                    pageEnd.get(p.id) > p.start
                ) {
                    moves.push({
                        id: moveId++,
                        marcher_id: m.id,
                        start_beat: p.start,
                        end_beat: pageEnd.get(p.id),
                        x: here.x,
                        y: here.y,
                    });
                }
                prev = here;
            });
        }
        notes.push(`Page-model file (version ${version}): one move per page where a marcher's spot changed.`);
    } else if (has("timeline_assignments")) {
        const rows = all(`SELECT a.marcher_id, a.start_beat, a.end_beat, d.x, d.y
            FROM timeline_assignments a
            JOIN timeline_transitions t ON t.id = a.transition_id
            JOIN timeline_slot_destinations d ON d.transition_id = t.id AND d.slot_index = a.slot_index
            WHERE t.dest_shape_id IS NULL`);
        const seen = new Set();
        for (const r of rows) {
            const k = `${r.marcher_id}:${r.start_beat}:${r.end_beat}`;
            if (seen.has(k)) continue;
            seen.add(k);
            moves.push({ id: moveId++, ...r });
        }
        const shaped = all(
            "SELECT count(*) AS c FROM timeline_assignments a JOIN timeline_transitions t ON t.id = a.transition_id WHERE t.dest_shape_id IS NOT NULL",
        )[0]?.c;
        notes.push(`Timeline file (version ${version}): ${moves.length} moves kept.`);
        if (shaped) notes.push(`${shaped} moves into shapes were skipped: the prototype has no shape resolver.`);
    }
    db.close();
    const name = fileName.replace(/\.dots$/i, "");
    return {
        name,
        marchers,
        pages,
        moves,
        meta: [
            { key: "name", value: name },
            { key: "total_beats", value: String(lastEnd) },
            { key: "grid_version", value: "1" },
        ],
        notes,
    };
}
