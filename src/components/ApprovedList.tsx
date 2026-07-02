import { useState, useEffect, useMemo } from 'react';
import { User } from '../App.tsx';
import { Search, CheckCircle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConfirmModal, SuccessModal, ErrorModal } from './Modal.tsx';
import QRCode from 'qrcode';
import railwayLogo from '../assets/indian_railways_logo.png';
import ashokaEmblem from '../assets/Ashoka_Emblem.svg';

function QRCodeImage({ data }: { data: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (data && !data.startsWith('data:')) {
      QRCode.toDataURL(data, { errorCorrectionLevel: 'M', margin: 1, width: 120 })
        .then(setSrc)
        .catch(() => setSrc(''));
    } else if (data) {
      setSrc(data);
    }
  }, [data]);
  if (!src) return <div className="w-[100px] h-[100px] bg-gray-50 flex items-center justify-center text-[10px] text-gray-400 font-bold border border-gray-100 rounded-lg">NO QR</div>;
  return <img src={src} alt="QR Code" className="w-[100px] h-[100px] object-contain mx-auto" />;
}

export default function ApprovedList({ user, token }: { user: User, token: string | null }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'expired'>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortOption, activeTab]);

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
    setSelectedIds(new Set(filteredRecords.map(r => r.id)));
  };

  // Delete state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [successModal, setSuccessModal] = useState({ open: false, title: '', message: '' });
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleteLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await fetch('/api/receipts/master/bulk-delete', {
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
        setDeleteConfirmOpen(false);
        setSuccessModal({
          open: true,
          title: 'Records Deleted',
          message: `Successfully deleted ${deletedCount} approved receipt${deletedCount > 1 ? 's' : ''}.`
        });
      } else {
        setDeleteConfirmOpen(false);
        setErrorModal({
          open: true,
          title: 'Delete Failed',
          message: data.error || 'Failed to delete the selected records.'
        });
      }
    } catch (e) {
      setDeleteConfirmOpen(false);
      setErrorModal({
        open: true,
        title: 'Network Error',
        message: 'Could not connect to the server. Please check your connection.'
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const fetchRecords = async () => {
    try {
      const res = await fetch('/api/receipts/approved', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const recs = Array.isArray(data) ? data : [];
      setRecords(recs);
    } catch (e) {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [user]);

  // Derived state: Filtering and Sorting
  const filteredRecords = useMemo(() => {
    let filtered = records;

    if (activeTab === 'active') {
      filtered = filtered.filter(r => r.status === 'active' && parseFloat(r.currentBalance || '0') > 0);
    } else if (activeTab === 'expired') {
      filtered = filtered.filter(r => r.status === 'exhausted' || parseFloat(r.currentBalance || '0') <= 0);
    }

    if (searchQuery.trim() !== '') {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        (r.receiptNoteNo && r.receiptNoteNo.toLowerCase().includes(lowerQuery)) ||
        (r.supplierName && r.supplierName.toLowerCase().includes(lowerQuery)) ||
        (r.invoiceNumber && r.invoiceNumber.toLowerCase().includes(lowerQuery))
      );
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortOption === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortOption === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return 0;
    });

    return sorted;
  }, [records, searchQuery, sortOption, activeTab]);

  const activeCount = records.filter(r => r.status === 'active' && parseFloat(r.currentBalance || '0') > 0).length;
  const expiredCount = records.filter(r => r.status === 'exhausted' || parseFloat(r.currentBalance || '0') <= 0).length;
  
  const totalPages = Math.ceil(filteredRecords.length / ITEMS_PER_PAGE);
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Auto-correct page if records were deleted and current page is now out of bounds
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

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
    <div className="relative pb-20">
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Approved Records</h2>
        <p className="text-gray-500 mt-1.5 text-sm">Manage, search and verify approved railway receipt records.</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 mb-8">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search Receipt No., Supplier or Invoice No..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 text-sm font-medium border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
          />
        </div>
        <div className="flex items-center gap-5">
          <button 
            onClick={handleSelectClick}
            onDoubleClick={handleSelectDoubleClick}
            className={`text-sm font-bold px-4 py-2.5 rounded-xl transition-colors border ${selectionMode ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            {selectionMode ? 'Cancel Selection' : 'Select'}
          </button>
          <select
            value={sortOption}
            onChange={e => setSortOption(e.target.value)}
            className="border border-gray-200 rounded-xl py-2.5 px-4 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm font-bold text-gray-700 bg-white cursor-pointer appearance-none pr-10"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.25em 1.25em' }}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      <div className="flex space-x-8 border-b border-gray-200 mb-8 px-1">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3.5 text-sm font-bold border-b-[3px] transition-colors whitespace-nowrap ${activeTab === 'all' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
        >
          All ({records.length})
        </button>
        <button
          onClick={() => setActiveTab('active')}
          className={`pb-3.5 text-sm font-bold border-b-[3px] transition-colors whitespace-nowrap ${activeTab === 'active' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setActiveTab('expired')}
          className={`pb-3.5 text-sm font-bold border-b-[3px] transition-colors whitespace-nowrap ${activeTab === 'expired' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}
        >
          Expired ({expiredCount})
        </button>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="py-20 text-center">
          <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-800 mb-1">No Records Found</h3>
          <p className="text-gray-500 text-sm">No approved receipts match your filters.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {paginatedRecords.map(r => {
            const isExhausted = r.status === 'exhausted' || parseFloat(r.currentBalance || '0') <= 0;
            const approvedDate = r.approvedAt ? new Date(r.approvedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            const isSelected = selectedIds.has(r.id);
            
            return (
              <div key={r.id} className={`relative bg-white rounded-[20px] border shadow-sm hover:shadow-lg transition-all hover:-translate-y-1 flex flex-col p-6 ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200'}`}>
                
                {/* Selection Checkbox */}
                {selectionMode && (
                  <div className="absolute top-4 left-4 z-10" onClick={e => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(r.id)}
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
                
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <img src={railwayLogo} alt="Logo" className="w-[34px] h-[34px] object-contain shrink-0" />
                  <div className="text-center flex-1 mx-2 mt-0.5">
                    <div className="text-[10px] font-extrabold tracking-widest text-gray-900 leading-none mb-1">INDIAN RAILWAYS</div>
                    <div className="text-[8px] font-bold tracking-widest text-gray-500 leading-none">STORES DEPARTMENT</div>
                    <div className="text-[9px] font-extrabold tracking-wider text-gray-800 mt-1.5 leading-none">RECEIPT NOTE</div>
                  </div>
                  <img src={ashokaEmblem} alt="Emblem" className="w-7 h-[34px] object-contain shrink-0 opacity-90" />
                </div>
                
                <hr className="border-t border-dashed border-gray-200 mb-5" />
                
                {/* Details */}
                <div className="text-center mb-5">
                  <div className="text-[10px] text-gray-400 font-extrabold tracking-widest uppercase">Receipt Note No.</div>
                  <div className="font-extrabold text-[17px] tracking-tight text-gray-900 break-all leading-none mt-1.5">{r.receiptNoteNo || "—"}</div>
                  
                  <div className="text-[10px] text-gray-400 font-extrabold tracking-widest uppercase mt-4">Date</div>
                  <div className="text-[14px] text-gray-700 font-bold mt-1 leading-none">{r.receiptDate || "—"}</div>
                </div>
                
                {/* QR Code */}
                <div className="flex justify-center mb-6">
                  <QRCodeImage data={r.qrCodeData} />
                </div>
                
                {/* Bottom Info */}
                <div className="mt-auto pt-2 flex flex-col h-full">
                  <div className="text-[13px] font-extrabold text-gray-900 leading-tight mb-1.5" style={{ whiteSpace: 'normal', overflowWrap: 'break-word' }}>
                    {r.supplierName || "—"}
                  </div>
                  <div className="text-[11px] font-medium text-gray-500 mb-5">Approved: {approvedDate}</div>
                  
                  <div className="mb-6 flex">
                    <div className={`text-[10px] font-extrabold px-3 py-1.5 rounded-md tracking-widest uppercase border ${
                      isExhausted ? 'border-orange-200/60 text-orange-600 bg-orange-50/50' : 'border-green-200/60 text-green-600 bg-green-50/50'
                    }`}>
                      {isExhausted ? 'Expired' : 'Active'}
                    </div>
                  </div>
                  
                  <div className="mt-auto">
                    <Link
                      to={`/record/${r.id}`}
                      className="flex items-center justify-center w-full space-x-2 bg-blue-50/70 hover:bg-blue-100/70 text-blue-600 py-[11px] rounded-xl text-[13px] font-bold transition-colors border border-blue-100/50"
                    >
                      <ExternalLink className="w-4 h-4" strokeWidth={2.5} />
                      <span>View Receipt</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
          </div>

          {totalPages > 1 && (
            <div className="mt-10 mb-2 flex flex-col sm:flex-row justify-between items-center bg-white px-6 py-4 rounded-2xl shadow-sm border border-gray-200 gap-4">
              <div className="text-sm text-gray-500 font-medium">
                Showing <span className="font-bold text-gray-900">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</span> to <span className="font-bold text-gray-900">{Math.min(currentPage * ITEMS_PER_PAGE, filteredRecords.length)}</span> of <span className="font-bold text-gray-900">{filteredRecords.length}</span> entries
              </div>
              <div className="flex space-x-1.5 items-center">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm transition-colors shadow-sm"
                >
                  Previous
                </button>
                
                <div className="hidden sm:flex space-x-1.5 items-center">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const p = i + 1;
                    if (totalPages <= 7 || p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                      return (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`w-10 h-10 rounded-xl text-sm font-bold border transition-all ${
                            currentPage === p ? 'bg-blue-600 text-white border-blue-600 shadow-md transform -translate-y-0.5' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    } else if (p === currentPage - 2 || p === currentPage + 2) {
                      return <span key={`ellipsis-${p}`} className="w-8 text-center text-gray-400 font-bold tracking-widest">...</span>;
                    }
                    return null;
                  })}
                </div>

                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm transition-colors shadow-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating Animated Delete Button */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <button className="animated-delete-btn" data-text={`${selectedIds.size} record${selectedIds.size > 1 ? 's' : ''} will be deleted`} onClick={() => setDeleteConfirmOpen(true)}>
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

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Approved Records"
        message={`Are you sure you want to permanently delete ${selectedIds.size} approved receipt${selectedIds.size > 1 ? 's' : ''}? This will also remove associated QR codes, history, and adjustments. This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteLoading}
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
