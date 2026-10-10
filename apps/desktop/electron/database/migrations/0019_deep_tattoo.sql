CREATE TABLE `timeline_shape_recipe_marchers` (
	`id` integer PRIMARY KEY NOT NULL,
	`recipe_id` integer NOT NULL,
	`marcher_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `timeline_shape_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marcher_id`) REFERENCES `marchers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timeline_shape_recipe_marchers_marcher` ON `timeline_shape_recipe_marchers` (`marcher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_shape_recipe_marchers_recipe_id_marcher_id_unique` ON `timeline_shape_recipe_marchers` (`recipe_id`,`marcher_id`);--> statement-breakpoint
CREATE TABLE `timeline_shape_recipes` (
	`id` integer PRIMARY KEY NOT NULL,
	`timeline_id` integer,
	`kind` text NOT NULL,
	`kind_version` integer NOT NULL,
	`params` text NOT NULL,
	`order_mode` text NOT NULL,
	`reverse` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "timeline_shape_recipes_params_check" CHECK(json_valid(params))
);
