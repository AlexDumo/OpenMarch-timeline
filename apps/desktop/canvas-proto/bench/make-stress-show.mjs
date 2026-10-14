// PROTOTYPE helper: clones every marcher of a timeline-mode show N times with
// small offsets, so the Fabric editor and the three.js prototype can both
// open the same ~2,000-marcher show.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
const [src, dst, copiesArg = "5"] = process.argv.slice(2);
const copies = +copiesArg;
fs.copyFileSync(src, dst);
const db = new DatabaseSync(dst);
const step = 11.25; // field px per 8-to-5 step at PIXELS_PER_INCH 0.5
const offsets = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.5, 1.5], [-1.5, -1.5]].map(([x, y]) => [x * step, y * step]);
const marchers = db.prepare("select * from marchers order by id").all();
const n = marchers.length;
const maxId = db.prepare("select max(id) m from marchers").get().m;
const transitions = db.prepare("select * from timeline_transitions").all();
db.exec("BEGIN");
const insM = db.prepare("insert into marchers (id, name, section, year, notes, drill_prefix, drill_order, home_x, home_y) values (?,?,?,?,?,?,?,?,?)");
const idMap = [];
for (let c = 1; c < copies; c++) {
  const [dx, dy] = offsets[c];
  const map = new Map();
  marchers.forEach((m, k) => {
    const id = maxId + (c - 1) * n + k + 1;
    map.set(m.id, id);
    insM.run(id, m.name, m.section, m.year, m.notes, m.drill_prefix, m.drill_order + c * 1000, m.home_x + dx, m.home_y + dy);
  });
  idMap.push({ c, map, dx, dy });
}
for (const t of transitions) {
  const dests = db.prepare("select * from timeline_slot_destinations where transition_id=?").all(t.id);
  const assigns = db.prepare("select * from timeline_assignments where transition_id=?").all(t.id);
  db.prepare("update timeline_transitions set slot_count=? where id=?").run(t.slot_count * copies, t.id);
  const insD = db.prepare("insert into timeline_slot_destinations (transition_id, slot_index, x, y) values (?,?,?,?)");
  const insA = db.prepare("insert into timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat, layer) values (?,?,?,?,?,?)");
  for (const { c, map, dx, dy } of idMap) {
    for (const d of dests) insD.run(t.id, d.slot_index + c * t.slot_count, d.x + dx, d.y + dy);
    for (const a of assigns) insA.run(map.get(a.marcher_id), t.id, a.slot_index + c * t.slot_count, a.start_beat, a.end_beat, a.layer);
  }
}
db.exec("COMMIT");
// Drop the undo history the triggers wrote, so the file stays small.
for (const { name } of db.prepare("select name from sqlite_master where type='table' and name like 'history_%' and name not in ('history_stats')").all()) {
  try { db.exec(`delete from "${name}"`); } catch {}
}
db.exec("VACUUM");
console.log("marchers", db.prepare("select count(*) n from marchers").get().n, "assignments", db.prepare("select count(*) n from timeline_assignments").get().n);
