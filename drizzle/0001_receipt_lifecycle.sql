-- ============================================================================
-- Migration 0001: Receipt Lifecycle Support
-- ============================================================================
-- Adds: receipt_adjustments, receipt_history tables
-- Extends: users (role), temp_receipts (rejection, flags, minus receipt),
--          master_receipts (balance, status, approval metadata)
-- ============================================================================

BEGIN;

-- ─── Users: Add role column ─────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;

-- ─── Temp Receipts: Lifecycle, minus receipt, flags, PDF storage ────────────

ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "rejected_by" integer REFERENCES "users"("id");
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "is_minus_receipt" integer DEFAULT 0;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "target_receipt_note_no" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "qty_rejected" numeric;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "flags" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "ocr_confidence" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "pdf_data" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "raw_ocr_text" text;

-- ─── Master Receipts: Balance tracking, status, approval metadata ───────────

ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "current_balance" numeric;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "approved_by" integer REFERENCES "users"("id");
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "pdf_data" text;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "raw_ocr_text" text;

-- ─── Populate current_balance from existing quantity for active records ──────

UPDATE "master_receipts"
SET "current_balance" = "quantity"
WHERE "current_balance" IS NULL AND "quantity" IS NOT NULL;

-- ─── Receipt Adjustments (Minus Receipt Deductions) ─────────────────────────

CREATE TABLE IF NOT EXISTS "receipt_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"master_receipt_id" integer NOT NULL REFERENCES "master_receipts"("id"),
	"receipt_note_no" text NOT NULL,
	"minus_receipt_note_no" text NOT NULL,
	"qty_deducted" numeric NOT NULL,
	"balance_before" numeric NOT NULL,
	"balance_after" numeric NOT NULL,
	"adjusted_by" integer NOT NULL REFERENCES "users"("id"),
	"source_temp_id" integer,
	"created_at" timestamp DEFAULT now()
);

-- ─── Receipt History (Full Audit Trail) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "receipt_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_note_no" text NOT NULL,
	"master_receipt_id" integer REFERENCES "master_receipts"("id"),
	"action" text NOT NULL,
	"details" text,
	"performed_by" integer NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now()
);

-- ─── Indexes for receipt_note_no lookups ────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_master_receipts_receipt_note_no"
  ON "master_receipts" ("receipt_note_no");

CREATE INDEX IF NOT EXISTS "idx_receipt_history_receipt_note_no"
  ON "receipt_history" ("receipt_note_no");

CREATE INDEX IF NOT EXISTS "idx_receipt_adjustments_receipt_note_no"
  ON "receipt_adjustments" ("receipt_note_no");

CREATE INDEX IF NOT EXISTS "idx_temp_receipts_status"
  ON "temp_receipts" ("status");

CREATE INDEX IF NOT EXISTS "idx_master_receipts_status"
  ON "master_receipts" ("status");

COMMIT;
