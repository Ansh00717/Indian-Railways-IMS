/**
 * ==========================================================================
 * RDSO Railway Receipt — Production OCR Pipeline v2
 * ==========================================================================
 *
 * Architecture:
 *   0. PyMuPDF Extraction   — primary digital text extractor (subprocess)
 *   1. OCR Extraction       — pdf-parse fallback (digital) → Poppler+Tesseract (scanned)
 *   1.5 Confidence Assessment — keyword density check; merge digital+OCR if needed
 *   2. Text Normalization   — strip control chars, fix encoding, collapse noise
 *   3. Railway Preprocessing — domain-specific cleanup for Indian Railway forms
 *   4. Gemini Structured Extraction — AI-first with strict JSON schema
 *   5. Dedicated Field Extractors   — per-field regex as last-resort fallback
 *   5.5 Cross-Validation    — compare Gemini vs regex, boost agreement confidence
 *   6. Format Validation    — reject values that don't match expected patterns
 *   7. Confidence Scoring   — per-field confidence, reject below threshold
 *   8. Field Sanitation     — final cleanup, OCR artifact removal
 *   9. Database-Safe Output — guaranteed shape, all strings, safe for INSERT
 *
 * Design Principles:
 *   - Never populate a field with uncertain OCR fragments
 *   - If confidence < threshold → empty string
 *   - Regex is ONLY used when Gemini is unavailable
 *   - Every extractor returns { value, confidence }
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { GoogleGenAI } from '@google/genai';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ==========================================================================
// Types
// ==========================================================================

/** Core 15 receipt fields that have dedicated DB columns. */
export const CORE_FIELDS = [
  'receiptNoteNo', 'receiptDate', 'supplierName', 'vendorCode', 'poNumber',
  'depot', 'ward', 'roNumber', 'itemDescription', 'plNumber', 'quantity',
  'value', 'acceptanceDate', 'warrantyDate', 'invoiceNumber',
] as const;

/** Extended fields stored in the extendedFields JSON blob. */
export const EXTENDED_FIELDS = [
  'poAtNumber', 'poDate', 'poSrNo', 'allocation', 'roDate',
  'rnQuantity', 'roQuantity', 'rate', 'termsOfDelivery', 'consignee',
  'poQuantity', 'balancePoQuantity', 'gateChallanRegistration',
  'inspectionDetails', 'payingAuthority', 'drrNumber', 'islNumber',
  'dueDate', 'actualSupplyDate', 'manufacturingDate', 'batchNumber',
  'challanInvoiceNumber', 'freight', 'wharfageDemurrage', 'packing',
  'forwarding', 'exciseDuty', 'gst', 'remarks', 'supplierGstin',
] as const;

/** ALL fields — core + extended — used throughout the pipeline. */
export const ALL_FIELDS = [...CORE_FIELDS, ...EXTENDED_FIELDS] as const;

/** Backward-compatible alias: the 15 core fields. */
export const RECEIPT_FIELDS = CORE_FIELDS;

export type CoreFieldKey = (typeof CORE_FIELDS)[number];
export type ExtendedFieldKey = (typeof EXTENDED_FIELDS)[number];
export type AllFieldKey = CoreFieldKey | ExtendedFieldKey;
/** Backward-compatible alias. */
export type ReceiptFieldKey = CoreFieldKey;

/** A single extracted field with its confidence score. */
export interface FieldResult {
  value: string;
  confidence: number;
}

/** All fields (core + extended) with confidence metadata. */
export type FullExtractionResult = Record<AllFieldKey, FieldResult>;
/** Backward-compatible alias for core-only results. */
export type ReceiptExtractionResult = Record<AllFieldKey, FieldResult>;

/** Flat record for database insertion (all strings). */
export type ReceiptData = Record<AllFieldKey, string>;

/** Human-readable labels for display. */
export const FIELD_LABELS: Record<AllFieldKey, string> = {
  // Core fields
  receiptNoteNo: 'Receipt Note No',
  receiptDate: 'Receipt Date',
  supplierName: 'Supplier Name',
  vendorCode: 'Vendor Code',
  poNumber: 'PO Number',
  depot: 'Depot',
  ward: 'Ward',
  roNumber: 'RO Number',
  itemDescription: 'Item Description',
  plNumber: 'PL Number',
  quantity: 'Quantity',
  value: 'Value (₹)',
  acceptanceDate: 'Acceptance Date',
  warrantyDate: 'Warranty Date',
  invoiceNumber: 'Invoice Number',
  // Extended fields
  poAtNumber: 'PO/AT Number',
  poDate: 'PO Date',
  poSrNo: 'PO Sr No',
  allocation: 'Allocation',
  roDate: 'RO Date',
  rnQuantity: 'RN Quantity',
  roQuantity: 'RO Quantity',
  rate: 'Rate',
  termsOfDelivery: 'Terms of Delivery',
  consignee: 'Consignee',
  poQuantity: 'PO Quantity',
  balancePoQuantity: 'Balance PO Qty',
  gateChallanRegistration: 'Gate/Challan Reg. No',
  inspectionDetails: 'Inspection Details',
  payingAuthority: 'Paying Authority',
  drrNumber: 'DRR Number',
  islNumber: 'ISL Number',
  dueDate: 'Due Date',
  actualSupplyDate: 'Actual Supply Date',
  manufacturingDate: 'Manufacturing Date',
  batchNumber: 'Batch Number',
  challanInvoiceNumber: 'Challan Invoice No',
  freight: 'Freight',
  wharfageDemurrage: 'Wharfage/Demurrage',
  packing: 'Packing',
  forwarding: 'Forwarding',
  exciseDuty: 'Excise Duty',
  gst: 'GST',
  remarks: 'Remarks',
  supplierGstin: 'Supplier GSTIN',
};

// ==========================================================================
// Configuration
// ==========================================================================

const TESSERACT_PATH = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const POPPLER_BIN_PATH = 'C:\\poppler-26.02.0\\Library\\bin';
const PDFTOPPM_PATH = path.join(POPPLER_BIN_PATH, 'pdftoppm.exe');

/** Minimum confidence (0–1) for a field to be kept. Below → empty string. */
const CONFIDENCE_THRESHOLD = 0.40;

/** Keywords expected in a Railway Receipt PDF. Used for confidence assessment. */
const RECEIPT_KEYWORDS = [
  'receipt', 'note', 'supplier', 'vendor', 'po no', 'p.o', 'depot', 'ward',
  'quantity', 'qty', 'value', 'acceptance', 'warranty', 'invoice', 'challan',
  'stores', 'r/note', 'pl no', 'p.l', 'description', 'rdso', 'release order',
  'r.o', 'ro no', 'allocation', 'indian railways', 'r/note no', 'receipt note',
  'po/rdso', 'ro/rdso', 'manak nagar', 'signal', 'telecom', 'mechanical',
  'acceptance date', 'warranty date', 'po number', 'ro number',
];

// ==========================================================================
// Stage 0 — PyMuPDF Extraction (Primary for Digital PDFs)
// ==========================================================================

/** Path to the Python venv executable. */
const PYTHON_PATH = os.platform() === 'win32'
  ? path.join(process.cwd(), 'venv', 'Scripts', 'python.exe')
  : path.join(process.cwd(), 'venv', 'bin', 'python');

/** Path to the PyMuPDF extraction script. */
const PYMUPDF_SCRIPT = path.join(process.cwd(), 'src', 'python', 'pymupdf_extract.py');

/**
 * Attempt text extraction using PyMuPDF via subprocess.
 * Returns the extracted text, or empty string on failure.
 */
function runPyMuPDF(tempFilePath: string): string {
  // Guard: check that the script and Python exist
  if (!fs.existsSync(PYMUPDF_SCRIPT)) {
    console.warn('[OCR:0] PyMuPDF script not found — skipping');
    return '';
  }
  if (!fs.existsSync(PYTHON_PATH)) {
    console.warn('[OCR:0] Python venv not found — skipping PyMuPDF');
    return '';
  }

  try {
    const result = execSync(
      `"${PYTHON_PATH}" "${PYMUPDF_SCRIPT}" "${tempFilePath}"`,
      { encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return (result || '').trim();
  } catch (err: any) {
    // Exit code 1 means insufficient text; other errors are real failures
    if (err.stdout && typeof err.stdout === 'string' && err.stdout.trim().length > 0) {
      console.warn(`[OCR:0] PyMuPDF returned insufficient text (${err.stdout.trim().length} chars)`);
      return err.stdout.trim();
    }
    console.warn('[OCR:0] PyMuPDF extraction failed:', err.stderr || err.message || '');
    return '';
  }
}

// ==========================================================================
// Stage 1 — OCR Extraction
// ==========================================================================

/**
 * Extracts raw text from a PDF.
 *   Strategy 0: PyMuPDF for digitally-authored PDFs (primary).
 *   Strategy A: pdf-parse for digitally-authored PDFs (fallback).
 *   Strategy B: Poppler→JPEG + Tesseract for scanned/image-based PDFs.
 */
export async function extractTextFromPDF(
  pdfBuffer: Buffer,
  tempFilePath: string,
): Promise<string> {
  console.log('[OCR:1] Starting text extraction…');

  let digitalText = '';
  let ocrText = '';

  // ── Strategy 0: PyMuPDF (primary digital extractor) ──────────────────
  let pymuText = '';
  try {
    pymuText = runPyMuPDF(tempFilePath);
    if (pymuText.length > 0) {
      console.log(`[OCR:0] PyMuPDF → ${pymuText.length} chars`);
    }
  } catch (err) {
    console.warn('[OCR:0] PyMuPDF threw unexpected error:', err);
  }

  // Assess PyMuPDF quality
  const pymuKeywords = countReceiptKeywords(pymuText);
  const pymuIsGood = pymuText.length > 80 && pymuKeywords >= 3;

  if (pymuIsGood) {
    console.log(`[OCR:0] PyMuPDF text has ${pymuKeywords} receipt keywords — using as primary`);

    // If keyword count is marginal, also try pdf-parse and pick the best
    if (pymuKeywords < 8) {
      console.log('[OCR:0] Keyword count marginal — also trying pdf-parse for comparison');
      try {
        const data = await pdfParse(pdfBuffer);
        const pdfParseText = (data.text || '').trim();
        const pdfParseKeywords = countReceiptKeywords(pdfParseText);
        console.log(`[OCR:1] pdf-parse → ${pdfParseText.length} chars, ${pdfParseKeywords} keywords`);

        // Use whichever has more receipt keywords
        if (pdfParseKeywords > pymuKeywords && pdfParseText.length > pymuText.length) {
          console.log('[OCR:0→1] pdf-parse has better keyword coverage — using pdf-parse');
          digitalText = pdfParseText;
        } else {
          console.log('[OCR:0] PyMuPDF wins or ties — using PyMuPDF');
          digitalText = pymuText;
        }
      } catch (err) {
        console.warn('[OCR:1] pdf-parse failed during comparison, using PyMuPDF result');
        digitalText = pymuText;
      }
    } else {
      // PyMuPDF has strong keyword coverage — use it directly
      digitalText = pymuText;
    }

    // Stage 1.5: even with good digital text, check if OCR merge would help
    const finalKeywords = countReceiptKeywords(digitalText);
    if (finalKeywords < 8) {
      console.log('[OCR:1.5] Keyword count marginal — also running OCR for merge');
      ocrText = await runOCR(tempFilePath);
      if (ocrText.length > 0) {
        const mergedText = mergeTexts(digitalText, ocrText);
        console.log(`[OCR:1.5] Merged text: ${mergedText.length} chars`);
        return mergedText;
      }
    }

    return digitalText;
  }

  // ── Strategy A: pdf-parse fallback (if PyMuPDF didn't produce good text) ─
  console.log(`[OCR:0] PyMuPDF insufficient (${pymuText.length} chars, ${pymuKeywords} keywords) — falling back to pdf-parse`);
  try {
    const data = await pdfParse(pdfBuffer);
    digitalText = (data.text || '').trim();
    console.log(`[OCR:1] pdf-parse → ${digitalText.length} chars`);
  } catch (err) {
    console.warn('[OCR:1] pdf-parse failed, continuing to OCR', err);
  }

  // If PyMuPDF had some text and pdf-parse also has text, pick the better one
  if (pymuText.length > 20 && digitalText.length > 20) {
    const pdfParseKw = countReceiptKeywords(digitalText);
    if (pymuKeywords > pdfParseKw) {
      console.log(`[OCR:1] PyMuPDF had more keywords (${pymuKeywords} vs ${pdfParseKw}) — using PyMuPDF text`);
      digitalText = pymuText;
    }
  } else if (pymuText.length > digitalText.length) {
    digitalText = pymuText;
  }

  // Stage 1.5: Confidence Assessment
  const keywordCount = countReceiptKeywords(digitalText);
  const hasGoodDigitalText = digitalText.length > 80 && keywordCount >= 3;

  if (hasGoodDigitalText) {
    console.log(`[OCR:1.5] Digital text has ${keywordCount} receipt keywords — high confidence`);

    // Even with good digital text, if keyword count is marginal, also get OCR
    if (keywordCount < 8) {
      console.log('[OCR:1.5] Keyword count marginal — also running OCR for merge');
      ocrText = await runOCR(tempFilePath);
      if (ocrText.length > 0) {
        const mergedText = mergeTexts(digitalText, ocrText);
        console.log(`[OCR:1.5] Merged text: ${mergedText.length} chars`);
        return mergedText;
      }
    }

    return digitalText;
  }

  // Strategy B: Image-based OCR
  console.log(`[OCR:1.5] Digital text insufficient (${digitalText.length} chars, ${keywordCount} keywords) — running OCR`);
  ocrText = await runOCR(tempFilePath);

  // If we have both, merge them
  if (digitalText.length > 20 && ocrText.length > 20) {
    const mergedText = mergeTexts(digitalText, ocrText);
    console.log(`[OCR:1.5] Merged digital+OCR: ${mergedText.length} chars`);
    return mergedText;
  }

  // Return whichever is longer
  return ocrText.length > digitalText.length ? ocrText : digitalText;
}

/** Count how many receipt-related keywords appear in the text. */
function countReceiptKeywords(text: string): number {
  const lower = text.toLowerCase();
  return RECEIPT_KEYWORDS.filter(kw => lower.includes(kw)).length;
}

/** Run Poppler + Tesseract OCR pipeline. */
async function runOCR(tempFilePath: string): Promise<string> {
  console.log('[OCR:1] Running Poppler + Tesseract…');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  const imagePrefix = path.join(tempDir, 'page');

  try {
    execSync(`"${PDFTOPPM_PATH}" -jpeg -r 300 "${tempFilePath}" "${imagePrefix}"`, {
      stdio: 'ignore',
    });

    const images = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith('page') && f.endsWith('.jpg'))
      .sort();

    let fullText = '';
    for (const file of images) {
      const imgPath = path.join(tempDir, file);
      console.log(`[OCR:1] Tesseract → ${file}`);

      // Try PSM 6 (block of text) — best for structured forms
      let pageText = '';
      try {
        pageText = execSync(`"${TESSERACT_PATH}" "${imgPath}" stdout -l eng --psm 6`, {
          encoding: 'utf-8',
        });
      } catch { /* ignore */ }

      // Also try PSM 4 (column) if PSM 6 gave poor results
      if (pageText.trim().length < 50) {
        try {
          const psm4Text = execSync(`"${TESSERACT_PATH}" "${imgPath}" stdout -l eng --psm 4`, {
            encoding: 'utf-8',
          });
          if (psm4Text.trim().length > pageText.trim().length) {
            pageText = psm4Text;
          }
        } catch { /* ignore */ }
      }

      fullText += pageText + '\n';
    }

    fullText = fullText.trim();
    console.log(`[OCR:1] Tesseract → ${fullText.length} chars`);
    return fullText;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Merge two text sources, deduplicating overlapping content. */
function mergeTexts(text1: string, text2: string): string {
  // Simple merge: concatenate with separator, let Gemini handle dedup
  // We put the longer/better text first
  const t1 = text1.trim();
  const t2 = text2.trim();
  if (t1.length >= t2.length) {
    return `${t1}\n\n--- ADDITIONAL OCR TEXT ---\n\n${t2}`;
  }
  return `${t2}\n\n--- ADDITIONAL DIGITAL TEXT ---\n\n${t1}`;
}

// ==========================================================================
// Stage 2 — Text Normalization
// ==========================================================================

function normalizeText(raw: string): string {
  let t = raw;
  // Strip control characters except \n and \r
  t = t.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  // Strip zero-width characters (common in digital PDFs)
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  // Normalize fancy quotes / dashes
  t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-');
  // Expand common ligatures from digital PDFs
  t = t.replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl');
  // Convert tabs to spaces
  t = t.replace(/\t/g, '  ');
  // Normalize bullet points and arrows to simple dashes
  t = t.replace(/[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u27A4\u25BA]/g, '-');
  // Collapse multiple spaces (not newlines)
  t = t.replace(/[^\S\n]+/g, ' ');
  // Join broken words across lines (pdf-parse artifact fix)
  t = t.replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2');
  // Join lines where a label is split from its value ("SUPPLIER NAME:\n  M/s Foo" → single line)
  t = t.replace(/([A-Z][A-Z\s/\.]{2,30}:)\s*\n\s+/g, '$1 ');
  // Collapse 3+ blank lines into 2
  t = t.replace(/\n{3,}/g, '\n\n');
  // Trim every line
  t = t.split('\n').map((l) => l.trim()).join('\n');
  return t.trim();
}

// ==========================================================================
// Stage 3 — Railway Receipt Preprocessing
// ==========================================================================

function preprocessRailway(text: string): string {
  let t = text;
  // Remove decorative / table-border characters
  t = t.replace(/[™®©§¶†‡]/g, '');
  // Remove lines that are purely border noise
  t = t.replace(/^[\-_|.=+*#~]{4,}$/gm, '');
  // Remove box-drawing characters used in PDF table borders
  t = t.replace(/[\u2500-\u257F]/g, ' ');
  // Aggressively remove stray pipes acting as table separators inside text lines
  t = t.replace(/\s+\|\s+/g, ' ');
  // Remove leading/trailing pipes on lines (table cell artifacts)
  t = t.replace(/^\s*\|\s*/gm, '').replace(/\s*\|\s*$/gm, '');

  // ── OCR label spelling corrections ────────────────────────────────────
  t = t.replace(/\bP\.0\./g, 'P.O.');
  t = t.replace(/\bP\.0\.\s*No/gi, 'P.O. No');
  t = t.replace(/\bVVard\b/ig, 'Ward');
  t = t.replace(/\bV\/ard\b/ig, 'Ward');
  t = t.replace(/\bWVard\b/ig, 'Ward');
  t = t.replace(/\bR\/l\\lote\b/gi, 'R/Note');
  t = t.replace(/\bR\/N0te\b/gi, 'R/Note');
  t = t.replace(/\bR\/Mote\b/gi, 'R/Note');
  t = t.replace(/\bR\/IMote\b/gi, 'R/Note');
  t = t.replace(/\bR\/l\/ote\b/gi, 'R/Note');
  t = t.replace(/\b[l|]\[ame\b/gi, 'Name');
  t = t.replace(/\bDepat\b/ig, 'Depot');
  t = t.replace(/\bOepot\b/ig, 'Depot');
  t = t.replace(/\bDep0t\b/ig, 'Depot');
  t = t.replace(/\bOate\b/ig, 'Date');
  t = t.replace(/\bDafe\b/ig, 'Date');
  t = t.replace(/\blnvoice\b/ig, 'Invoice');
  t = t.replace(/\bInv0ice\b/ig, 'Invoice');
  t = t.replace(/\bChalIan\b/ig, 'Challan');
  t = t.replace(/\bChaiIan\b/ig, 'Challan');
  t = t.replace(/\bReceipt\s+N0te\b/ig, 'Receipt Note');
  t = t.replace(/\bAcceptanee\b/ig, 'Acceptance');
  t = t.replace(/\bWarrantv\b/ig, 'Warranty');
  t = t.replace(/\bWarraniy\b/ig, 'Warranty');
  t = t.replace(/\bQuantitv\b/ig, 'Quantity');
  t = t.replace(/\bSuppIier\b/ig, 'Supplier');
  t = t.replace(/\bSuppller\b/ig, 'Supplier');
  t = t.replace(/\bDescrlption\b/ig, 'Description');
  t = t.replace(/\bAIlocation\b/ig, 'Allocation');
  t = t.replace(/\bVend0r\b/ig, 'Vendor');

  // ── Normalize Rs. variants ────────────────────────────────────────────
  t = t.replace(/\bRs\s*\.\s*/gi, 'Rs.');
  t = t.replace(/\bRs\s+/gi, 'Rs.');
  t = t.replace(/\bINR\s*/gi, 'Rs.');
  t = t.replace(/₹\s*/g, 'Rs.');

  // ── GSTIN normalization ───────────────────────────────────────────────
  // Normalize GSTIN so it doesn't get confused with other fields
  t = t.replace(/GST\.?\s*I\.?N\.?\s*[.:;]?\s*/gi, 'GSTIN: ');

  // ── Date separator normalization ──────────────────────────────────────
  // 23.04.26 → 23/04/26
  t = t.replace(/(\d{2})\.(\d{2})\.(\d{2,4})/g, '$1/$2/$3');
  // 23-04-2026 is already fine
  // Also handle DD.MMM.YYYY (23.May.2025)
  t = t.replace(/(\d{1,2})\.([A-Za-z]{3})\.(\d{4})/g, '$1-$2-$3');

  // ── Table row joining ─────────────────────────────────────────────────
  // Join fragmented table rows where a number appears on its own line after a label
  // e.g. "Qty Accepted\n  15" → "Qty Accepted 15"
  t = t.replace(/((?:Qty|Quantity|Value|Amount|Total)[^\n]{0,20})\n\s*(\d[\d,.]*)/gi, '$1 $2');

  // ── Multiline supplier name joining ───────────────────────────────────
  // "M/s XYZ\n  Technologies Pvt. Ltd." → single line
  t = t.replace(/(M\/[Ss]\s+[A-Z][^\n]{3,40})\n\s+([A-Z][A-Za-z\s&.,]{3,40}(?:Pvt|Ltd|Private|Limited|Corp|Inc|LLP|Industries|Enterprises|Solutions|Technologies|Systems))/gi, '$1 $2');

  // Remove stray single-character noise lines
  t = t.replace(/^\s*[|_]{1,2}\s*$/gm, '');
  // Remove lines that are just a single character
  t = t.replace(/^\s*.\s*$/gm, '');
  return t.trim();
}

// ==========================================================================
// Stage 4 — Gemini Structured Extraction (Primary Strategy)
// ==========================================================================

const GEMINI_PROMPT = `You are a precision data extraction engine for Indian Railway Receipt Notes (RDSO Stores Department documents).

TASK: Extract ALL of the following fields from the provided text. Return ONLY a valid JSON object.

For each field, return a confidence score (0.0 to 1.0) indicating how certain you are.

Return format:
{
  "receiptNoteNo": {"value": "...", "confidence": 0.95},
  "receiptDate": {"value": "...", "confidence": 0.90},
  ...all fields...
}

FIELD DEFINITIONS (with ALL possible alternate labels to search for):

=== CORE FIELDS ===

1. receiptNoteNo: The Receipt Note Number — the MOST IMPORTANT identifier.
   - Labels: "RECEIPT NOTE NO.", "R/Note No", "Receipt Note No", "RN No", "R.N.No.", "Receipt No.", "R/IMote No"
   - Format examples: "RR/RDSO/2025/05/000567", "0126100014", "RR-RDSO-2025-000567"
   - LOCATION: Usually in the FIRST section after the header, near the top of the document. Look for isolated 10-digit codes if labels are obscured.

2. receiptDate: The date on the receipt note.
   - Labels: "RECEIPT DATE", "Date", "R/Note Date", "Dt.", "Date of Receipt"
   - Format: "20-May-2025", "20/05/2025", "DD/MM/YY", "DD-Mon-YYYY"

3. supplierName: Full supplier/firm name.
   - Labels: "SUPPLIER NAME", "Name of Supplier", "Firm Name", "Name & Address of Supplier"
   - Often starts with "M/s" or "M/S" (abbreviation for Messrs), but MAY NOT.
   - Capture the FULL name, excluding addresses.

4. vendorCode: Short alphanumeric vendor/supplier code.
   - Labels: "VENDOR CODE", "V.Code", "Vendor Code", "Supplier Code"
   - Format: "SUP/DEL/2023/0156", "GEm26247", "1060735"

5. poNumber: Purchase Order number.
   - Labels: "PO NUMBER", "PO No", "P.O. No", "P.O.No.", "Purchase Order"
   - Format: "PO/RDSO/2024-25/0789", "GEMC-511687783888349", "4P261021200155"

6. depot: Stores depot / delivery location name.
   - Labels: "DEPOT", "Stores Depot", "Inspecting Depot", "Delivery Location", "Consignee"
   - Examples: "Central Stores Depot, RDSO CC: 44"

7. ward: Ward or section/department name within the railway.
   - Labels: "WARD", "Ward/Section", "Section", "Ward Name"
   - Examples: "SIGNAL & TELECOM", "SSE/STM/Signal", "Electrical", "WARD-07"
   - This is a department/section name, NOT a geographic ward.

8. roNumber: Release Order number.
   - Labels: "RO NUMBER", "R.O. No", "RO No", "Release Order No", "R.O.No."
   - Format: "RO/RDSO/2025/041", "01022"

9. itemDescription: COMPLETE product/material description.
   - Labels: "ITEM DESCRIPTION", "Description of Material", "Description & Specifications"

10. plNumber: PL number, purely numeric.
    - Labels: "PL No", "P.L. No.", "P.L.No."
    - Format: "83401374" — digits only

11. quantity: Total numeric quantity received/accepted.
    - Labels: "QUANTITY", "Qty", "Qty. Accepted", "QTY ACCEPTED"
    - Do NOT default to 1 unless explicitly stated.

12. value: Monetary value in rupees. Return as numeric string only, no currency symbols.
    - Labels: "VALUE", "Total Value", "Value (Rs.)", "TOTAL INVOICE VALUE"
    - Strip ₹, Rs., commas, spaces from the number.

13. acceptanceDate: Date of acceptance/inspection.
    - Labels: "Acceptance Date", "Date of Acceptance"
    - Format: "20-May-2025", "20/05/2025"

14. warrantyDate: Warranty expiry/end date.
    - Labels: "WARRANTY DATE", "Warranty Upto", "Warranty Expiry", "Warranty/Expiry Date"
    - This is a FUTURE date (warranty end).

15. invoiceNumber: Invoice number.
    - Labels: "INVOICE NUMBER", "Invoice No", "Bill No."

=== EXTENDED FIELDS (Extract ALL that are present) ===

16. poAtNumber: PO/AT combined number.
    - Labels: "PO/AT No", "AT No", "PO/AT Number"

17. poDate: Purchase Order date.
    - Labels: "P.O.Date", "PO Date", "Purchase Order Date"

18. poSrNo: PO Serial Number.
    - Labels: "P.O.Sr.No.", "PO Sr No", "PO Serial Number"

19. allocation: Allocation code or department.
    - Labels: "Allocation", "ALLOCATION"
    - This is often the budget allocation or department code.

20. roDate: Release Order date.
    - Labels: "R.O. Date", "RO Date", "Release Order Date"

21. rnQuantity: RN Quantity (Receipt Note quantity).
    - Labels: "RN Quantity", "R.N. Qty"

22. roQuantity: RO Quantity (Release Order quantity).
    - Labels: "RO Quantity", "R.O. Qty"

23. rate: Unit rate/price.
    - Labels: "Rate", "Unit Rate", "Rate (Rs.)"
    - Return as numeric string without currency symbols.

24. termsOfDelivery: Terms of delivery.
    - Labels: "Terms of Delivery", "Mode of Receipt", "Mode of Despatch", "F.O.R.", "F.D.R."

25. consignee: Consignee name/address.
    - Labels: "Consignee", "Ship To"

26. poQuantity: PO Quantity.
    - Labels: "P.O.Qty", "PO Qty", "PO Quantity"

27. balancePoQuantity: Balance PO Quantity.
    - Labels: "Bal.P.O.Qty", "Balance PO Qty"

28. gateChallanRegistration: Gate/Challan Registration Number.
    - Labels: "Gate/Challan Registration No.", "GRN No.", "Gate Entry No."

29. inspectionDetails: Inspection details or report.
    - Labels: "Inspection Details", "Inspection Report", "Insp. Agency"
    - Capture the full inspection text block.

30. payingAuthority: Paying Authority.
    - Labels: "Paying Auth.", "Paying Authority", "Pay Auth"

31. drrNumber: DRR Number.
    - Labels: "D.R.R. No.", "DRR No.", "Drr No"

32. islNumber: ISL Number.
    - Labels: "I.S.L. No.", "ISL No.", "Isl No"

33. dueDate: Due Date of Delivery.
    - Labels: "Due Date of Delivery", "Due Date", "Due Dt."

34. actualSupplyDate: Actual Date of Supply.
    - Labels: "Actual Date of Supply", "Actual Supply Date"

35. manufacturingDate: Manufacturing Date.
    - Labels: "Mfg. Date", "Manufacturing Date", "Date of Mfg."

36. batchNumber: Batch or Lot Number.
    - Labels: "Batch No.", "Lot No."

37. challanInvoiceNumber: Challan/Invoice Number (distinct from invoiceNumber).
    - Labels: "Challan/Invoice No.", "Challan Invoice No"

38. freight: Freight charges.
    - Labels: "Freight", "Freight Charges"
    - Return as numeric string.

39. wharfageDemurrage: Wharfage/Demurrage charges.
    - Labels: "Wharfage/Demurrage"
    - Return as numeric string.

40. packing: Packing charges.
    - Labels: "Packing", "Packing Charges"
    - Return as numeric string.

41. forwarding: Forwarding charges.
    - Labels: "Forwarding", "Forwarding Charges"
    - Return as numeric string.

42. exciseDuty: Excise Duty.
    - Labels: "Excise Duty"
    - Return as numeric string.

43. gst: GST amount or percentage.
    - Labels: "GST", "IGST", "CGST", "SGST"

44. remarks: Remarks or notes.
    - Labels: "Remarks", "REMARKS"

45. supplierGstin: Supplier GSTIN number.
    - Labels: "GSTIN", "Supplier GSTIN"
    - Format: 15-character alphanumeric (e.g., "09AAACR5055M1ZK")

DOCUMENT STRUCTURE (Indian Railway Receipt Note):
The document typically has these sections:
1. HEADER: "RDSO" / "RECEIPT NOTE" / "[STOCK] [S710]"
2. RECEIPT DETAILS: R/Note No., Date, PO/AT No, P.O.Date, P.O.Sr.No., Allocation, Depot, Ward, R.O. No., R.O. Date
3. SUPPLIER DETAILS: Name & Address of Supplier, Vendor Code, RN Quantity, Unit, Rate, Value
4. DESCRIPTION & SPECIFICATIONS: Description & Drg./Spec., PL No., DRR No., ISL No., Date of Acceptance, Date of Mfg.
5. LOGISTICS: Terms of Delivery (F.O.R./F.D.R.), Freight, Wharfage/Demurrage, Packing, Forwarding, Excise Duty, GST
6. GATE/CHALLAN: Gate/Challan Registration No., Dated, Consignee, P.O.Qty, Bal.P.O.Qty
7. INSPECTION: Inspection Details, Insp. Agency, Paying Auth.
8. QUANTITY TABLE: Qty.Invoiced, Qty.Received, Qty.Accepted, Qty.Rejected, Original PO details
9. WARRANTY: Warranty Upto/Expiry Date
10. REMARKS & SIGNATURES

STRICT RULES:
1. Return ONLY the JSON object. No markdown, no explanation, no wrapping.
2. Every "value" MUST be a string. Every "confidence" MUST be a number 0.0–1.0.
3. If a field is NOT found, set value to "" and confidence to 0.0.
4. Do NOT invent or hallucinate values. Only extract what is explicitly present.
5. OCR typos are common: '0' instead of 'O', 'V' instead of 'W'. Map labels intelligently.
6. Clean ALL OCR artifacts (|, _, stray punctuation) from extracted values.
7. vendorCode must be a SINGLE code, NOT an address or description.
8. poNumber must be a SINGLE number/code, NOT a sentence.
9. For monetary fields (value, rate, freight, etc.): strip ₹, Rs., commas → return pure numeric like "38000.00"
10. Search EVERY section thoroughly. Fields often appear in unexpected locations.
11. For Warranty Date: it is ALWAYS a future date, typically years after acceptance.
12. Extract ALL fields that exist in the document — do not skip extended fields.

TEXT TO EXTRACT FROM:
`;

async function extractWithGemini(text: string): Promise<ReceiptExtractionResult | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[OCR:4] GEMINI_API_KEY not set — skipping AI extraction');
    return null;
  }

  console.log('[OCR:4] Sending to Gemini…');

  // Retry up to 2 times on failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: GEMINI_PROMPT + text,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.05,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        console.warn(`[OCR:4] Gemini returned empty response (attempt ${attempt})`);
        continue;
      }

      const parsed = JSON.parse(responseText);
      console.log('[OCR:4] Gemini extraction successful');

      // Normalize to ReceiptExtractionResult
      const result = {} as ReceiptExtractionResult;
      for (const key of ALL_FIELDS) {
        const entry = parsed[key];
        if (entry && typeof entry === 'object' && 'value' in entry) {
          result[key] = {
            value: String(entry.value ?? ''),
            confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.5,
          };
        } else if (typeof entry === 'string') {
          // Gemini returned flat strings instead of objects
          result[key] = { value: entry, confidence: 0.5 };
        } else {
          result[key] = { value: '', confidence: 0 };
        }
      }

      return result;
    } catch (err) {
      console.error(`[OCR:4] Gemini extraction failed (attempt ${attempt}):`, err);
      if (attempt < 2) {
        console.log('[OCR:4] Retrying in 1s…');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  return null;
}

// ==========================================================================
// Stage 5 — Dedicated Field Extractors (Regex Fallback)
// ==========================================================================

/**
 * Each extractor is intentionally conservative.
 * Returns { value, confidence } or { value: "", confidence: 0 }.
 * Never returns OCR fragments.
 */

function extractReceiptNumber(text: string): FieldResult {
  // Pattern 0: RR/RDSO/YYYY/MM/NNNNNN format
  const m0 = text.match(/RR\/RDSO\/\d{4}\/\d{2}\/\d{4,10}/i);
  if (m0) return { value: m0[0].trim(), confidence: 0.95 };

  // Pattern 0b: RRRDSO format (no slashes, as in barcodes)
  const m0b = text.match(/RRRDSO(\d{10,15})/i);
  if (m0b) return { value: 'RR/RDSO/' + m0b[1].substring(0,4) + '/' + m0b[1].substring(4,6) + '/' + m0b[1].substring(6), confidence: 0.85 };

  // Pattern 1: "R/Note No" pattern (most common in railway forms)
  const m1 = text.match(/R\/Note\s*No\.?\s*[,.:;\-\s]*([0-9]{6,15})/i);
  if (m1) return { value: m1[1].trim(), confidence: 0.9 };

  // Pattern 1b: R.N.No. pattern, or R/IMote
  const m1b = text.match(/R\.?N\.?\s*No\.?\s*[,.:;\-\s]*([A-Za-z0-9/\-]{6,30})/i);
  if (m1b) return { value: m1b[1].trim(), confidence: 0.85 };

  const m1c = text.match(/R\/IMote\s*No\.?\s*[,.:;\-\s]*([0-9]{6,15})/i);
  if (m1c) return { value: m1c[1].trim(), confidence: 0.85 };

  // Pattern 2: "Receipt Note No" with various formats
  const m2 = text.match(/Receipt\s*Note\s*(?:No\.?|Number)\s*[,.:;\-\s]*([A-Za-z0-9/\-]{6,30})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.85 };

  // Pattern 3: "RECEIPT NOTE NO." (uppercase label) followed by value after colon
  const m3 = text.match(/RECEIPT\s+NOTE\s+NO\.?\s*[:]\s*([A-Za-z0-9/\-]{6,30})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.9 };

  // Pattern 4: Receipt No. (abbreviated)
  const m4 = text.match(/Receipt\s*No\.?\s*[,.:;\-\s]*([A-Za-z0-9/\-]{6,30})/i);
  if (m4) return { value: m4[1].trim(), confidence: 0.75 };

  // Fallback: Standalone 10-digit number near the start
  const titleArea = text.substring(0, Math.min(text.length, 600));
  const m5 = titleArea.match(/(?:^|\s)(01\d{8})(?:\s|$)/);
  if (m5) return { value: m5[1].trim(), confidence: 0.7 };

  return { value: '', confidence: 0 };
}

function extractReceiptDate(text: string): FieldResult {
  // Pattern: "RECEIPT DATE" or "Receipt Date" with colon
  const m0 = text.match(/RECEIPT\s+DATE\s*[:]\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4}(?:\s+\d{2}:\d{2})?)/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.9 };

  // Receipt date on next line
  const m0b = text.match(/RECEIPT\s+DATE\s*[:]?\s*\n\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m0b) return { value: m0b[1].trim(), confidence: 0.85 };

  // Find dates near "Date" label but NOT "P.O.Date" or "Mfg.Date" or "Invoice Date"
  const m = text.match(/(?:Receipt\s*)?(?:R\/Note\s*)?Date\s*[.:;\-\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.8 };

  // DD-Mon-YYYY format
  const m2 = text.match(/(?:Receipt\s*)?Date\s*[:]\s*(\d{1,2}[-/]\w{3}[-/]\d{4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.85 };

  // R/Note Date specific pattern
  const m3 = text.match(/R\/Note\s*Date\s*[.:;\-\s]*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.85 };

  return { value: '', confidence: 0 };
}

function extractSupplierName(text: string): FieldResult {
  /** Clean supplier name: strip trailing GSTIN, address fragments, noise. */
  const cleanSupplier = (raw: string): string => {
    let v = raw.trim().replace(/\s{2,}/g, ' ');
    // Strip trailing GSTIN
    v = v.replace(/\s*GSTIN\s*[:.]?\s*[A-Z0-9]{10,}.*$/i, '');
    // Strip trailing address fragments (city, PIN)
    v = v.replace(/\s*,?\s*(?:New Delhi|Delhi|Mumbai|Lucknow|Kolkata|Chennai|Bangalore|Hyderabad|Jaipur|Pune)[\s,\-]*(?:\d{6})?\s*$/i, '');
    // Strip trailing phone/email
    v = v.replace(/\s*(?:Ph|Tel|Phone|Email|Mob)[.:].*/i, '');
    // Strip trailing comma/period
    v = v.replace(/[.,;:]+$/, '').trim();
    return v;
  };

  // Pattern 0: "SUPPLIER NAME" with colon (reference image format)
  const m0 = text.match(/SUPPLIER\s+NAME\s*[:]\s*(M\/[Ss]\s+[^\n]{3,120})/i);
  if (m0) return { value: cleanSupplier(m0[1]), confidence: 0.9 };

  // Pattern 0b: SUPPLIER NAME with multiline capture (name on next line)
  const m0b = text.match(/SUPPLIER\s+NAME\s*[:]\s*\n\s*(M\/[Ss]\s+[^\n]{3,120})/i);
  if (m0b) return { value: cleanSupplier(m0b[1]), confidence: 0.9 };

  const m = text.match(/(?:Name\s*(?:&|and)?\s*Address\s*of\s*Supplier|Supplier\s*(?:Name)?|Firm\s*Name)\s*[.:;\-\s]*(M\/[Ss][^\n]{3,120})/i);
  if (m) return { value: cleanSupplier(m[1]), confidence: 0.8 };

  // Multi-line: label on one line, name on next (with or without M/s)
  const m3 = text.match(/(?:Supplier\s*Name|Name\s*of\s*(?:the\s*)?Supplier|Firm\s*Name)\s*[:]?\s*\n\s*([^\n]{3,120})/i);
  if (m3) {
    let val = cleanSupplier(m3[1]);
    if (val.length >= 3 && /[a-zA-Z]/.test(val)) {
      if (!/^M\/[Ss]/i.test(val)) val = 'M/s ' + val;
      return { value: val, confidence: 0.75 };
    }
  }

  // Broader pattern: any "M/S" or "M/s" followed by a name
  const m2 = text.match(/M\/[Ss]\s+([A-Z][A-Za-z\s&.,()]{3,80})/);
  if (m2) return { value: cleanSupplier('M/s ' + m2[1]), confidence: 0.6 };

  // Fallback: name without M/s (after Supplier/Firm/Vendor label)
  const m4 = text.match(/(?:Supplier|Firm|Vendor)\s*Name\s*[:]\s*([A-Za-z][A-Za-z\s&.,()]{5,80})/i);
  if (m4) {
    let val = cleanSupplier(m4[1]);
    if (!/^M\/[Ss]/i.test(val)) val = 'M/s ' + val;
    return { value: val, confidence: 0.6 };
  }

  return { value: '', confidence: 0 };
}

function extractVendorCode(text: string): FieldResult {
  // Pattern 0: "VENDOR CODE" with colon (reference image format)
  const m0 = text.match(/VENDOR\s+CODE\s*[:]\s*([A-Za-z0-9/\-]{5,25})/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.9 };

  // Vendor codes: SUP/DEL/2023/0156, GEm26247, GHM26787
  const m = text.match(/(?:Vendor|V)[.\s]*Code\s*[.:;\-|\s]*([A-Za-z]{2,4}\d{4,8})/i);
  if (m) return { value: m[1].trim(), confidence: 0.9 };

  // SUP/DEL/YYYY/NNNN format
  const m3 = text.match(/(?:Vendor|V)[.\s]*Code\s*[.:;\-|\s]*([A-Z]{3}\/[A-Z]{2,4}\/\d{4}\/\d{3,6})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.9 };

  const m2 = text.match(/v\.?\s*Code[:\s]*([A-Za-z0-9/\-]{5,25})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.7 };

  return { value: '', confidence: 0 };
}

function extractPoNumber(text: string): FieldResult {
  // Pattern 0: PO/RDSO/YYYY-NN/NNNN format (reference image)
  const m0 = text.match(/PO\/RDSO\/\d{4}[-]\d{2}\/\d{3,6}/i);
  if (m0) return { value: m0[0].trim(), confidence: 0.95 };

  // Pattern 0a: GeM contract IDs: GEMC-511687767912858
  const mGem = text.match(/GEMC-\d{10,18}/i);
  if (mGem) return { value: mGem[0].trim(), confidence: 0.9 };

  // Pattern 0b: "PO NUMBER" with colon
  const m0b = text.match(/PO\s+NUMBER\s*[:]\s*([A-Za-z0-9/\-]{4,35})/i);
  if (m0b) return { value: m0b[1].trim(), confidence: 0.9 };

  // Pattern 0c: "PO No." with colon or space
  const m0c = text.match(/PO\s*No\.?\s*[.:;\-\s]+([A-Za-z0-9/\-]{4,35})/i);
  if (m0c && !/depot|stores|central/i.test(m0c[1])) {
    return { value: m0c[1].trim(), confidence: 0.85 };
  }

  // PO numbers are clean codes like "01008", "4P261021200155"
  const m = text.match(/P\.?[O0]\.?\s*(?:No\.?|Number)\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,35})/i);
  if (m && !/depot|stores|central/i.test(m[1])) {
    return { value: m[1].trim(), confidence: 0.8 };
  }

  // Look for "p.o.no.: 01008" pattern
  const m2 = text.match(/p\.?[o0]\.?no\.?\s*[.:;\-\s]*([0-9]{3,15})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.85 };

  // PO/AT No pattern
  const m3 = text.match(/PO\/AT\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,35})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.85 };

  // AT/PO hybrid (AT No. / PO reference)
  const mAt = text.match(/AT\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,35})/i);
  if (mAt && !/depot|stores/i.test(mAt[1])) return { value: mAt[1].trim(), confidence: 0.75 };

  // Purchase Order
  const m4 = text.match(/Purchase\s*[0O]rder\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,35})/i);
  if (m4) return { value: m4[1].trim(), confidence: 0.8 };

  return { value: '', confidence: 0 };
}

function extractDepot(text: string): FieldResult {
  // Pattern 0: "DEPOT" with colon (reference image format)
  const m0 = text.match(/DEPOT\s*[:]\s*([^\n]{3,100})/i);
  if (m0) {
    const val = m0[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 3) return { value: val, confidence: 0.9 };
  }

  // Pattern 0b: "DELIVERY LOCATION" with colon
  const m0b = text.match(/(?:DELIVERY\s+LOCATION|LOCATION)\s*[:]\s*([^\n]{3,120})/i);
  if (m0b) {
    const val = m0b[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 3) return { value: val, confidence: 0.9 };
  }

  // Delivery Location multiline
  const mDL = text.match(/(?:DELIVERY\s+LOCATION|LOCATION)\s*[:]?\s*\n\s*([^\n]{3,120})/i);
  if (mDL) {
    const val = mDL[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 3) return { value: val, confidence: 0.85 };
  }

  // Pattern: RDSO Stores, Manak Nagar format
  const m3 = text.match(/RDSO\s+STORES[,\s]+([A-Za-z\s,\-0-9]+)/i);
  if (m3) return { value: ('RDSO Stores, ' + m3[1]).trim().replace(/\s{2,}/g, ' ').replace(/\s*$/, ''), confidence: 0.85 };

  // Pattern: "Manak Nagar" standalone (RDSO HQ)
  const m4 = text.match(/Manak\s*Nagar[,\s]*(?:Lucknow)?[^\n]*/i);
  if (m4) return { value: 'RDSO Stores, ' + m4[0].trim().replace(/\s{2,}/g, ' '), confidence: 0.75 };

  const m = text.match(/(?:Central\s*)?Stores?\s*Depot\s*[,.:;\-\s]*([A-Za-z\s]{3,60})/i);
  if (m) {
    const val = m[0].trim().replace(/\s{2,}/g, ' ');
    return { value: val, confidence: 0.7 };
  }

  // Consignee pattern (single line)
  const m5 = text.match(/Consignee\s*[:]\s*([^\n]{3,100})/i);
  if (m5) return { value: m5[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.7 };

  // Consignee multiline
  const m5b = text.match(/Consignee\s*[:]?\s*\n\s*([^\n]{3,100})/i);
  if (m5b) return { value: m5b[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.65 };

  return { value: '', confidence: 0 };
}

function extractWard(text: string): FieldResult {
  const wardBlocklist = /excise|duty|wharfage|freight|invoice|challan|total|amount|date|number/i;

  // Pattern 0: "WARD" with colon (reference image format)
  const m0 = text.match(/WARD\s*[:]\s*([^\n]{2,60})/i);
  if (m0) {
    const val = m0[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 2 && !wardBlocklist.test(val)) {
      return { value: val, confidence: 0.85 };
    }
  }

  // Pattern 0b: "ALLOCATION" with colon (same as ward in many forms)
  const m0b = text.match(/ALLOCATION\s*[:]\s*([^\n]{2,60})/i);
  if (m0b) {
    const val = m0b[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 2 && !wardBlocklist.test(val)) {
      return { value: val, confidence: 0.85 };
    }
  }

  // Allocation multiline
  const m0c = text.match(/ALLOCATION\s*[:]?\s*\n\s*([^\n]{2,60})/i);
  if (m0c) {
    const val = m0c[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 2 && !wardBlocklist.test(val)) {
      return { value: val, confidence: 0.8 };
    }
  }

  // Pattern 1: "Ward/Section" or "Section" or "Indenting/Department" label
  const m1 = text.match(/(?:Ward|Section|Indenting|Department)[/\s]*(?:Name)?[:\s]*([A-Z][A-Za-z&\s/()]{2,45})/i);
  if (m1) {
    const val = m1[1].trim();
    if (val.length >= 2 && !wardBlocklist.test(val)) {
      return { value: val, confidence: 0.75 };
    }
  }

  // Pattern 2: Common ward/section names that appear directly
  const wardPatterns: [RegExp, number][] = [
    [/SIGNAL\s*[&]\s*TELECOM/i, 0.7],
    [/S\s*&\s*T\s*(?:Directorate|Department|Dte)?/i, 0.65],
    [/SSE\/STM\/Signal/i, 0.7],
    [/SSE\/[A-Za-z]+\/[A-Za-z]+/i, 0.65],
    [/QA\s*\/\s*QC/i, 0.6],
    [/Electrical\s*(?:Department)?/i, 0.6],
    [/Mechanical\s*(?:Department)?/i, 0.6],
    [/Civil\s*Engineering/i, 0.6],
    [/Telecom(?:munication)?/i, 0.6],
    [/Track\s*(?:Machine|Design)/i, 0.6],
    [/Metallurgy/i, 0.6],
    [/Geo[-\s]*?Tech/i, 0.6],
    [/Bridges\s*(?:&|and)?\s*Structures/i, 0.6],
  ];
  for (const [pattern, conf] of wardPatterns) {
    const m = text.match(pattern);
    if (m) return { value: m[0].trim(), confidence: conf };
  }

  return { value: '', confidence: 0 };
}

function extractRoNumber(text: string): FieldResult {
  // Pattern 0: RO/RDSO/YYYY/NNN format (reference image)
  const m0 = text.match(/RO\/RDSO\/\d{4}\/\d{2,6}/i);
  if (m0) return { value: m0[0].trim(), confidence: 0.95 };

  // Pattern 0b: "RO NUMBER" with colon
  const m0b = text.match(/RO\s+NUMBER\s*[:]\s*([A-Za-z0-9/\-]{3,25})/i);
  if (m0b) return { value: m0b[1].trim(), confidence: 0.9 };

  // Pattern 0c: "RO No." or "R.O. No."
  const m0c = text.match(/R\.?O\.?\s*No\.?\s*[.:;\-\s]+([A-Za-z0-9/\-]{3,25})/i);
  if (m0c) return { value: m0c[1].trim(), confidence: 0.85 };

  // Pattern 1: "Release Order" label
  const m1 = text.match(/Release\s*Order\s*(?:No\.?|Number)?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,25})/i);
  if (m1) return { value: m1[1].trim(), confidence: 0.85 };

  // RO numbers are clean numeric codes
  const m = text.match(/R\.?O\.?\s*(?:No\.?|Number)\s*[.:;\-\s]*([0-9]{3,15})/i);
  if (m) return { value: m[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractItemDescription(text: string): FieldResult {
  // Look for "ITEM DESCRIPTION" or "Description of Material" or "ITEM CATEGORY"
  const m0 = text.match(/(?:ITEM\s+(?:DESCRIPTION|CATEGORY)|Description\s+of\s+Material|Material\s+Description)\s*[:]\s*([^\n]{5,300})/i);
  if (m0) {
    let desc = m0[1].trim().replace(/\s{2,}/g, ' ');
    desc = desc.replace(/[.,;:]+$/, '').trim();
    if (desc.length > 5) return { value: desc, confidence: 0.85 };
  }

  // Multiline item description: label then description on next line(s)
  const m0b = text.match(/(?:ITEM\s+(?:DESCRIPTION|CATEGORY)|Description\s+of\s+Material)\s*[:]?\s*\n\s*([^\n]{5,300})/i);
  if (m0b) {
    let desc = m0b[1].trim().replace(/\s{2,}/g, ' ');
    // Try to capture a continuation line
    const afterMatch = text.indexOf(m0b[0]) + m0b[0].length;
    const nextLine = text.substring(afterMatch).match(/^\s*\n\s*([A-Za-z][^\n]{5,200})/);
    if (nextLine) desc += ' ' + nextLine[1].trim();
    desc = desc.replace(/[.,;:]+$/, '').replace(/\s{2,}/g, ' ').trim();
    if (desc.length > 5) return { value: desc, confidence: 0.8 };
  }

  // Look for inspection report lines which contain actual product info
  const m = text.match(/\(1\)\s*(.+?)(?:\s*OK|\s*\(2\))/i);
  if (m) {
    let desc = m[1].trim().replace(/\s{2,}/g, ' ');
    desc = desc.replace(/[.,;:]+$/, '').trim();
    if (desc.length > 5) return { value: desc, confidence: 0.75 };
  }

  // "Description & Specifications" pattern
  const m3 = text.match(/Description\s*(?:&|and)\s*Specifications?\s*[:]?\s*([^\n]{5,300})/i);
  if (m3) {
    const desc = m3[1].trim().replace(/\s{2,}/g, ' ').replace(/[.,;:]+$/, '');
    if (desc.length > 5) return { value: desc, confidence: 0.75 };
  }

  // Fallback: Look for "Description" label
  const m2 = text.match(/Description\s*[&]\s*[^\n]*\n\s*(.+?)(?:\n|$)/i);
  if (m2) {
    const desc = m2[1].trim().replace(/\s{2,}/g, ' ');
    if (desc.length > 5 && desc.length < 300) return { value: desc, confidence: 0.5 };
  }

  return { value: '', confidence: 0 };
}

function extractPlNumber(text: string): FieldResult {
  // Pattern 0: "PL NUMBER" with colon
  const m0 = text.match(/PL\s+NUMBER\s*[:]\s*(\d{5,15})/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.95 };

  const m = text.match(/P\.?L\.?\s*(?:No\.?|Number)\s*[.:;\-\s]*(\d{5,15})/i);
  if (m) return { value: m[1].trim(), confidence: 0.9 };

  // Pattern: PL No on next line
  const m2 = text.match(/P\.?L\.?\s*(?:No\.?|Number)\s*[:]?\s*\n\s*(\d{5,15})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.85 };

  // Standalone 8-digit number in vicinity of "PL" context
  const plArea = text.match(/P\.?L\.?[^\n]*?(\d{7,10})/i);
  if (plArea) return { value: plArea[1].trim(), confidence: 0.7 };

  return { value: '', confidence: 0 };
}

function extractQuantity(text: string): FieldResult {
  // Pattern 0: "QTY ACCEPTED" in uppercase
  const m0 = text.match(/QTY\s+ACCEPTED\s*[:]\s*(\d+(?:\.\d+)?)/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.9 };

  // Look for Qty.Accepted pattern
  const m = text.match(/Qty\.?\s*Accepted\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };

  const m2 = text.match(/Qty\.?\s*Received\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };

  const m3 = text.match(/RO\s*Quantity\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.75 };

  // "Quantity" with colon (generic)
  const m3b = text.match(/Quantity\s*[:]\s*(\d+(?:\.\d+)?)/i);
  if (m3b) return { value: m3b[1].trim(), confidence: 0.75 };

  // "TOTAL" row in a quantity summary table
  const m4 = text.match(/TOTAL\s+(\d+)\s+\d+\s+\d+\s+\d+/i);
  if (m4) return { value: m4[1].trim(), confidence: 0.7 };

  // Quantity in structured table with column header
  const m5 = text.match(/(?:Qty|Quantity)\s*\n\s*(\d+(?:\.\d+)?)/i);
  if (m5) return { value: m5[1].trim(), confidence: 0.65 };

  return { value: '', confidence: 0 };
}

function extractValue(text: string): FieldResult {
  /** Clean a monetary value string to pure numeric. */
  const cleanMoney = (raw: string): string => {
    let v = raw.replace(/[₹$\s]/g, '').replace(/Rs\.?/gi, '').replace(/INR/gi, '');
    // Fix comma-as-decimal (14590,00 → 14590.00)
    v = v.replace(/,(\d{2})$/, '.$1');
    // Remove thousands separators
    v = v.replace(/,/g, '');
    return v;
  };

  // Pattern 0: "TOTAL INVOICE VALUE" or "VALUE (ACCEPTED)" or "Total Value"
  const m0 = text.match(/(?:TOTAL\s+INVOICE\s+VALUE|VALUE\s*\(ACCEPTED\)|TOTAL\s+VALUE\s*(?:\(.*?\))?)\s*[.:;]?\s*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m0) {
    const val = cleanMoney(m0[1]);
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.9 };
  }

  // Pattern: "Total Amount" or "Grand Total" or "Net Value"
  const m1b = text.match(/(?:Total\s+Amount|Grand\s+Total|Net\s+(?:Payable|Value))\s*[.:;]?\s*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m1b) {
    const val = cleanMoney(m1b[1]);
    if (/^\d+(\.\d+)?$/.test(val) && parseFloat(val) > 0) return { value: val, confidence: 0.85 };
  }

  // Look for "Value: Rs. 14,590.00" or "Value: As, 14590,00"
  const m = text.match(/Value\s*[.:;\-\s]*(?:Rs\.?\s*|As[.,]\s*)?([0-9][0-9,.\s]*\d)/i);
  if (m) {
    const val = cleanMoney(m[1]);
    if (/^\d+(\.\d+)?$/.test(val)) {
      return { value: val, confidence: 0.85 };
    }
  }

  // Pattern: "Value of Goods" or "Value of Material"
  const m2b = text.match(/Value\s+(?:of\s+)?(?:Goods|Material|Stores)\s*[.:;]?\s*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m2b) {
    const val = cleanMoney(m2b[1]);
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.8 };
  }

  return { value: '', confidence: 0 };
}

function extractAcceptanceDate(text: string): FieldResult {
  // Pattern 0: "ACCEPTANCE DATE" with colon
  const m0 = text.match(/ACCEPTANCE\s+DATE\s*[:]\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4}(?:\s+\d{2}:\d{2})?)/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.9 };

  const m = text.match(/(?:Date\s*of\s*)?Acceptance\s*[.:;\-\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.8 };

  // DD-Mon-YYYY format
  const m2 = text.match(/(?:Date\s*of\s*)?Acceptance\s*[:]\s*(\d{1,2}[-/]\w{3}[-/]\d{4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.85 };

  // "Date of Inspection" or "Inspected On" (sometimes used as acceptance date)
  const m3 = text.match(/(?:Date\s*of\s*Inspection|Inspected\s*On)\s*[.:;\-\s]*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.75 };

  // Acceptance date on next line
  const m4 = text.match(/(?:Acceptance\s*Date|Date\s*of\s*Acceptance)\s*[:]?\s*\n\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m4) return { value: m4[1].trim(), confidence: 0.8 };

  return { value: '', confidence: 0 };
}

function extractWarrantyDate(text: string): FieldResult {
  // Pattern 0: "WARRANTY DATE" with colon (reference image format)
  const m0 = text.match(/WARRANTY\s+DATE\s*[:]\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m0) return { value: m0[1].trim(), confidence: 0.9 };

  // Pattern 0b: "Warranty Upto" or "Warranty Period Upto"
  const m0b = text.match(/(?:Warranty|Guarantee)\s*(?:Period\s*)?(?:Upto|Up\s*To|Valid|Till)\s*[/:;\-\s]*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m0b) return { value: m0b[1].trim(), confidence: 0.9 };

  const m = text.match(/(?:Warranty|Guarantee)\s*(?:Upto|Expiry|Date|Valid)\s*(?:Date)?\s*[/:;\-\s]*(\d{2}-[A-Z]{3}-\d{4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };

  const m2 = text.match(/(?:Warranty|Guarantee)\s*(?:Upto|Expiry|Date|Valid)\s*(?:Date)?\s*[/:;\-\s]*(\d{2}[/-]\d{2}[/-]\d{2,4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };

  // DD-Mon-YYYY format anywhere near "warranty"
  const m3 = text.match(/(?:Warranty|Guarantee)\s*[^:]*[:]\s*(\d{1,2}[-/]\w{3}[-/]\d{4})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.8 };

  // Look for warranty in multi-line context
  const m4 = text.match(/(?:Warranty|Guarantee)[^\n]*\n\s*(\d{1,2}[-/]\w{3,9}[-/]\d{2,4})/i);
  if (m4) return { value: m4[1].trim(), confidence: 0.7 };

  return { value: '', confidence: 0 };
}

function extractInvoiceNumber(text: string): FieldResult {
  /** Clean invoice number: strip trailing date/noise. */
  const cleanInvoice = (raw: string): string => {
    let v = raw.trim();
    // Strip trailing "dated ..." or "dt. ..."
    v = v.replace(/\s*(?:dated|dt\.?)\s*.*$/i, '').trim();
    // Strip trailing whitespace and punctuation
    v = v.replace(/[.,;:]+$/, '').trim();
    return v;
  };

  // Pattern 0: "CHALLAN / INVOICE NO." or "INVOICE NUMBER" with colon
  const m0 = text.match(/(?:CHALLAN\s*\/\s*INVOICE\s*NO\.?|INVOICE\s+NUMBER)\s*[:]\s*([A-Za-z0-9/\-]{4,35})/i);
  if (m0) return { value: cleanInvoice(m0[1]), confidence: 0.9 };

  // Invoice Number on next line
  const m0b = text.match(/(?:CHALLAN\s*\/\s*INVOICE\s*NO\.?|INVOICE\s+NUMBER)\s*[:]?\s*\n\s*([A-Za-z0-9/\-]{4,35})/i);
  if (m0b) return { value: cleanInvoice(m0b[1]), confidence: 0.85 };

  // INV/XX/YYYY/NNNN format
  const m3 = text.match(/INV\/[A-Z]{2}\/\d{4}\/\d{3,6}/i);
  if (m3) return { value: m3[0].trim(), confidence: 0.9 };

  // SI/PI prefix: SI-2025-001234
  const mSI = text.match(/(?:SI|PI)[-/]\d{4}[-/]\d{3,8}/i);
  if (mSI) return { value: mSI[0].trim(), confidence: 0.85 };

  // GEM invoices: GEM-73988057
  const m = text.match(/(?:Challan|Invoice)\s*(?:No\.?|Number)?\s*[.:;\-\s]*(GEM-\d{5,12})/i);
  if (m) return { value: m[1].trim(), confidence: 0.9 };

  // Standalone GEM pattern
  const mGem = text.match(/\bGEM[-/]\d{5,12}\b/i);
  if (mGem) return { value: mGem[0].trim(), confidence: 0.8 };

  // Generic challan/invoice with number
  const m2 = text.match(/(?:Challan|Invoice)\s*(?:No\.?|Number)?\s*[.:;\-\s]*([A-Za-z0-9/\-]{5,35})/i);
  if (m2) return { value: cleanInvoice(m2[1]), confidence: 0.7 };

  // Bill No pattern
  const mBill = text.match(/Bill\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,30})/i);
  if (mBill) return { value: cleanInvoice(mBill[1]), confidence: 0.65 };

  return { value: '', confidence: 0 };
}

// ─── Extended Field Extractors ─────────────────────────────────────────────

function extractPoAtNumber(text: string): FieldResult {
  const m = text.match(/PO\/AT\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,35})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/AT\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,35})/i);
  if (m2 && !/depot|stores/i.test(m2[1])) return { value: m2[1].trim(), confidence: 0.75 };
  return { value: '', confidence: 0 };
}

function extractPoDate(text: string): FieldResult {
  const m = text.match(/P\.?O\.?\s*Date\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/P\.?O\.?\s*Date\s*[:]?\s*\n\s*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractPoSrNo(text: string): FieldResult {
  const m = text.match(/P\.?O\.?\s*Sr\.?\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{1,20})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractAllocation(text: string): FieldResult {
  const m = text.match(/Allocation\s*[.:;\-\s]*([^\n]{2,80})/i);
  if (m) {
    const val = m[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 2 && !/excise|duty|wharfage|freight/i.test(val)) {
      return { value: val, confidence: 0.85 };
    }
  }
  return { value: '', confidence: 0 };
}

function extractRoDate(text: string): FieldResult {
  const m = text.match(/R\.?O\.?\s*Date\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/R\.?O\.?\s*Date\s*[:]?\s*\n\s*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractRnQuantity(text: string): FieldResult {
  const m = text.match(/RN\s*Quantity\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/R\.?N\.?\s*Qty\.?\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractRoQuantity(text: string): FieldResult {
  const m = text.match(/RO\s*Quantity\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/R\.?O\.?\s*Qty\.?\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractRate(text: string): FieldResult {
  const cleanMoney = (raw: string): string => {
    let v = raw.replace(/[₹$\s]/g, '').replace(/Rs\.?/gi, '').replace(/INR/gi, '');
    v = v.replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
    return v;
  };
  const m = text.match(/\bRate\s*(?:\(Rs\.?\))?\s*[.:;\-\s]*[₹Rs.\s]*(\d[\d,. ]*\d)/i);
  if (m) {
    const val = cleanMoney(m[1]);
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  const m2 = text.match(/Unit\s*Rate\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m2) {
    const val = cleanMoney(m2[1]);
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.8 };
  }
  return { value: '', confidence: 0 };
}

function extractTermsOfDelivery(text: string): FieldResult {
  const m = text.match(/(?:Terms\s*of\s*Delivery|Mode\s*of\s*(?:Receipt|Despatch|Dispatch))\s*[.:;\-\s]*([^\n]{2,80})/i);
  if (m) return { value: m[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractConsignee(text: string): FieldResult {
  const m = text.match(/Consignee\s*[.:;\-\s]*([^\n]{3,120})/i);
  if (m) return { value: m[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.85 };
  const m2 = text.match(/Consignee\s*[:]?\s*\n\s*([^\n]{3,120})/i);
  if (m2) return { value: m2[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractPoQuantity(text: string): FieldResult {
  const m = text.match(/P\.?O\.?\s*Qty\.?\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/PO\s*Quantity\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractBalancePoQuantity(text: string): FieldResult {
  const m = text.match(/Bal\.?\s*P\.?O\.?\s*Qty\.?\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/Balance\s*PO\s*(?:Qty|Quantity)\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractGateChallanRegistration(text: string): FieldResult {
  const m = text.match(/Gate\/?\s*Challan\s*(?:Registration|Reg\.?)\s*(?:No\.?)?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/GRN\s*(?:No\.?)?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.75 };
  const m3 = text.match(/Gate\s*Entry\s*(?:No\.?)?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m3) return { value: m3[1].trim(), confidence: 0.75 };
  return { value: '', confidence: 0 };
}

function extractInspectionDetails(text: string): FieldResult {
  // Try to capture inspection block
  const m = text.match(/INSPECTION\s*DETAILS\s*[:]?\s*\n([\s\S]{10,500}?)(?=\n\s*(?:REMARKS|CERTIFIED|Received by|Entered in|ACCOUNTING|$))/i);
  if (m) {
    let val = m[1].trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
    if (val.length > 300) val = val.substring(0, 300);
    return { value: val, confidence: 0.8 };
  }
  // Simpler patterns
  const m2 = text.match(/Inspection\s*Details\s*[.:;\-\s]*([^\n]{5,200})/i);
  if (m2) return { value: m2[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.75 };
  // Inspection Report
  const m3 = text.match(/Inspection\s*Report\s*[.:;\-\s]*([\s\S]{10,300}?)(?=\n\s*(?:REMARKS|R\/MTR|CERTIFIED|Shortage))/i);
  if (m3) {
    let val = m3[1].trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
    return { value: val, confidence: 0.75 };
  }
  return { value: '', confidence: 0 };
}

function extractPayingAuthority(text: string): FieldResult {
  const m = text.match(/Paying[\s\-]*Auth(?:ority|\.)\s*[.:;\-\s]*([^\n]{2,80})/i);
  if (m) return { value: m[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.85 };
  const m2 = text.match(/Pay[\s\-]*Auth\.?\s*[.:;\-\s]*([^\n]{2,80})/i);
  if (m2) return { value: m2[1].trim().replace(/\s{2,}/g, ' '), confidence: 0.75 };
  return { value: '', confidence: 0 };
}

function extractDrrNumber(text: string): FieldResult {
  const m = text.match(/D\.?R\.?R\.?\s*(?:No\.?|Number)\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/Drr[\s\-]*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractIslNumber(text: string): FieldResult {
  const m = text.match(/I\.?S\.?L\.?\s*(?:No\.?|Number)\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/Isl[\s\-]*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{3,30})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractDueDate(text: string): FieldResult {
  const m = text.match(/Due\s*Date(?:\s*of\s*Delivery)?\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractActualSupplyDate(text: string): FieldResult {
  const m = text.match(/Actual\s*(?:Date\s*of\s*)?Supply(?:\s*Date)?\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractManufacturingDate(text: string): FieldResult {
  const m = text.match(/(?:Mfg\.?|Manufacturing)\s*Date\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  const m2 = text.match(/Date\s*of\s*Mfg\.?\s*[.:;\-\s]*(\d{1,2}[-/]\w{2,9}[-/]\d{2,4})/i);
  if (m2) return { value: m2[1].trim(), confidence: 0.8 };
  return { value: '', confidence: 0 };
}

function extractBatchNumber(text: string): FieldResult {
  const m = text.match(/(?:Batch|Lot)\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{2,30})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractChallanInvoiceNumber(text: string): FieldResult {
  const m = text.match(/Challan\s*\/?\s*Invoice\s*No\.?\s*[.:;\-\s]*([A-Za-z0-9/\-]{4,35})/i);
  if (m) return { value: m[1].trim(), confidence: 0.85 };
  return { value: '', confidence: 0 };
}

function extractFreight(text: string): FieldResult {
  const m = text.match(/Freight\s*(?:Charges?)?\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m) {
    const val = m[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  // Also match text labels like "F.O.B." or "F.O.R."
  const m2 = text.match(/F\.?O\.?[BR]\.?\s*[.:;\-\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m2) {
    const val = m2[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.7 };
  }
  return { value: '', confidence: 0 };
}

function extractWharfageDemurrage(text: string): FieldResult {
  const m = text.match(/Wharfage\s*[/]?\s*Demurrage\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m) {
    const val = m[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  return { value: '', confidence: 0 };
}

function extractPacking(text: string): FieldResult {
  const m = text.match(/Packing\s*(?:Charges?)?\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m) {
    const val = m[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  return { value: '', confidence: 0 };
}

function extractForwarding(text: string): FieldResult {
  const m = text.match(/Forwarding\s*(?:Charges?)?\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m) {
    const val = m[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  return { value: '', confidence: 0 };
}

function extractExciseDuty(text: string): FieldResult {
  const m = text.match(/Excise\s*Duty\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  if (m) {
    const val = m[1].replace(/,/g, '');
    if (/^\d+(\.\d+)?$/.test(val)) return { value: val, confidence: 0.85 };
  }
  return { value: '', confidence: 0 };
}

function extractGst(text: string): FieldResult {
  // GST amount or percentage
  const m = text.match(/\b(?:I?GST|CGST|SGST)\s*[.:;\-\s]*[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?(?:\s*%)?)/i);
  if (m) return { value: m[1].trim().replace(/,/g, ''), confidence: 0.85 };
  const m2 = text.match(/\bGST\s*[.:;\-\s]*([\d,]+(?:\.\d{1,2})?(?:\s*%)?)/i);
  if (m2) return { value: m2[1].trim().replace(/,/g, ''), confidence: 0.75 };
  return { value: '', confidence: 0 };
}

function extractRemarks(text: string): FieldResult {
  // REMARKS section
  const m = text.match(/\bREMARKS\s*[.:;\-\s]*\n?\s*([^\n]{3,200})/i);
  if (m) {
    const val = m[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 3 && !/^[-_=*]+$/.test(val)) return { value: val, confidence: 0.8 };
  }
  const m2 = text.match(/\bRemark(?:s)?\s*[.:;\-\s]*([^\n]{3,200})/i);
  if (m2) {
    const val = m2[1].trim().replace(/\s{2,}/g, ' ');
    if (val.length >= 3) return { value: val, confidence: 0.7 };
  }
  return { value: '', confidence: 0 };
}

function extractSupplierGstin(text: string): FieldResult {
  // GSTIN: 15-character alphanumeric
  const m = text.match(/GSTIN\s*[.:;\-\s]*([A-Z0-9]{15})/i);
  if (m) return { value: m[1].toUpperCase().trim(), confidence: 0.9 };
  // Standalone GSTIN pattern
  const m2 = text.match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]\w)\b/);
  if (m2) return { value: m2[1].toUpperCase().trim(), confidence: 0.75 };
  return { value: '', confidence: 0 };
}

/** Run all dedicated extractors (fallback strategy). */
function runDedicatedExtractors(text: string): ReceiptExtractionResult {
  console.warn('[OCR:5] Using regex fallback — extraction quality will be limited');
  return {
    // Core fields
    receiptNoteNo: extractReceiptNumber(text),
    receiptDate: extractReceiptDate(text),
    supplierName: extractSupplierName(text),
    vendorCode: extractVendorCode(text),
    poNumber: extractPoNumber(text),
    depot: extractDepot(text),
    ward: extractWard(text),
    roNumber: extractRoNumber(text),
    itemDescription: extractItemDescription(text),
    plNumber: extractPlNumber(text),
    quantity: extractQuantity(text),
    value: extractValue(text),
    acceptanceDate: extractAcceptanceDate(text),
    warrantyDate: extractWarrantyDate(text),
    invoiceNumber: extractInvoiceNumber(text),
    // Extended fields
    poAtNumber: extractPoAtNumber(text),
    poDate: extractPoDate(text),
    poSrNo: extractPoSrNo(text),
    allocation: extractAllocation(text),
    roDate: extractRoDate(text),
    rnQuantity: extractRnQuantity(text),
    roQuantity: extractRoQuantity(text),
    rate: extractRate(text),
    termsOfDelivery: extractTermsOfDelivery(text),
    consignee: extractConsignee(text),
    poQuantity: extractPoQuantity(text),
    balancePoQuantity: extractBalancePoQuantity(text),
    gateChallanRegistration: extractGateChallanRegistration(text),
    inspectionDetails: extractInspectionDetails(text),
    payingAuthority: extractPayingAuthority(text),
    drrNumber: extractDrrNumber(text),
    islNumber: extractIslNumber(text),
    dueDate: extractDueDate(text),
    actualSupplyDate: extractActualSupplyDate(text),
    manufacturingDate: extractManufacturingDate(text),
    batchNumber: extractBatchNumber(text),
    challanInvoiceNumber: extractChallanInvoiceNumber(text),
    freight: extractFreight(text),
    wharfageDemurrage: extractWharfageDemurrage(text),
    packing: extractPacking(text),
    forwarding: extractForwarding(text),
    exciseDuty: extractExciseDuty(text),
    gst: extractGst(text),
    remarks: extractRemarks(text),
    supplierGstin: extractSupplierGstin(text),
  };
}

// ==========================================================================
// Stage 5.5 — Cross-Validation
// ==========================================================================

/**
 * Compare Gemini results with regex results.
 * If they agree → boost confidence.
 * If regex has a value that Gemini missed → fill in with regex value.
 * If they disagree and regex is more confident → prefer regex.
 */
function crossValidate(
  geminiResult: ReceiptExtractionResult,
  regexResult: ReceiptExtractionResult,
): ReceiptExtractionResult {
  const result = { ...geminiResult } as ReceiptExtractionResult;

  for (const key of RECEIPT_FIELDS) {
    const gemini = geminiResult[key];
    const regex = regexResult[key];

    // Case 1: Gemini missed, regex found → use regex (multi-pass rescue)
    if ((!gemini || !gemini.value) && regex?.value) {
      // If regex found it but Gemini missed it completely, it's a valuable rescue
      const validator = FORMAT_VALIDATORS[key];
      // Boost the rescued regex confidence slightly if it passes structural validation
      const rescueConfidence = validator && validator(regex.value) ? Math.min(1.0, regex.confidence + 0.2) : regex.confidence;
      result[key] = { value: regex.value, confidence: rescueConfidence };
      console.log(`[OCR:5.5] Cross-fill rescue ${key}: regex="${regex.value}" (Gemini missed, final conf: ${rescueConfidence.toFixed(2)})`);
      continue;
    }

    // Case 2: Both have values
    if (gemini?.value && regex?.value) {
      const geminiClean = gemini.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const regexClean = regex.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      if (geminiClean === regexClean || geminiClean.includes(regexClean) || regexClean.includes(geminiClean)) {
        // Agreement! Boost confidence
        result[key] = {
          value: gemini.value,
          confidence: Math.min(1, Math.max(gemini.confidence, regex.confidence) + 0.1),
        };
        // Flag perfect agreement on result object to bypass strict format penalty later
        (result[key] as any)._perfectAgreement = true;
        console.log(`[OCR:5.5] Agreement on ${key}: "${gemini.value}" → confidence boosted to ${result[key].confidence.toFixed(2)}`);
      } else if (regex.confidence > gemini.confidence + 0.15) {
        // Regex is significantly more confident — prefer regex
        result[key] = regex;
        console.log(`[OCR:5.5] Prefer regex for ${key}: "${regex.value}" (regex=${regex.confidence.toFixed(2)} > gemini=${gemini.confidence.toFixed(2)})`);
      }
    }
  }

  return result;
}

// ==========================================================================
// Stage 6 — Format Validation
// ==========================================================================

/** Format validators: return true if value looks structurally valid for this field. */
const FORMAT_VALIDATORS: Record<ReceiptFieldKey, (val: string) => boolean> = {
  receiptNoteNo: (v) => /^[A-Za-z0-9\-/]{4,35}$/.test(v),
  receiptDate: (v) => /^\d{1,2}[-/]\w{2,9}[-/]\d{2,4}(\s+\d{2}:\d{2})?$/.test(v),
  supplierName: (v) => v.length >= 3 && v.length <= 150 && !/[|_™®]/.test(v),
  vendorCode: (v) => /^[A-Za-z0-9/\-]{3,30}$/.test(v),
  poNumber: (v) => /^[A-Za-z0-9\-/]{3,35}$/.test(v) && !/depot|stores|central|contract/i.test(v),
  depot: (v) => v.length >= 3 && v.length <= 120 && !/[|_™®]/.test(v),
  ward: (v) => v.length >= 2 && v.length <= 60 && !/excise|duty|wharfage|freight/i.test(v),
  roNumber: (v) => /^[A-Za-z0-9\-/]{3,30}$/.test(v) && !/contract|gem|product/i.test(v),
  itemDescription: (v) => v.length >= 5 && v.length <= 500,
  plNumber: (v) => /^\d{5,15}$/.test(v),
  quantity: (v) => /^\d+(\.\d+)?$/.test(v),
  value: (v) => /^\d+(\.\d{1,4})?$/.test(v),
  acceptanceDate: (v) => /^\d{1,2}[-/]\w{2,9}[-/]\d{2,4}(\s+\d{2}:\d{2})?$/.test(v),
  warrantyDate: (v) => /\d{1,2}[-/]\w{2,9}[-/]\d{2,4}/.test(v),
  invoiceNumber: (v) => /^[A-Za-z0-9\-/]{4,35}$/.test(v),
};

// ==========================================================================
// Stage 7 — Confidence Scoring & Filtering
// ==========================================================================

/**
 * Applies format validation on top of AI confidence.
 * If the value fails format validation, its confidence is heavily penalized.
 * If confidence < threshold, the value is blanked.
 */
function scoreAndFilter(data: ReceiptExtractionResult, ocrText: string): ReceiptExtractionResult {
  const result = {} as ReceiptExtractionResult;

  for (const key of RECEIPT_FIELDS) {
    const { value, confidence } = data[key];
    if (!value) {
      result[key] = { value: '', confidence: 0 };
      continue;
    }

    let adjustedConfidence = confidence;

    // Format validation penalty
    const validator = FORMAT_VALIDATORS[key];
    if (!validator(value.trim())) {
      if ((data[key] as any)._perfectAgreement) {
        adjustedConfidence *= 0.8; // Reduced penalty if Gemini & Regex perfectly agreed
        console.log(`[OCR:7] Format validation failed but perfect agreement: ${key}="${value}" → confidence ${adjustedConfidence.toFixed(2)}`);
      } else {
        adjustedConfidence *= 0.3; // Heavy penalty for failing format check
        console.log(`[OCR:7] Format validation failed: ${key}="${value}" → confidence ${adjustedConfidence.toFixed(2)}`);
      }
    }

    // Presence check: does the core value appear in OCR text?
    const cleanVal = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const cleanOCR = ocrText.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanVal.length > 5 && !cleanOCR.includes(cleanVal)) {
      // Also try partial match (first 8 chars) for values that may have been reformatted
      const partialVal = cleanVal.substring(0, Math.min(8, cleanVal.length));
      if (partialVal.length >= 4 && cleanOCR.includes(partialVal)) {
        // Partial match found — very mild penalty
        adjustedConfidence *= 0.9;
      } else {
        // Value doesn't appear in source text — possible hallucination, mild penalty
        adjustedConfidence *= 0.7;
        console.log(`[OCR:7] Presence check failed: ${key}="${value}" → confidence ${adjustedConfidence.toFixed(2)}`);
      }
    }

    // Length sanity
    if (value.length > 300) adjustedConfidence *= 0.3;
    else if (value.length > 200) adjustedConfidence *= 0.5;

    adjustedConfidence = Math.max(0, Math.min(1, adjustedConfidence));

    if (adjustedConfidence < CONFIDENCE_THRESHOLD) {
      console.log(`[OCR:7] REJECTED ${key}="${value}" (confidence=${adjustedConfidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD})`);
      result[key] = { value: '', confidence: 0 };
    } else {
      result[key] = { value, confidence: adjustedConfidence };
    }
  }

  return result;
}

// ==========================================================================
// Stage 8 — Field Sanitation
// ==========================================================================

function sanitizeFields(data: ReceiptExtractionResult): ReceiptExtractionResult {
  const result = {} as ReceiptExtractionResult;

  for (const key of RECEIPT_FIELDS) {
    let { value, confidence } = data[key];
    if (!value) {
      result[key] = { value: '', confidence: 0 };
      continue;
    }

    // Strip leading/trailing OCR noise
    value = value.replace(/^[\s:\-|_.,;]+/, '').replace(/[\s:\-|_.,;]+$/, '');
    // Collapse internal spaces
    value = value.replace(/\s{2,}/g, ' ');
    // Remove stray pipes/underscores mid-string
    value = value.replace(/\s*\|\s*/g, ' ').replace(/\s*_\s*/g, ' ');
    // Remove box-drawing remnants
    value = value.replace(/[\u2500-\u257F]/g, '').trim();
    value = value.trim();

    result[key] = { value, confidence };
  }

  // ── Format-specific sanitation ─────────────────────────────────────────

  // Supplier Name: clean trailing GSTIN, address, noise
  if (result.supplierName.value) {
    let v = result.supplierName.value;
    v = v.replace(/\s*GSTIN\s*[:.]?\s*[A-Z0-9]{10,}.*$/i, '');
    v = v.replace(/\s*,?\s*(?:Ph|Tel|Phone|Email|Mob)[.:].*/i, '');
    v = v.replace(/[.,;:]+$/, '').trim();
    result.supplierName = { value: v, confidence: result.supplierName.confidence };
  }

  // Invoice Number: strip trailing date references
  if (result.invoiceNumber.value) {
    let v = result.invoiceNumber.value;
    v = v.replace(/\s*(?:dated|dt\.?)\s*.*$/i, '').trim();
    v = v.replace(/[.,;:]+$/, '').trim();
    result.invoiceNumber = { value: v, confidence: result.invoiceNumber.confidence };
  }

  // Item Description: join multiline fragments, clean trailing noise
  if (result.itemDescription.value) {
    let v = result.itemDescription.value;
    v = v.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
    v = v.replace(/[.,;:]+$/, '').trim();
    result.itemDescription = { value: v, confidence: result.itemDescription.confidence };
  }

  // Value: strip currency, commas → pure numeric
  if (result.value.value) {
    const numeric = result.value.value
      .replace(/[₹$\s,]/g, '')
      .replace(/Rs\.?/gi, '')
      .replace(/INR/gi, '')
      .replace(/[^0-9.]/g, '');
    result.value = {
      value: /\d/.test(numeric) ? numeric : '',
      confidence: /\d/.test(numeric) ? result.value.confidence : 0,
    };
  }

  // Quantity: pure numeric
  if (result.quantity.value) {
    const numeric = result.quantity.value.replace(/[^0-9.]/g, '');
    result.quantity = {
      value: /\d/.test(numeric) ? numeric : '',
      confidence: /\d/.test(numeric) ? result.quantity.confidence : 0,
    };
  }

  return result;
}

// ==========================================================================
// Stage 9 — Database-Safe Output
// ==========================================================================

/** Convert ReceiptExtractionResult → flat ReceiptData for DB insertion. */
function toDatabaseOutput(data: ReceiptExtractionResult): ReceiptData {
  const output = {} as ReceiptData;
  for (const key of RECEIPT_FIELDS) {
    const val = data[key]?.value;
    output[key] = typeof val === 'string' ? val.trim() : '';
  }
  return output;
}

/** Convert ReceiptExtractionResult → confidence map for frontend display. */
function toConfidenceMap(data: ReceiptExtractionResult): Record<ReceiptFieldKey, number> {
  const output = {} as Record<ReceiptFieldKey, number>;
  for (const key of RECEIPT_FIELDS) {
    output[key] = data[key]?.confidence ?? 0;
  }
  return output;
}

// ==========================================================================
// Stage 10 — Minus Receipt Detection
// ==========================================================================

/**
 * Detects whether the OCR text represents a "Minus Receipt" document.
 * Minus receipts deduct quantity from an existing receipt's balance.
 *
 * Patterns detected:
 *   - "Receipt Note Minus for R/Note No. 0126100014"
 *   - "RN Minus for 0126100014"
 *   - "Minus Receipt Note" / "Debit Note"
 */
interface MinusReceiptInfo {
  isMinusReceipt: boolean;
  targetReceiptNoteNo: string;
  qtyRejected: string;
}

function detectMinusReceipt(text: string, extractedData: ReceiptData): MinusReceiptInfo {
  const result: MinusReceiptInfo = {
    isMinusReceipt: false,
    targetReceiptNoteNo: '',
    qtyRejected: '',
  };

  // Pattern 1: "Receipt Note Minus for R/Note No. XXXXXXXXXX"
  const m1 = text.match(/(?:Receipt\s*Note\s*)?Minus\s+(?:for\s+)?R\/Note\s*(?:No\.?)?\s*[.:;\-\s]*([0-9]{6,15})/i);
  if (m1) {
    result.isMinusReceipt = true;
    result.targetReceiptNoteNo = m1[1].trim();
  }

  // Pattern 2: "RN Minus" or "Minus R/N"
  if (!result.isMinusReceipt) {
    const m2 = text.match(/(?:RN|R\/N)\s*Minus\s*(?:for\s+)?(?:No\.?)?\s*[.:;\-\s]*([0-9]{6,15})/i);
    if (m2) {
      result.isMinusReceipt = true;
      result.targetReceiptNoteNo = m2[1].trim();
    }
  }

  // Pattern 3: Generic "Minus" in title area with a receipt number nearby
  if (!result.isMinusReceipt) {
    const titleArea = text.substring(0, Math.min(text.length, 500));
    if (/\bminus\b/i.test(titleArea) && /receipt\s*note/i.test(titleArea)) {
      result.isMinusReceipt = true;
      // Try to find target receipt number
      const m3 = titleArea.match(/(?:for|against|ref)\s*[.:;\-\s]*([0-9]{6,15})/i);
      if (m3) result.targetReceiptNoteNo = m3[1].trim();
    }
  }

  // Extract qty rejected
  if (result.isMinusReceipt) {
    const qtyMatch = text.match(/Qty\.?\s*(?:Rejected|Deducted|Minus)\s*[.:;\-\s]*(\d+(?:\.\d+)?)/i);
    if (qtyMatch) {
      result.qtyRejected = qtyMatch[1].trim();
    } else if (extractedData.quantity) {
      // Use extracted quantity as fallback for minus amount
      result.qtyRejected = extractedData.quantity;
    }
  }

  return result;
}

// ==========================================================================
// Flag Computation
// ==========================================================================

export type ReceiptFlag = 'DUPLICATE_RNOTE' | 'MISSING_FIELDS' | 'LOW_OCR_CONFIDENCE' | 'INVALID_FORMAT';

const REQUIRED_FIELDS: ReceiptFieldKey[] = ['receiptNoteNo', 'poNumber', 'supplierName', 'vendorCode', 'plNumber', 'quantity', 'value', 'acceptanceDate'];
const CONFIDENCE_FLAG_THRESHOLD = 0.6;

function computeFlags(
  data: ReceiptData,
  confidence: Record<ReceiptFieldKey, number>,
  isDuplicate: boolean,
): ReceiptFlag[] {
  const flags: ReceiptFlag[] = [];

  if (isDuplicate) flags.push('DUPLICATE_RNOTE');

  const missingRequired = REQUIRED_FIELDS.some((f) => !data[f] || data[f].trim() === '');
  if (missingRequired) flags.push('MISSING_FIELDS');

  const lowConfidence = RECEIPT_FIELDS.some((f) => data[f] && confidence[f] > 0 && confidence[f] < CONFIDENCE_FLAG_THRESHOLD);
  if (lowConfidence) flags.push('LOW_OCR_CONFIDENCE');

  const formatIssues = RECEIPT_FIELDS.some((f) => {
    if (!data[f]) return false;
    const validator = FORMAT_VALIDATORS[f];
    return !validator(data[f].trim());
  });
  if (formatIssues) flags.push('INVALID_FORMAT');

  return flags;
}

// ==========================================================================
// Public API — Main Pipeline
// ==========================================================================

export interface ParseResult {
  /** Flat field values for database insertion. */
  data: ReceiptData;
  /** Per-field confidence scores (0–1). */
  confidence: Record<ReceiptFieldKey, number>;
  /** Minus receipt detection result. */
  minusReceipt: MinusReceiptInfo;
  /** Computed flags for the upload. */
  flags: ReceiptFlag[];
  /** Whether manual verification is recommended. */
  verificationRequired: boolean;
}

/**
 * Full production extraction pipeline.
 *
 * Called from server.ts after raw text is obtained via extractTextFromPDF.
 * @param rawText - Raw OCR/parsed text from the PDF
 * @param isDuplicate - Whether a master receipt with this receiptNoteNo already exists
 */
export async function parseWithAI(rawText: string, isDuplicate: boolean = false): Promise<ParseResult> {
  // Stage 2: Normalize
  const normalized = normalizeText(rawText);

  // Stage 3: Railway preprocessing
  const preprocessed = preprocessRailway(normalized);

  // Stage 4: Gemini AI extraction (primary)
  let extracted = await extractWithGemini(preprocessed);

  // Stage 5: Run regex extractors (always, for cross-validation)
  const regexResults = runDedicatedExtractors(preprocessed);

  // Stage 5.5: Cross-validation
  if (extracted) {
    extracted = crossValidate(extracted, regexResults);
  } else {
    // Gemini failed entirely — use regex as primary
    extracted = regexResults;
  }

  // Stage 6+7: Format validation + confidence scoring
  const scored = scoreAndFilter(extracted, preprocessed);

  // Stage 8: Field sanitation
  const sanitized = sanitizeFields(scored);

  // Stage 9: Database-safe output
  const data = toDatabaseOutput(sanitized);
  const confidence = toConfidenceMap(sanitized);

  // Stage 10: Minus receipt detection
  const minusReceipt = detectMinusReceipt(preprocessed, data);

  // Stage 11: Flag computation
  const flags = computeFlags(data, confidence, isDuplicate);

  // Determine if manual verification is needed
  const verificationRequired = RECEIPT_FIELDS.some(
    (f) => data[f] && confidence[f] > 0 && confidence[f] < 0.8
  );

  const populated = RECEIPT_FIELDS.filter((k) => data[k].length > 0).length;
  console.log(`[OCR] Pipeline complete: ${populated}/${RECEIPT_FIELDS.length} fields, minus=${minusReceipt.isMinusReceipt}, flags=[${flags.join(',')}], verificationRequired=${verificationRequired}`);

  return { data, confidence, minusReceipt, flags, verificationRequired };
}
