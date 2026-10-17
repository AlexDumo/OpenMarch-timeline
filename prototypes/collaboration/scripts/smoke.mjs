// Drives the session server with two scripted clients and checks the protocol end to end:
// live sync, field-level LWW conflicts, delete versus edit, stale beat grid, claims, catch-up.
// Run against `pnpm dev`: `pnpm smoke` (BASE=http://localhost:8787 by default).
import WebSocket from "ws";
import { demoShow } from "../public/shared/shows.js";

const BASE = process.env.BASE ?? "http://localhost:8787";
let failures = 0;
const check = (ok, what) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures++;
};

function client(sessionId, name, headToken, lastSeq = -1) {
    const ws = new WebSocket(
        `${BASE.replace("http", "ws")}/api/sessions/${sessionId}/ws`,
    );
    const inbox = [];
    const waiters = [];
    ws.on("message", (d) => {
        const msg = JSON.parse(d);
        inbox.push(msg);
        for (const w of [...waiters])
            if (w.pred(msg)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(msg);
            }
    });
    const user = { id: `${name}-id`, name, color: "#fff" };
    const c = {
        ws,
        user,
        seq: 0,
        next(pred, ms = 3000) {
            const found = inbox.find(pred);
            if (found) {
                inbox.splice(inbox.indexOf(found), 1);
                return Promise.resolve(found);
            }
            return new Promise((resolve, reject) => {
                const w = {
                    pred,
                    resolve: (m) => {
                        inbox.splice(inbox.indexOf(m), 1);
                        resolve(m);
                    },
                };
                waiters.push(w);
                setTimeout(() => reject(new Error(`${name}: timed out`)), ms);
            });
        },
        send: (m) => ws.send(JSON.stringify(m)),
        op(
            changes,
            { baseSeq, gridVersion = 1, override = false, label = "test" } = {},
        ) {
            const opId = crypto.randomUUID();
            c.send({
                type: "op",
                op: {
                    opId,
                    baseSeq: baseSeq ?? c.seq,
                    gridVersion,
                    override,
                    label,
                    changes,
                },
            });
            return opId;
        },
    };
    ws.on("open", () => c.send({ type: "hello", user, headToken, lastSeq }));
    return c;
}

const outcome = (c, opId) =>
    c.next(
        (m) =>
            (m.type === "applied" || m.type === "rejected") && m.opId === opId,
    );

const res = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    body: JSON.stringify(demoShow()),
});
const { sessionId, headToken } = await res.json();
check(
    /^[0-9a-f]{64}$/.test(sessionId),
    "make collaborative: session created from a snapshot",
);

const head = client(sessionId, "Head", headToken);
const sam = client(sessionId, "Sam");
const hw = await head.next((m) => m.type === "welcome");
const sw = await sam.next((m) => m.type === "welcome");
check(
    hw.you.role === "head" && sw.you.role === "collaborator",
    "roles: token holder is head",
);
check(hw.you.idBase !== sw.you.idBase, "each member gets its own id block");
check(sw.snapshot.marchers.length === 46, "a joining client gets the snapshot");

// 1. live sync
let id = head.op([
    { kind: "update", table: "moves", key: 1, set: { x: 500 }, prev: { x: 0 } },
]);
let a = await outcome(head, id);
let b = await sam.next((m) => m.type === "applied" && m.opId === id);
check(
    a.type === "applied" && b.changes[0].set.x === 500,
    "live sync: an edit reaches the other client",
);
head.seq = sam.seq = a.seq;

// 2. conflict: Sam edits the same field without having seen Head's next edit
id = head.op([
    { kind: "update", table: "moves", key: 2, set: { x: 111 }, prev: { x: 0 } },
]);
a = await outcome(head, id);
const samId = sam.op(
    [
        {
            kind: "update",
            table: "moves",
            key: 2,
            set: { x: 222 },
            prev: { x: 0 },
        },
    ],
    { baseSeq: head.seq },
);
b = await outcome(sam, samId);
check(
    b.type === "applied" &&
        b.conflicts.length === 1 &&
        b.conflicts[0].loser.name === "Head",
    "LWW: later op wins and names whose change it overwrote",
);
head.seq = sam.seq = b.seq;
const headSaw = await head.next(
    (m) => m.type === "applied" && m.opId === samId,
);
check(
    headSaw.conflicts[0]?.lostValue === 111,
    "the overwritten person is told what they lost",
);

// 3. delete versus edit
id = head.op([{ kind: "delete", table: "moves", key: 3, prev: { id: 3 } }]);
a = await outcome(head, id);
head.seq = sam.seq = a.seq;
id = sam.op([
    { kind: "update", table: "moves", key: 3, set: { y: 9 }, prev: { y: 0 } },
]);
b = await outcome(sam, id);
check(
    b.type === "rejected" &&
        b.code === "DELETED" &&
        b.message.startsWith("Head"),
    "delete wins: an edit of a deleted move is refused, naming who deleted it",
);

// 4. structural edits: head only, and an op on an old grid is refused
id = sam.op([
    {
        kind: "update",
        table: "pages",
        key: 1,
        set: { beat: 20 },
        prev: { beat: 16 },
    },
]);
b = await outcome(sam, id);
check(
    b.type === "rejected" && b.code === "NOT_ALLOWED",
    "structural edits are head-only",
);
id = head.op([
    {
        kind: "update",
        table: "pages",
        key: 6,
        set: { beat: 100 },
        prev: { beat: 96 },
    },
    {
        kind: "update",
        table: "meta",
        key: "total_beats",
        set: { value: "100" },
        prev: { value: "96" },
    },
    {
        kind: "update",
        table: "meta",
        key: "grid_version",
        set: { value: "2" },
        prev: { value: "1" },
    },
]);
a = await outcome(head, id);
check(a.type === "applied", "head inserts counts");
head.seq = sam.seq = a.seq;
id = sam.op(
    [
        {
            kind: "update",
            table: "moves",
            key: 4,
            set: { end_beat: 20 },
            prev: { end_beat: 16 },
        },
    ],
    { gridVersion: 1 },
);
b = await outcome(sam, id);
check(
    b.type === "rejected" && b.code === "STALE_GRID",
    "an edit computed on the old beat grid is refused",
);
id = sam.op(
    [
        {
            kind: "update",
            table: "moves",
            key: 4,
            set: { end_beat: 20 },
            prev: { end_beat: 16 },
        },
    ],
    { gridVersion: 2 },
);
b = await outcome(sam, id);
check(b.type === "applied", "the same edit on the new grid lands");
head.seq = sam.seq = b.seq;

// 5. constraints come from the shared DDL
id = sam.op(
    [
        {
            kind: "insert",
            table: "moves",
            key: sw.you.idBase + 1,
            row: {
                id: sw.you.idBase + 1,
                marcher_id: 1,
                start_beat: 0,
                end_beat: 16,
                x: 0,
                y: 0,
            },
        },
    ],
    { gridVersion: 2 },
);
b = await outcome(sam, id);
check(
    b.type === "rejected" &&
        b.code === "CONSTRAINT" &&
        /exactly those counts/.test(b.message),
    "L-4: a second move over the same counts is refused by the UNIQUE",
);

// 6. claims
sam.send({ type: "claim", section: "Battery" });
await head.next((m) => m.type === "claims" && m.claims.length === 1);
const battery = sw.snapshot.marchers.find((m) => m.section === "Battery").id;
const batteryMove = sw.snapshot.moves.find((m) => m.marcher_id === battery).id;
id = head.op([
    {
        kind: "update",
        table: "moves",
        key: batteryMove,
        set: { x: 1 },
        prev: { x: 0 },
    },
]);
a = await outcome(head, id);
check(
    a.type === "rejected" && a.code === "CLAIMED",
    "a claimed section refuses others' edits",
);
id = head.op(
    [
        {
            kind: "update",
            table: "moves",
            key: batteryMove,
            set: { x: 1 },
            prev: { x: 0 },
        },
    ],
    { override: true },
);
a = await outcome(head, id);
check(
    a.type === "applied" && a.overrides[0]?.section === "Battery",
    "the head writer can override a claim, and it is reported",
);
head.seq = sam.seq = a.seq;

// 7. disconnect and catch up from the op log
sam.ws.close();
const before = head.seq;
id = head.op([
    {
        kind: "update",
        table: "marchers",
        key: 1,
        set: { name: "Renamed" },
        prev: { name: "Winds 1" },
    },
]);
a = await outcome(head, id);
const sam2 = client(sessionId, "Sam", undefined, before);
const w2 = await sam2.next((m) => m.type === "welcome");
check(
    !w2.snapshot &&
        w2.ops.length === 1 &&
        w2.ops[0].changes[0].set.name === "Renamed",
    "a reconnecting client catches up from its last seq",
);

head.ws.close();
sam2.ws.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
