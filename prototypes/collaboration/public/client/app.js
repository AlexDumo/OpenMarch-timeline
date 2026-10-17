// The prototype's editor: a field, a timeline and a side panel over the local mirror. Every edit
// is a command run through `submit`, the single write path; the UI redraws from the mirror's
// change events, whether the change was ours, a peer's, or a revert.
import { Mirror, invertChanges, fieldsOf } from "./mirror.js";
import { SYNCED, KEY, isStructural, touchesBeats } from "../shared/schema.js";
import { Connection } from "./connection.js";
import { createResolver, flagBeats, pageBoxAt, colorFor, sectionColor } from "../shared/model.js";
import { demoShow, importDots, FIELD } from "../shared/shows.js";

const $ = (sel) => document.querySelector(sel);
const NAMES = ["Alex", "Sam", "Pat", "Jordan", "Riley", "Casey", "Morgan", "Drew"];
const STEP = 12;

// ---------------------------------------------------------------- state

const S = {
    SQL: null,
    mirror: null,
    conn: null,
    mode: "landing", // landing | solo | session
    user: loadUser(),
    sessionId: null,
    show: { marchers: [], pages: [], moves: [], meta: {} },
    resolver: null,
    flags: [0],
    total: 16,
    selection: new Set(),
    selectedMove: null,
    playhead: 0,
    playing: false,
    range: null,
    drag: null,
    people: [],
    claims: [],
    highlights: new Map(), // marcherId -> {until, color}
    moveHighlights: new Map(), // moveId -> until
    view: null,
};

function loadUser() {
    let raw = sessionStorage.getItem("om-sync-user");
    if (!raw) {
        const name = NAMES[Math.floor(Math.random() * NAMES.length)];
        const id = crypto.randomUUID();
        raw = JSON.stringify({ id, name, color: colorFor(id) });
        sessionStorage.setItem("om-sync-user", raw);
    }
    return JSON.parse(raw);
}

function saveUser() {
    sessionStorage.setItem("om-sync-user", JSON.stringify(S.user));
}

const drill = (m) => `${m.drill_prefix}${m.drill_order}`;
const marcherById = (id) => S.show.marchers.find((m) => m.id === id);
const canEdit = () => S.mode === "solo" || (S.mode === "session" && S.conn?.live);
const isHead = () => S.mode === "solo" || S.conn?.role === "head";

// ---------------------------------------------------------------- boot

async function boot() {
    S.SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
    S.mirror = new Mirror(S.SQL);
    S.mirror.onChange((tables, source) => {
        refresh();
        if (source === "remote") flashChangedFromRemote();
    });
    $("#my-name").value = S.user.name;
    $("#my-name").addEventListener("change", (e) => {
        S.user.name = e.target.value.trim() || S.user.name;
        saveUser();
        if (S.conn?.live) {
            // presence and authorship carry the name, so rejoin under it
            S.conn.user = S.user;
            S.conn.kill();
            S.conn.reconnect();
        }
    });
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("s");
    if (sessionId) void joinSession(sessionId);
    else showLanding();
    wireField();
    wireTimeline();
    wireKeys();
    window.addEventListener("resize", render);
}

function showLanding() {
    S.mode = "landing";
    $("#landing").hidden = false;
    $("#editor").hidden = true;
    renderChrome();
    for (const b of document.querySelectorAll("[data-open]")) {
        b.onclick = async () => {
            const what = b.dataset.open;
            if (what === "demo") return openSolo(demoShow(), []);
            const res = await fetch(what);
            if (!res.ok) return toast(`Couldn't load ${what} (run \`pnpm vendor\`).`, "bad");
            const snap = importDots(S.SQL, new Uint8Array(await res.arrayBuffer()), what.split("/").pop());
            openSolo(snap, snap.notes);
        };
    }
    $("#file").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            if (file.name.toLowerCase().endsWith(".json")) {
                const snap = JSON.parse(await file.text());
                return openSolo(snap, [`Opened ${file.name} solo. It is not linked to the session it came from.`]);
            }
            const snap = importDots(S.SQL, new Uint8Array(await file.arrayBuffer()), file.name);
            openSolo(snap, snap.notes);
        } catch (err) {
            toast(`Couldn't read ${file.name}: ${err.message}`, "bad");
        }
    };
}

function snapshotFrom(show) {
    return { marchers: show.marchers, pages: show.pages, moves: show.moves, meta: show.meta };
}

function openSolo(show, notes) {
    S.mode = "solo";
    S.mirror.idBase = 0;
    S.mirror.load(snapshotFrom(show));
    S.view = null;
    enterEditor();
    for (const n of notes) toast(n);
}

function enterEditor() {
    $("#landing").hidden = true;
    $("#editor").hidden = false;
    refresh();
}

/** "Make collaborative": ask first, then upload the local show as the session's first snapshot. */
function makeCollaborative() {
    const snapshot = S.mirror.snapshot();
    const body = JSON.stringify(snapshot);
    const kb = Math.max(1, Math.round(body.length / 1024));
    modal(`<h2>Make "${escapeHtml(S.show.meta.name ?? "this show")}" collaborative?</h2>
        <p>A copy of the show goes to a session on the server: ${snapshot.marchers.length} marchers,
        ${snapshot.moves.length} moves and ${snapshot.pages.length} page flags (${kb} KB).
        Positions aren't uploaded; every window works them out from the moves.</p>
        <ul>
            <li>You become the <b>head drill writer</b>: you can insert time and override claims.</li>
            <li>Anyone with the invite link can join and edit as a collaborator.</li>
            <li>While collaborative, editing needs a connection. Offline, the show is read-only.</li>
            <li>Your local file is left as it was. Use <b>Download a copy</b> to take the session's show away.</li>
        </ul>`, [
        ["Cancel", () => {}],
        ["Make collaborative", () => uploadAndJoin(body), "primary"],
    ]);
}

async function uploadAndJoin(body) {
    const res = await fetch("/api/sessions", { method: "POST", body });
    if (!res.ok) return toast(`Couldn't start a session: ${res.status}`, "bad");
    const { sessionId, headToken } = await res.json();
    sessionStorage.setItem(`om-sync-head:${sessionId}`, headToken);
    window.history.replaceState(null, "", `?s=${sessionId}`);
    await joinSession(sessionId);
    showInvite(true);
}

function showInvite(justCreated = false) {
    modal(`<h2>${justCreated ? "The show is collaborative" : "Invite people"}</h2>
        <p>Send this link to the people you want to edit with. They join as collaborators.</p>
        <input id="invite-url" readonly value="${escapeHtml(inviteUrl())}" style="width:100%"/>
        <p class="muted">The session keeps running when you close this window, and when everyone has left.</p>`, [
        ["Copy link", async () => {
            await navigator.clipboard?.writeText(inviteUrl()).catch(() => {});
            toast("Invite link copied.");
        }],
        ["Open a second window", () => window.open(inviteUrl(), "_blank", "noopener,width=1300,height=850")],
        ["Done", () => {}, "primary"],
    ]);
    setTimeout(() => document.querySelector("#invite-url")?.select(), 0);
}

/** Saves the session's current show, as the server has it, to a file that opens solo. */
async function downloadCopy() {
    const res = await fetch(`/api/sessions/${S.sessionId}/snapshot`);
    if (!res.ok) return toast("Couldn't download the show.", "bad");
    const snap = await res.json();
    const name = (S.show.meta.name ?? "show").replace(/[^\w -]+/g, "");
    const blob = new Blob([JSON.stringify({ name, ...snap }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name} (session copy, #${snap.seq}).json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Downloaded the show as of edit #${snap.seq}. Open it from the start page to work on it solo.`, "good");
}

/** A small dialog: HTML body and a row of [label, action, class] buttons. */
function modal(html, buttons) {
    const back = document.createElement("div");
    back.style.cssText = "position:fixed;inset:0;background:#000a;display:grid;place-items:center;z-index:20";
    const card = document.createElement("div");
    card.className = "card";
    card.style.width = "520px";
    card.innerHTML = html;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:12px";
    for (const [label, action, cls] of buttons)
        row.append(button(label, () => {
            if (label !== "Copy link") back.remove();
            void action();
        }, cls ?? ""));
    card.append(row);
    back.append(card);
    document.body.append(back);
}

async function joinSession(sessionId) {
    const check = await fetch(`/api/sessions/${sessionId}/snapshot`).catch(() => null);
    if (!check || check.status === 404 || check.status === 400) {
        window.history.replaceState(null, "", window.location.pathname);
        showLanding();
        $("#landing-note").textContent = "That invite link doesn't lead to a session (it may be from another server). Open a show to start one.";
        return;
    }
    S.mode = "session";
    S.sessionId = sessionId;
    S.conn?.kill();
    S.conn = new Connection({
        sessionId,
        user: S.user,
        headToken: sessionStorage.getItem(`om-sync-head:${sessionId}`) ?? undefined,
        mirror: S.mirror,
        onEvent,
    });
    if (!S.mirror.db) S.mirror.load({});
    enterEditor();
    S.conn.connect();
}

function inviteUrl() {
    return `${window.location.origin}${window.location.pathname}?s=${S.sessionId}`;
}

// ---------------------------------------------------------------- data

function refresh() {
    if (!S.mirror.db) return;
    const m = S.mirror;
    S.show = {
        marchers: m.all("SELECT * FROM marchers ORDER BY drill_prefix, drill_order"),
        pages: m.all("SELECT * FROM pages ORDER BY beat"),
        moves: m.all("SELECT * FROM moves"),
        meta: Object.fromEntries(m.all("SELECT key, value FROM meta").map((r) => [r.key, r.value])),
    };
    S.resolver = createResolver(S.show);
    S.flags = flagBeats(S.show.pages);
    S.total = Math.max(Number(S.show.meta.total_beats ?? 0), S.flags[S.flags.length - 1], 1);
    S.playhead = Math.min(S.playhead, S.total);
    for (const id of [...S.selection]) if (!marcherById(id)) S.selection.delete(id);
    if (S.selectedMove && !S.show.moves.some((mv) => mv.id === S.selectedMove)) S.selectedMove = null;
    if (!S.view) S.view = fieldView();
    render();
}

function fieldView() {
    let minX = 0, minY = 0, maxX = FIELD.width, maxY = FIELD.height;
    const grow = (x, y) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    for (const m of S.show.marchers) grow(m.home_x, m.home_y);
    for (const mv of S.show.moves) grow(mv.x, mv.y);
    const pad = 4 * STEP;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

// ---------------------------------------------------------------- the write path

/**
 * Every edit goes through here. Solo: a local transaction, nothing else. In a session: the same
 * transaction, then its changes go to the server as one op.
 */
function submit(label, fn, opts = {}) {
    const kind = opts.kind ?? "edit";
    if (S.mode === "solo") {
        try {
            const changes = S.mirror.transact(fn);
            log({ who: S.user, text: label });
            if (changes.length) {
                recordWriters(changes, S.user);
                pushHistory(kind, label, changes);
            }
            return true;
        } catch (err) {
            toast(explainLocal(err), "bad");
            return false;
        }
    }
    if (!S.conn) return false;
    try {
        const res = S.conn.submit(label, fn, opts);
        if (!res.ok) {
            toast(res.reason, "bad");
            return false;
        }
        if (res.op) U.kinds.set(res.op.opId, { kind, label });
        return true;
    } catch (err) {
        toast(explainLocal(err), "bad");
        return false;
    }
}

function explainLocal(err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("UNIQUE") && msg.includes("moves")) return "That marcher already has a move over exactly those counts.";
    if (msg.includes("CHECK")) return "A move needs at least one count.";
    return msg;
}

// ---------------------------------------------------------------- claims

/** The claim on a section, if someone holds it. */
function claimOf(section) {
    return S.mode === "session" ? S.claims.find((c) => c.section === section) : undefined;
}

/** Claims held by someone else over any of these marchers. */
function heldByOthers(ids) {
    const sections = new Set([...ids].map((id) => marcherById(id)?.section).filter(Boolean));
    return S.claims.filter((c) => S.mode === "session" && sections.has(c.section) && c.user.id !== S.user.id);
}

function describeHeld(held) {
    return held.map((c) => `${c.section} is held by ${c.user.name}`).join("; ");
}

/**
 * An edit of marchers someone else has claimed: a collaborator is stopped (the server would
 * refuse it anyway); the head drill writer is asked, and can override.
 */
function guarded(label, ids, fn) {
    const held = heldByOthers(ids);
    if (held.length === 0) return submit(label, fn);
    if (isHead()) {
        toastAction(`${describeHeld(held)}.`, "Override claim", () => submit(label, fn, { override: true }));
        return false;
    }
    toast(`${describeHeld(held)}. You can look, but not edit.`, "bad");
    return false;
}

/** Collaborators can't even start dragging what someone else holds. */
function canStartEditing(ids) {
    const held = heldByOthers(ids);
    if (held.length === 0 || isHead()) return true;
    toast(`${describeHeld(held)}. You can look, but not edit.`, "bad");
    return false;
}

function claimSection(section) {
    S.conn?.send({ type: "claim", section });
}

function releaseSection(section) {
    S.conn?.send({ type: "release", section });
}

// Commands: plain SQL against the mirror, like db-functions inside transactionWithHistory.

function moveMarchersCommand(ids, dx, dy, range) {
    return (m) => {
        for (const id of ids) {
            const end = S.resolver.positionAt(id, range.end);
            const existing = m.all(
                "SELECT id FROM moves WHERE marcher_id = ? AND start_beat = ? AND end_beat = ?",
                [id, range.start, range.end],
            )[0];
            const x = Math.round((end.x + dx) * 100) / 100;
            const y = Math.round((end.y + dy) * 100) / 100;
            if (existing) m.run("UPDATE moves SET x = ?, y = ? WHERE id = ?", [x, y, existing.id]);
            else
                m.run(
                    "INSERT INTO moves (id, marcher_id, start_beat, end_beat, x, y) VALUES (?, ?, ?, ?, ?, ?)",
                    [m.nextId("moves"), id, range.start, range.end, x, y],
                );
        }
    };
}

function deleteSelectedMove() {
    const mv = S.show.moves.find((m) => m.id === S.selectedMove);
    if (mv) guarded("Delete a move", [mv.marcher_id], deleteMoveCommand(mv.id));
}

function resizeMoveCommand(id, start, end) {
    return (m) => m.run("UPDATE moves SET start_beat = ?, end_beat = ? WHERE id = ?", [start, end, id]);
}

function deleteMoveCommand(id) {
    return (m) => m.run("DELETE FROM moves WHERE id = ?", [id]);
}

/** Structural: inserting counts shifts every later flag and move (the timeline ripple). */
function insertCountsCommand(at, k) {
    return (m) => {
        m.run("UPDATE pages SET beat = beat + ? WHERE beat > ?", [k, at]);
        m.run("UPDATE moves SET start_beat = start_beat + ?, end_beat = end_beat + ? WHERE start_beat >= ?", [k, k, at]);
        m.run("UPDATE moves SET end_beat = end_beat + ? WHERE start_beat < ? AND end_beat > ?", [k, at, at]);
        const total = Number(m.meta("total_beats") ?? 0) + k;
        m.run("INSERT INTO meta (key, value) VALUES ('total_beats', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(total)]);
        const grid = Number(m.meta("grid_version") ?? 1) + 1;
        m.run("INSERT INTO meta (key, value) VALUES ('grid_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(grid)]);
    };
}

/** The range a drag edits: the time selection if the playhead is at its end, else the page box. */
function editRange() {
    if (S.range && S.playhead === S.range[1]) return { start: S.range[0], end: S.range[1] };
    return pageBoxAt(S.flags, S.playhead);
}

// ---------------------------------------------------------------- events from the session

function onEvent(ev) {
    if (ev.type === "state") {
        if (ev.state === "offline") {
            // what others were doing is unknown now; don't show it as if it were live
            S.people = [];
            S.drag = null;
        }
        render();
    }
    else if (ev.type === "pending") render();
    else if (ev.type === "welcome") {
        if (ev.snapshot) S.view = null;
        refresh();
        S.claims = ev.claims ?? [];
        const role = ev.you.role === "head" ? "head drill writer" : "collaborator";
        if (ev.caughtUp > 0) {
            toast(`Reconnected. Caught up on ${ev.caughtUp} edit${ev.caughtUp > 1 ? "s" : ""} from while you were away.`, "good");
            for (const op of ev.ops) {
                log({ who: op.by, text: `${op.label} (while you were offline)` });
                flashChanges(op.changes, op.by.color, 2500);
            }
        } else toast(`Joined as ${role}.`);
        lastPresence = "";
        sendPresence();
        renderChrome();
    } else if (ev.type === "applied") onApplied(ev.msg, ev.mine);
    else if (ev.type === "rejected") onRejected(ev.msg, ev.op);
    else if (ev.type === "people") {
        S.people = ev.people;
        render();
    } else if (ev.type === "claims") {
        S.claims = ev.claims;
        render();
    } else if (ev.type === "notice") toast(ev.message);
    else if (ev.type === "dropped")
        toast(`${ev.count} edit${ev.count > 1 ? "s" : ""} hadn't reached the server and ${ev.count > 1 ? "were" : "was"} undone.`, "bad");
}

function onApplied(msg, mine) {
    log({ who: msg.by, text: msg.label, seq: msg.seq });
    recordWriters(msg.changes, msg.by);
    const mineKind = mine && U.kinds.get(msg.opId);
    if (mineKind) {
        U.kinds.delete(msg.opId);
        // the server's effective changes, whose `prev` is what the server had: the truest inverse
        pushHistory(mineKind.kind, mineKind.label, msg.changes, msg.seq);
    }
    if (!mine && msg.changes.some(touchesBeats)) U.othersBeatSeq = msg.seq;
    if (!mine) flashChanges(msg.changes, msg.by.color);
    reportConflicts(msg);
    for (const o of msg.overrides ?? []) {
        if (o.owner.id === S.user.id) toast(`${msg.by.name} (head drill writer) edited ${o.section}, which you hold.`, "bad");
        log({ who: msg.by, text: `overrode ${o.owner.name}'s claim on ${o.section}`, cls: "conflict" });
    }
}

function onRejected(msg, op) {
    toast(`Not saved: ${msg.message}`, "bad");
    log({ who: S.user, text: `refused: ${msg.message}`, cls: "rejected" });
    if (op) {
        const ids = marchersTouched(op.changes);
        markConflict(ids, op.changes, "not saved");
    }
}

// ---------------------------------------------------------------- per-user undo

/**
 * Per-user, selective undo (report §4.4). The stack holds my own confirmed ops, never trigger
 * SQL and never anyone else's edits. Undo builds the inverse field by field and keeps only the
 * fields still holding what I wrote; anything someone changed since is left alone, and I'm told.
 * The inverse goes out as an ordinary op, so the server checks it like any edit (claims, deletes,
 * the beat grid).
 */
const U = { undo: [], redo: [], kinds: new Map(), writers: new Map(), othersBeatSeq: 0 };

function recordWriters(changes, by) {
    for (const ch of changes)
        for (const f of fieldsOf(ch)) U.writers.set(f, by);
}

function pushHistory(kind, label, changes, seq = 0) {
    const entry = { label, changes, seq };
    if (kind === "undo") U.redo.push(entry);
    else {
        U.undo.push(entry);
        if (kind === "edit") U.redo = [];
    }
    renderTransport();
}

function currentRow(table, key) {
    return S.mirror.all(`SELECT * FROM ${table} WHERE ${KEY[table]} = ?`, [key])[0];
}

/** Splits an entry's inverse into what can still be undone and what someone else has changed since. */
function planInverse(entry) {
    const keep = [];
    const skipped = [];
    for (const inv of invertChanges(entry.changes)) {
        if (inv.table === "meta" && inv.key === "grid_version") continue; // a structural undo moves the grid on, not back
        const row = currentRow(inv.table, inv.key);
        if (inv.kind === "update") {
            if (!row) {
                skipped.push({ inv, who: U.writers.get(`${inv.table}:${inv.key}:${KEY[inv.table]}`), why: "deleted" });
                continue;
            }
            const set = {};
            const prev = {};
            for (const [col, value] of Object.entries(inv.set)) {
                // `inv.prev[col]` is what I wrote; undo it only if it is still there
                if (row[col] === inv.prev[col]) {
                    set[col] = value;
                    prev[col] = row[col];
                } else skipped.push({ inv, col, who: U.writers.get(`${inv.table}:${inv.key}:${col}`), why: "changed" });
            }
            if (Object.keys(set).length) keep.push({ ...inv, set, prev });
        } else if (inv.kind === "delete") {
            // undoing my insert: only if nobody has edited the row since
            if (!row) continue;
            const other = SYNCED[inv.table].map((c) => U.writers.get(`${inv.table}:${inv.key}:${c}`)).find((w) => w && w.id !== S.user.id);
            if (other) skipped.push({ inv, who: other, why: "changed" });
            else keep.push(inv);
        } else if (inv.kind === "insert") {
            // undoing my delete: put the row back with the same id, if nobody did already
            if (!row) keep.push(inv);
        }
    }
    return { keep, skipped };
}

function applyPlan(keep, structural) {
    return (m) => {
        for (const ch of keep) {
            const key = KEY[ch.table];
            if (ch.kind === "update") {
                const cols = Object.keys(ch.set);
                m.run(`UPDATE ${ch.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`, [...cols.map((c) => ch.set[c]), ch.key]);
            } else if (ch.kind === "delete") m.run(`DELETE FROM ${ch.table} WHERE ${key} = ?`, [ch.key]);
            else m.insertRow(ch.table, ch.row);
        }
        if (structural) {
            const grid = Number(m.meta("grid_version") ?? 1) + 1;
            m.run("UPDATE meta SET value = ? WHERE key = 'grid_version'", [String(grid)]);
        }
    };
}

function undoOrRedo(which) {
    if (!canEdit()) return toast(S.mode === "session" ? "You're offline, so the show is read-only." : "Nothing to undo.", "bad");
    const stack = which === "undo" ? U.undo : U.redo;
    const entry = stack.pop();
    if (!entry) return toast(which === "undo" ? "Nothing of yours to undo." : "Nothing to redo.");
    const structural = entry.changes.some(isStructural);
    const { keep, skipped } = planInverse(entry);
    const names = [...new Set(skipped.map((sk) => sk.who?.name ?? "someone"))].join(" and ");
    if (structural && U.othersBeatSeq > entry.seq) {
        // moves others wrote on the new grid would land over the wrong music
        stack.push(entry);
        return toast(`Can't ${which} "${entry.label}": others have edited moves or pages since.`, "bad");
    }
    if (structural && skipped.length) {
        // half an "insert time" would leave moves over the wrong music: all or nothing
        stack.push(entry);
        return toast(`Can't ${which} "${entry.label}": ${names} changed the counts since.`, "bad");
    }
    if (keep.length === 0) {
        renderTransport();
        return toast(`Nothing left to ${which} in "${entry.label}": ${names} changed all of it since.`, "bad");
    }
    const verb = which === "undo" ? "Undo" : "Redo";
    const ok = submit(`${verb}: ${entry.label}`, applyPlan(keep, structural), { kind: which });
    if (!ok) return stack.push(entry);
    if (skipped.length) {
        const ids = marchersTouched(skipped.map((sk) => sk.inv));
        markConflict(ids, skipped.map((sk) => sk.inv), `kept ${names}'s`);
        toast(`${verb === "Undo" ? "Undid" : "Redid"} "${entry.label}", except what ${names} changed since. That was kept.`);
    }
}

// ---------------------------------------------------------------- conflicts

/** What a changed field is, in words. */
function describeField(c) {
    if (c.table === "moves") {
        const mv = S.show.moves.find((m) => m.id === c.key);
        const who = marcherById(c.marcherId ?? mv?.marcher_id);
        const what = c.col === "x" || c.col === "y" ? "spot" : c.col === "start_beat" || c.col === "end_beat" ? "counts" : c.col;
        return `${who ? drill(who) : "a marcher"}'s ${what}${mv ? ` (counts ${mv.start_beat}–${mv.end_beat})` : ""}`;
    }
    if (c.table === "marchers") {
        const m = marcherById(c.key);
        return `${m ? drill(m) : "a marcher"}'s ${c.col === "home_x" || c.col === "home_y" ? "starting spot" : c.col}`;
    }
    return `${c.table}.${c.col}`;
}

/** Marks marchers (and their moves) where something collided, for a few seconds. */
function markConflict(ids, changes, label, ms = 3500) {
    const until = Date.now() + ms;
    for (const id of ids) S.highlights.set(id, { until, color: "#ff6b6b", label });
    for (const ch of changes) if (ch.table === "moves") S.moveHighlights.set(ch.key, until);
    render();
    setTimeout(render, ms + 20);
}

/**
 * Conflicts the server found while applying an op: a field someone else had changed, which this
 * op replaced without having seen it (last writer wins), or a row deleted after someone edited it.
 * Both sides are told, and the one who lost can put their value back.
 */
function reportConflicts(msg) {
    const conflicts = msg.conflicts ?? [];
    if (!conflicts.length) return;
    // one notice per person and row
    const groups = new Map();
    for (const c of conflicts) {
        const k = `${c.loser.id}:${c.table}:${c.key}:${c.kind}`;
        if (!groups.has(k)) groups.set(k, { ...c, cols: [] });
        groups.get(k).cols.push(c);
    }
    for (const g of groups.values()) {
        const what = describeField(g);
        const ids = g.marcherId !== null && g.marcherId !== undefined ? [g.marcherId] : [];
        const iLost = g.loser.id === S.user.id;
        const iWon = msg.by.id === S.user.id;
        if (g.kind === "deleted-edited") {
            if (iLost) toast(`${msg.by.name} deleted ${what.replace(/'s (spot|counts).*/, "'s move")}, which you had just edited.`, "bad");
            else if (iWon) toast(`You deleted a move ${g.loser.name} had just edited.`);
            log({ who: msg.by, text: `deleted a move ${g.loser.name} had just edited`, cls: "conflict" });
            markConflict(ids, [], `${msg.by.name} deleted it`);
            continue;
        }
        if (iLost) {
            const restore = g.cols.map((c) => ({ table: c.table, key: c.key, col: c.col, value: c.lostValue }));
            toastAction(
                `${msg.by.name} changed ${what} at the same time as you, and theirs landed last, so it replaced yours.`,
                "Put mine back",
                () => submit("Put my change back", (m) => {
                    for (const r of restore) m.run(`UPDATE ${r.table} SET ${r.col} = ? WHERE id = ?`, [r.value, r.key]);
                }),
            );
            markConflict(ids, [{ table: g.table, key: g.key }], `${msg.by.name} won`);
        } else if (iWon) {
            toast(`You and ${g.loser.name} changed ${what} at the same time. Yours landed last, so it replaced theirs.`);
            markConflict(ids, [{ table: g.table, key: g.key }], `replaced ${g.loser.name}'s`);
        }
        log({ who: msg.by, text: `replaced ${g.loser.name}'s change to ${what}`, cls: "conflict" });
    }
}

/** A short ring on marchers a peer just changed, so remote edits don't happen silently. */
function flashChangedFromRemote() {}

/** The marchers a list of changes touches. */
function marchersTouched(changes) {
    const ids = new Set();
    for (const ch of changes) {
        if (ch.table === "marchers") ids.add(ch.key);
        else if (ch.table === "moves") {
            const row = ch.row ?? ch.prev ?? {};
            const mv = S.show.moves.find((m) => m.id === ch.key);
            const id = row.marcher_id ?? mv?.marcher_id;
            if (id !== undefined) ids.add(id);
        }
    }
    return ids;
}

function flashChanges(changes, color, ms = 1600) {
    const until = Date.now() + ms;
    for (const id of marchersTouched(changes)) S.highlights.set(id, { until, color });
    for (const ch of changes) if (ch.table === "moves") S.moveHighlights.set(ch.key, until);
    render();
    setTimeout(render, ms + 20);
}

// ---------------------------------------------------------------- rendering

function render() {
    renderChrome();
    if (S.mode === "landing" || !S.mirror.db) return;
    renderField();
    renderTimeline();
    renderSide();
}

function renderChrome() {
    const mode = $("#mode");
    const banner = $("#banner");
    document.body.classList.toggle("readonly", S.mode === "session" && !S.conn?.live);
    $("#show-name").textContent = S.show.meta.name ?? "OpenMarch collaboration prototype";
    if (S.mode === "landing") {
        mode.textContent = "No show open";
        mode.className = "chip";
        banner.hidden = true;
    } else if (S.mode === "solo") {
        mode.textContent = "Solo · local file";
        mode.className = "chip solo";
        banner.hidden = false;
        banner.className = "info";
        banner.textContent = "Solo: this show lives only in this window. Nothing is sent anywhere until you make it collaborative.";
    } else {
        const st = S.conn?.state ?? "connecting";
        mode.textContent = st === "live" ? `Live · ${S.conn.role === "head" ? "head drill writer" : "collaborator"}` : st === "offline" ? "Offline · read-only" : "Connecting…";
        mode.className = `chip ${st}`;
        if (st === "offline") {
            banner.hidden = false;
            banner.className = "";
            banner.textContent = S.conn.killed
                ? "Disconnected. The show is read-only until you reconnect; edits from others will catch up then."
                : "Connection lost. The show is read-only; trying to reconnect…";
        } else banner.hidden = true;
    }
    const pending = S.conn?.pending.length ?? 0;
    $("#pending").textContent = pending ? `${pending} edit${pending > 1 ? "s" : ""} sending…` : "";

    const actions = $("#actions");
    actions.replaceChildren();
    if (S.mode === "solo") actions.append(button("Make collaborative", makeCollaborative, "primary"));
    if (S.mode === "session") {
        actions.append(
            button("Invite", () => showInvite()),
            button("Open a second window", () => window.open(inviteUrl(), "_blank", "noopener,width=1300,height=850")),
            button("Download a copy", downloadCopy),
        );
    }
    renderAvatars();
}

function renderAvatars() {
    const box = $("#avatars");
    box.replaceChildren();
    for (const p of S.people) {
        const a = document.createElement("div");
        a.className = "avatar";
        a.style.background = p.user.color;
        a.title = `${p.user.name}${p.role === "head" ? " (head)" : ""}${p.user.id === S.user.id ? " (you)" : ""}`;
        a.textContent = p.user.name.slice(0, 1).toUpperCase();
        box.append(a);
    }
}

function button(text, onclick, cls = "") {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = cls;
    b.onclick = onclick;
    return b;
}

function positionsNow() {
    const out = new Map();
    for (const m of S.show.marchers) out.set(m.id, S.resolver.positionAt(m.id, S.playhead));
    return out;
}

function renderField() {
    const svg = $("#field");
    const v = S.view;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    const parts = [];
    parts.push(`<rect x="0" y="0" width="${FIELD.width}" height="${FIELD.height}" fill="#1f3326" stroke="#2f5a3d"/>`);
    for (let x = 0; x <= FIELD.width; x += 8 * STEP)
        parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${FIELD.height}" stroke="#2f5a3d" stroke-width="${x % (40 * STEP) === 0 ? 3 : 1.5}"/>`);
    const pos = positionsNow();
    const drag = S.drag?.kind === "marchers" ? S.drag : null;
    parts.push(fieldOverlays(pos));
    for (const m of S.show.marchers) {
        let p = pos.get(m.id);
        if (drag && S.selection.has(m.id)) p = { x: p.x + drag.dx, y: p.y + drag.dy };
        const color = sectionColor(m.section);
        const selected = S.selection.has(m.id);
        parts.push(marcherDecorations(m, p));
        parts.push(`<g data-marcher="${m.id}" style="cursor:${canEdit() ? "grab" : "default"}">
            <circle cx="${p.x}" cy="${p.y}" r="11" opacity="${heldByOthers([m.id]).length ? 0.5 : 1}" fill="${color}" stroke="${selected ? "#fff" : "#0006"}" stroke-width="${selected ? 3 : 1}"/>
            <text x="${p.x}" y="${p.y - 15}" font-size="13" text-anchor="middle" fill="#cfd3dc">${drill(m)}</text>
        </g>`);
    }
    if (S.drag?.kind === "marquee") {
        const { a, b } = S.drag;
        parts.push(`<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}" fill="#ffffff14" stroke="#fff8" stroke-dasharray="4 3"/>`);
    }
    svg.innerHTML = parts.join("");
}

/** Others on the field: rings on what they have selected, and a ghost of what they're dragging. */
function fieldOverlays(pos) {
    const out = [];
    for (const c of S.mode === "session" ? S.claims : []) {
        const ids = S.show.marchers.filter((m) => m.section === c.section).map((m) => pos.get(m.id));
        if (!ids.length) continue;
        const top = ids.reduce((a, b) => (b.y < a.y ? b : a));
        const left = Math.min(...ids.map((q) => q.x));
        const right = Math.max(...ids.map((q) => q.x));
        const mine = c.user.id === S.user.id;
        out.push(nameTag((left + right) / 2, top.y - 34, `${c.section}: ${mine ? "yours" : `held by ${c.user.name}`}`, c.user.color, 20));
    }
    others().forEach((p, i) => {
        const pr = p.presence;
        if (!pr) return;
        const r = 15 + 4 * i;
        for (const id of pr.selection ?? []) {
            const q = pos.get(id);
            if (q) out.push(`<circle cx="${q.x}" cy="${q.y}" r="${r}" fill="none" stroke="${p.user.color}" stroke-width="2.5" stroke-dasharray="5 3" opacity="0.9"/>`);
        }
        if (pr.drag && (pr.drag.dx || pr.drag.dy)) {
            let first = null;
            for (const id of pr.selection ?? []) {
                const q = pos.get(id);
                if (!q) continue;
                const gx = q.x + pr.drag.dx, gy = q.y + pr.drag.dy;
                first ??= { x: gx, y: gy };
                out.push(`<circle cx="${gx}" cy="${gy}" r="11" fill="${p.user.color}" fill-opacity="0.25" stroke="${p.user.color}" stroke-width="2"/>`);
            }
            if (first) out.push(nameTag(first.x, first.y - 26, `${p.user.name} is moving these`, p.user.color));
        } else if (pr.selection?.length) {
            const q = pos.get(pr.selection[0]);
            if (q) out.push(nameTag(q.x, q.y - r - 8, p.user.name, p.user.color));
        }
    });
    return out.join("");
}

function nameTag(x, y, text, color, size = 24) {
    const w = text.length * size * 0.66 + 12;
    return `<g pointer-events="none"><rect x="${x - w / 2}" y="${y - size}" width="${w}" height="${size + 6}" rx="4" fill="${color}"/>
        <text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="#111" font-weight="600">${escapeHtml(text)}</text></g>`;
}

/** Everyone in the session but me. */
function others() {
    return S.mode === "session" ? S.people.filter((p) => p.user.id !== S.user.id) : [];
}

function marcherDecorations(m, p) {
    const out = [];
    const claim = claimOf(m.section);
    if (claim) {
        const mine = claim.user.id === S.user.id;
        out.push(`<rect x="${p.x - 15}" y="${p.y - 15}" width="30" height="30" rx="4" fill="${mine ? "none" : claim.user.color}" fill-opacity="0.12" stroke="${claim.user.color}" stroke-width="${mine ? 1.5 : 2.5}" ${mine ? 'stroke-dasharray="2 3"' : ""} pointer-events="none"/>`);
    }
    const hl = S.highlights.get(m.id);
    if (hl && hl.until > Date.now()) {
        out.push(`<circle cx="${p.x}" cy="${p.y}" r="18" fill="none" stroke="${hl.color}" class="pulse"/>`);
        if (hl.label) out.push(nameTag(p.x, p.y + 44, hl.label, hl.color, 20));
    }
    return out.join("");
}

// ---------------------------------------------------------------- timeline

const TL = { padL: 70, padR: 16, rulerH: 26, laneH: 20, rowH: 18, rowsTop: 52 };

function tlScale() {
    const w = $("#timeline").clientWidth || 800;
    const per = (w - TL.padL - TL.padR) / S.total;
    return { w, per, x: (b) => TL.padL + b * per, beat: (px) => (px - TL.padL) / per };
}

function timelineRows() {
    return S.show.marchers.filter((m) => S.selection.has(m.id)).slice(0, 9);
}

function renderTimeline() {
    renderTransport();
    const svg = $("#timeline");
    const { w, per, x } = tlScale();
    const h = svg.clientHeight || 230;
    const parts = [];
    parts.push(`<rect x="0" y="0" width="${w}" height="${TL.rulerH}" fill="#181b21" data-ruler="1"/>`);
    // beats and flags
    for (let b = 0; b <= S.total; b++) {
        const major = b % 4 === 0;
        if (!major && per < 5) continue;
        parts.push(`<line x1="${x(b)}" y1="${major ? 14 : 19}" x2="${x(b)}" y2="${TL.rulerH}" stroke="#555" pointer-events="none"/>`);
    }
    S.flags.forEach((f, i) => {
        parts.push(`<line x1="${x(f)}" y1="0" x2="${x(f)}" y2="${h}" stroke="#ffffff22" pointer-events="none"/>`);
        if (i > 0) parts.push(`<text x="${x(f) - 3}" y="11" font-size="10" text-anchor="end" fill="#aab" pointer-events="none">${i}</text>`);
    });
    // time selection
    if (S.range)
        parts.push(`<rect x="${x(S.range[0])}" y="0" width="${x(S.range[1]) - x(S.range[0])}" height="${h}" fill="#ffc94a18" stroke="#ffc94a55" pointer-events="none"/>`);
    parts.push(timelineOverlays(x, h));
    // rows of moves for the selected marchers
    const rows = timelineRows();
    if (rows.length === 0)
        parts.push(`<text x="${TL.padL}" y="${TL.rowsTop + 14}" fill="#8b90a0" font-size="12">Select marchers to see and edit their moves.</text>`);
    rows.forEach((m, r) => {
        const y = TL.rowsTop + r * TL.rowH;
        const rowClaim = claimOf(m.section);
        parts.push(`<text x="8" y="${y + 12}" font-size="11" fill="#cfd3dc">${drill(m)}</text>`);
        if (rowClaim && rowClaim.user.id !== S.user.id)
            parts.push(`<rect x="${TL.padL}" y="${y + 1}" width="${x(S.total) - TL.padL}" height="15" fill="${rowClaim.user.color}" fill-opacity="0.08" pointer-events="none"/><text x="34" y="${y + 12}" font-size="10" fill="${rowClaim.user.color}">${escapeHtml(rowClaim.user.name)}</text>`);
        // lowest priority first, so the move that wins is drawn on top
        const moves = S.resolver.movesOf(m.id).sort((a, b) => a.start_beat * 1e6 - (a.end_beat - a.start_beat) - (b.start_beat * 1e6 - (b.end_beat - b.start_beat)));
        for (const mv of moves) {
            let s = mv.start_beat, e = mv.end_beat;
            if (S.drag?.kind === "move" && S.drag.id === mv.id) ({ s, e } = S.drag.preview);
            const sel = S.selectedMove === mv.id;
            const flash = (S.moveHighlights.get(mv.id) ?? 0) > Date.now();
            parts.push(`<rect data-move="${mv.id}" x="${x(s)}" y="${y + 2}" width="${Math.max(2, x(e) - x(s))}" height="13" rx="3"
                fill="${sectionColor(m.section)}" fill-opacity="0.75" stroke="${flash ? "#ffc94a" : sel ? "#fff" : "#0008"}" stroke-width="${flash || sel ? 2 : 1}" ${flash ? 'class="pulse"' : ""} style="cursor:${canEdit() ? "ew-resize" : "default"}"/>`);
        }
    });
    // my playhead
    parts.push(`<line x1="${x(S.playhead)}" y1="0" x2="${x(S.playhead)}" y2="${h}" stroke="#ffc94a" stroke-width="2" pointer-events="none"/>`);
    parts.push(`<path d="M${x(S.playhead) - 6},0 L${x(S.playhead) + 6},0 L${x(S.playhead)},9 Z" fill="#ffc94a" pointer-events="none"/>`);
    svg.innerHTML = parts.join("");
}

/** Others on the timeline: their time selections and their playhead lines, in their colors. */
function timelineOverlays(x, h) {
    const out = [];
    others().forEach((p, i) => {
        const pr = p.presence;
        if (!pr) return;
        const c = p.user.color;
        if (pr.range) {
            out.push(`<rect x="${x(pr.range[0])}" y="${TL.rulerH}" width="${x(pr.range[1]) - x(pr.range[0])}" height="${h - TL.rulerH}" fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-opacity="0.6" pointer-events="none"/>`);
        }
        const px = x(pr.playhead ?? 0);
        out.push(`<line x1="${px}" y1="${TL.rulerH}" x2="${px}" y2="${h}" stroke="${c}" stroke-width="2" stroke-dasharray="4 3" pointer-events="none"/>`);
        out.push(`<path d="M${px - 5},${TL.rulerH} L${px + 5},${TL.rulerH} L${px},${TL.rulerH + 8} Z" fill="${c}" pointer-events="none"/>`);
        const label = `${p.user.name}${pr.playing ? " ▶" : ""}`;
        const w = label.length * 6.6 + 10;
        const lx = Math.min(px + 4, x(S.total) - w);
        const ly = TL.rulerH + 2 + (i % 2) * 11;
        out.push(`<g pointer-events="none"><rect x="${lx}" y="${ly}" width="${w}" height="13" rx="3" fill="${c}"/><text x="${lx + 5}" y="${ly + 10}" font-size="11" fill="#111" font-weight="600">${escapeHtml(label)}</text></g>`);
    });
    return out.join("");
}

function renderTransport() {
    const t = $("#transport");
    t.replaceChildren();
    const box = pageBoxAt(S.flags, S.playhead);
    t.append(
        button(S.playing ? "Pause" : "Play", togglePlay),
        button("Start", () => setPlayhead(0)),
        button("◀ page", () => setPlayhead([...S.flags].reverse().find((f) => f < S.playhead) ?? 0)),
        button("page ▶", () => setPlayhead(S.flags.find((f) => f > S.playhead) ?? S.total)),
    );
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = `Count ${Math.round(S.playhead * 10) / 10} · page ${box?.index ?? "–"}${S.range ? ` · selection ${S.range[0]}–${S.range[1]}` : ""}`;
    t.append(label);
    const spacer = document.createElement("span");
    spacer.className = "grow";
    t.append(spacer);
    const undo = button(`Undo${U.undo.length ? ` (${U.undo.length})` : ""}`, () => undoOrRedo("undo"));
    undo.disabled = !U.undo.length || !canEdit();
    undo.title = U.undo.length ? `Undo your "${U.undo[U.undo.length - 1].label}" (Ctrl+Z). Only your own edits.` : "Nothing of yours to undo";
    const redo = button("Redo", () => undoOrRedo("redo"));
    redo.disabled = !U.redo.length || !canEdit();
    t.append(undo, redo);
    const del = button("Delete move", () => S.selectedMove && deleteSelectedMove());
    del.disabled = !S.selectedMove || !canEdit();
    const ins = button("Insert 4 counts at playhead", () =>
        submit("Insert 4 counts", insertCountsCommand(Math.round(S.playhead), 4)),
    );
    ins.disabled = !canEdit() || !isHead();
    ins.title = isHead() ? "Shifts every later page flag and move (structural)" : "Only the head drill writer can insert time";
    t.append(del, ins);
}

function setPlayhead(b, { snap = true } = {}) {
    S.playhead = Math.max(0, Math.min(S.total, snap ? Math.round(b) : b));
    afterLocalUi();
}

function togglePlay() {
    S.playing = !S.playing;
    if (!S.playing) return render();
    if (S.playhead >= S.total) S.playhead = 0;
    let last = performance.now();
    const tick = (now) => {
        if (!S.playing) return;
        S.playhead = Math.min(S.total, S.playhead + ((now - last) / 1000) * 2); // 120 bpm
        last = now;
        if (S.playhead >= S.total) S.playing = false;
        afterLocalUi();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/** Local UI state changed (selection, playhead): redraw, and tell peers. */
function afterLocalUi() {
    render();
    sendPresence();
}

let presenceTimer = null;
let lastPresence = "";

/** Tells peers what I'm looking at and doing. Never stored: the server only relays it. */
function sendPresence() {
    if (S.mode !== "session" || !S.conn?.live || presenceTimer) return;
    presenceTimer = setTimeout(() => {
        presenceTimer = null;
        if (!S.conn?.live) return;
        const drag = S.drag?.kind === "marchers" ? { dx: S.drag.dx, dy: S.drag.dy } : null;
        const presence = {
            selection: [...S.selection].slice(0, 200),
            playhead: Math.round(S.playhead * 100) / 100,
            range: S.range,
            playing: S.playing,
            drag,
        };
        const text = JSON.stringify(presence);
        if (text === lastPresence) return;
        lastPresence = text;
        S.conn.send({ type: "presence", presence });
    }, 50);
}

/** Jump to where someone else is: their playhead, their selection. */
function goTo(person) {
    const pr = person.presence;
    if (!pr) return;
    S.playhead = pr.playhead ?? 0;
    S.range = pr.range ?? null;
    afterLocalUi();
    toast(`Went to ${person.user.name}'s playhead (count ${Math.round(S.playhead)}).`);
}

function describePresence(p) {
    const pr = p.presence;
    if (!pr) return "just joined";
    const box = pageBoxAt(S.flags, pr.playhead ?? 0);
    const bits = [`page ${box?.index ?? "–"} · count ${Math.round(pr.playhead ?? 0)}`];
    if (pr.playing) bits.push("playing");
    if (pr.range) bits.push(`selecting ${pr.range[0]}–${pr.range[1]}`);
    if (pr.selection?.length) bits.push(`${pr.selection.length} selected`);
    if (pr.drag) bits.push("dragging");
    return bits.join(" · ");
}

// ---------------------------------------------------------------- side panel

function renderSide() {
    const people = $("#people");
    people.replaceChildren();
    if (S.mode !== "session") {
        people.innerHTML = `<li class="muted">Just you (solo).</li>`;
    } else if (!S.conn?.live) {
        people.innerHTML = `<li class="muted">Offline: you can't see who else is here.</li>`;
    } else
        for (const p of S.people) {
            const li = document.createElement("li");
            const me = p.user.id === S.user.id;
            li.style.flexWrap = "wrap";
            li.innerHTML = `<span class="swatch" style="background:${p.user.color}"></span><b>${escapeHtml(p.user.name)}</b>${me ? " (you)" : ""} <span class="muted">${p.role === "head" ? "head" : ""}</span><span class="grow"></span>`;
            if (!me) li.append(button("go to", () => goTo(p)));
            const what = document.createElement("div");
            what.className = "muted";
            what.style.cssText = "width:100%;font-size:11px;padding-left:16px";
            what.textContent = me ? "" : describePresence(p);
            li.append(what);
            people.append(li);
        }
    renderSections();
    renderNetwork();
}

function renderSections() {
    const ul = $("#sections");
    ul.replaceChildren();
    const sections = [...new Set(S.show.marchers.map((m) => m.section))];
    for (const section of sections) {
        const count = S.show.marchers.filter((m) => m.section === section).length;
        const li = document.createElement("li");
        li.innerHTML = `<span class="swatch" style="background:${sectionColor(section)}"></span>${escapeHtml(section)} <span class="muted">${count}</span><span class="grow"></span>`;
        const claim = claimOf(section);
        if (claim) {
            const mine = claim.user.id === S.user.id;
            const online = S.people.some((p) => p.user.id === claim.user.id);
            const chip = document.createElement("span");
            chip.className = "chip";
            chip.style.cssText = `background:${claim.user.color};color:#111`;
            chip.textContent = mine ? "yours" : `${claim.user.name}${online ? "" : " (away)"}`;
            chip.title = mine ? "You hold this section" : `Held by ${claim.user.name}: others can look, not edit`;
            li.append(chip);
            if (mine || isHead()) li.append(button(mine ? "release" : "take back", () => releaseSection(section)));
        } else if (S.mode === "session" && S.conn?.live) li.append(button("claim", () => claimSection(section)));
        li.append(button("select", () => {
            S.selection = new Set(S.show.marchers.filter((m) => m.section === section).map((m) => m.id));
            afterLocalUi();
        }));
        ul.append(li);
    }
}

function renderNetwork() {
    const box = $("#network");
    box.replaceChildren();
    if (S.mode !== "session") {
        box.innerHTML = `<span class="muted">Not connected (solo).</span>`;
        return;
    }
    const lat = document.createElement("label");
    lat.innerHTML = `Simulated latency <select>${[0, 150, 500, 1500, 3000].map((ms) => `<option value="${ms}" ${S.conn.latencyMs === ms ? "selected" : ""}>${ms} ms</option>`).join("")}</select>`;
    lat.querySelector("select").onchange = (e) => {
        S.conn.latencyMs = Number(e.target.value);
    };
    box.append(lat);
    const status = document.createElement("div");
    status.className = "muted";
    const pending = S.conn.pending.length;
    status.textContent = `${S.conn.state === "live" ? "Connected" : S.conn.state === "offline" ? "Offline" : "Connecting"} · synced to #${Math.max(0, S.conn.seq)}${pending ? ` · ${pending} unconfirmed` : ""}`;
    box.append(status);
    if (S.conn.state === "offline" && S.conn.killed) box.append(button("Reconnect", () => S.conn.reconnect(), "primary"));
    else if (S.conn.state !== "offline")
        box.append(button("Kill connection", () => {
            S.conn.kill();
            toast("Connection cut. You're read-only until you reconnect.", "bad");
        }));
}

// ---------------------------------------------------------------- log and toasts

function log({ who, text, seq, cls = "" }) {
    const li = document.createElement("li");
    li.className = cls;
    li.innerHTML = `<span class="swatch" style="background:${who?.color ?? "#888"}"></span> <b>${escapeHtml(who?.name ?? "?")}</b> ${escapeHtml(text ?? "")} ${seq ? `<span class="muted">#${seq}</span>` : ""}`;
    const ol = $("#log");
    ol.prepend(li);
    while (ol.children.length > 60) ol.lastChild.remove();
}

function toast(text, kind = "") {
    const div = document.createElement("div");
    div.className = `toast ${kind}`;
    div.textContent = text;
    $("#toasts").append(div);
    setTimeout(() => div.remove(), kind === "bad" ? 6000 : 4000);
}

/** A toast with one action button. */
function toastAction(text, label, action) {
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = `${text} `;
    const b = button(label, () => {
        div.remove();
        action();
    }, "primary");
    b.style.marginLeft = "8px";
    div.append(b);
    $("#toasts").append(div);
    setTimeout(() => div.remove(), 8000);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ---------------------------------------------------------------- field interactions

function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function wireField() {
    const svg = $("#field");
    svg.addEventListener("pointerdown", (e) => {
        if (S.mode === "landing") return;
        const p = svgPoint(svg, e);
        const g = e.target.closest("[data-marcher]");
        if (g) {
            const id = Number(g.dataset.marcher);
            if (e.shiftKey) {
                S.selection.has(id) ? S.selection.delete(id) : S.selection.add(id);
                afterLocalUi();
                return;
            }
            if (!S.selection.has(id)) S.selection = new Set([id]);
            if (S.mode === "session" && !S.conn?.live) toast("You're offline, so the show is read-only. You can still look around and play.", "bad");
            if (canEdit() && canStartEditing(S.selection) && beginMarcherDrag()) S.drag = { kind: "marchers", start: p, dx: 0, dy: 0, moved: false };
            afterLocalUi();
        } else {
            if (!e.shiftKey) S.selection = new Set();
            S.drag = { kind: "marquee", a: p, b: p, add: e.shiftKey };
            afterLocalUi();
        }
        svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
        if (!S.drag) return;
        const p = svgPoint(svg, e);
        if (S.drag.kind === "marchers") {
            S.drag.dx = Math.round((p.x - S.drag.start.x) / (STEP / 2)) * (STEP / 2);
            S.drag.dy = Math.round((p.y - S.drag.start.y) / (STEP / 2)) * (STEP / 2);
            S.drag.moved ||= S.drag.dx !== 0 || S.drag.dy !== 0;
            renderField();
            sendPresence();
        } else if (S.drag.kind === "marquee") {
            S.drag.b = p;
            renderField();
        }
    });
    svg.addEventListener("pointerup", () => {
        const drag = S.drag;
        S.drag = null;
        if (drag?.kind === "marchers" && drag.moved) {
            const ids = [...S.selection];
            const range = editRange();
            guarded(`Move ${ids.length} marcher${ids.length > 1 ? "s" : ""} (${range.index ? `page ${range.index}` : `counts ${range.start}–${range.end}`})`, ids, moveMarchersCommand(ids, drag.dx, drag.dy, range));
        } else if (drag?.kind === "marquee") {
            const pos = positionsNow();
            const [x0, x1] = [Math.min(drag.a.x, drag.b.x), Math.max(drag.a.x, drag.b.x)];
            const [y0, y1] = [Math.min(drag.a.y, drag.b.y), Math.max(drag.a.y, drag.b.y)];
            for (const m of S.show.marchers) {
                const q = pos.get(m.id);
                if (q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1) S.selection.add(m.id);
            }
        }
        afterLocalUi();
    });
}

/** Starting a drag puts the playhead on the end of the range it will edit. */
function beginMarcherDrag() {
    const range = editRange();
    if (!range) return false;
    S.playhead = range.end;
    return true;
}

function wireKeys() {
    window.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || S.mode === "landing") return;
        const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (nudge && S.selection.size && canEdit()) {
            e.preventDefault();
            const range = editRange();
            if (!range) return;
            S.playhead = range.end;
            const ids = [...S.selection];
            if (!canStartEditing(ids)) return;
            guarded(`Nudge ${ids.length} marcher${ids.length > 1 ? "s" : ""}`, ids, moveMarchersCommand(ids, nudge[0] * STEP, nudge[1] * STEP, range));
        } else if ((e.key === "Delete" || e.key === "Backspace") && S.selectedMove && canEdit()) {
            deleteSelectedMove();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            undoOrRedo(e.shiftKey ? "redo" : "undo");
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            undoOrRedo("redo");
        } else if (e.key === " ") {
            e.preventDefault();
            togglePlay();
        } else if (e.key === "Escape") {
            S.selection = new Set();
            S.range = null;
            S.selectedMove = null;
            afterLocalUi();
        }
    });
}

// ---------------------------------------------------------------- timeline interactions

function wireTimeline() {
    const svg = $("#timeline");
    svg.addEventListener("pointerdown", (e) => {
        if (S.mode === "landing") return;
        const { beat, x } = tlScale();
        const rect = svg.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const b = Math.max(0, Math.min(S.total, Math.round(beat(px))));
        const bar = e.target.closest("[data-move]");
        if (bar) {
            const id = Number(bar.dataset.move);
            const mv = S.show.moves.find((m) => m.id === id);
            S.selectedMove = id;
            if (canEdit() && canStartEditing([mv.marcher_id])) {
                const nearStart = Math.abs(px - x(mv.start_beat)) < 7;
                const nearEnd = Math.abs(px - x(mv.end_beat)) < 7;
                S.drag = { kind: "move", id, edge: nearEnd ? "end" : nearStart ? "start" : "body", from: b, orig: mv, preview: { s: mv.start_beat, e: mv.end_beat } };
            }
            svg.setPointerCapture(e.pointerId);
            afterLocalUi();
            return;
        }
        if (py <= TL.rulerH + TL.laneH || !bar) {
            if (e.shiftKey) S.drag = { kind: "range", from: b };
            else {
                S.drag = { kind: "scrub" };
                S.range = null;
                setPlayhead(b);
            }
            svg.setPointerCapture(e.pointerId);
        }
    });
    svg.addEventListener("pointermove", (e) => {
        if (!S.drag) return;
        const rect = svg.getBoundingClientRect();
        const b = Math.max(0, Math.min(S.total, Math.round(tlScale().beat(e.clientX - rect.left))));
        if (S.drag.kind === "scrub") setPlayhead(b);
        else if (S.drag.kind === "range") {
            if (b !== S.drag.from) S.range = [Math.min(b, S.drag.from), Math.max(b, S.drag.from)];
            S.playhead = S.range ? S.range[1] : S.playhead;
            afterLocalUi();
        } else if (S.drag.kind === "move") {
            const { orig, edge, from } = S.drag;
            const d = b - from;
            let s = orig.start_beat, en = orig.end_beat;
            if (edge === "start") s = Math.min(orig.end_beat - 1, Math.max(0, s + d));
            else if (edge === "end") en = Math.max(orig.start_beat + 1, Math.min(S.total, en + d));
            else {
                const dd = Math.max(-s, Math.min(S.total - en, d));
                s += dd;
                en += dd;
            }
            S.drag.preview = { s, e: en };
            renderTimeline();
        }
    });
    svg.addEventListener("pointerup", () => {
        const drag = S.drag;
        S.drag = null;
        if (drag?.kind === "move") {
            const { s, e } = drag.preview;
            if (s !== drag.orig.start_beat || e !== drag.orig.end_beat)
                guarded(drag.edge === "body" ? "Shift a move" : "Resize a move", [drag.orig.marcher_id], resizeMoveCommand(drag.id, s, e));
        }
        afterLocalUi();
    });
}

// for poking at state from the console (and the scripted checks)
window.__S = S;
void boot();
