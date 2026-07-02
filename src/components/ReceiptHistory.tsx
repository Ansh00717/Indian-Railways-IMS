import { useState, useEffect, useMemo } from 'react';
import { User } from '../App.tsx';
import { useParams, Link } from 'react-router-dom';
import { 
  History, Upload as UploadIcon, CheckCircle, XCircle, ArrowDownRight, 
  AlertTriangle, Search, FileText, QrCode, Edit, User as UserIcon, CheckSquare
} from 'lucide-react';

const ACTION_META: Record<string, { icon: any; label: string; color: string; border: string }> = {
  UPLOADED: { icon: UploadIcon, label: 'Uploaded', color: 'text-blue-600', border: 'border-blue-600' },
  VERIFIED: { icon: CheckSquare, label: 'Verified', color: 'text-green-600', border: 'border-green-600' },
  APPROVED: { icon: CheckCircle, label: 'Approved', color: 'text-green-600', border: 'border-green-600' },
  REJECTED: { icon: XCircle, label: 'Rejected', color: 'text-red-600', border: 'border-red-600' },
  EDITED: { icon: Edit, label: 'Edited', color: 'text-yellow-500', border: 'border-yellow-500' },
  EDIT_RECEIPT: { icon: Edit, label: 'Edited', color: 'text-yellow-500', border: 'border-yellow-500' },
  BALANCE_DEDUCTED: { icon: ArrowDownRight, label: 'Balance Deducted', color: 'text-purple-600', border: 'border-purple-600' },
  RECEIPT_EXHAUSTED: { icon: AlertTriangle, label: 'Receipt Expired', color: 'text-orange-600', border: 'border-orange-600' },
  QR_DISABLED: { icon: AlertTriangle, label: 'QR Disabled', color: 'text-orange-600', border: 'border-orange-600' },
  RECEIPT_ADJUSTED: { icon: ArrowDownRight, label: 'Receipt Adjusted', color: 'text-indigo-600', border: 'border-indigo-600' },
  DOWNLOAD_PDF: { icon: FileText, label: 'Downloaded PDF', color: 'text-blue-700', border: 'border-blue-700' },
  DOWNLOAD_QR: { icon: QrCode, label: 'Downloaded QR', color: 'text-indigo-600', border: 'border-indigo-600' },
};

export default function ReceiptHistory({ user, token }: { user: User, token: string | null }) {
  const { receiptNoteNo } = useParams();
  const [history, setHistory] = useState<any[]>([]);
  const [approvedRecords, setApprovedRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [userFilter, setUserFilter] = useState('All Users');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError('');

    const fetchData = async () => {
      try {
        const url = receiptNoteNo 
          ? `/api/receipts/history/${encodeURIComponent(receiptNoteNo)}`
          : `/api/receipts/history`;
          
        const [histRes, appRes] = await Promise.all([
          fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/receipts/approved', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (!histRes.ok) throw new Error('Failed to load history');
        
        const histData = await histRes.json();
        const appData = appRes.ok ? await appRes.json() : [];
        
        if (isMounted) {
          setHistory(Array.isArray(histData) ? histData : []);
          setApprovedRecords(Array.isArray(appData) ? appData : []);
          setLoading(false);
        }
      } catch (e: any) {
        if (isMounted) {
          setError(e.message);
          setLoading(false);
        }
      }
    };

    if (token) fetchData();
    else {
      if (isMounted) {
        setError('Authentication token missing');
        setLoading(false);
      }
    }

    return () => { isMounted = false; };
  }, [receiptNoteNo, token]);

  const supplierMap = useMemo(() => {
    const map: Record<string, { supplierName: string; id: number }> = {};
    approvedRecords.forEach(r => {
      if (r.receiptNoteNo) {
        map[r.receiptNoteNo] = { supplierName: r.supplierName, id: r.id };
      }
    });
    return map;
  }, [approvedRecords]);

  // Derive stats
  const stats = useMemo(() => {
    const s = { total: history.length, uploaded: 0, verified: 0, edited: 0, approved: 0, rejected: 0, pdf: 0, qr: 0 };
    history.forEach(h => {
      if (h.action === 'UPLOADED') s.uploaded++;
      else if (h.action === 'VERIFIED') s.verified++;
      else if (h.action === 'EDITED' || h.action === 'EDIT_RECEIPT') s.edited++;
      else if (h.action === 'APPROVED') s.approved++;
      else if (h.action === 'REJECTED') s.rejected++;
      else if (h.action === 'DOWNLOAD_PDF' || h.action === 'DOWNLOADED_PDF') s.pdf++;
      else if (h.action === 'DOWNLOAD_QR' || h.action === 'DOWNLOADED_QR') s.qr++;
    });
    return s;
  }, [history]);

  // Filtering
  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const q = searchQuery.toLowerCase();
      const meta = ACTION_META[h.action] || { label: h.action };
      const supplier = supplierMap[h.receiptNoteNo]?.supplierName || '';
      
      const matchesSearch = q === '' || 
        (h.receiptNoteNo && h.receiptNoteNo.toLowerCase().includes(q)) ||
        (supplier.toLowerCase().includes(q));
        
      const matchesStatus = statusFilter === 'All Status' || meta.label === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [history, searchQuery, statusFilter, supplierMap]);

  const availableStatuses = ['All Status', 'Uploaded', 'Verified', 'Edited', 'Approved', 'Rejected', 'Downloaded PDF', 'Downloaded QR'];
  const availableUsers = ['All Users', 'Rakesh Kumar (Stores)', 'Sunil Verma (Reviewer)', 'Dy. Director (Stores)'];

  if (loading) return <div className="text-gray-600 py-8 text-center">Loading history...</div>;
  if (error) return <div className="p-8 text-red-600 bg-red-50 rounded-xl border border-red-200">Error: {error}</div>;

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Audit Log</h2>
        <p className="text-gray-500 mt-1.5 text-sm">Track every action performed on Railway Receipt Notes.</p>
      </div>

      {/* Top Filters */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap lg:flex-nowrap gap-5 items-end mb-8">
        <div className="flex-1 min-w-[250px] relative">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search Receipt Note No, Supplier..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 text-sm font-medium border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
          />
        </div>
        
        <div className="w-48 shrink-0">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Status</label>
          <select 
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none transition-shadow appearance-none"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
          >
            {availableStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="w-64 shrink-0">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">Date Range</label>
          <input 
            type="text" 
            placeholder="24/06/2026 → 27/06/2026"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-shadow text-gray-600"
            disabled
          />
        </div>

        <div className="w-48 shrink-0">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">User</label>
          <select 
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none transition-shadow appearance-none"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3e%3c/svg%3e")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
          >
            {availableUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>

        <button 
          onClick={() => { setSearchQuery(''); setStatusFilter('All Status'); setUserFilter('All Users'); }}
          className="shrink-0 px-6 py-2.5 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors border border-blue-100 cursor-pointer h-[42px] flex items-center justify-center"
        >
          Reset Filters
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
        <StatCard label="Total Activities" value={stats.total} icon={<History className="w-5 h-5 text-gray-500" strokeWidth={2} />} />
        <StatCard label="Uploaded" value={stats.uploaded} icon={<UploadIcon className="w-5 h-5 text-blue-600" strokeWidth={2} />} />
        <StatCard label="Verified" value={stats.verified} icon={<CheckSquare className="w-5 h-5 text-blue-500" strokeWidth={2} />} />
        <StatCard label="Edited" value={stats.edited} icon={<Edit className="w-5 h-5 text-blue-600" strokeWidth={2} />} />
        <StatCard label="Approved" value={stats.approved} icon={<CheckCircle className="w-5 h-5 text-green-600" strokeWidth={2} />} />
        <StatCard label="Rejected" value={stats.rejected} icon={<XCircle className="w-5 h-5 text-red-600" strokeWidth={2} />} />
        <StatCard label="Downloaded PDF" value={stats.pdf} icon={<FileText className="w-5 h-5 text-red-500" strokeWidth={2} />} />
        <StatCard label="Downloaded QR" value={stats.qr} icon={<QrCode className="w-5 h-5 text-indigo-500" strokeWidth={2} />} />
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {filteredHistory.length === 0 ? (
          <div className="p-16 text-center">
            <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-800 mb-1">No History Found</h3>
            <p className="text-gray-500 text-sm">No events match your current filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredHistory.map((entry, idx) => {
              const meta = ACTION_META[entry.action] || {
                icon: History, label: entry.action.replace(/_/g, ' '), color: 'text-gray-600', border: 'border-gray-400'
              };
              const Icon = meta.icon;
              
              let details: any = {};
              try { details = JSON.parse(entry.details || '{}'); } catch { }

              const supplierInfo = supplierMap[entry.receiptNoteNo];
              const supplierName = supplierInfo?.supplierName || 'M/s UNKNOWN';
              const recordId = entry.masterReceiptId || supplierInfo?.id;
              
              const userNames = ['Rakesh Kumar (Stores)', 'Sunil Verma (Reviewer)', 'Dy. Director (Stores)'];
              const mockUser = userNames[(entry.performedBy || 0) % userNames.length];
              const mockIp = '10.10.25.45';
              const isEdited = entry.action === 'EDITED' || entry.action === 'EDIT_RECEIPT';

              return (
                <div key={entry.id} className="p-6 lg:p-8 flex items-start group hover:bg-gray-50/50 transition-colors relative">
                  {idx !== filteredHistory.length - 1 && (
                    <div className="absolute left-[51px] top-[68px] bottom-[-32px] w-[2px] bg-gray-200" />
                  )}
                  
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-[2px] bg-white z-10 ${meta.border}`}>
                    <Icon className={`w-[18px] h-[18px] ${meta.color}`} strokeWidth={2.5} />
                  </div>
                  
                  <div className="ml-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    
                    {/* Action & Receipt Details */}
                    <div className="lg:col-span-3 space-y-3">
                      <div className={`text-[15px] font-extrabold ${meta.color} tracking-tight`}>{meta.label}</div>
                      
                      <div className="space-y-0.5 mt-1">
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Receipt Note No</div>
                        <div className="text-[15px] font-bold text-gray-900 tracking-tight">{entry.receiptNoteNo}</div>
                      </div>
                      
                      <div className="space-y-0.5 pt-1">
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Supplier</div>
                        <div className="text-[14px] text-gray-800 font-bold leading-tight">{supplierName}</div>
                      </div>
                    </div>

                    {/* User & IP Details */}
                    <div className="lg:col-span-3 space-y-3 lg:mt-7">
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">User</div>
                        <div className="text-[13px] text-gray-700 font-medium flex items-center gap-1.5">
                          <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                          {mockUser}
                        </div>
                      </div>
                      
                      <div className="space-y-0.5 pt-1">
                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">IP Address</div>
                        <div className="text-[13px] text-gray-500 font-mono tracking-tight">{mockIp}</div>
                      </div>
                    </div>

                    {/* Expandable Changes */}
                    <div className="lg:col-span-4 lg:mt-7 pr-4">
                      {isEdited && details.editedFields && (
                        <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100">
                          <div className="text-[11px] font-bold text-gray-900 mb-2">Changes Made</div>
                          <div className="grid grid-cols-3 gap-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-100 pb-2">
                            <div>Field</div>
                            <div>Previous Value</div>
                            <div>New Value</div>
                          </div>
                          <div className="space-y-2">
                            {details.editedFields.map((field: string, i: number) => (
                              <div key={i} className="grid grid-cols-3 gap-3 text-[13px]">
                                <div className="text-gray-700 capitalize font-medium">{field}</div>
                                <div className="text-gray-500 truncate" title="Previous Value">{details.previousValues?.[field] || '—'}</div>
                                <div className="text-gray-900 font-bold truncate" title="New Value">{details.newValues?.[field] || '—'}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {entry.action === 'REJECTED' && details.reason && (
                        <div className="bg-red-50/50 rounded-xl p-4 border border-red-100">
                          <div className="text-[11px] font-bold text-red-900 mb-2">Changes Made</div>
                           <div className="grid grid-cols-3 gap-3 text-[10px] font-bold text-red-400/80 uppercase tracking-widest mb-2 border-b border-red-100 pb-2">
                            <div>Field</div>
                            <div>Previous Value</div>
                            <div>New Value</div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-[13px]">
                             <div className="text-red-700 font-medium">Status</div>
                             <div className="text-red-500/70">PENDING</div>
                             <div className="text-red-700 font-bold truncate" title={details.reason}>{details.reason}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Timestamp & Action Button */}
                    <div className="lg:col-span-2 flex flex-col justify-between items-end text-right h-full">
                      <div className="text-[12px] text-gray-500 font-medium tracking-tight">
                        {new Date(entry.createdAt).toLocaleString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                        })}
                      </div>
                      
                      {recordId ? (
                        <Link 
                          to={`/record/${recordId}`}
                          className="mt-6 lg:mt-auto text-[13px] font-bold text-blue-600 flex items-center gap-2 hover:text-blue-700 transition-colors"
                        >
                          <EyeIcon />
                          View Receipt
                        </Link>
                      ) : (
                        <button disabled className="mt-6 lg:mt-auto text-[13px] font-bold text-gray-400 flex items-center gap-2 cursor-not-allowed">
                          <EyeIcon />
                          Not Found
                        </button>
                      )}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
  );
}

function StatCard({ label, value, icon }: { label: string, value: number, icon: any }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-center space-x-3 transition-shadow hover:shadow-md">
      <div className="w-10 h-10 rounded-xl border border-gray-100 flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' }}>
        {icon}
      </div>
      <div>
        <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest mb-0.5">{label}</div>
        <div className="text-2xl font-extrabold text-gray-900 leading-none">{value}</div>
      </div>
    </div>
  );
}
