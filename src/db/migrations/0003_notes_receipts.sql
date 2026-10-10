CREATE TABLE `receipt_files` (
	`receipt_id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`group_id` text NOT NULL,
	`state` text NOT NULL,
	`bytes` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `receipt_files_state_idx` ON `receipt_files` (`state`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `note` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `receipt_id` text;