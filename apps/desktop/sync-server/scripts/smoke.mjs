/* eslint-disable no-console */
// Drives the sync server with two scripted clients and checks the protocol end to end
// (docs/collaboration/spike/CONTRACT.md). Start the server first (`wrangler dev --port 8790`,
// see ../README.md), then: `node scripts/smoke.mjs` (BASE=http://127.0.0.1:8790 by default).
// The show is a fresh copy of the app's _blank.dots with three marchers and one timeline move.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLANK = path.resolve(
    HERE,
    "../../electron/database/migrations/_blank.dots",
);
const TABLES = JSON.parse(
    fs.readFileSync(path.resolve(HERE, "../generated/tables.json"), "utf8"),
);
const BASE = process.env.BASE ?? "http://127.0.0.1:8790";

let failures = 0;
const check = (ok, what, detail) => {
    console.log(
        `${ok ? "ok  " : "FAIL"} ${what}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ""}`,
    );
    if (!ok) failures++;
};

/** A show as the app would have it: _blank.dots plus marchers and one timeline move. */
function buildSnapshot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sync-smoke-"));
    const file = path.join(dir, "show.dots");
    fs.copyFileSync(BLANK, file);
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`
        INSERT INTO marchers (id, name, section, drill_prefix, drill_order, home_x, home_y) VALUES
            (1, 'Ana', 'Trumpet', 'T', 1, 0, 0),
            (2, 'Ben', 'Trumpet', 'T', 2, 10, 0),
            (3, 'Cy', 'Snare', 'S', 1, 20, 0);
        INSERT INTO timelines (id, name, start_beat, end_beat) VALUES (1, 'Move 1', 0, 16);
        INSERT INTO timeline_transitions (id, timeline_id, slot_count, start_beat, end_beat)
            VALUES (1, 1, 2, 0, 16);
        INSERT INTO timeline_slot_destinations (id, transition_id, slot_index, x, y) VALUES
            (1, 1, 0, 100, 50), (2, 1, 1, 110, 50);
        INSERT INTO timeline_assignments (id, marcher_id, transition_id, slot_index, start_beat, end_beat)
            VALUES (1, 1, 1, 0, 0, 16), (2, 2, 1, 1, 0, 16);
    `);
    const violations = db
        .prepare("SELECT * FROM timeline_commit_violations")
        .all();
    if (violations.length)
        throw new Error(`fixture is invalid: ${JSON.stringify(violations)}`);
    const snapshot = {};
    for (const table of TABLES.order) {
        const { blobColumns } = TABLES.tables[table];
        snapshot[table] = db
            .prepare(`SELECT * FROM "${table}"`)
            .all()
            .map((r) => {
                const row = { ...r };
                for (const c of blobColumns) delete row[c];
                return row;
            });
    }
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return snapshot;
}

function client(sessionId, name, { ownerToken, lastSeq = -1 } = {}) {
    const ws = new WebSocket(
        `${BASE.replace(/^http/, "ws")}/api/sessions/${sessionId}/ws`,
    );
    const inbox = [];
    const waiters = [];
    ws.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        const w = waiters.find((x) => x.pred(msg));
        if (w) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(msg);
        } else inbox.push(msg);
    });
    const user = { id: `${name}-id`, name, color: "#fff" };
    const c = {
        ws,
        user,
        seq: 0,
        grid: 1,
        next(pred, ms = 5000) {
            const found = inbox.find(pred);
            if (found) {
                inbox.splice(inbox.indexOf(found), 1);
                return Promise.resolve(found);
            }
            return new Promise((resolve, reject) => {
                waiters.push({ pred, resolve });
                setTimeout(() => reject(new Error(`${name}: timed out`)), ms);
            });
        },
        send: (m) => ws.send(JSON.stringify(m)),
        op(changes, { baseSeq, gridVersion, label = "smoke", opId } = {}) {
            const id = opId ?? crypto.randomUUID();
            c.send({
                type: "op",
                op: {
                    opId: id,
                    baseSeq: baseSeq ?? c.seq,
                    gridVersion: gridVersion ?? c.grid,
                    label,
                    changes,
                },
            });
            return id;
        },
        outcome: (opId) =>
            c.next(
                (m) =>
                    (m.type === "applied" || m.type === "rejected") &&
                    m.opId === opId,
            ),
        close: () =>
            new Promise((resolve) => {
                ws.addEventListener("close", resolve);
                ws.close();
            }),
    };
    ws.addEventListener("open", () =>
        c.send({ type: "hello", user, ownerToken, lastSeq }),
    );
    return c;
}

const update = (table, id, set, prev = {}) => ({
    kind: "update",
    table,
    id,
    set,
    prev,
});

async function main() {
    // make collaborative
    const snapshot = buildSnapshot();
    let res = await fetch(`${BASE}/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ snapshot }),
    });
    const created = await res.json();
    const { sessionId, ownerToken } = created;
    check(
        res.ok && /^[0-9a-f]{64}$/.test(sessionId) && Boolean(ownerToken),
        "POST /api/sessions creates a session from a snapshot of _blank.dots + a timeline move",
        created,
    );
    res = await fetch(`${BASE}/api/sessions/${sessionId}/snapshot`);
    const snap = await res.json();
    check(
        res.ok &&
            snap.seq === 0 &&
            snap.gridVersion === 1 &&
            snap.snapshot.marchers.length === 3 &&
            snap.snapshot.timeline_assignments.length === 2 &&
            snap.snapshot.beats.length === 1,
        "GET snapshot returns {seq, gridVersion, snapshot}",
        snap,
    );
    res = await fetch(`${BASE}/api/sessions/${"0".repeat(64)}/snapshot`);
    check(res.status === 404, "unknown session is 404");
    res = await fetch(`${BASE}/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ snapshot: { workspace_settings: [] } }),
    });
    check(
        res.status === 400,
        "a snapshot with a table out of scope is refused",
    );

    const a = client(sessionId, "Alex", { ownerToken });
    const b = client(sessionId, "Bea");
    const aw = await a.next((m) => m.type === "welcome");
    const bw = await b.next((m) => m.type === "welcome");
    check(
        aw.you.role === "owner" && bw.you.role === "editor",
        "roles: the owner token holder is owner, the other an editor",
        [aw.you, bw.you],
    );
    check(
        aw.you.idBase === 2 ** 40 && bw.you.idBase === 2 * 2 ** 40,
        "idBase = memberIndex * 2^40, from 1",
        [aw.you.idBase, bw.you.idBase],
    );
    check(
        bw.snapshot?.marchers.length === 3 &&
            bw.snapshot.timeline_slot_destinations.length === 2 &&
            bw.seq === 0 &&
            bw.gridVersion === 1,
        "welcome carries the snapshot, seq and gridVersion",
    );

    const settle = (m) => {
        a.seq = b.seq = m.seq;
        a.grid = b.grid = m.gridVersion;
    };

    // an update applies and is broadcast
    let id = a.op([update("marchers", 1, { name: "Ana R." }, { name: "Ana" })]);
    let ra = await a.outcome(id);
    let rb = await b.next((m) => m.type === "applied" && m.opId === id);
    check(
        ra.type === "applied" &&
            ra.seq === 1 &&
            rb.changes[0].set.name === "Ana R." &&
            rb.changes[0].prev.name === "Ana" &&
            rb.by.name === "Alex",
        "an update applies and reaches the other client with prev as the server had it",
        ra,
    );
    settle(ra);

    // idempotent retry
    a.op([update("marchers", 1, { name: "Ana R." })], { opId: id });
    const again = await a.outcome(id);
    check(
        again.type === "applied" && again.seq === 1,
        "a retried opId gets its original outcome, not a second apply",
    );

    // LWW conflict
    id = a.op([update("marchers", 2, { home_x: 11 }, { home_x: 10 })]);
    ra = await a.outcome(id);
    await b.next((m) => m.type === "applied" && m.opId === id);
    const bId = b.op([update("marchers", 2, { home_x: 12 }, { home_x: 10 })], {
        baseSeq: b.seq, // has not seen Alex's edit
    });
    rb = await b.outcome(bId);
    const aSaw = await a.next((m) => m.type === "applied" && m.opId === bId);
    check(
        rb.type === "applied" &&
            rb.conflicts.length === 1 &&
            rb.conflicts[0].kind === "overwrite" &&
            rb.conflicts[0].loser.name === "Alex" &&
            aSaw.conflicts[0]?.lostValue === 11,
        "LWW: the later op wins and the conflict names the loser and the lost value",
        rb,
    );
    settle(rb);

    // delete versus update
    id = a.op([
        {
            kind: "delete",
            table: "marchers",
            id: 3,
            prev: snapshot.marchers[2],
        },
    ]);
    ra = await a.outcome(id);
    settle(ra);
    id = b.op([update("marchers", 3, { name: "Cy!" }, { name: "Cy" })], {
        baseSeq: ra.seq - 1,
    });
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "DELETED" &&
            rb.message.startsWith("Alex"),
        "an update of a deleted row is DELETED, naming who deleted it",
        rb,
    );

    // CHECK constraint
    id = b.op([update("marchers", 1, { home_x: 2e6 }, { home_x: 0 })]);
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "CONSTRAINT" &&
            /marchers_home_x_check/.test(rb.message),
        "a CHECK violation is CONSTRAINT, naming the check",
        rb,
    );
    id = b.op([update("timeline_transitions", 1, { slot_count: 1 })]);
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "CONSTRAINT" &&
            rb.message === "E-A2: slot_count below an occupied slot",
        "a timeline trigger's message passes through (E-A2)",
        rb,
    );

    // timeline row trigger
    id = b.op([
        update("timeline_assignments", 1, { end_beat: 20 }, { end_beat: 16 }),
    ]);
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "CONSTRAINT" &&
            rb.message.startsWith("E-A1/E-A2"),
        "an assignment outside its transition is refused with the trigger's E-A1/E-A2 message",
        rb,
    );

    // commit-time check (timeline_commit_violations)
    id = b.op([
        {
            kind: "delete",
            table: "timeline_slot_destinations",
            id: 2,
            prev: snapshot.timeline_slot_destinations[1],
        },
    ]);
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "CONSTRAINT" &&
            rb.message.startsWith("E-T6"),
        "a shapeless transition missing a destination fails the commit check (E-T6)",
        rb,
    );

    // foreign keys: deferred to the end of the op, and enforced there
    const tagId = bw.you.idBase + 1;
    id = b.op([
        {
            kind: "insert",
            table: "marcher_tags",
            id: bw.you.idBase + 2,
            row: { marcher_id: 1, tag_id: tagId },
        },
        {
            kind: "insert",
            table: "tags",
            id: tagId,
            row: { name: "Front" },
        },
    ]);
    rb = await b.outcome(id);
    check(
        rb.type === "applied",
        "foreign keys are deferred: a child inserted before its parent in one op applies",
        rb,
    );
    settle(rb);
    id = b.op([
        {
            kind: "insert",
            table: "marcher_tags",
            id: bw.you.idBase + 3,
            row: { marcher_id: 2, tag_id: 999 },
        },
    ]);
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" &&
            rb.code === "CONSTRAINT" &&
            /FOREIGN KEY/.test(rb.message),
        "a dangling foreign key is refused at the end of the op",
        rb,
    );

    // allowlist and shape
    id = b.op([update("workspace_settings", 1, { json_data: "{}" })]);
    rb = await b.outcome(id);
    check(rb.code === "NOT_ALLOWED", "a table out of scope is NOT_ALLOWED", rb);
    id = b.op([update("marchers", 1, { secret: 1 })]);
    rb = await b.outcome(id);
    check(rb.code === "NOT_ALLOWED", "an unknown column is NOT_ALLOWED", rb);
    b.send({ type: "op", op: { opId: "bad", baseSeq: 0, changes: [] } });
    rb = await b.outcome("bad");
    check(rb.code === "MALFORMED", "a malformed op is MALFORMED", rb);

    // grid version
    id = a.op([
        {
            kind: "insert",
            table: "beats",
            id: aw.you.idBase + 1,
            row: { duration: 0.5, position: 1 },
        },
    ]);
    ra = await a.outcome(id);
    check(
        ra.type === "applied" && ra.gridVersion === 2,
        "a structural op applies and bumps gridVersion",
        ra,
    );
    const staleGrid = a.grid;
    settle(ra);
    id = b.op(
        [update("timeline_assignments", 1, { end_beat: 12 }, { end_beat: 16 })],
        { gridVersion: staleGrid },
    );
    rb = await b.outcome(id);
    check(
        rb.type === "rejected" && rb.code === "STALE_GRID",
        "a beat-range write on the old grid is STALE_GRID",
        rb,
    );
    id = b.op(
        [update("timeline_assignments", 1, { end_beat: 12 }, { end_beat: 16 })],
        { gridVersion: b.grid },
    );
    rb = await b.outcome(id);
    check(
        rb.type === "applied",
        "the same write on the current grid applies",
        rb,
    );
    settle(rb);
    id = b.op([update("marchers", 1, { notes: "old grid is fine" })], {
        gridVersion: staleGrid,
    });
    rb = await b.outcome(id);
    check(
        rb.type === "applied",
        "a non-beat edit doesn't need the current grid",
        rb,
    );
    settle(rb);

    // presence
    a.send({ type: "presence", presence: { selection: [1] } });
    const people = await b.next(
        (m) =>
            m.type === "people" &&
            m.people.some((p) => p.user.name === "Alex" && p.presence),
    );
    check(people.people.length === 2, "presence is relayed as people", people);

    // catch-up by lastSeq
    await b.close();
    const before = a.seq;
    id = a.op([update("marchers", 2, { name: "Ben K." }, { name: "Ben" })]);
    ra = await a.outcome(id);
    const b2 = client(sessionId, "Bea", { lastSeq: before });
    const bw2 = await b2.next((m) => m.type === "welcome");
    check(
        !bw2.snapshot &&
            bw2.ops?.length === 1 &&
            bw2.ops[0].type === "applied" &&
            bw2.ops[0].changes[0].set.name === "Ben K." &&
            bw2.seq === ra.seq &&
            bw2.gridVersion === 2,
        "a reconnecting client catches up from the op log after lastSeq",
        bw2,
    );
    check(
        bw2.you.idBase === bw.you.idBase,
        "a member keeps its idBase across reconnects",
    );

    // a parent deleted under a NO ACTION reference is refused (checked before commit)
    const beatId = aw.you.idBase + 1;
    id = a.op([
        {
            kind: "insert",
            table: "pages",
            id: aw.you.idBase + 2,
            row: { start_beat: beatId, is_subset: 0 },
        },
    ]);
    ra = await a.outcome(id);
    check(ra.type === "applied", "a page on the new beat applies", ra);
    settle(ra);
    id = a.op([
        {
            kind: "delete",
            table: "beats",
            id: beatId,
            prev: { id: beatId },
        },
    ]);
    ra = await a.outcome(id);
    check(
        ra.type === "rejected" &&
            ra.code === "CONSTRAINT" &&
            /FOREIGN KEY/.test(ra.message),
        "deleting a beat a page still starts on is refused",
        ra,
    );
    id = a.op([update("marchers", 1, { name: "still alive" })]);
    ra = await a.outcome(id);
    check(
        ra.type === "applied",
        "the session keeps working after refused ops",
        ra,
    );

    await a.close();
    await b2.close();
}

main()
    .catch((error) => {
        console.log(`FAIL ${error.message}`);
        failures++;
    })
    .finally(() => {
        console.log(failures ? `\n${failures} failed` : "\nall passed");
        process.exit(failures ? 1 : 0);
    });
