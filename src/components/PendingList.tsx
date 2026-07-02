import React, { useState, useEffect } from 'react';
import { User } from '../App.tsx';
import { SuccessModal, ErrorModal, ConfirmModal, RejectModal } from './Modal.tsx';
import { ArrowDownRight, Flag, ShieldAlert, Eye, XCircle } from 'lucide-react';

/** Human-readable labels for receipt fields. */
const FIELD_LABELS: Record<string, string> = {
  receiptNoteNo: 'Receipt Number',
  receiptDate: 'Receipt Date',
  poNumber: 'PO Number',
  poAtNumber: 'PO/AT Number',
  poDate: 'PO Date',
  poSrNo: 'PO Sr No',
  allocation: 'Allocation',
  supplierName: 'Supplier Name',
  vendorCode: 'Vendor Code',
  depot: 'Depot',
  ward: 'Ward',
  roNumber: 'RO Number',
  roDate: 'RO Date',
  itemDescription: 'Description',
  plNumber: 'PL Number',
  rnQuantity: 'RN Quantity',
  roQuantity: 'RO Quantity',
  quantity: 'Quantity',
  rate: 'Rate',
  value: 'Value (₹)',
  termsOfDelivery: 'Terms of Delivery',
  consignee: 'Consignee',
  poQuantity: 'PO Quantity',
  balancePoQuantity: 'Balance PO Quantity',
  gateChallanRegistration: 'Gate/Challan Registration',
  inspectionDetails: 'Inspection Details',
  payingAuthority: 'Paying Authority',
  drrNumber: 'DRR Number',
  islNumber: 'ISL Number',
  acceptanceDate: 'Acceptance Date',
  warrantyDate: 'Warranty Date',
  dueDate: 'Due Date',
  actualSupplyDate: 'Actual Supply Date',
  manufacturingDate: 'Manufacturing Date',
  batchNumber: 'Batch Number',
  invoiceNumber: 'Invoice Number',
  challanInvoiceNumber: 'Challan Invoice Number'
};

const FIELD_GROUPS = [
  {
    title: 'Receipt Information',
    fields: ['receiptNoteNo', 'receiptDate', 'poNumber', 'poAtNumber', 'poDate', 'poSrNo', 'allocation']
  },
  {
    title: 'Supplier Information',
    fields: ['supplierName', 'vendorCode', 'depot', 'ward', 'roNumber', 'roDate']
  },
  {
    title: 'Inventory',
    fields: ['itemDescription', 'plNumber', 'rnQuantity', 'roQuantity', 'quantity', 'rate', 'value']
  },
  {
    title: 'Delivery',
    fields: ['termsOfDelivery', 'consignee', 'poQuantity', 'balancePoQuantity', 'gateChallanRegistration']
  },
  {
    title: 'Inspection',
    fields: ['inspectionDetails', 'payingAuthority', 'drrNumber', 'islNumber']
  },
  {
    title: 'Dates',
    fields: ['acceptanceDate', 'warrantyDate', 'dueDate', 'actualSupplyDate', 'manufacturingDate', 'batchNumber', 'invoiceNumber', 'challanInvoiceNumber']
  }
];

/** Summary fields shown on the collapsed card. */
const SUMMARY_FIELDS = [
  'receiptDate', 'poNumber', 'plNumber', 'quantity', 'value',
];

const FLAG_DISPLAY: Record<string, { label: string; color: string }> = {
  DUPLICATE_RNOTE: { label: 'Duplicate', color: 'bg-amber-100 text-amber-700' },
  MISSING_FIELDS: { label: 'Missing Fields', color: 'bg-red-100 text-red-700' },
  LOW_OCR_CONFIDENCE: { label: 'Low Confidence', color: 'bg-orange-100 text-orange-700' },
  INVALID_FORMAT: { label: 'Invalid Format', color: 'bg-purple-100 text-purple-700' },
};

const getOverallConfidence = (confMap: Record<string, number>): number => {
  const values = Object.values(confMap);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return (sum / values.length) * 100;
};

const getConfidenceStatus = (score: number) => {
  if (score >= 95) return { label: 'Auto Approve Ready', color: 'bg-emerald-100 text-emerald-800' };
  if (score >= 70) return { label: 'Review Needed', color: 'bg-amber-100 text-amber-800' };
  return { label: 'Manual Verification', color: 'bg-red-100 text-red-800' };
};

export default function PendingList({ user, token }: { user: User, token: string | null }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [approving, setApproving] = useState(false);
  const [statusTab, setStatusTab] = useState<'pending' | 'rejected'>('pending');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleSelectClick = () => {
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedIds(new Set());
    } else {
      setSelectionMode(true);
      setSelectedIds(new Set());
    }
  };

  const handleSelectDoubleClick = () => {
    setSelectionMode(true);
    setSelectedIds(new Set(records.map(r => r.id)));
  };

  // PDF preview state
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);

  // Original values for edit tracking
  const [originalValues, setOriginalValues] = useState<any>({});

  // Modal state
  const [successModal, setSuccessModal] = useState({ open: false, title: '', message: '' });
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);

  // Minus receipt processing
  const [minusTarget, setMinusTarget] = useState<any>(null);
  const [minusForm, setMinusForm] = useState({ targetReceiptNoteNo: '', qtyRejected: '' });
  const [minusProcessing, setMinusProcessing] = useState(false);

  // Bulk delete state
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleteLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const endpoint = statusTab === 'rejected'
        ? '/api/receipts/rejected/bulk-delete'
        : '/api/receipts/temp/bulk-delete';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (res.ok) {
        // Remove deleted records from local state (no page refresh)
        setRecords(prev => prev.filter(r => !selectedIds.has(r.id)));
        const deletedCount = data.deletedCount || ids.length;
        setSelectionMode(false);
        setSelectedIds(new Set());
        setBulkDeleteConfirmOpen(false);
        window.dispatchEvent(new Event('receipt-action'));
        setSuccessModal({
          open: true,
          title: 'Records Deleted',
          message: `Successfully deleted ${deletedCount} ${statusTab} record${deletedCount > 1 ? 's' : ''}.`
        });
      } else {
        setBulkDeleteConfirmOpen(false);
        setErrorModal({
          open: true,
          title: 'Delete Failed',
          message: data.error || 'Failed to delete the selected records.'
        });
      }
    } catch (e) {
      setBulkDeleteConfirmOpen(false);
      setErrorModal({
        open: true,
        title: 'Network Error',
        message: 'Could not connect to the server. Please check your connection.'
      });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [user, statusTab]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/receipts/pending?status=${statusTab}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch (e) {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (record: any) => {
    setEditingId(record.id);
    setEditForm({ ...record });
    setOriginalValues({ ...record }); // Store original for edit tracking
    // Show PDF preview if available
    if (record.pdfData) {
      setPreviewPdf(record.pdfData);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
    setOriginalValues({});
    setPreviewPdf(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const approveRecord = async () => {
    setApproving(true);
    try {
      const res = await fetch(`/api/receipts/approve/${editingId}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        setEditingId(null);
        setPreviewPdf(null);
        fetchRecords();
        window.dispatchEvent(new Event('receipt-action'));
        setSuccessModal({
          open: true,
          title: 'Receipt Approved',
          message: 'Receipt has been approved and QR code generated successfully.'
        });
      } else {
        const err = await res.json();
        setErrorModal({
          open: true,
          title: 'Approval Failed',
          message: err.error || 'Failed to approve the receipt. Please try again.'
        });
      }
    } catch (e) {
      setErrorModal({
        open: true,
        title: 'Network Error',
        message: 'Could not connect to the server. Please check your connection.'
      });
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (rejectTarget === null) return;
    setRejectLoading(true);
    try {
      const res = await fetch(`/api/receipts/reject/${rejectTarget}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ rejectionReason: reason })
      });
      if (res.ok) {
        setRejectTarget(null);
        fetchRecords();
        window.dispatchEvent(new Event('receipt-action'));
        setSuccessModal({
          open: true,
          title: 'Receipt Rejected',
          message: 'The receipt has been rejected with the provided reason.'
        });
      } else {
        const err = await res.json();
        setErrorModal({
          open: true,
          title: 'Rejection Failed',
          message: err.error || 'Failed to reject the receipt.'
        });
      }
    } catch (e) {
      setErrorModal({
        open: true,
        title: 'Network Error',
        message: 'Could not connect to the server.'
      });
    } finally {
      setRejectLoading(false);
    }
  };

  const startMinusProcess = (record: any) => {
    setMinusTarget(record);
    setMinusForm({
      targetReceiptNoteNo: record.targetReceiptNoteNo || '',
      qtyRejected: record.qtyRejected || '',
    });
  };

  const processMinusReceipt = async () => {
    if (!minusTarget) return;
    setMinusProcessing(true);
    try {
      const res = await fetch(`/api/receipts/process-minus/${minusTarget.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(minusForm)
      });
      const data = await res.json();
      if (res.ok) {
        setMinusTarget(null);
        fetchRecords();
        setSuccessModal({
          open: true,
          title: 'Minus Receipt Processed',
          message: `Deducted ${data.qtyDeducted} from R/Note ${data.targetReceiptNoteNo}. New balance: ${data.balanceAfter}${data.isExhausted ? ' (EXPIRED)' : ''}`
        });
      } else {
        setErrorModal({
          open: true,
          title: 'Processing Failed',
          message: data.error || 'Failed to process minus receipt.'
        });
      }
    } catch (e) {
      setErrorModal({
        open: true,
        title: 'Network Error',
        message: 'Could not connect to the server.'
      });
    } finally {
      setMinusProcessing(false);
    }
  };

  const requestDelete = (id: number) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/receipts/temp/${deleteTarget}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setDeleteTarget(null);
      fetchRecords();
      window.dispatchEvent(new Event('receipt-action'));
    } catch (e) {
      setDeleteTarget(null);
      setErrorModal({ open: true, title: 'Delete Failed', message: 'Failed to delete the record.' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const parseFlags = (flagsStr: string | null): string[] => {
    if (!flagsStr) return [];
    try { return JSON.parse(flagsStr); } catch { return []; }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p className="text-lg font-medium">Loading records...</p>
    </div>
  );

  return (
    <div className="pb-20">
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Pending Approvals</h2>
        <p className="text-gray-500 mt-1.5 text-sm">Review, approve, or reject extracted receipt data.</p>
      </div>

      {/* Header Actions Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        {/* Status Tabs */}
        <div className="relative flex bg-gray-100/80 p-1.5 rounded-xl w-fit border border-gray-200/60 shadow-sm">
          <div
            className="absolute top-1.5 bottom-1.5 w-[90px] bg-white rounded-md shadow-sm transition-all duration-300 ease-in-out"
            style={{ transform: `translateX(${statusTab === 'pending' ? '0' : '90px'})` }}
          />
          <button
            onClick={() => setStatusTab('pending')}
            className={`relative z-10 w-[90px] text-center py-2 rounded-md text-sm font-medium transition-colors ${
              statusTab === 'pending' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setStatusTab('rejected')}
            className={`relative z-10 w-[90px] text-center py-2 rounded-md text-sm font-medium transition-colors ${
              statusTab === 'rejected' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Rejected
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button 
            onClick={handleSelectClick}
            onDoubleClick={handleSelectDoubleClick}
            className={`px-4 py-2 text-sm font-bold border rounded-xl transition-colors shadow-sm ${selectionMode ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            {selectionMode ? 'Cancel Selection' : 'Select'}
          </button>
          <button className="px-4 py-2 text-sm font-bold bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors shadow-sm">
            Clear History
          </button>
        </div>
      </div>

      {records.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center shadow-sm">
          <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-800 mb-1">No {statusTab} records</h3>
          <p className="text-gray-500 text-sm">You're all caught up! There are no records waiting for review.</p>
        </div>
      )}
      
      <div className="space-y-6">
        {records.map(r => {
          const flags = parseFlags(r.flags);
          const isMinusReceipt = r.isMinusReceipt === 1;
          const isRejected = r.status === 'rejected';
          
          let confMap = {};
          try { confMap = JSON.parse(r.ocrConfidence || '{}'); } catch {}
          const overallConfidence = getOverallConfidence(confMap);
          const confStatus = getConfidenceStatus(overallConfidence);
          const isSelected = selectedIds.has(r.id);
          const baseBorderClass = isMinusReceipt ? 'border-indigo-200' : isRejected ? 'border-red-200' : 'border-gray-200';
          const selectionClass = isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : baseBorderClass;

          return (
            <div key={r.id} className={`relative bg-white p-6 md:p-8 rounded-[20px] border shadow-sm hover:shadow-md transition-shadow ${selectionClass}`}>
              
              {/* Selection Checkbox */}
              {selectionMode && (
                <div className="absolute top-6 left-6 z-10" onClick={e => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    checked={isSelected}
                    onChange={(e) => {
                      const newSelected = new Set(selectedIds);
                      if (e.target.checked) newSelected.add(r.id);
                      else newSelected.delete(r.id);
                      setSelectedIds(newSelected);
                    }}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                  />
                </div>
              )}

              {editingId === r.id ? (
                /* ─── Verification & Edit Panel ─── */
                <div className="space-y-6">
                  <div className="flex items-center space-x-2 border-b border-gray-100 pb-4 mb-2">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                      <Eye className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-lg text-gray-900 leading-tight">Verify Extracted Information</h3>
                      <p className="text-sm text-gray-500 font-medium">Please review carefully before approving.</p>
                    </div>
                  </div>

                  {/* Split view: PDF preview + fields */}
                  <div className="flex flex-col lg:flex-row items-start gap-6 relative">
                    {/* PDF Preview */}
                    {previewPdf && (
                      <div className="lg:w-1/2 lg:sticky lg:top-6 w-full shrink-0 z-10">
                        <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                          <Eye className="w-4 h-4 mr-1" /> Original Document
                        </h4>
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 h-[calc(100vh-10rem)] min-h-[600px] shadow-sm flex flex-col">
                          <iframe
                            src={`data:application/pdf;base64,${previewPdf}#view=FitH`}
                            className="w-full h-full flex-1"
                            title="PDF Preview"
                          />
                        </div>
                      </div>
                    )}

                    {/* Editable Fields */}
                    <div className={previewPdf ? 'lg:w-1/2 w-full flex flex-col' : 'w-full flex flex-col'}>
                      <p className="text-sm text-gray-500 mb-4">Review the extracted information against the original document.</p>
                      <div className="space-y-6 flex-1">
                        {FIELD_GROUPS.map((group) => (
                          <div key={group.title} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                            <div className="bg-gray-50/80 px-4 py-3 border-b border-gray-200">
                              <h4 className="font-bold text-sm text-gray-800 uppercase tracking-wider">{group.title}</h4>
                            </div>
                            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {group.fields.map((field) => {
                                const fieldValue = editForm[field] || '';
                                const isEmpty = !fieldValue;
                                
                                // Get confidence for this field
                                let confidence = 0;
                                try {
                                  const confMap = JSON.parse(r.ocrConfidence || '{}');
                                  confidence = confMap[field] || 0;
                                } catch {}
                                
                                const isLowConf = confidence > 0 && confidence < 0.6;
                                const isMedConf = confidence >= 0.6 && confidence < 0.8;
                                const isHighConf = confidence >= 0.8;

                                const confColor = isLowConf ? 'text-red-600' : isMedConf ? 'text-amber-600' : isHighConf ? 'text-emerald-600' : 'text-gray-400';
                                const confBg = isLowConf ? 'bg-red-50 border-red-200' : isMedConf ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200';

                                return (
                                  <div key={field} className={`p-4 rounded-xl border transition-colors ${confBg} ${isEmpty ? 'opacity-70' : ''}`}>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-[10px] text-gray-500 uppercase font-extrabold tracking-wider">
                                        {FIELD_LABELS[field] || field}
                                      </span>
                                      {confidence > 0 && (
                                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-white/80 shadow-sm border border-white/40 ${confColor}`} title={`OCR Confidence: ${(confidence * 100).toFixed(0)}%`}>
                                          {(confidence * 100).toFixed(0)}%
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[15px] font-bold text-gray-900 break-words leading-tight">
                                      {isEmpty ? <span className="text-gray-400 italic font-medium">Not extracted</span> : fieldValue}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Sticky Action Buttons */}
                      <div className="sticky bottom-0 z-20 flex flex-wrap gap-3 pt-4 pb-6 md:pb-8 border-t border-gray-200 mt-6 bg-white/95 backdrop-blur-md shadow-[0_-12px_16px_-12px_rgba(0,0,0,0.05)] -mx-6 px-6 -mb-6 md:-mx-8 md:px-8 md:-mb-8 rounded-b-[20px]">
                        <button onClick={approveRecord} disabled={approving} className="bg-green-600 text-white px-6 py-2.5 rounded-xl hover:bg-green-700 font-bold transition-all shadow-sm hover:shadow active:scale-[0.98] disabled:opacity-70 flex items-center">
                          {approving ? (
                            <><svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Approving...</>
                          ) : "Approve"}
                        </button>
                        <button onClick={() => { cancelEdit(); setRejectTarget(r.id); }} className="bg-red-50 text-red-600 px-6 py-2.5 rounded-xl hover:bg-red-100 font-bold transition-colors border border-red-100">Reject</button>
                        <button onClick={cancelEdit} className="bg-white text-gray-700 px-6 py-2.5 rounded-xl hover:bg-gray-50 font-bold transition-colors border border-gray-200 shadow-sm ml-auto">Cancel</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Collapsed Card ─── */
                <div className={selectionMode ? 'pl-8' : ''}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        {isMinusReceipt && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">
                            <ArrowDownRight className="w-3 h-3 mr-1" /> Minus Receipt
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
                            Rejected
                          </span>
                        )}
                        {/* Flag badges */}
                        {flags.map(flag => {
                          const display = FLAG_DISPLAY[flag];
                          if (!display) return null;
                          return (
                            <span key={flag} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${display.color}`}>
                              {display.label}
                            </span>
                          );
                        })}
                        {/* Confidence Status Badge */}
                        {!isRejected && !isMinusReceipt && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${confStatus.color}`}>
                            {confStatus.label} ({Math.round(overallConfidence)}%)
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-lg text-gray-800">{r.receiptNoteNo || "Pending Extraction"} {r.supplierName ? `— ${r.supplierName}` : ''}</h3>
                      <p className="text-sm text-gray-500">Extracted on {new Date(r.createdAt).toLocaleString()}</p>
                      {isMinusReceipt && r.targetReceiptNoteNo && (
                        <p className="text-sm text-indigo-600 mt-1">
                          Target: R/Note No {r.targetReceiptNoteNo} — Qty: {r.qtyRejected || '?'}
                        </p>
                      )}
                      {isRejected && r.rejectionReason && (
                        <div className="mt-3 p-3 bg-red-50/50 rounded-xl text-sm text-red-700 border border-red-100 flex items-start">
                          <XCircle className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-red-500" />
                          <div><strong className="font-semibold mr-1">Reason:</strong> {r.rejectionReason}</div>
                        </div>
                      )}
                    </div>
                    {!isRejected && (
                      <div className="space-x-3 flex shrink-0 mt-4 md:mt-0">
                        {isMinusReceipt ? (
                          <button onClick={() => startMinusProcess(r)} className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl hover:bg-indigo-100 text-sm font-bold transition-colors border border-indigo-100">Process Minus</button>
                        ) : (
                          <button onClick={() => startEdit(r)} className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 text-sm font-bold shadow-sm transition-all hover:shadow active:scale-[0.98]">Verify</button>
                        )}
                        <button onClick={() => setRejectTarget(r.id)} className="text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-4 py-2 rounded-xl text-sm font-bold transition-colors">Reject</button>
                        <button onClick={() => requestDelete(r.id)} className="text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100 px-4 py-2 rounded-xl text-sm font-bold transition-colors">Delete</button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm bg-gray-50/80 p-5 rounded-xl border border-gray-100/80 text-gray-700">
                    {SUMMARY_FIELDS.map(field => (
                      <div key={field}>
                        <span className="font-extrabold block text-[10px] text-gray-400 uppercase tracking-widest mb-1">{FIELD_LABELS[field]}</span>
                        <div className="font-bold text-[14px] text-gray-900">{r[field] || <span className="text-gray-400 italic font-medium">—</span>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Minus Receipt Processing Modal */}
      {minusTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-bold mb-2 flex items-center">
              <ArrowDownRight className="w-5 h-5 mr-2 text-indigo-600" />
              Process Minus Receipt
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              This will deduct the rejected quantity from the target receipt's balance.
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target R/Note No <span className="text-red-500">*</span></label>
                <input
                  required
                  type="text"
                  value={minusForm.targetReceiptNoteNo}
                  onChange={e => setMinusForm({ ...minusForm, targetReceiptNoteNo: e.target.value })}
                  className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="e.g. 0126100014"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Qty Rejected <span className="text-red-500">*</span></label>
                <input
                  required
                  type="number"
                  step="any"
                  min="0.01"
                  value={minusForm.qtyRejected}
                  onChange={e => setMinusForm({ ...minusForm, qtyRejected: e.target.value })}
                  className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="e.g. 5"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setMinusTarget(null)} className="px-4 py-2 text-gray-600 border rounded hover:bg-gray-50">Cancel</button>
              <button
                onClick={processMinusReceipt}
                disabled={minusProcessing || !minusForm.targetReceiptNoteNo || !minusForm.qtyRejected}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {minusProcessing ? 'Processing...' : 'Process Deduction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Animated Delete Button */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <button className="animated-delete-btn" data-text={`${selectedIds.size} record${selectedIds.size > 1 ? 's' : ''} will be deleted`} onClick={() => setBulkDeleteConfirmOpen(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 69 14" className="svgIcon bin-top">
              <g clipPath="url(#clip0_35_24)">
                <path fill="black" d="M20.8232 2.62734L19.9948 4.21304C19.8224 4.54309 19.4808 4.75 19.1085 4.75H4.92857C2.20246 4.75 0 6.87266 0 9.5C0 12.1273 2.20246 14.25 4.92857 14.25H64.0714C66.7975 14.25 69 12.1273 69 9.5C69 6.87266 66.7975 4.75 64.0714 4.75H49.8915C49.5192 4.75 49.1776 4.54309 49.0052 4.21305L48.1768 2.62734C47.3451 1.00938 45.6355 0 43.7719 0H25.2281C23.3645 0 21.6549 1.00938 20.8232 2.62734ZM64.0023 20.0648C64.0397 19.4882 63.5822 19 63.0044 19H5.99556C5.4178 19 4.96025 19.4882 4.99766 20.0648L8.19375 69.3203C8.44018 73.0758 11.6746 76 15.5712 76H53.4288C57.3254 76 60.5598 73.0758 60.8062 69.3203L64.0023 20.0648Z" />
              </g>
              <defs><clipPath id="clip0_35_24"><rect fill="white" height="14" width="69" /></clipPath></defs>
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 69 57" className="svgIcon bin-bottom">
              <g clipPath="url(#clip0_35_22)">
                <path fill="black" d="M20.8232 -16.3727L19.9948 -14.787C19.8224 -14.4569 19.4808 -14.25 19.1085 -14.25H4.92857C2.20246 -14.25 0 -12.1273 0 -9.5C0 -6.8727 2.20246 -4.75 4.92857 -4.75H64.0714C66.7975 -4.75 69 -6.8727 69 -9.5C69 -12.1273 66.7975 -14.25 64.0714 -14.25H49.8915C49.5192 -14.25 49.1776 -14.4569 49.0052 -14.787L48.1768 -16.3727C47.3451 -17.9906 45.6355 -19 43.7719 -19H25.2281C23.3645 -19 21.6549 -17.9906 20.8232 -16.3727ZM64.0023 1.0648C64.0397 0.4882 63.5822 0 63.0044 0H5.99556C5.4178 0 4.96025 0.4882 4.99766 1.0648L8.19375 50.3203C8.44018 54.0758 11.6746 57 15.5712 57H53.4288C57.3254 57 60.5598 54.0758 60.8062 50.3203L64.0023 1.0648Z" />
              </g>
              <defs><clipPath id="clip0_35_22"><rect fill="white" height="57" width="69" /></clipPath></defs>
            </svg>
          </button>
        </div>
      )}

      {/* Single Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Pending Record"
        message="Are you sure you want to delete this pending record? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Bulk Delete Confirmation Modal */}
      <ConfirmModal
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        title={statusTab === 'rejected' ? 'Delete Rejected Records' : 'Delete Pending Records'}
        message={`Are you sure you want to permanently delete ${selectedIds.size} ${statusTab} record${selectedIds.size > 1 ? 's' : ''}? ${statusTab === 'rejected' ? 'This will also remove associated history entries.' : 'This will also remove associated history entries.'} This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={bulkDeleteLoading}
      />

      {/* Reject Modal */}
      <RejectModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => handleReject(reason)}
        loading={rejectLoading}
      />

      {/* Success Modal */}
      <SuccessModal
        open={successModal.open}
        onClose={() => setSuccessModal({ open: false, title: '', message: '' })}
        title={successModal.title}
        message={successModal.message}
      />

      {/* Error Modal */}
      <ErrorModal
        open={errorModal.open}
        onClose={() => setErrorModal({ open: false, title: '', message: '' })}
        title={errorModal.title}
        message={errorModal.message}
      />
    </div>
  );
}
