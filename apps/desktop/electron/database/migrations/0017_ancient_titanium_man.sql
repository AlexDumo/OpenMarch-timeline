CREATE INDEX `index_history_redo_on_history_group` ON `history_redo` (`history_group`);--> statement-breakpoint
CREATE INDEX `index_history_undo_on_history_group` ON `history_undo` (`history_group`);