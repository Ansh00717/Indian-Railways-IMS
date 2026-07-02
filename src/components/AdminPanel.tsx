import React, { useState, useEffect } from 'react';
import { User } from '../App.tsx';
import { Shield, Search, Edit2, Trash2, PowerOff, Power, Users, BarChart3, FileText, Upload as UploadIcon, CheckCircle, XCircle, ArrowDownRight, AlertTriangle } from 'lucide-react';
import { ConfirmModal, SuccessModal, ErrorModal } from './Modal.tsx';

type AdminTab = 'users' | 'monitoring' | 'audit';

const ACTION_COLORS: Record<string, string> = {
  UPLOADED: 'text-blue-600',
  APPROVED: 'text-green-600',
  REJECTED: 'text-red-600',
  BALANCE_DEDUCTED: 'text-purple-600',
  RECEIPT_EXHAUSTED: 'text-orange-600',
  QR_DISABLED: 'text-orange-600',
};

export default function AdminPanel({ user, token }: { user: User, token: string | null }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  return (
    <div>
      {/* Tab Header */}
      <div className="flex items-center space-x-2 mb-6">
        <Shield className="w-6 h-6 text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-800">Admin Panel</h2>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            activeTab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Users</span>
        </button>
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            activeTab === 'monitoring' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Monitoring</span>
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition ${
            activeTab === 'audit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Trail</span>
        </button>
      </div>

      {activeTab === 'users' && <UsersTab user={user} token={token} />}
      {activeTab === 'monitoring' && <MonitoringTab token={token} />}
      {activeTab === 'audit' && <AuditTab token={token} />}
    </div>
  );
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab({ user, token }: { user: User, token: string | null }) {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 10;
  
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ fullName: '', username: '', email: '' });

  // Modal state
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [suspendTarget, setSuspendTarget] = useState<any>(null);
  const [successModal, setSuccessModal] = useState({ open: false, title: '', message: '' });
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });
  const [modalLoading, setModalLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`/api/admin/users?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      } else {
        setErrorModal({ open: true, title: 'Fetch Failed', message: 'Failed to fetch users. Please try again.' });
      }
    } catch (e) {
      setErrorModal({ open: true, title: 'Network Error', message: 'Could not connect to the server.' });
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, search]);

  const handleStatusToggle = (u: any) => {
    if (u.id === user.id) {
      setErrorModal({ open: true, title: 'Action Denied', message: 'You cannot modify your own admin account status.' });
      return;
    }
    setSuspendTarget(u);
  };

  const confirmStatusToggle = async () => {
    if (!suspendTarget) return;
    setModalLoading(true);
    const newStatus = suspendTarget.isActive === 1 ? 0 : 1;
    try {
      const res = await fetch(`/api/admin/users/${suspendTarget.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ isActive: newStatus })
      });
      if (res.ok) {
        setSuspendTarget(null);
        fetchUsers();
        setSuccessModal({
          open: true,
          title: newStatus === 1 ? 'Account Enabled' : 'Account Suspended',
          message: `${suspendTarget.fullName}'s account has been ${newStatus === 1 ? 'enabled' : 'suspended'} successfully.`
        });
      } else {
        setSuspendTarget(null);
        setErrorModal({ open: true, title: 'Action Failed', message: 'Failed to change user status.' });
      }
    } catch (e) {
      setSuspendTarget(null);
      setErrorModal({ open: true, title: 'Network Error', message: 'Could not connect to the server.' });
    } finally {
      setModalLoading(false);
    }
  };

  const handleDelete = (u: any) => {
    if (u.id === user.id) {
      setErrorModal({ open: true, title: 'Action Denied', message: 'You cannot delete your own admin account.' });
      return;
    }
    setDeleteTarget(u);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setModalLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setDeleteTarget(null);
        fetchUsers();
        setSuccessModal({ open: true, title: 'User Deleted', message: 'The user and all their data have been permanently removed.' });
      } else {
        const data = await res.json();
        setDeleteTarget(null);
        setErrorModal({ open: true, title: 'Delete Failed', message: data.error || 'Failed to delete user.' });
      }
    } catch (e) {
      setDeleteTarget(null);
      setErrorModal({ open: true, title: 'Network Error', message: 'Could not connect to the server.' });
    } finally {
      setModalLoading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
        setSuccessModal({ open: true, title: 'User Updated', message: 'User details have been saved successfully.' });
      } else {
        setErrorModal({ open: true, title: 'Update Failed', message: 'Failed to update user details.' });
      }
    } catch (e) {
      setErrorModal({ open: true, title: 'Network Error', message: 'Could not connect to the server.' });
    }
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200">
      <div className="p-6 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-gray-800">User Management</h3>
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text"
            placeholder="Search username or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-10 pr-4 py-2 border rounded-md w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-sm">
              <th className="p-4 font-medium border-b">ID</th>
              <th className="p-4 font-medium border-b">User Info</th>
              <th className="p-4 font-medium border-b">Dates</th>
              <th className="p-4 font-medium border-b">Status</th>
              <th className="p-4 font-medium border-b text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50 transition">
                <td className="p-4 text-sm text-gray-700 font-mono">{u.id}</td>
                <td className="p-4">
                  <div className="font-medium text-gray-900">{u.fullName}</div>
                  <div className="text-sm text-gray-500">@{u.username} &bull; {u.email}</div>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  <div>Created: {new Date(u.createdAt).toLocaleDateString()}</div>
                  <div className="text-xs text-gray-400">Last Login: {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</div>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${u.isActive === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.isActive === 1 ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="p-4 text-right space-x-2">
                  <button onClick={() => { setEditingUser(u); setEditForm({ fullName: u.fullName, username: u.username, email: u.email }); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {u.id !== user.id && (
                    <>
                      <button onClick={() => handleStatusToggle(u)} className={`p-2 rounded ${u.isActive === 1 ? 'text-orange-600 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`} title={u.isActive === 1 ? 'Disable' : 'Enable'}>
                        {u.isActive === 1 ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </button>
                      <button onClick={() => handleDelete(u)} className="p-2 text-red-600 hover:bg-red-50 rounded" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500">No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t flex justify-between items-center text-sm text-gray-600">
        <div>Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} entries</div>
        <div className="space-x-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50">Previous</button>
          <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50">Next</button>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" style={{ backdropFilter: 'blur(4px)' }}>
          <form onSubmit={handleEditSubmit} className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-bold mb-4">Edit User</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input required type="text" value={editForm.fullName} onChange={e => setEditForm({...editForm, fullName: e.target.value})} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input required type="text" value={editForm.username} onChange={e => setEditForm({...editForm, username: e.target.value})} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input required type="email" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 text-gray-600 border rounded hover:bg-gray-50">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete User Account"
        message={deleteTarget ? `Are you sure you want to permanently delete ${deleteTarget.fullName}'s account? This will remove all their receipts, transaction logs, and data. This action cannot be undone.` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={modalLoading}
      />

      {/* Suspend/Enable Confirmation Modal */}
      <ConfirmModal
        open={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        onConfirm={confirmStatusToggle}
        title={suspendTarget?.isActive === 1 ? 'Suspend User Account' : 'Enable User Account'}
        message={suspendTarget ? (
          suspendTarget.isActive === 1
            ? `Are you sure you want to suspend ${suspendTarget.fullName}'s account? They will not be able to log in until re-enabled. Their data will be preserved.`
            : `Are you sure you want to re-enable ${suspendTarget.fullName}'s account? They will be able to log in again.`
        ) : ''}
        confirmLabel={suspendTarget?.isActive === 1 ? 'Suspend' : 'Enable'}
        cancelLabel="Cancel"
        variant={suspendTarget?.isActive === 1 ? 'warning' : 'danger'}
        loading={modalLoading}
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

// ─── Monitoring Tab ─────────────────────────────────────────────────────────

function MonitoringTab({ token }: { token: string | null }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMonitoring = async () => {
      try {
        const res = await fetch('/api/admin/monitoring', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const d = await res.json();
          setData(d);
        }
      } catch (e) {
        // Silent fail
      } finally {
        setLoading(false);
      }
    };
    fetchMonitoring();
  }, []);

  if (loading) return <div className="text-gray-600 py-8 text-center">Loading monitoring data...</div>;
  if (!data) return <div className="text-gray-500 py-8 text-center">Failed to load monitoring data.</div>;

  const statCards = [
    { label: 'Total Users', value: data.users.total, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Active Users', value: data.users.active, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Total Uploads', value: data.uploads.total, icon: UploadIcon, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Pending Uploads', value: data.uploads.pending, icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Rejected', value: data.uploads.rejected, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Approved Receipts', value: data.receipts.total, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Active Receipts', value: data.receipts.active, icon: FileText, color: 'text-teal-600', bg: 'bg-teal-50' },
    { label: 'Expired Receipts', value: data.receipts.exhausted, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Total Adjustments', value: data.adjustments, icon: ArrowDownRight, color: 'text-purple-600', bg: 'bg-purple-50' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center space-x-3 mb-2">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{label}</div>
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      {data.recentHistory && data.recentHistory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-200">
            <h3 className="text-lg font-bold text-gray-800">Recent Activity</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs">
                  <th className="p-3 font-medium border-b">Action</th>
                  <th className="p-3 font-medium border-b">R/Note No</th>
                  <th className="p-3 font-medium border-b">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recentHistory.map((entry: any) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-3">
                      <span className={`text-xs font-semibold ${ACTION_COLORS[entry.action] || 'text-gray-600'}`}>
                        {entry.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-sm font-mono text-gray-700">{entry.receiptNoteNo}</td>
                    <td className="p-3 text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audit Trail Tab ────────────────────────────────────────────────────────

function AuditTab({ token }: { token: string | null }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 15;

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (e) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, [page, search]);

  if (loading && !data) return <div className="text-gray-600 py-8 text-center">Loading audit trail...</div>;
  if (!data) return <div className="text-gray-500 py-8 text-center">Failed to load audit data.</div>;

  const { records, total } = data;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by Receipt No, Supplier, or Invoice..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Audit Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs">
                <th className="p-3 font-medium border-b">R/Note No.</th>
                <th className="p-3 font-medium border-b">Supplier</th>
                <th className="p-3 font-medium border-b">Uploader</th>
                <th className="p-3 font-medium border-b">Approved By</th>
                <th className="p-3 font-medium border-b">Approval Time</th>
                <th className="p-3 font-medium border-b">Edits</th>
                <th className="p-3 font-medium border-b">Status</th>
                <th className="p-3 font-medium border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any) => {
                const isExpanded = expandedId === r.id;
                let editedFieldsList: string[] = [];
                try { editedFieldsList = JSON.parse(r.editedFields || '[]'); } catch {}

                return (
                  <React.Fragment key={r.id}>
                    <tr className={`border-b hover:bg-gray-50 transition ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                      <td className="p-3 text-sm font-mono text-gray-800">{r.receiptNoteNo || '—'}</td>
                      <td className="p-3 text-sm text-gray-700 max-w-[160px] truncate" title={r.supplierName}>{r.supplierName || '—'}</td>
                      <td className="p-3 text-sm text-gray-600">{r.uploaderName}</td>
                      <td className="p-3 text-sm text-gray-600">{r.approvedByName || '—'}</td>
                      <td className="p-3 text-xs text-gray-500">{r.approvedAt ? new Date(r.approvedAt).toLocaleString() : '—'}</td>
                      <td className="p-3">
                        {(r.adjustmentCount || 0) > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">
                            {r.adjustmentCount} edits
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          r.status === 'active' ? 'bg-green-100 text-green-700' :
                          r.status === 'exhausted' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {r.status || 'active'}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          {isExpanded ? 'Collapse' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="p-4 bg-gray-50 border-b">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            {/* Column 1: Receipt Info */}
                            <div className="space-y-2">
                              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide">Receipt Info</h4>
                              <div><span className="text-gray-500">Invoice:</span> <span className="font-mono">{r.invoiceNumber || '—'}</span></div>
                              <div><span className="text-gray-500">Value:</span> {r.value ? `₹ ${r.value}` : '—'}</div>
                              <div><span className="text-gray-500">Qty:</span> {r.quantity || '—'}</div>
                              <div><span className="text-gray-500">Balance:</span> <span className={r.status === 'exhausted' ? 'text-orange-600 font-bold' : 'text-emerald-600 font-bold'}>{r.currentBalance || '—'}</span></div>
                              <div><span className="text-gray-500">Verification:</span> <span className={`font-medium ${
                                r.verificationStatus === 'auto_verified' ? 'text-green-600' :
                                r.verificationStatus === 'manually_verified' ? 'text-blue-600' : 'text-gray-500'
                              }`}>{(r.verificationStatus || 'unverified').replace(/_/g, ' ')}</span></div>
                            </div>
                            {/* Column 2: Edit Info */}
                            <div className="space-y-2">
                              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide">Edit History</h4>
                              {editedFieldsList.length > 0 ? (
                                <>
                                  <div><span className="text-gray-500">Edited By:</span> {r.editedByName || '—'}</div>
                                  <div><span className="text-gray-500">Edited At:</span> {r.editedAt ? new Date(r.editedAt).toLocaleString() : '—'}</div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {editedFieldsList.map((f: string) => (
                                      <span key={f} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold">{f}</span>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <div className="text-gray-400 text-xs">No manual edits recorded</div>
                              )}
                            </div>
                            {/* Column 3: Activity Timeline */}
                            <div className="space-y-2">
                              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wide">Activity Timeline</h4>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {(r.history || []).slice(0, 10).map((h: any, idx: number) => (
                                  <div key={idx} className="flex items-start gap-2 text-xs">
                                    <span className={`font-semibold shrink-0 ${
                                      ACTION_COLORS[h.action] || 'text-gray-600'
                                    }`}>{h.action.replace(/_/g, ' ')}</span>
                                    <span className="text-gray-400">{new Date(h.createdAt).toLocaleString()}</span>
                                  </div>
                                ))}
                                {(!r.history || r.history.length === 0) && (
                                  <div className="text-gray-400 text-xs">No activity recorded</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">No audit records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t flex justify-between items-center text-sm text-gray-600">
          <div>Showing {Math.min((page - 1) * limit + 1, total)} to {Math.min(page * limit, total)} of {total} entries</div>
          <div className="space-x-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50">Previous</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
