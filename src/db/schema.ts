import { pgTable, serial, text, timestamp, decimal, integer } from 'drizzle-orm/pg-core';

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  fullName: text('full_name').notNull(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('user').notNull(),
  lastLogin: timestamp('last_login'),
  isActive: integer('is_active').default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── Captchas ───────────────────────────────────────────────────────────────

export const captchas = pgTable('captchas', {
  id: text('id').primaryKey(), // UUID string
  hash: text('hash').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

// ─── Temporary Receipts (Pre-Approval Staging) ──────────────────────────────

export const tempReceipts = pgTable('temp_receipts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),

  // Core receipt fields
  receiptNoteNo: text('receipt_note_no'),
  receiptDate: text('receipt_date'),
  supplierName: text('supplier_name'),
  vendorCode: text('vendor_code'),
  poNumber: text('po_number'),
  depot: text('depot'),
  ward: text('ward'),
  roNumber: text('ro_number'),
  itemDescription: text('item_description'),
  plNumber: text('pl_number'),
  quantity: decimal('quantity'),
  value: decimal('value'),
  acceptanceDate: text('acceptance_date'),
  warrantyDate: text('warranty_date'),
  invoiceNumber: text('invoice_number'),

  // Extended fields (JSON blob for all additional extracted fields not in dedicated columns)
  extendedFields: text('extended_fields'),

  // Lifecycle fields
  status: text('status').default('pending').notNull(),
  rejectionReason: text('rejection_reason'),
  rejectedBy: integer('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at'),

  // Minus receipt fields
  isMinusReceipt: integer('is_minus_receipt').default(0),
  targetReceiptNoteNo: text('target_receipt_note_no'),
  qtyRejected: decimal('qty_rejected'),

  // Flags & confidence
  flags: text('flags'),              // JSON array: ["DUPLICATE_RNOTE","MISSING_FIELDS","LOW_OCR_CONFIDENCE","INVALID_FORMAT"]
  ocrConfidence: text('ocr_confidence'), // JSON map: { fieldName: number }

  // Edit tracking
  adjustmentCount: integer('adjustment_count').default(0),
  editedFields: text('edited_fields'),   // JSON array of field names edited before approval
  editedBy: integer('edited_by').references(() => users.id),
  editedAt: timestamp('edited_at'),

  // Document storage
  pdfData: text('pdf_data'),         // Base64-encoded original PDF for verification preview
  pdfUrl: text('pdf_url'),
  fileHash: text('file_hash'),
  rawOcrText: text('raw_ocr_text'),

  createdAt: timestamp('created_at').defaultNow(),
});

// ─── Master Receipts (Approved / Permanent) ─────────────────────────────────

export const masterReceipts = pgTable('master_receipts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),

  // Core receipt fields
  receiptNoteNo: text('receipt_note_no'),
  receiptDate: text('receipt_date'),
  supplierName: text('supplier_name'),
  vendorCode: text('vendor_code'),
  poNumber: text('po_number'),
  depot: text('depot'),
  ward: text('ward'),
  roNumber: text('ro_number'),
  itemDescription: text('item_description'),
  plNumber: text('pl_number'),
  quantity: decimal('quantity'),
  value: decimal('value'),
  acceptanceDate: text('acceptance_date'),
  warrantyDate: text('warranty_date'),
  invoiceNumber: text('invoice_number'),

  // Extended fields (JSON blob for additional extracted fields)
  extendedFields: text('extended_fields'),

  // Balance tracking
  currentBalance: decimal('current_balance'),
  status: text('status').default('active').notNull(),   // 'active' | 'exhausted'

  // Approval metadata
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),

  // Rejection metadata (for audit trail of past rejections before re-approval)
  rejectedBy: integer('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at'),

  // Edit tracking
  adjustmentCount: integer('adjustment_count').default(0),
  editedFields: text('edited_fields'),   // JSON array of field names edited before approval
  editedBy: integer('edited_by').references(() => users.id),
  editedAt: timestamp('edited_at'),
  ocrConfidence: text('ocr_confidence'), // JSON map copied from temp_receipts
  verificationStatus: text('verification_status'), // 'auto_verified' | 'manually_verified' | 'unverified'

  // Document & QR
  qrCodeData: text('qr_code_data'),  // Stores URL string (not base64 image)
  pdfData: text('pdf_data'),         // Base64-encoded original PDF for download
  fileHash: text('file_hash'),
  rawOcrText: text('raw_ocr_text'),

  createdAt: timestamp('created_at').defaultNow(),
});

// ─── Receipt Adjustments (Minus Receipt Deductions) ─────────────────────────

export const receiptAdjustments = pgTable('receipt_adjustments', {
  id: serial('id').primaryKey(),
  masterReceiptId: integer('master_receipt_id').references(() => masterReceipts.id).notNull(),
  receiptNoteNo: text('receipt_note_no').notNull(),
  minusReceiptNoteNo: text('minus_receipt_note_no').notNull(),
  qtyDeducted: decimal('qty_deducted').notNull(),
  balanceBefore: decimal('balance_before').notNull(),
  balanceAfter: decimal('balance_after').notNull(),
  adjustedBy: integer('adjusted_by').references(() => users.id).notNull(),
  sourceTempId: integer('source_temp_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── Receipt History (Full Audit Trail) ─────────────────────────────────────

export const receiptHistory = pgTable('receipt_history', {
  id: serial('id').primaryKey(),
  receiptNoteNo: text('receipt_note_no').notNull(),
  masterReceiptId: integer('master_receipt_id').references(() => masterReceipts.id),
  action: text('action').notNull(),
  details: text('details'),
  performedBy: integer('performed_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── Balances (Legacy — kept for backward compatibility) ────────────────────

export const balances = pgTable('balances', {
  id: serial('id').primaryKey(),
  plNumber: text('pl_number').notNull().unique(),
  quantity: decimal('quantity').notNull().default('0'),
  lastUpdated: timestamp('last_updated').defaultNow(),
});

// ─── Transaction Logs ───────────────────────────────────────────────────────

export const transactionLogs = pgTable('transaction_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow(),
});
