PRAGMA foreign_keys = ON;

CREATE TABLE marchers (
  id      INTEGER PRIMARY KEY,
  label   TEXT NOT NULL,
  home_x  REAL NOT NULL CHECK (abs(home_x) <= 1e6),
  home_y  REAL NOT NULL CHECK (abs(home_y) <= 1e6)
) STRICT;

CREATE TABLE shapes (
  id        INTEGER PRIMARY KEY,
  name      TEXT,
  kind      TEXT NOT NULL CHECK (kind IN ('line','freehand','circle','box','block')),
  geometry  TEXT NOT NULL CHECK (json_valid(geometry)),
  -- I-S1 (partial, DB-enforced): circle radius positive and within the coordinate bound;
  -- start_angle normalized to [0, 2π) so that adding a turn never loses precision
  CHECK (kind <> 'circle' OR (coalesce(json_type(geometry, '$.radius'), '') IN ('integer', 'real')
                              AND json_extract(geometry, '$.radius') > 0
                              AND json_extract(geometry, '$.radius') <= 1e6
                              AND coalesce(json_type(geometry, '$.start_angle'), '') IN ('integer', 'real')
                              AND json_extract(geometry, '$.start_angle') >= 0
                              AND json_extract(geometry, '$.start_angle') < 6.283185307179586))
) STRICT;

CREATE TABLE timelines (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  start_beat  INTEGER NOT NULL CHECK (start_beat BETWEEN 0 AND 2147483647),
  end_beat    INTEGER NOT NULL CHECK (end_beat   BETWEEN 0 AND 2147483647),
  CHECK (end_beat > start_beat)
) STRICT;

-- v0.9 (D-19, Appendix I): the path a route transition walks. No owner column, like shapes.
CREATE TABLE routes (
  id        INTEGER PRIMARY KEY,
  geometry  TEXT NOT NULL CHECK (json_valid(geometry))    -- §5.2, I-R1
) STRICT;

CREATE TABLE transitions (
  id             INTEGER PRIMARY KEY,
  timeline_id    INTEGER NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  dest_shape_id  INTEGER          REFERENCES shapes(id)    ON DELETE RESTRICT,   -- NULL: slots placed individually (D-16)
  path_style     TEXT NOT NULL DEFAULT 'direct'
                 CHECK (path_style IN ('direct','arc','follow_the_leader','route')),
  path_params    TEXT CHECK (path_params IS NULL OR json_valid(path_params)),
  route_id       INTEGER          REFERENCES routes(id)    ON DELETE RESTRICT,   -- v0.9: required for 'route' (I-R2)
  order_mode     TEXT NOT NULL DEFAULT 'inherit' CHECK (order_mode IN ('inherit','slot')),
  slot_count     INTEGER NOT NULL CHECK (slot_count BETWEEN 1 AND 10000),
  start_beat     INTEGER NOT NULL CHECK (start_beat BETWEEN 0 AND 2147483647),
  end_beat       INTEGER NOT NULL CHECK (end_beat   BETWEEN 0 AND 2147483647),
  CHECK (end_beat > start_beat),
  -- I-T5: follow-the-leader follows a path, so it needs a destination shape
  CHECK (dest_shape_id IS NOT NULL OR path_style <> 'follow_the_leader'),
  -- I-T2 (partial, DB-enforced): an arc carries a numeric bulge with |bulge| <= 0.5 (minor arcs only, §8.11)
  CHECK (path_style <> 'arc' OR (coalesce(json_type(path_params, '$.bulge'), '') IN ('integer', 'real')
                                 AND abs(json_extract(path_params, '$.bulge')) <= 0.5)),
  -- I-R2 (v0.9): a route transition walks a route, has no shape and exactly one slot
  CHECK (path_style <> 'route' OR (route_id IS NOT NULL AND dest_shape_id IS NULL AND slot_count = 1))
) STRICT;

CREATE TABLE assignments (
  id             INTEGER PRIMARY KEY,
  marcher_id     INTEGER NOT NULL REFERENCES marchers(id)    ON DELETE CASCADE,
  transition_id  INTEGER NOT NULL REFERENCES transitions(id) ON DELETE CASCADE,
  slot_index     INTEGER NOT NULL CHECK (slot_index >= 0),
  start_beat     INTEGER NOT NULL CHECK (start_beat BETWEEN 0 AND 2147483647),
  end_beat       INTEGER NOT NULL CHECK (end_beat   BETWEEN 0 AND 2147483647),
  layer          INTEGER NOT NULL DEFAULT 0 CHECK (layer BETWEEN -1000 AND 1000),
  CHECK (end_beat > start_beat),
  UNIQUE (transition_id, slot_index),
  UNIQUE (transition_id, marcher_id)
) STRICT;

-- D-16: individually placed destinations, used when a transition has no shape (one row per slot)
CREATE TABLE slot_destinations (
  transition_id  INTEGER NOT NULL REFERENCES transitions(id) ON DELETE CASCADE,
  slot_index     INTEGER NOT NULL CHECK (slot_index >= 0),
  x              REAL NOT NULL CHECK (abs(x) <= 1e6),       -- I-D2: inside the authored bound
  y              REAL NOT NULL CHECK (abs(y) <= 1e6),
  PRIMARY KEY (transition_id, slot_index)
) STRICT;

CREATE INDEX idx_asn_marcher    ON assignments(marcher_id, start_beat);
CREATE INDEX idx_tr_shape       ON transitions(dest_shape_id);
CREATE INDEX idx_tr_timeline    ON transitions(timeline_id);
-- (transition_id, ...) lookups are served by the UNIQUE(transition_id, slot_index) index.

-- I-A1, I-A2: assignment inside its transition's range and slot_count
CREATE TRIGGER asn_bounds_ins BEFORE INSERT ON assignments
WHEN NOT EXISTS (SELECT 1 FROM transitions t WHERE t.id = NEW.transition_id
                 AND NEW.start_beat >= t.start_beat AND NEW.end_beat <= t.end_beat
                 AND NEW.slot_index < t.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-A1/E-A2: assignment outside transition range or slot_count'); END;

CREATE TRIGGER asn_bounds_upd BEFORE UPDATE ON assignments
WHEN NOT EXISTS (SELECT 1 FROM transitions t WHERE t.id = NEW.transition_id
                 AND NEW.start_beat >= t.start_beat AND NEW.end_beat <= t.end_beat
                 AND NEW.slot_index < t.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-A1/E-A2: assignment outside transition range or slot_count'); END;

-- I-A3: one marcher, one layer, no overlapping ranges
CREATE TRIGGER asn_overlap_ins BEFORE INSERT ON assignments
WHEN EXISTS (SELECT 1 FROM assignments a WHERE a.marcher_id = NEW.marcher_id AND a.layer = NEW.layer
             AND a.start_beat < NEW.end_beat AND NEW.start_beat < a.end_beat)
BEGIN SELECT RAISE(ABORT, 'E-A3: overlapping assignments for one marcher at the same layer'); END;

CREATE TRIGGER asn_overlap_upd BEFORE UPDATE ON assignments
WHEN EXISTS (SELECT 1 FROM assignments a WHERE a.id <> NEW.id AND a.marcher_id = NEW.marcher_id
             AND a.layer = NEW.layer AND a.start_beat < NEW.end_beat AND NEW.start_beat < a.end_beat)
BEGIN SELECT RAISE(ABORT, 'E-A3: overlapping assignments for one marcher at the same layer'); END;

-- I-T1: transition inside its timeline
CREATE TRIGGER tr_in_timeline_ins BEFORE INSERT ON transitions
WHEN NOT EXISTS (SELECT 1 FROM timelines l WHERE l.id = NEW.timeline_id
                 AND NEW.start_beat >= l.start_beat AND NEW.end_beat <= l.end_beat)
BEGIN SELECT RAISE(ABORT, 'E-T1: transition outside its timeline'); END;

CREATE TRIGGER tr_in_timeline_upd BEFORE UPDATE OF start_beat, end_beat, timeline_id ON transitions
WHEN NOT EXISTS (SELECT 1 FROM timelines l WHERE l.id = NEW.timeline_id
                 AND NEW.start_beat >= l.start_beat AND NEW.end_beat <= l.end_beat)
BEGIN SELECT RAISE(ABORT, 'E-T1: transition outside its timeline'); END;

CREATE TRIGGER tl_contains_upd BEFORE UPDATE OF start_beat, end_beat ON timelines
WHEN EXISTS (SELECT 1 FROM transitions t WHERE t.timeline_id = NEW.id
             AND (t.start_beat < NEW.start_beat OR t.end_beat > NEW.end_beat))
BEGIN SELECT RAISE(ABORT, 'E-T1: timeline would no longer contain its transitions'); END;

-- I-A2 (transition side): slot_count cannot shrink below an occupied slot
CREATE TRIGGER tr_slots_upd BEFORE UPDATE OF slot_count ON transitions
WHEN EXISTS (SELECT 1 FROM assignments a WHERE a.transition_id = NEW.id AND a.slot_index >= NEW.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-A2: slot_count below an occupied slot'); END;

-- I-T6 (row side): a destination row belongs to a shapeless transition and to one of its slots
CREATE TRIGGER sd_ins BEFORE INSERT ON slot_destinations
WHEN NOT EXISTS (SELECT 1 FROM transitions t WHERE t.id = NEW.transition_id
                 AND t.dest_shape_id IS NULL AND NEW.slot_index < t.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-T6: destination row on a shaped transition or outside slot_count'); END;

CREATE TRIGGER sd_upd BEFORE UPDATE ON slot_destinations
WHEN NOT EXISTS (SELECT 1 FROM transitions t WHERE t.id = NEW.transition_id
                 AND t.dest_shape_id IS NULL AND NEW.slot_index < t.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-T6: destination row on a shaped transition or outside slot_count'); END;

-- I-T6 (transition side): a shape and individual destinations are exclusive; slot_count keeps its rows valid
CREATE TRIGGER tr_shape_set BEFORE UPDATE OF dest_shape_id ON transitions
WHEN NEW.dest_shape_id IS NOT NULL AND EXISTS (SELECT 1 FROM slot_destinations d WHERE d.transition_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'E-T6: remove individual destinations before assigning a shape'); END;

CREATE TRIGGER tr_slots_dest_upd BEFORE UPDATE OF slot_count ON transitions
WHEN EXISTS (SELECT 1 FROM slot_destinations d WHERE d.transition_id = NEW.id AND d.slot_index >= NEW.slot_count)
BEGIN SELECT RAISE(ABORT, 'E-T6: slot_count below a placed destination'); END;

-- §6 commit-time invariants: the write wrapper aborts the edit if this view returns any row.
-- (Completeness can only be judged once the whole edit has run: a transition and its points are inserted together.)
CREATE VIEW commit_violations AS
  SELECT 'E-T6' AS code, t.id AS transition_id,
         'shapeless transition has ' || (SELECT count(*) FROM slot_destinations d WHERE d.transition_id = t.id)
           || ' of ' || t.slot_count || ' destinations' AS detail
    FROM transitions t
   WHERE t.dest_shape_id IS NULL
     AND (SELECT count(*) FROM slot_destinations d WHERE d.transition_id = t.id) <> t.slot_count
  UNION ALL
  SELECT 'E-R3', NULL, 'route ' || r.id || ' is used by no transition'
    FROM routes r WHERE NOT EXISTS (SELECT 1 FROM transitions t WHERE t.route_id = r.id)
  UNION ALL
  SELECT 'E-R2', t.id, 'a ' || t.path_style || ' transition has a route' FROM transitions t WHERE t.path_style <> 'route' AND t.route_id IS NOT NULL
  UNION ALL
  -- I-R4 (v0.9 step 15): a route transition without an offset walks its route alone
  SELECT 'E-R4', t.id, 'route ' || t.route_id || ' is shared but this transition has no offset' FROM transitions t
   WHERE t.path_style = 'route' AND t.path_params IS NULL AND (SELECT count(*) FROM transitions u WHERE u.route_id = t.route_id) > 1
  UNION ALL
  -- I-R5 (v0.9 step 15): every transition walking one route is in one timeline, over the same range
  SELECT 'E-R5', t.id, 'route ' || t.route_id || ' is walked in two moves or over two ranges' FROM transitions t
    JOIN transitions u ON u.route_id = t.route_id AND u.id < t.id
   WHERE t.timeline_id <> u.timeline_id OR t.start_beat <> u.start_beat OR t.end_beat <> u.end_beat;

CREATE INDEX idx_tr_route ON transitions(route_id);

-- I-A1 (transition side): a transition's range must still contain every one of its assignments.
-- A pure check. The anchored rewrite (R-E1) is an app procedure, NOT a trigger: a trigger that modifies rows
-- adds side effects that undo replays in the wrong order (§6.1, QA-UNDO-1).
CREATE TRIGGER tr_range_check BEFORE UPDATE OF start_beat, end_beat ON transitions
WHEN EXISTS (SELECT 1 FROM assignments a WHERE a.transition_id = NEW.id
             AND (a.start_beat < NEW.start_beat OR a.end_beat > NEW.end_beat))
BEGIN SELECT RAISE(ABORT, 'E-A1: range change strands an assignment'); END;

-- I-T3, I-T4: destination shape must suit the path style and slot_count
CREATE TRIGGER tr_dest_ins BEFORE INSERT ON transitions
WHEN EXISTS (SELECT 1 FROM shapes s WHERE s.id = NEW.dest_shape_id AND s.kind = 'block'
             AND (NEW.path_style = 'follow_the_leader'
                  OR json_extract(s.geometry,'$.rows') * json_extract(s.geometry,'$.cols') < NEW.slot_count))
BEGIN SELECT RAISE(ABORT, 'E-T3/E-T4: block shape used for FTL or over capacity'); END;

CREATE TRIGGER tr_dest_upd BEFORE UPDATE OF dest_shape_id, path_style, slot_count ON transitions
WHEN EXISTS (SELECT 1 FROM shapes s WHERE s.id = NEW.dest_shape_id AND s.kind = 'block'
             AND (NEW.path_style = 'follow_the_leader'
                  OR json_extract(s.geometry,'$.rows') * json_extract(s.geometry,'$.cols') < NEW.slot_count))
BEGIN SELECT RAISE(ABORT, 'E-T3/E-T4: block shape used for FTL or over capacity'); END;

CREATE TRIGGER shape_dest_upd BEFORE UPDATE OF kind, geometry ON shapes
WHEN NEW.kind = 'block' AND EXISTS (SELECT 1 FROM transitions t WHERE t.dest_shape_id = NEW.id
             AND (t.path_style = 'follow_the_leader'
                  OR json_extract(NEW.geometry,'$.rows') * json_extract(NEW.geometry,'$.cols') < t.slot_count))
BEGIN SELECT RAISE(ABORT, 'E-T3/E-T4: shape change invalidates a transition using it'); END;

-- §10.2 change log: one row per changed row, in commit order, including FK cascades (they fire
-- AFTER triggers). The write wrapper reads and clears it inside the same transaction, commits,
-- then hands the coalesced batch to the resolver. Undo and redo go through the same wrapper (§6.1).
-- Triggers on data tables either RAISE or write to bookkeeping tables (change_log, history_*); none
-- modifies a data table (§6.1 U-1).
CREATE TABLE change_log (
  seq     INTEGER PRIMARY KEY,
  tbl     TEXT NOT NULL,
  row_id  INTEGER NOT NULL,
  before  TEXT,            -- JSON row image, NULL on insert
  after   TEXT             -- JSON row image, NULL on delete
) STRICT;

CREATE TRIGGER log_marchers_ins AFTER INSERT ON marchers BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('marchers',NEW.id,NULL,json_object('id',NEW.id,'home',json_array(NEW.home_x,NEW.home_y))); END;
CREATE TRIGGER log_marchers_upd AFTER UPDATE ON marchers BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('marchers',NEW.id,json_object('id',OLD.id,'home',json_array(OLD.home_x,OLD.home_y)),json_object('id',NEW.id,'home',json_array(NEW.home_x,NEW.home_y))); END;
CREATE TRIGGER log_marchers_del AFTER DELETE ON marchers BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('marchers',OLD.id,json_object('id',OLD.id,'home',json_array(OLD.home_x,OLD.home_y)),NULL); END;
CREATE TRIGGER log_shapes_ins AFTER INSERT ON shapes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('shapes',NEW.id,NULL,json_object('id',NEW.id,'kind',NEW.kind,'geometry',json(NEW.geometry))); END;
CREATE TRIGGER log_shapes_upd AFTER UPDATE ON shapes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('shapes',NEW.id,json_object('id',OLD.id,'kind',OLD.kind,'geometry',json(OLD.geometry)),json_object('id',NEW.id,'kind',NEW.kind,'geometry',json(NEW.geometry))); END;
CREATE TRIGGER log_shapes_del AFTER DELETE ON shapes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('shapes',OLD.id,json_object('id',OLD.id,'kind',OLD.kind,'geometry',json(OLD.geometry)),NULL); END;
CREATE TRIGGER log_transitions_ins AFTER INSERT ON transitions BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('transitions',NEW.id,NULL,json_object('id',NEW.id,'dest',NEW.dest_shape_id,'style',NEW.path_style,'params',json(NEW.path_params),'order',NEW.order_mode,'slots',NEW.slot_count,'start',NEW.start_beat,'end',NEW.end_beat,'route',NEW.route_id)); END;
CREATE TRIGGER log_transitions_upd AFTER UPDATE ON transitions BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('transitions',NEW.id,json_object('id',OLD.id,'dest',OLD.dest_shape_id,'style',OLD.path_style,'params',json(OLD.path_params),'order',OLD.order_mode,'slots',OLD.slot_count,'start',OLD.start_beat,'end',OLD.end_beat,'route',OLD.route_id),json_object('id',NEW.id,'dest',NEW.dest_shape_id,'style',NEW.path_style,'params',json(NEW.path_params),'order',NEW.order_mode,'slots',NEW.slot_count,'start',NEW.start_beat,'end',NEW.end_beat,'route',NEW.route_id)); END;
CREATE TRIGGER log_transitions_del AFTER DELETE ON transitions BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('transitions',OLD.id,json_object('id',OLD.id,'dest',OLD.dest_shape_id,'style',OLD.path_style,'params',json(OLD.path_params),'order',OLD.order_mode,'slots',OLD.slot_count,'start',OLD.start_beat,'end',OLD.end_beat,'route',OLD.route_id),NULL); END;
CREATE TRIGGER log_assignments_ins AFTER INSERT ON assignments BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('assignments',NEW.id,NULL,json_object('id',NEW.id,'marcher',NEW.marcher_id,'transition',NEW.transition_id,'slot',NEW.slot_index,'start',NEW.start_beat,'end',NEW.end_beat,'layer',NEW.layer)); END;
CREATE TRIGGER log_assignments_upd AFTER UPDATE ON assignments BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('assignments',NEW.id,json_object('id',OLD.id,'marcher',OLD.marcher_id,'transition',OLD.transition_id,'slot',OLD.slot_index,'start',OLD.start_beat,'end',OLD.end_beat,'layer',OLD.layer),json_object('id',NEW.id,'marcher',NEW.marcher_id,'transition',NEW.transition_id,'slot',NEW.slot_index,'start',NEW.start_beat,'end',NEW.end_beat,'layer',NEW.layer)); END;
CREATE TRIGGER log_assignments_del AFTER DELETE ON assignments BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('assignments',OLD.id,json_object('id',OLD.id,'marcher',OLD.marcher_id,'transition',OLD.transition_id,'slot',OLD.slot_index,'start',OLD.start_beat,'end',OLD.end_beat,'layer',OLD.layer),NULL); END;
-- slot_destinations rows are logged under their transition id (the resolver recomputes that transition's destinations)
CREATE TRIGGER log_slot_destinations_ins AFTER INSERT ON slot_destinations BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('slot_destinations',NEW.transition_id,NULL,json_object('transition',NEW.transition_id,'slot',NEW.slot_index,'x',NEW.x,'y',NEW.y)); END;
CREATE TRIGGER log_slot_destinations_upd AFTER UPDATE ON slot_destinations BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('slot_destinations',NEW.transition_id,json_object('transition',OLD.transition_id,'slot',OLD.slot_index,'x',OLD.x,'y',OLD.y),json_object('transition',NEW.transition_id,'slot',NEW.slot_index,'x',NEW.x,'y',NEW.y)); END;
CREATE TRIGGER log_routes_ins AFTER INSERT ON routes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('routes',NEW.id,NULL,json_object('id',NEW.id,'geometry',json(NEW.geometry))); END;
CREATE TRIGGER log_routes_upd AFTER UPDATE ON routes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('routes',NEW.id,json_object('id',OLD.id,'geometry',json(OLD.geometry)),json_object('id',NEW.id,'geometry',json(NEW.geometry))); END;
CREATE TRIGGER log_routes_del AFTER DELETE ON routes BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('routes',OLD.id,json_object('id',OLD.id,'geometry',json(OLD.geometry)),NULL); END;
CREATE TRIGGER log_slot_destinations_del AFTER DELETE ON slot_destinations BEGIN INSERT INTO change_log(tbl,row_id,before,after) VALUES ('slot_destinations',OLD.transition_id,json_object('transition',OLD.transition_id,'slot',OLD.slot_index,'x',OLD.x,'y',OLD.y),NULL); END;
