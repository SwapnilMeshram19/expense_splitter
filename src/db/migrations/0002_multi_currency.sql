ALTER TABLE `expense_payers` ADD `original_amount_minor` integer;--> statement-breakpoint
ALTER TABLE `expenses` ADD `original_currency` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `original_amount_minor` integer;--> statement-breakpoint
ALTER TABLE `expenses` ADD `fx_rate` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `currency` text DEFAULT 'INR' NOT NULL;