import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";

import { db } from "./src/db/index.ts";
import {
  users, tempReceipts, masterReceipts, balances,
  transactionLogs, receiptAdjustments, receiptHistory
} from "./src/db/schema.ts";
import { eq, sql, desc, like, or, and, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";

const requireAdmin = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  if (!req.user || req.user.username !== 'admin') {
    res.status(403).json({ error: "Forbidden: Admin access required" });
    return;
  }
  next();
};
import { createUser, getUserByUsernameOrEmail, getUserById, updateUserLastLogin } from "./src/db/users.ts";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';
import QRCode from "qrcode";
import crypto from "crypto";
import { spawn, execSync } from "child_process";
import fs from "fs";
import os from "os";

const upload = multer({ storage: multer.memoryStorage() });

// ─── OCR Text Sanitization ──────────────────────────────────────────────────

function sanitizeExtractedText(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  let t = value.trim();
  if (!t) return null;

  // Remove garbage unicode
  t = t.replace(/[™®©§¶†‡•‣⁃]/g, '');
  // Remove common OCR noise characters
  t = t.replace(/[{}[\]<>\\|~`^]/g, '');
  // Remove sequences of stray punctuation (3+ non-alphanumeric)
  t = t.replace(/[^\w\s,./:;()\-₹&]{3,}/g, '');
  // Remove broken OCR fragments: consonant clusters > 4 without vowels
  t = t.replace(/\b[bcdfghjklmnpqrstvwxz]{5,}\b/gi, '');
  // Collapse multiple spaces
  t = t.replace(/\s{2,}/g, ' ');
  // Remove leading/trailing noise
  t = t.replace(/^[\s:\-|_.,;]+/, '').replace(/[\s:\-|_.,;]+$/, '');
  t = t.trim();

  // If after cleaning it's too short or just noise, return null
  if (t.length < 1) return null;
  // Reject if mostly non-alphanumeric
  const alphaCount = (t.match(/[a-zA-Z0-9]/g) || []).length;
  if (t.length > 3 && alphaCount / t.length < 0.3) return null;

  return t;
}

function sanitizeFieldValue(key: string, value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const cleaned = sanitizeExtractedText(value);
  if (!cleaned) return null;
  // Never store "Not extracted" or similar placeholders
  if (/^not\s*(extracted|found|available|applicable)$/i.test(cleaned)) return null;
  if (/^n\/?a$/i.test(cleaned)) return null;
  if (/^-+$/.test(cleaned)) return null;
  return cleaned;
}

// ─── Server ─────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = 3000;

  try {
    const result = await db.execute(sql`SELECT 1`);
    if (result) {
      console.log("✓ PostgreSQL connected");
      
      const TESSERACT_PATH = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
      const POPPLER_PATH = "C:\\poppler-26.02.0\\Library\\bin\\pdfinfo.exe";

      const tesseractFound = fs.existsSync(TESSERACT_PATH);
      const popplerFound = fs.existsSync(POPPLER_PATH);
      
      // Check PyMuPDF availability
      let pymuFound = false;
      try {
        const pythonExe = os.platform() === 'win32' ? "venv\\Scripts\\python.exe" : "venv/bin/python";
        execSync(`"${pythonExe}" -c "import fitz"`, { stdio: 'ignore', timeout: 5000 });
        pymuFound = true;
      } catch { /* PyMuPDF not available */ }

      console.log(tesseractFound ? "✓ Tesseract detected" : `⚠️ Tesseract missing at ${TESSERACT_PATH}`);
      console.log(popplerFound ? "✓ Poppler detected" : `⚠️ Poppler missing at ${POPPLER_PATH}`);
      console.log(pymuFound ? "✓ PyMuPDF detected (primary PDF extractor)" : "⚠️ PyMuPDF not available (will use pdf-parse)");
      console.log("✓ PDF parser ready");
      if (tesseractFound && popplerFound) {
        console.log("✓ OCR ready");
      }
      console.log("✓ Authentication ready");
    }
  } catch (dbErr) {
    console.error("Database connection failed", dbErr);
  }

  console.log("Starting Django CAPTCHA service...");
  const pythonExecutable = os.platform() === 'win32' ? "venv\\Scripts\\python.exe" : "venv/bin/python";
  const djangoProcess = spawn(pythonExecutable, ["manage.py", "runserver", "8000", "--noreload"], {
    cwd: path.join(process.cwd(), "captcha_service"),
    stdio: "inherit",
    shell: true
  });
  
  djangoProcess.on('error', (err) => console.error("Failed to start Django CAPTCHA service:", err));
  
  // Ensure the subprocess is killed when the parent exits
  process.on('exit', () => djangoProcess.kill());
  process.on('SIGINT', () => { djangoProcess.kill(); process.exit(); });
  process.on('SIGTERM', () => { djangoProcess.kill(); process.exit(); });

  app.use(express.json({ limit: '50mb' }));

  // ─── Registration ──────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { fullName, email, username, password } = req.body;
      
      const existingUser = await getUserByUsernameOrEmail(email);
      const existingUsername = await getUserByUsernameOrEmail(username);
      if (existingUser || existingUsername) {
        res.status(400).json({ error: "User already exists" });
        return;
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      await createUser({
        fullName,
        email,
        username,
        passwordHash,
      });
      res.json({ success: true, message: "User registered successfully" });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });

  // ─── Login ─────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { identifier, password } = req.body;
      
      const user = await getUserByUsernameOrEmail(identifier);
      if (!user) {
         res.status(400).json({ error: "Invalid credentials" });
         return;
      }
      
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
         res.status(400).json({ error: "Invalid credentials" });
         return;
      }
      
      if (!user.isActive) {
         res.status(400).json({ error: "Account is disabled" });
         return;
      }
      
      await updateUserLastLogin(user.id);
      const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email, username: user.username } });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // ─── Auth Check ────────────────────────────────────────────────────────

  app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user || !req.user.id) {
         res.status(401).json({ error: "Unauthorized" });
         return;
      }
      const user = await getUserById(req.user.id);
      if (!user) {
         res.status(401).json({ error: "User not found" });
         return;
      }
      res.json({ user: { id: user.id, fullName: user.fullName, email: user.email, username: user.username } });
    } catch (error: any) {
      res.status(500).json({ error: "Authentication check failed" });
    }
  });

  // ─── Forgot Password (Disabled without email/security questions) ───────────────

  app.post("/api/auth/forgot-password/reset", async (req, res) => {
    try {
      const { username, newPassword } = req.body;
      const user = await getUserByUsernameOrEmail(username);
      if (!user) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      await db.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, user.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Password reset failed" });
    }
  });

  // ─── Upload and Parse PDF ─────────────────────────────────────────────

  app.post("/api/receipts/parse", requireAuth, upload.single('file'), async (req: AuthRequest, res, next) => {
    try {
      if (!req.user || !req.file) {
        res.status(400).json({ error: "Missing file or auth" });
        return;
      }

      // Calculate Hash to prevent duplicates
      const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      
      const existingMaster = await db.select().from(masterReceipts).where(eq(masterReceipts.fileHash, fileHash));
      if (existingMaster.length > 0) {
         res.status(400).json({ error: "Duplicate document detected. This receipt was already processed." });
         return;
      }

      const userId = req.user.id;

      // Write buffer to temp file
      const ext = path.extname(req.file.originalname) || ".pdf";
      const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}${ext}`);
      fs.writeFileSync(tempFilePath, req.file.buffer);

      // Extract text using Local OCR Pipeline
      const { extractTextFromPDF, parseWithAI } = await import("./src/lib/ocr.ts");
      let rawText = "";
      try {
         rawText = await extractTextFromPDF(req.file.buffer, tempFilePath);
      } catch (error: any) {
         res.status(500).json({
           error: error instanceof Error ? error.message : String(error)
         });
         return;
      } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }

      // Pre-check for duplicate R/Note No
      let isDuplicate = false;
      // Quick parse to get receiptNoteNo for duplicate check (before full pipeline)
      const quickParse = await parseWithAI(rawText, false);
      if (quickParse.data.receiptNoteNo) {
        const duplicateCheck = await db.select().from(masterReceipts)
          .where(eq(masterReceipts.receiptNoteNo, quickParse.data.receiptNoteNo));
        if (duplicateCheck.length > 0) isDuplicate = true;
      }

      // Full parse with duplicate awareness
      const parseResult = isDuplicate ? { ...quickParse, flags: [...new Set([...quickParse.flags, 'DUPLICATE_RNOTE' as const])] } : quickParse;
      const extractedData = parseResult.data;
      const confidenceScores = parseResult.confidence;
      const minusReceipt = parseResult.minusReceipt;
      const flagsList = parseResult.flags;

      // Store PDF as base64 for verification preview
      const pdfBase64 = req.file.buffer.toString('base64');

      // Save to Temporary Table — sanitize all values before storing
      const insertResult = await db.insert(tempReceipts).values({
        userId: userId,
        receiptNoteNo: sanitizeFieldValue('receiptNoteNo', extractedData.receiptNoteNo),
        receiptDate: sanitizeFieldValue('receiptDate', extractedData.receiptDate),
        supplierName: sanitizeFieldValue('supplierName', extractedData.supplierName),
        vendorCode: sanitizeFieldValue('vendorCode', extractedData.vendorCode),
        poNumber: sanitizeFieldValue('poNumber', extractedData.poNumber),
        depot: sanitizeFieldValue('depot', extractedData.depot),
        ward: sanitizeFieldValue('ward', extractedData.ward),
        roNumber: sanitizeFieldValue('roNumber', extractedData.roNumber),
        itemDescription: sanitizeFieldValue('itemDescription', extractedData.itemDescription),
        plNumber: sanitizeFieldValue('plNumber', extractedData.plNumber),
        quantity: sanitizeFieldValue('quantity', extractedData.quantity),
        value: sanitizeFieldValue('value', extractedData.value),
        acceptanceDate: sanitizeFieldValue('acceptanceDate', extractedData.acceptanceDate),
        warrantyDate: sanitizeFieldValue('warrantyDate', extractedData.warrantyDate),
        invoiceNumber: sanitizeFieldValue('invoiceNumber', extractedData.invoiceNumber),
        fileHash: fileHash,
        rawOcrText: rawText,
        pdfData: pdfBase64,
        // Lifecycle fields
        status: 'pending',
        isMinusReceipt: minusReceipt.isMinusReceipt ? 1 : 0,
        targetReceiptNoteNo: minusReceipt.targetReceiptNoteNo || null,
        qtyRejected: minusReceipt.qtyRejected || null,
        flags: JSON.stringify(flagsList),
        ocrConfidence: JSON.stringify(confidenceScores),
      }).returning();

      // Create history entry
      await db.insert(receiptHistory).values({
        receiptNoteNo: extractedData.receiptNoteNo || 'UNKNOWN',
        action: 'UPLOADED',
        details: JSON.stringify({
          tempId: insertResult[0].id,
          flags: flagsList,
          isMinusReceipt: minusReceipt.isMinusReceipt,
        }),
        performedBy: userId,
      });

      res.json({
        success: true,
        pendingRecord: insertResult[0],
        isDuplicate,
        confidence: confidenceScores,
        flags: flagsList,
        minusReceipt,
      });
    } catch (error: any) {
      console.error("PDF Extraction Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // ─── Get Pending Receipts (User-scoped) ───────────────────────────────

  app.get("/api/receipts/pending", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';
      const statusFilter = (req.query.status as string) || 'pending';

      const conditions = isAdmin
        ? eq(tempReceipts.status, statusFilter)
        : and(eq(tempReceipts.userId, userId), eq(tempReceipts.status, statusFilter));

      const pending = await db.select().from(tempReceipts)
        .where(conditions)
        .orderBy(desc(tempReceipts.createdAt));

      res.json(Array.isArray(pending) ? pending : []);
    } catch (error: any) {
      res.json([]);
    }
  });

  // ─── Approve Receipt ──────────────────────────────────────────────────

  // ─── Edit Tracking (save edits to temp record before approval) ────────

  app.put("/api/receipts/temp/:id/edit", requireAuth, async (req: AuthRequest, res) => {
    try {
      const tempId = parseInt(req.params.id);
      const userId = req.user!.id;
      const editedFieldValues = req.body;

      // Fetch original temp record
      const tempRecord = await db.select().from(tempReceipts).where(eq(tempReceipts.id, tempId));
      if (tempRecord.length === 0) {
        res.status(404).json({ error: "Record not found" });
        return;
      }

      const temp = tempRecord[0];
      const EDITABLE = [
        'receiptNoteNo', 'receiptDate', 'supplierName', 'vendorCode', 'poNumber',
        'depot', 'ward', 'roNumber', 'itemDescription', 'plNumber', 'quantity',
        'value', 'acceptanceDate', 'warrantyDate', 'invoiceNumber',
      ];

      // Detect which fields changed
      const changedFields: string[] = [];
      for (const field of EDITABLE) {
        const original = (temp as any)[field] || '';
        const edited = editedFieldValues[field] || '';
        if (original.trim() !== edited.trim()) {
          changedFields.push(field);
        }
      }

      // Merge with previously edited fields
      let existingEdited: string[] = [];
      try { existingEdited = JSON.parse(temp.editedFields || '[]'); } catch {}
      const allEdited = [...new Set([...existingEdited, ...changedFields])];

      const updateValues: any = {
        ...editedFieldValues,
        adjustmentCount: (temp.adjustmentCount || 0) + changedFields.length,
        editedFields: JSON.stringify(allEdited),
        editedBy: userId,
        editedAt: new Date(),
      };

      await db.update(tempReceipts).set(updateValues).where(eq(tempReceipts.id, tempId));

      res.json({ success: true, changedFields, totalEdits: allEdited.length });
    } catch (error: any) {
      console.error("Edit tracking error:", error);
      res.status(500).json({ error: "Failed to save edits" });
    }
  });

  // ─── Approve Receipt ──────────────────────────────────────────────────

  app.post("/api/receipts/approve/:tempId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const tempId = parseInt(req.params.tempId);
      const userId = req.user!.id;

      await db.transaction(async (tx) => {
        // Fetch temp record
        const tempRecord = await tx.select().from(tempReceipts).where(eq(tempReceipts.id, tempId));
        if (tempRecord.length === 0) {
          throw new Error("Pending record not found");
        }

        const temp = tempRecord[0];
        const fileHash = temp.fileHash;

        // Accept user-edited fields from body (these are the final truth)
        const fields = req.body;
        const appUrl = process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'http://localhost:3000';

        // --- Edit Detection: compare submitted fields to temp record ---
        const EDITABLE = [
          'receiptNoteNo', 'receiptDate', 'supplierName', 'vendorCode', 'poNumber',
          'depot', 'ward', 'roNumber', 'itemDescription', 'plNumber', 'quantity',
          'value', 'acceptanceDate', 'warrantyDate', 'invoiceNumber',
        ];
        const inlineEdits: string[] = [];
        for (const field of EDITABLE) {
          const original = (temp as any)[field] || '';
          const submitted = fields[field] || '';
          if (original.trim() !== submitted.trim()) {
            inlineEdits.push(field);
          }
        }

        // Merge with any pre-existing edits from the temp record
        let priorEdits: string[] = [];
        try { priorEdits = JSON.parse(temp.editedFields || '[]'); } catch {}
        const allEditedFields = [...new Set([...priorEdits, ...inlineEdits])];
        const totalAdjustmentCount = (temp.adjustmentCount || 0) + inlineEdits.length;

        // Determine verification status
        let verificationStatus = 'unverified';
        if (allEditedFields.length > 0) {
          verificationStatus = 'manually_verified';
        } else {
          // Check if all confidences are >= 0.8
          let allHighConf = true;
          try {
            const confMap = JSON.parse(temp.ocrConfidence || '{}');
            for (const key of EDITABLE) {
              if ((temp as any)[key] && confMap[key] !== undefined && confMap[key] < 0.8) {
                allHighConf = false;
                break;
              }
            }
          } catch { allHighConf = false; }
          verificationStatus = allHighConf ? 'auto_verified' : 'manually_verified';
        }

        // Determine initial balance from quantity
        const cleanQty = sanitizeFieldValue('quantity', fields.quantity);
        const initialBalance = cleanQty || '0';

        // Sanitize edited fields before saving to master
        const insertMasterResult = await tx.insert(masterReceipts).values({
          userId: userId,
          receiptNoteNo: sanitizeFieldValue('receiptNoteNo', fields.receiptNoteNo),
          receiptDate: sanitizeFieldValue('receiptDate', fields.receiptDate),
          supplierName: sanitizeFieldValue('supplierName', fields.supplierName),
          vendorCode: sanitizeFieldValue('vendorCode', fields.vendorCode),
          poNumber: sanitizeFieldValue('poNumber', fields.poNumber),
          depot: sanitizeFieldValue('depot', fields.depot),
          ward: sanitizeFieldValue('ward', fields.ward),
          roNumber: sanitizeFieldValue('roNumber', fields.roNumber),
          itemDescription: sanitizeFieldValue('itemDescription', fields.itemDescription),
          plNumber: sanitizeFieldValue('plNumber', fields.plNumber),
          quantity: sanitizeFieldValue('quantity', fields.quantity),
          value: sanitizeFieldValue('value', fields.value),
          acceptanceDate: sanitizeFieldValue('acceptanceDate', fields.acceptanceDate),
          warrantyDate: sanitizeFieldValue('warrantyDate', fields.warrantyDate),
          invoiceNumber: sanitizeFieldValue('invoiceNumber', fields.invoiceNumber),
          fileHash: fileHash,
          pdfData: temp.pdfData,
          // Balance tracking
          currentBalance: initialBalance,
          status: 'active',
          // Approval metadata
          approvedBy: userId,
          approvedAt: new Date(),
          // Edit tracking
          adjustmentCount: totalAdjustmentCount,
          editedFields: allEditedFields.length > 0 ? JSON.stringify(allEditedFields) : null,
          editedBy: allEditedFields.length > 0 ? userId : null,
          editedAt: allEditedFields.length > 0 ? new Date() : null,
          ocrConfidence: temp.ocrConfidence,
          verificationStatus,
        }).returning();

        const masterId = insertMasterResult[0].id;

        // QR payload: URL pointing to public receipt page
        const qrPayload = `${appUrl}/r/${masterId}`;
        await tx.update(masterReceipts).set({ qrCodeData: qrPayload }).where(eq(masterReceipts.id, masterId));

        // Update legacy Balance table
        const cleanPl = sanitizeFieldValue('plNumber', fields.plNumber);
        if (cleanPl && cleanQty) {
          await tx.insert(balances).values({
            plNumber: cleanPl,
            quantity: cleanQty,
          }).onConflictDoUpdate({
            target: balances.plNumber,
            set: {
              quantity: sql`balances.quantity + ${cleanQty}`,
              lastUpdated: sql`now()`,
            }
          });
        }

        // Create Transaction Log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'APPROVED_RECEIPT',
          details: `Approved Receipt ${fields.receiptNoteNo || ''} (Master ID: ${masterId})${allEditedFields.length > 0 ? ` [${allEditedFields.length} fields edited]` : ''}`
        });

        // Create Receipt History
        await tx.insert(receiptHistory).values({
          receiptNoteNo: fields.receiptNoteNo || 'UNKNOWN',
          masterReceiptId: masterId,
          action: 'APPROVED',
          details: JSON.stringify({
            masterId,
            approvedBy: userId,
            initialBalance,
            editedFields: allEditedFields,
            adjustmentCount: totalAdjustmentCount,
            verificationStatus,
          }),
          performedBy: userId,
        });

        // Remove from Temp Table
        await tx.delete(tempReceipts).where(eq(tempReceipts.id, tempId));

        // Generate QR image for response
        const qrImageDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 2 });

        res.json({ success: true, masterId, qrData: qrImageDataUrl, qrUrl: qrPayload });
      });
    } catch (error: any) {
      console.error("Approval error:", error);
      next(error);
    }
  });

  // ─── Reject Receipt ───────────────────────────────────────────────────

  app.post("/api/receipts/reject/:tempId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const tempId = parseInt(req.params.tempId);
      const userId = req.user!.id;
      const { rejectionReason } = req.body;

      if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
        res.status(400).json({ error: "Rejection reason is required" });
        return;
      }

      await db.transaction(async (tx) => {
        // Fetch temp record
        const tempRecord = await tx.select().from(tempReceipts).where(eq(tempReceipts.id, tempId));
        if (tempRecord.length === 0) {
          throw new Error("Pending record not found");
        }

        const temp = tempRecord[0];

        // Update temp receipt status
        await tx.update(tempReceipts).set({
          status: 'rejected',
          rejectionReason: rejectionReason.trim(),
          rejectedBy: userId,
          rejectedAt: new Date(),
        }).where(eq(tempReceipts.id, tempId));

        // Create history entry
        await tx.insert(receiptHistory).values({
          receiptNoteNo: temp.receiptNoteNo || 'UNKNOWN',
          action: 'REJECTED',
          details: JSON.stringify({
            tempId,
            reason: rejectionReason.trim(),
            rejectedBy: userId,
          }),
          performedBy: userId,
        });

        // Create transaction log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'REJECTED_RECEIPT',
          details: `Rejected Receipt ${temp.receiptNoteNo || ''} (Temp ID: ${tempId}). Reason: ${rejectionReason.trim()}`
        });
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Rejection error:", error);
      res.status(500).json({ error: error.message || "Failed to reject receipt" });
    }
  });

  // ─── Process Minus Receipt ────────────────────────────────────────────

  app.post("/api/receipts/process-minus/:tempId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const tempId = parseInt(req.params.tempId);
      const userId = req.user!.id;
      const { targetReceiptNoteNo, qtyRejected } = req.body;

      if (!targetReceiptNoteNo || !qtyRejected) {
        res.status(400).json({ error: "Target R/Note No and Qty Rejected are required" });
        return;
      }

      const qtyToDeduct = parseFloat(qtyRejected);
      if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
        res.status(400).json({ error: "Qty Rejected must be a positive number" });
        return;
      }

      await db.transaction(async (tx) => {
        // Fetch temp record
        const tempRecord = await tx.select().from(tempReceipts).where(eq(tempReceipts.id, tempId));
        if (tempRecord.length === 0) {
          throw new Error("Pending record not found");
        }
        const temp = tempRecord[0];

        // Find target master receipt (SELECT FOR UPDATE equivalent)
        const targetRecords = await tx.select().from(masterReceipts)
          .where(eq(masterReceipts.receiptNoteNo, targetReceiptNoteNo));

        if (targetRecords.length === 0) {
          throw new Error(`No approved receipt found with R/Note No: ${targetReceiptNoteNo}`);
        }

        const target = targetRecords[0];
        const currentBalance = parseFloat(target.currentBalance || '0');

        if (qtyToDeduct > currentBalance) {
          throw new Error(`Cannot deduct ${qtyToDeduct} from current balance of ${currentBalance}`);
        }

        const newBalance = currentBalance - qtyToDeduct;
        const isExhausted = newBalance <= 0;

        // Update master receipt balance
        await tx.update(masterReceipts).set({
          currentBalance: String(newBalance),
          status: isExhausted ? 'exhausted' : 'active',
        }).where(eq(masterReceipts.id, target.id));

        // Create adjustment record
        await tx.insert(receiptAdjustments).values({
          masterReceiptId: target.id,
          receiptNoteNo: targetReceiptNoteNo,
          minusReceiptNoteNo: temp.receiptNoteNo || `MINUS-${tempId}`,
          qtyDeducted: String(qtyToDeduct),
          balanceBefore: String(currentBalance),
          balanceAfter: String(newBalance),
          adjustedBy: userId,
          sourceTempId: tempId,
        });

        // History: Balance deducted
        await tx.insert(receiptHistory).values({
          receiptNoteNo: targetReceiptNoteNo,
          masterReceiptId: target.id,
          action: 'BALANCE_DEDUCTED',
          details: JSON.stringify({
            qtyDeducted: qtyToDeduct,
            balanceBefore: currentBalance,
            balanceAfter: newBalance,
            minusReceiptNoteNo: temp.receiptNoteNo,
            sourceTempId: tempId,
          }),
          performedBy: userId,
        });

        // If exhausted, add additional history entries
        if (isExhausted) {
          await tx.insert(receiptHistory).values({
            receiptNoteNo: targetReceiptNoteNo,
            masterReceiptId: target.id,
            action: 'RECEIPT_EXHAUSTED',
            details: JSON.stringify({ finalBalance: newBalance }),
            performedBy: userId,
          });

          await tx.insert(receiptHistory).values({
            receiptNoteNo: targetReceiptNoteNo,
            masterReceiptId: target.id,
            action: 'QR_DISABLED',
            details: JSON.stringify({ reason: 'Balance reached zero' }),
            performedBy: userId,
          });
        }

        // Transaction log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'PROCESSED_MINUS_RECEIPT',
          details: `Minus receipt for ${targetReceiptNoteNo}: deducted ${qtyToDeduct}, balance ${currentBalance} → ${newBalance}`
        });

        // Delete the temp record (processed)
        await tx.delete(tempReceipts).where(eq(tempReceipts.id, tempId));

        res.json({
          success: true,
          targetReceiptNoteNo,
          qtyDeducted: qtyToDeduct,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          isExhausted,
        });
      });
    } catch (error: any) {
      console.error("Minus receipt processing error:", error);
      res.status(500).json({ error: error.message || "Failed to process minus receipt" });
    }
  });

  // ─── Get Approved Receipts (User-scoped) ──────────────────────────────

  app.get("/api/receipts/approved", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';
      const conditions = isAdmin ? undefined : eq(masterReceipts.userId, userId);
      const records = await db.select().from(masterReceipts).where(conditions).orderBy(desc(masterReceipts.createdAt));
      res.json(Array.isArray(records) ? records : []);
    } catch (error: any) {
      res.json([]);
    }
  });

  // ─── Public Receipt Page (No auth) ────────────────────────────────────

  app.get("/api/receipts/public/:id", async (req, res) => {
    try {
      const record = await db.select().from(masterReceipts).where(eq(masterReceipts.id, parseInt(req.params.id)));
      if (record.length === 0) {
         res.status(404).json({ error: "Receipt not found" });
         return;
      }
      // Return public-safe fields (no raw OCR text, no file hash, no PDF data)
      const r = record[0];
      const isExhausted = r.status === 'exhausted' || parseFloat(r.currentBalance || '0') <= 0;

      res.json({
        id: r.id,
        receiptNoteNo: r.receiptNoteNo,
        receiptDate: r.receiptDate,
        supplierName: r.supplierName,
        vendorCode: r.vendorCode,
        poNumber: r.poNumber,
        depot: r.depot,
        ward: r.ward,
        roNumber: r.roNumber,
        itemDescription: r.itemDescription,
        plNumber: r.plNumber,
        quantity: r.quantity,
        value: r.value,
        acceptanceDate: r.acceptanceDate,
        warrantyDate: r.warrantyDate,
        invoiceNumber: r.invoiceNumber,
        qrCodeData: r.qrCodeData,
        createdAt: r.createdAt,
        // Lifecycle fields
        currentBalance: r.currentBalance,
        status: r.status,
        isExhausted,
        approvedAt: r.approvedAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load receipt" });
    }
  });

  // ─── Get Record Detail (Authed) ───────────────────────────────────────

  app.get("/api/receipts/master/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const record = await db.select().from(masterReceipts).where(eq(masterReceipts.id, parseInt(req.params.id)));
      if (record.length === 0) {
         res.status(404).json({ error: "Record not found" });
         return;
      }
      res.json(record[0]);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load record" });
    }
  });

  // ─── Download PDF (Mobile Compatible) ─────────────────────────────────

  app.get("/api/receipts/master/:id/pdf", async (req, res) => {
    try {
      const record = await db.select().from(masterReceipts).where(eq(masterReceipts.id, parseInt(req.params.id)));
      if (record.length === 0 || !record[0].pdfData) {
         res.status(404).json({ error: "PDF not found" });
         return;
      }
      
      const pdfBuffer = Buffer.from(record[0].pdfData, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Receipt_${record[0].receiptNoteNo || record[0].id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to download PDF" });
    }
  });

  // ─── Receipt History ──────────────────────────────────────────────────

  app.get("/api/receipts/history/:receiptNoteNo", requireAuth, async (req: AuthRequest, res) => {
    try {
      const receiptNoteNo = req.params.receiptNoteNo;
      const history = await db.select().from(receiptHistory)
        .where(eq(receiptHistory.receiptNoteNo, receiptNoteNo))
        .orderBy(desc(receiptHistory.createdAt));

      res.json(Array.isArray(history) ? history : []);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load receipt history" });
    }
  });

  app.get("/api/receipts/history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const history = await db.select().from(receiptHistory)
        .orderBy(desc(receiptHistory.createdAt))
        .limit(100);
      res.json(Array.isArray(history) ? history : []);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load receipt history" });
    }
  });

  // ─── Receipt Adjustments ──────────────────────────────────────────────

  app.get("/api/receipts/adjustments/:receiptNoteNo", requireAuth, async (req: AuthRequest, res) => {
    try {
      const receiptNoteNo = req.params.receiptNoteNo;
      const adjustments = await db.select().from(receiptAdjustments)
        .where(eq(receiptAdjustments.receiptNoteNo, receiptNoteNo))
        .orderBy(desc(receiptAdjustments.createdAt));

      res.json(Array.isArray(adjustments) ? adjustments : []);
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load adjustments" });
    }
  });

  // ─── Delete Temp Record ───────────────────────────────────────────────

  app.delete("/api/receipts/temp/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
        await db.delete(tempReceipts).where(eq(tempReceipts.id, parseInt(req.params.id)));
        res.json({ success: true });
    } catch (error: any) {
       res.status(500).json({ error: "Failed to delete record" });
    }
  });

  // ─── Delete Pending Temp Records (Bulk) ────────────────────────────────

  app.post("/api/receipts/temp/bulk-delete", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "No records specified" });
        return;
      }

      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';

      let deletedCount = 0;

      await db.transaction(async (tx) => {
        const records = await tx.select().from(tempReceipts).where(inArray(tempReceipts.id, ids));

        if (records.length === 0) {
          throw new Error("No records found");
        }

        if (!isAdmin) {
          if (records.some(r => r.userId !== userId)) {
            throw new Error("Unauthorized: some records do not belong to you");
          }
        }

        // Collect receiptNoteNos for history cleanup
        const receiptNoteNos = records
          .map(r => r.receiptNoteNo)
          .filter(Boolean) as string[];

        // Delete associated history entries
        if (receiptNoteNos.length > 0) {
          await tx.delete(receiptHistory).where(inArray(receiptHistory.receiptNoteNo, receiptNoteNos));
        }

        // Delete the temp records
        await tx.delete(tempReceipts).where(inArray(tempReceipts.id, ids));

        deletedCount = records.length;

        // Audit log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'BULK_DELETE_PENDING',
          details: `Bulk deleted ${deletedCount} pending record(s): [${ids.join(', ')}]`,
        });
      });

      res.json({ success: true, deletedCount });
    } catch (error: any) {
      console.error("Bulk delete pending error:", error);
      res.status(500).json({ error: error.message || "Failed to delete pending records" });
    }
  });

  // ─── Delete Master Record (Single) ────────────────────────────────────

  app.delete("/api/receipts/master/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const targetId = parseInt(req.params.id);
      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';

      await db.transaction(async (tx) => {
        // Fetch record to verify ownership and get receiptNoteNo
        const record = await tx.select().from(masterReceipts).where(eq(masterReceipts.id, targetId));
        if (record.length === 0) {
          throw new Error("Record not found");
        }

        if (!isAdmin && record[0].userId !== userId) {
          throw new Error("Unauthorized");
        }

        const receiptNoteNo = record[0].receiptNoteNo;

        // Delete child records first to satisfy foreign key constraints
        await tx.delete(receiptHistory).where(eq(receiptHistory.masterReceiptId, targetId));

        // Also delete orphan history entries linked by receiptNoteNo
        if (receiptNoteNo) {
          await tx.delete(receiptHistory).where(eq(receiptHistory.receiptNoteNo, receiptNoteNo));
        }

        await tx.delete(receiptAdjustments).where(eq(receiptAdjustments.masterReceiptId, targetId));

        // Delete from masterReceipts (QR data is deleted along with row)
        await tx.delete(masterReceipts).where(eq(masterReceipts.id, targetId));

        // Audit log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'DELETE_APPROVED',
          details: `Deleted approved receipt ${receiptNoteNo || ''} (Master ID: ${targetId})`,
        });
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Single delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete record" });
    }
  });

  // ─── Delete Master Records (Bulk) ─────────────────────────────────────

  app.post("/api/receipts/master/bulk-delete", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "No records specified" });
        return;
      }

      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';

      let deletedCount = 0;

      await db.transaction(async (tx) => {
        // Fetch records to verify ownership and get receiptNoteNos for history cleanup
        const records = await tx.select().from(masterReceipts).where(inArray(masterReceipts.id, ids));

        if (records.length === 0) {
          throw new Error("No records found");
        }

        if (!isAdmin) {
          if (records.length !== ids.length || records.some(r => r.userId !== userId)) {
            throw new Error("Unauthorized or some records not found");
          }
        }

        // Collect receiptNoteNos for thorough history cleanup
        const receiptNoteNos = records
          .map(r => r.receiptNoteNo)
          .filter(Boolean) as string[];

        // Delete child records first to satisfy foreign key constraints
        // Delete history by masterReceiptId (FK-linked)
        await tx.delete(receiptHistory).where(inArray(receiptHistory.masterReceiptId, ids));

        // Also delete orphan history entries linked only by receiptNoteNo (e.g. UPLOADED entries)
        if (receiptNoteNos.length > 0) {
          await tx.delete(receiptHistory).where(inArray(receiptHistory.receiptNoteNo, receiptNoteNos));
        }

        // Delete adjustments
        await tx.delete(receiptAdjustments).where(inArray(receiptAdjustments.masterReceiptId, ids));

        // Delete the master records themselves
        await tx.delete(masterReceipts).where(inArray(masterReceipts.id, ids));

        deletedCount = records.length;

        // Audit log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'BULK_DELETE_APPROVED',
          details: `Bulk deleted ${deletedCount} approved receipt(s): [${ids.join(', ')}]`,
        });
      });

      res.json({ success: true, deletedCount });
    } catch (error: any) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete records" });
    }
  });

  // ─── Delete Rejected Records (Bulk) ───────────────────────────────────

  app.post("/api/receipts/rejected/bulk-delete", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "No records specified" });
        return;
      }

      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';

      let deletedCount = 0;

      await db.transaction(async (tx) => {
        // Fetch records to verify ownership and status
        const records = await tx.select().from(tempReceipts).where(inArray(tempReceipts.id, ids));

        if (records.length === 0) {
          throw new Error("No records found");
        }

        // Verify all are rejected
        const nonRejected = records.filter(r => r.status !== 'rejected');
        if (nonRejected.length > 0) {
          throw new Error("Some records are not in rejected status");
        }

        if (!isAdmin) {
          if (records.some(r => r.userId !== userId)) {
            throw new Error("Unauthorized: some records do not belong to you");
          }
        }

        // Collect receiptNoteNos for history cleanup
        const receiptNoteNos = records
          .map(r => r.receiptNoteNo)
          .filter(Boolean) as string[];

        // Delete associated history entries (linked by receiptNoteNo, no FK on temp)
        if (receiptNoteNos.length > 0) {
          await tx.delete(receiptHistory).where(inArray(receiptHistory.receiptNoteNo, receiptNoteNos));
        }

        // Delete the rejected temp records
        await tx.delete(tempReceipts).where(inArray(tempReceipts.id, ids));

        deletedCount = records.length;

        // Audit log
        await tx.insert(transactionLogs).values({
          userId: userId,
          action: 'BULK_DELETE_REJECTED',
          details: `Bulk deleted ${deletedCount} rejected record(s): [${ids.join(', ')}]`,
        });
      });

      res.json({ success: true, deletedCount });
    } catch (error: any) {
      console.error("Bulk delete rejected error:", error);
      res.status(500).json({ error: error.message || "Failed to delete rejected records" });
    }
  });

  app.post("/api/receipts/master/:id/log-download", async (req: AuthRequest, res) => {
    try {
      const record = await db.select().from(masterReceipts).where(eq(masterReceipts.id, parseInt(req.params.id)));
      if (record.length > 0) {
        // If not logged in, we use the record's owner as fallback since the history table requires a user ID
        const userId = req.user?.id || record[0].userId;
        await db.insert(receiptHistory).values({
          receiptNoteNo: record[0].receiptNoteNo || `REC-${record[0].id}`,
          masterReceiptId: record[0].id,
          action: 'DOWNLOAD_PDF',
          details: 'Downloaded PDF',
          performedBy: userId
        });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to log download" });
    }
  });

  // ─── Dashboard Stats (User-scoped) ────────────────────────────────────

  app.get("/api/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const isAdmin = req.user!.username === 'admin';

      let tempCount, masterCount, rejectedCount, exhaustedCount, minusAdjustmentCount, manualEditCount, downloadCountResult;

      // For exhaustion, check either status = 'exhausted' or currentBalance <= 0.
      // currentBalance is stored as text/decimal. Using sql to cast it.
      const isExhaustedCond = or(
        eq(masterReceipts.status, 'exhausted'),
        lte(sql<number>`CAST(${masterReceipts.currentBalance} AS FLOAT)`, 0)
      );

      if (isAdmin) {
        tempCount = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(eq(tempReceipts.status, 'pending'));
        masterCount = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts);
        rejectedCount = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(eq(tempReceipts.status, 'rejected'));
        exhaustedCount = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(isExhaustedCond);
        minusAdjustmentCount = await db.select({ count: sql<number>`count(*)` }).from(receiptAdjustments);
        manualEditCount = await db.select({ count: sql<number>`COALESCE(SUM(adjustment_count), 0)` }).from(masterReceipts);
        downloadCountResult = await db.select({ count: sql<number>`count(*)` }).from(receiptHistory).where(inArray(receiptHistory.action, ['DOWNLOAD_PDF', 'DOWNLOADED_PDF']));
      } else {
        tempCount = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(and(eq(tempReceipts.userId, userId), eq(tempReceipts.status, 'pending')));
        masterCount = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(eq(masterReceipts.userId, userId));
        rejectedCount = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(and(eq(tempReceipts.userId, userId), eq(tempReceipts.status, 'rejected')));
        exhaustedCount = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(and(eq(masterReceipts.userId, userId), isExhaustedCond));
        minusAdjustmentCount = await db.select({ count: sql<number>`count(*)` }).from(receiptAdjustments).where(eq(receiptAdjustments.adjustedBy, userId));
        manualEditCount = await db.select({ count: sql<number>`COALESCE(SUM(adjustment_count), 0)` }).from(masterReceipts).where(eq(masterReceipts.userId, userId));
        // Join with masterReceipts to only count downloads for this user's receipts
        downloadCountResult = await db.select({ count: sql<number>`count(*)` })
          .from(receiptHistory)
          .innerJoin(masterReceipts, eq(receiptHistory.masterReceiptId, masterReceipts.id))
          .where(
            and(
              eq(masterReceipts.userId, userId),
              inArray(receiptHistory.action, ['DOWNLOAD_PDF', 'DOWNLOADED_PDF'])
            )
          );
      }
      
      const pending = Number(tempCount[0].count);
      const approved = Number(masterCount[0].count);
      const rejected = Number(rejectedCount[0].count);
      const exhausted = Number(exhaustedCount[0].count);
      const adjustments = Number(minusAdjustmentCount[0].count) + Number(manualEditCount[0].count);
      const downloaded = downloadCountResult ? Number(downloadCountResult[0].count) : 0;
      const totalUploaded = pending + approved + rejected;
      const totalQrGenerated = approved;

      res.json({ totalUploaded, pending, approved, rejected, exhausted, adjustments, downloaded, totalQrGenerated });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load stats" });
    }
  });

  // ─── Admin Panel Routes ───────────────────────────────────────────────

  app.get("/api/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || "";
      const offset = (page - 1) * limit;

      let conditions = undefined;
      if (search) {
        conditions = or(
          like(users.username, `%${search}%`),
          like(users.email, `%${search}%`),
          like(users.fullName, `%${search}%`)
        );
      }

      const usersList = await db.select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        email: users.email,
        createdAt: users.createdAt,
        lastLogin: users.lastLogin,
        isActive: users.isActive
      }).from(users).where(conditions).limit(limit).offset(offset).orderBy(desc(users.createdAt));

      const totalResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(conditions);
      const total = Number(totalResult[0].count);

      res.json({ users: usersList, total, page, limit });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // ─── Admin Monitoring Stats ───────────────────────────────────────────

  app.get("/api/admin/monitoring", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const totalUsers = await db.select({ count: sql<number>`count(*)` }).from(users);
      const activeUsers = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isActive, 1));
      const totalUploads = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts);
      const pendingUploads = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(eq(tempReceipts.status, 'pending'));
      const rejectedUploads = await db.select({ count: sql<number>`count(*)` }).from(tempReceipts).where(eq(tempReceipts.status, 'rejected'));
      const totalApproved = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts);
      const activeReceipts = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(eq(masterReceipts.status, 'active'));
      const exhaustedReceipts = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(eq(masterReceipts.status, 'exhausted'));
      const totalAdjustments = await db.select({ count: sql<number>`count(*)` }).from(receiptAdjustments);

      // Recent history entries
      const recentHistory = await db.select().from(receiptHistory)
        .orderBy(desc(receiptHistory.createdAt))
        .limit(20);

      res.json({
        users: {
          total: Number(totalUsers[0].count),
          active: Number(activeUsers[0].count),
        },
        uploads: {
          total: Number(totalUploads[0].count),
          pending: Number(pendingUploads[0].count),
          rejected: Number(rejectedUploads[0].count),
        },
        receipts: {
          total: Number(totalApproved[0].count),
          active: Number(activeReceipts[0].count),
          exhausted: Number(exhaustedReceipts[0].count),
        },
        adjustments: Number(totalAdjustments[0].count),
        recentHistory,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to load monitoring data" });
    }
  });

  app.put("/api/admin/users/:id/status", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const targetId = parseInt(req.params.id);
      const { isActive } = req.body;
      if (targetId === req.user?.id) {
         res.status(400).json({ error: "Cannot modify your own admin account status" });
         return;
      }
      await db.update(users).set({ isActive: isActive ? 1 : 0 }).where(eq(users.id, targetId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update user status" });
    }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const targetId = parseInt(req.params.id);
      if (targetId === req.user?.id) {
         res.status(400).json({ error: "Cannot delete your own admin account" });
         return;
      }
      
      // Cascade: delete all related data then the user
      await db.delete(transactionLogs).where(eq(transactionLogs.userId, targetId));
      await db.delete(tempReceipts).where(eq(tempReceipts.userId, targetId));
      await db.delete(masterReceipts).where(eq(masterReceipts.userId, targetId));
      await db.delete(users).where(eq(users.id, targetId));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const targetId = parseInt(req.params.id);
      const { fullName, email, username } = req.body;
      await db.update(users).set({ fullName, email, username }).where(eq(users.id, targetId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to update user details" });
    }
  });

  // ─── Admin Audit Trail ────────────────────────────────────────────────

  app.get("/api/admin/audit", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = (req.query.search as string) || '';
      const offset = (page - 1) * limit;

      // Build audit data from master_receipts with user info
      let conditions = undefined;
      if (search) {
        conditions = or(
          like(masterReceipts.receiptNoteNo, `%${search}%`),
          like(masterReceipts.supplierName, `%${search}%`),
          like(masterReceipts.invoiceNumber, `%${search}%`)
        );
      }

      const records = await db.select({
        id: masterReceipts.id,
        receiptNoteNo: masterReceipts.receiptNoteNo,
        supplierName: masterReceipts.supplierName,
        invoiceNumber: masterReceipts.invoiceNumber,
        userId: masterReceipts.userId,
        approvedBy: masterReceipts.approvedBy,
        approvedAt: masterReceipts.approvedAt,
        adjustmentCount: masterReceipts.adjustmentCount,
        editedFields: masterReceipts.editedFields,
        editedBy: masterReceipts.editedBy,
        editedAt: masterReceipts.editedAt,
        verificationStatus: masterReceipts.verificationStatus,
        ocrConfidence: masterReceipts.ocrConfidence,
        status: masterReceipts.status,
        currentBalance: masterReceipts.currentBalance,
        quantity: masterReceipts.quantity,
        value: masterReceipts.value,
        createdAt: masterReceipts.createdAt,
      }).from(masterReceipts)
        .where(conditions)
        .orderBy(desc(masterReceipts.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db.select({ count: sql<number>`count(*)` }).from(masterReceipts).where(conditions);
      const total = Number(totalResult[0].count);

      // Enrich with user names
      const userIds = new Set<number>();
      for (const r of records) {
        if (r.userId) userIds.add(r.userId);
        if (r.approvedBy) userIds.add(r.approvedBy);
        if (r.editedBy) userIds.add(r.editedBy);
      }

      const userMap: Record<number, string> = {};
      if (userIds.size > 0) {
        const userList = await db.select({ id: users.id, fullName: users.fullName, username: users.username })
          .from(users)
          .where(inArray(users.id, Array.from(userIds)));
        for (const u of userList) {
          userMap[u.id] = u.fullName || u.username;
        }
      }

      // Fetch history entries for these receipts
      const receiptNoteNos = records.map(r => r.receiptNoteNo).filter(Boolean) as string[];
      let historyMap: Record<string, any[]> = {};
      if (receiptNoteNos.length > 0) {
        const history = await db.select().from(receiptHistory)
          .where(inArray(receiptHistory.receiptNoteNo, receiptNoteNos))
          .orderBy(desc(receiptHistory.createdAt));
        for (const h of history) {
          if (!historyMap[h.receiptNoteNo]) historyMap[h.receiptNoteNo] = [];
          historyMap[h.receiptNoteNo].push({
            ...h,
            performedByName: userMap[h.performedBy] || `User #${h.performedBy}`,
          });
        }
      }

      const auditRecords = records.map(r => ({
        ...r,
        uploaderName: userMap[r.userId] || `User #${r.userId}`,
        approvedByName: r.approvedBy ? (userMap[r.approvedBy] || `User #${r.approvedBy}`) : null,
        editedByName: r.editedBy ? (userMap[r.editedBy] || `User #${r.editedBy}`) : null,
        history: historyMap[r.receiptNoteNo || ''] || [],
      }));

      res.json({ records: auditRecords, total, page, limit });
    } catch (error: any) {
      console.error("Audit trail error:", error);
      res.status(500).json({ error: "Failed to load audit trail" });
    }
  });
  // ─── Django Captcha Proxy Endpoints ──────────────────────────────────

  app.get("/api/captcha/health", async (req, res) => {
    try {
      const djangoRes = await fetch("http://127.0.0.1:8000/api/captcha/health");
      const data = await djangoRes.json() as any;
      res.json(data);
    } catch (error) {
      console.error("Captcha health proxy error:", error);
      res.status(500).json({ error: "CAPTCHA service is unreachable." });
    }
  });

  app.get("/api/captcha/generate", async (req, res) => {
    try {
      const djangoRes = await fetch("http://127.0.0.1:8000/api/captcha/generate");
      if (!djangoRes.ok) throw new Error(`Django returned ${djangoRes.status}`);
      const data = await djangoRes.json() as any;
      
      // Rewrite Django's absolute image URL to be relative to this Express server
      if (data.captcha_image) {
        data.captcha_image = data.captcha_image.replace("http://127.0.0.1:8000", "");
      }
      res.json(data);
    } catch (error) {
      console.error("Captcha generate proxy error:", error);
      res.status(500).json({ error: "CAPTCHA server unavailable. Received HTML instead of JSON." });
    }
  });

  app.post("/api/captcha/validate", async (req, res) => {
    try {
      const djangoRes = await fetch("http://127.0.0.1:8000/api/captcha/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await djangoRes.json() as any;
      res.json(data);
    } catch (error) {
      console.error("Captcha validate proxy error:", error);
      res.status(500).json({ error: "CAPTCHA validation server unavailable." });
    }
  });

  // Proxy the captcha image stream
  app.get("/captcha/image/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const djangoRes = await fetch(`http://127.0.0.1:8000/captcha/image/${key}/`);
      
      if (!djangoRes.ok) {
        res.status(djangoRes.status).send("Failed to load captcha image");
        return;
      }
      
      const contentType = djangoRes.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }
      
      const buffer = await djangoRes.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Captcha image proxy error:", error);
      res.status(500).send("Captcha image service unavailable");
    }
  });

  // ─── Global Error Handler ─────────────────────────────────────────────

  app.use("/api", (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Global Error Handler]", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  // ─── Vite / Static ────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
