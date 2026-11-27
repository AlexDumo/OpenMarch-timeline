-- Performer figures, ADR 0019 (fork #1319): each look the show uses, seen from straight above,
-- for the 2D field. A cache: an older build ignores the table, so the file keeps its version.
-- Numbered 0031 and dated just after 0029, before the shape-count branch's 0030, so whichever
-- merges first, a file that takes one still takes the other. IF NOT EXISTS because the app also
-- makes the table when a file has missed this migration (`performerFigures.ts`).
CREATE TABLE IF NOT EXISTS `performer_figures` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`image` blob NOT NULL,
	`layout` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "performer_figures_fingerprint_check" CHECK(length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "performer_figures_layout_check" CHECK(json_valid(layout) AND json_type(layout) = 'object')
);
