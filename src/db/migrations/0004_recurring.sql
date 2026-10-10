CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`category_label` text,
	`note` text,
	`split_input` text NOT NULL,
	`payers` text NOT NULL,
	`shares` text NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`time_zone` text NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_rules_group_idx` ON `recurring_rules` (`group_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `recurring_rule_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `occurrence_date` text;