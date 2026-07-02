import { useState, useEffect } from 'react';
import { User } from '../App.tsx';
import { Upload as UploadIcon, Clock, CheckCircle, QrCode, XCircle, AlertTriangle, Download } from 'lucide-react';

interface Stats {
  totalUploaded: number;
  pending: number;
  approved: number;
  rejected: number;
  exhausted: number;
  downloaded: number;
  totalQrGenerated: number;
}

const statCards = [
  { key: 'totalUploaded', label: 'Total Uploads', icon: UploadIcon, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  { key: 'pending', label: 'Pending Approvals', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { key: 'approved', label: 'Approved Records', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' },
  { key: 'exhausted', label: 'Expired', icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100' },
  { key: 'totalQrGenerated', label: 'Generated Receipts', icon: QrCode, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100' },
  { key: 'downloaded', label: 'Downloaded Receipts', icon: Download, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' },
] as const;

export default function Dashboard({ user, token }: { user: User, token: string | null }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setStats(data);
      } catch (err) {
        // Stats load failed silently
      }
    };
    
    fetchStats();
  }, [user, token]);

  if (!stats) return <div className="text-gray-600 py-8 text-center">Loading dashboard...</div>;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Dashboard</h2>
        <p className="text-gray-500 mt-1.5 text-sm font-medium">Welcome back, {user.fullName}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {statCards.map(({ key, label, icon: Icon, color, bg, border }) => (
          <div key={key} className={`bg-white p-5 sm:p-6 rounded-2xl border ${border} shadow-sm hover:shadow-lg transition-all hover:-translate-y-0.5 flex flex-col justify-center min-h-[100px]`}>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="text-[10px] sm:text-[11px] text-gray-500 font-extrabold uppercase tracking-widest truncate pr-2">{label}</div>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-5 h-5 sm:w-5 sm:h-5 ${color}`} />
              </div>
            </div>
            <div className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${color}`}>
              {(stats as any)[key] ?? 0}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
