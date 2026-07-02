-- ============================================================================
-- Migration 0002: Edit Tracking & Audit Fields
-- ============================================================================
-- Adds: adjustment_count, edited_fields, edited_by, edited_at to temp_receipts
-- Adds: adjustment_count, edited_fields, edited_by, edited_at, ocr_confidence,
--        verification_status, rejected_by, rejected_at to master_receipts
-- ============================================================================

BEGIN;

-- ─── Temp Receipts: Edit tracking ──────────────────────────────────────────

ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "adjustment_count" integer DEFAULT 0;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "edited_fields" text;
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "edited_by" integer REFERENCES "users"("id");
ALTER TABLE "temp_receipts" ADD COLUMN IF NOT EXISTS "edited_at" timestamp;

-- ─── Master Receipts: Edit tracking, confidence, verification, rejection ───

ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "adjustment_count" integer DEFAULT 0;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "edited_fields" text;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "edited_by" integer REFERENCES "users"("id");
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "edited_at" timestamp;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "ocr_confidence" text;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "verification_status" text;
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "rejected_by" integer REFERENCES "users"("id");
ALTER TABLE "master_receipts" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;

-- ─── Set default verification status for existing approved records ─────────

UPDATE "master_receipts"
SET "verification_status" = 'unverified'
WHERE "verification_status" IS NULL;

COMMIT;
