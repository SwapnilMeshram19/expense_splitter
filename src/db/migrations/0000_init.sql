CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_member_id` text,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_group_created_idx` ON `activity_log` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `expense_payers` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `member_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_payers_amount_non_negative" CHECK("expense_payers"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `expense_payers_member_idx` ON `expense_payers` (`member_id`);--> statement-breakpoint
CREATE TABLE `expense_shares` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `member_id`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_shares_amount_non_negative" CHECK("expense_shares"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `expense_shares_member_idx` ON `expense_shares` (`member_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`description` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`expense_date` text NOT NULL,
	`split_input` text NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_amount_positive" CHECK("expenses"."amount_paise" > 0),
	CONSTRAINT "expenses_date_format" CHECK("expenses"."expense_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `expenses_group_date_idx` ON `expenses` (`group_id`,`expense_date`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`simplify_debts` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	CONSTRAINT "groups_name_not_blank" CHECK(length(trim("groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`display_name` text NOT NULL,
	`user_id` text,
	`upi_vpa` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_name_not_blank" CHECK(length(trim("members"."display_name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `members_group_idx` ON `members` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_group_user_uq` ON `members` (`group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`method` text DEFAULT 'upi' NOT NULL,
	`note` text,
	`settled_at` integer NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlements_amount_positive" CHECK("settlements"."amount_paise" > 0),
	CONSTRAINT "settlements_not_self" CHECK("settlements"."from_member_id" <> "settlements"."to_member_id")
);
--> statement-breakpoint
CREATE INDEX `settlements_group_idx` ON `settlements` (`group_id`);