-- Add extended_fields column to temp_receipts and master_receipts
-- This stores additional extracted fields as JSON without requiring individual columns

ALTER TABLE temp_receipts ADD COLUMN IF NOT EXISTS extended_fields TEXT;
ALTER TABLE master_receipts ADD COLUMN IF NOT EXISTS extended_fields TEXT;
