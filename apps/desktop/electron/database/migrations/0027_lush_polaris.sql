ALTER TABLE `beats` ADD `tempo_pin` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `beats` ADD `tempo_hold` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `measures` ADD `number_override` integer;