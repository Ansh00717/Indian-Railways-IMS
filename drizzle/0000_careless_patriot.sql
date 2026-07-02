CREATE TABLE "balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"pl_number" text NOT NULL,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"last_updated" timestamp DEFAULT now(),
	CONSTRAINT "balances_pl_number_unique" UNIQUE("pl_number")
);
--> statement-breakpoint
CREATE TABLE "master_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_note_no" text,
	"receipt_date" text,
	"supplier_name" text,
	"vendor_code" text,
	"po_number" text,
	"depot" text,
	"ward" text,
	"ro_number" text,
	"item_description" text,
	"pl_number" text,
	"quantity" numeric,
	"value" numeric,
	"acceptance_date" text,
	"warranty_date" text,
	"invoice_number" text,
	"qr_code_data" text,
	"file_hash" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "temp_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"receipt_note_no" text,
	"receipt_date" text,
	"supplier_name" text,
	"vendor_code" text,
	"po_number" text,
	"depot" text,
	"ward" text,
	"ro_number" text,
	"item_description" text,
	"pl_number" text,
	"quantity" numeric,
	"value" numeric,
	"acceptance_date" text,
	"warranty_date" text,
	"invoice_number" text,
	"pdf_url" text,
	"file_hash" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" text NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"last_login" timestamp,
	"is_active" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "master_receipts" ADD CONSTRAINT "master_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temp_receipts" ADD CONSTRAINT "temp_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD CONSTRAINT "transaction_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;