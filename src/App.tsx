/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Upload, LayoutList, CheckCircle, LogOut, Shield, Menu, X, History } from 'lucide-react';
import WebsiteLogo from './assets/Website-Logo.png';
import Dashboard from './components/Dashboard.tsx';
import UploadFile from './components/UploadFile.tsx';
import PendingList from './components/PendingList.tsx';
import ApprovedList from './components/ApprovedList.tsx';
import RecordDetail from './components/RecordDetail.tsx';
import ReceiptHistory from './components/ReceiptHistory.tsx';
import Login from './components/Login.tsx';
import Register from './components/Register.tsx';
import AdminPanel from './components/AdminPanel.tsx';
import ForgotPassword from './components/ForgotPassword.tsx';
import PublicReceipt from './components/PublicReceipt.tsx';

export interface User {
  id: number;
  fullName: string;
  email: string;
  username: string;
}

function SidebarLink({ to, icon: Icon, label, badgeCount, onClick, isCollapsed }: { to: string; icon: any; label: string; badgeCount?: number; onClick?: () => void; isCollapsed?: boolean }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link
      to={to}
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={`flex items-center h-10 rounded-xl text-[13px] transition-all duration-[250ms] ease-in-out relative outline-none focus-visible:ring-2 focus-visible:ring-blue-500 overflow-hidden ${
        isActive
          ? 'bg-blue-50 text-blue-600 border border-blue-500 shadow-sm'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
      } ${isCollapsed ? 'w-12 mx-auto px-0 justify-center' : 'w-full px-4 justify-start'}`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={isActive ? 2.5 : 2} />
      <span 
        className={`whitespace-nowrap transition-all duration-[250ms] ease-in-out ${
          isCollapsed ? 'w-0 opacity-0 ml-0 overflow-hidden' : 'flex-1 opacity-100 ml-3'
        } ${isActive ? 'font-bold' : 'font-medium'}`}
      >
        {label}
      </span>
      <div className={`overflow-hidden transition-all duration-[250ms] ease-in-out flex items-center justify-end ${
        isCollapsed ? 'w-0 opacity-0 scale-0' : 'w-auto opacity-100 scale-100 ml-2'
      }`}>
        {badgeCount !== undefined && badgeCount > 0 && (
          <span className="bg-white text-gray-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-gray-200 shrink-0 shadow-sm">
            {badgeCount}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(localStorage.getItem('authToken'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('authToken', token);
      fetchMe();
      fetchPendingCount();
    } else {
      localStorage.removeItem('authToken');
      setUser(null);
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const handleReceiptAction = () => {
      if (token) fetchPendingCount();
    };
    window.addEventListener('receipt-action', handleReceiptAction);
    return () => window.removeEventListener('receipt-action', handleReceiptAction);
  }, [token]);

  const fetchMe = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setToken(null);
      }
    } catch (e) {
      setToken(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingCount = async () => {
    try {
      const res = await fetch('/api/receipts/pending?status=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setPendingCount(data.length);
        }
      }
    } catch (e) {
      console.error('Failed to fetch pending count');
    }
  };

  const handleLogout = () => {
    setToken(null);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <img src={WebsiteLogo} alt="RDSO Logo" className="w-[42px] h-[42px] object-contain mx-auto mb-3 animate-pulse" />
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    </div>
  );

  return (
    <Router>
      <Routes>
        {/* Public routes (no auth needed) */}
        <Route path="/r/:receiptId" element={<PublicReceipt />} />
        <Route path="/login" element={!user ? <Login setAuthToken={setToken} setUser={setUser} /> : <Navigate to="/" />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to="/" />} />
        <Route path="/forgot-password" element={!user ? <ForgotPassword /> : <Navigate to="/" />} />

        {/* Protected routes */}
        <Route path="*" element={
          user ? (
            <div className="h-screen flex overflow-hidden bg-[#f8fafc]">
              {/* Mobile menu overlay */}
              {sidebarOpen && (
                <div
                  className="fixed inset-0 bg-black/40 z-40 lg:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
              )}

              {/* Sidebar */}
              <div 
                className={`
                  fixed inset-y-0 left-0 z-50
                  bg-white border-r border-gray-200 flex flex-col h-screen
                  transition-all ease-in-out
                  ${isCollapsed ? 'lg:w-20' : 'w-64 lg:w-64'}
                  ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
                `}
                style={{ transitionDuration: '250ms' }}
              >
                {/* Desktop Header Area (Interactive Toggle) */}
                <div 
                  className="hidden lg:flex items-center px-[20px] py-[20px] cursor-pointer hover:bg-gray-50 transition-colors group outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0 border-b border-transparent hover:border-gray-200 h-[80px]"
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIsCollapsed(!isCollapsed);
                    }
                  }}
                  tabIndex={0}
                  aria-label={isCollapsed ? "Open sidebar" : "Close sidebar"}
                  title={isCollapsed ? "Open sidebar" : "Close sidebar"}
                >
                  <div className="w-[40px] h-[40px] shrink-0 flex items-center justify-center">
                    <img src={WebsiteLogo} alt="RDSO" className="w-[38px] h-[38px] object-contain transition-transform group-hover:scale-105 duration-300" />
                  </div>
                  
                  <div 
                    className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-[250ms] ease-in-out ${
                      isCollapsed ? 'w-0 opacity-0 ml-0' : 'w-[120px] opacity-100 ml-3'
                    }`}
                  >
                    <span className="font-bold text-[16px] tracking-tight text-gray-900 leading-tight">RDSO</span>
                    <span className="text-[11px] font-medium text-gray-500 leading-tight">Indian Railways</span>
                  </div>

                  <div 
                    className={`ml-auto flex items-center justify-end overflow-hidden transition-all duration-[250ms] ease-in-out ${
                      isCollapsed ? 'w-0 opacity-0' : 'w-8 opacity-100'
                    }`}
                  >
                     <Menu className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                  </div>
                </div>

                {/* Mobile Header (Hidden on Desktop) */}
                <div className="lg:hidden p-4 flex items-center justify-between shrink-0 h-[80px] border-b border-gray-100">
                  <div className="flex items-center space-x-3">
                    <img src={WebsiteLogo} alt="RDSO" className="w-[42px] h-[42px] object-contain shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold text-[16px] tracking-tight text-gray-900 leading-tight">RDSO</span>
                      <span className="text-[11px] font-medium text-gray-500 leading-tight">Indian Railways</span>
                    </div>
                  </div>
                  <button onClick={() => setSidebarOpen(false)} className="p-1 hover:bg-gray-100 rounded">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                <nav className={`flex-1 ${isCollapsed ? 'px-2' : 'px-4'} py-4 space-y-1.5 overflow-y-auto overflow-x-hidden transition-all duration-[250ms] ease-in-out`}>
                  <SidebarLink to="/" icon={LayoutList} label="Dashboard" onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  <SidebarLink to="/upload" icon={Upload} label="Upload PDF" onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  <SidebarLink to="/pending" icon={CheckCircle} label="Pending Approvals" badgeCount={pendingCount} onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  <SidebarLink to="/approved" icon={CheckCircle} label="Approved Records" onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  <SidebarLink to="/history" icon={History} label="Audit Log" onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  {user.username === 'admin' && (
                    <SidebarLink to="/admin" icon={Shield} label="Admin Panel" onClick={() => setSidebarOpen(false)} isCollapsed={isCollapsed} />
                  )}
                </nav>
                
                {/* User Section */}
                <div className="mt-auto shrink-0 border-t border-gray-100 bg-white flex flex-col items-center py-5 overflow-hidden">
                  <div className={`flex items-center w-full px-[20px] transition-all duration-[250ms] ease-in-out`}>
                    <div className="w-[40px] h-[40px] rounded-full bg-blue-50 flex items-center justify-center shrink-0 shadow-inner" title={user.fullName}>
                      <span className="text-blue-600 font-bold text-lg">{user.fullName.charAt(0).toUpperCase()}</span>
                    </div>
                    
                    <div className={`flex flex-col whitespace-nowrap overflow-hidden transition-all duration-[250ms] ease-in-out ${
                      isCollapsed ? 'w-0 opacity-0 ml-0 hidden lg:flex' : 'flex-1 opacity-100 ml-3'
                    }`}>
                      <div className="text-[13px] font-bold text-gray-900 truncate">{user.fullName}</div>
                      <div className="text-[11px] text-gray-500 truncate">{user.email}</div>
                    </div>
                    
                    <div className={`flex items-center justify-end overflow-hidden transition-all duration-[250ms] ease-in-out ${
                      isCollapsed ? 'w-0 opacity-0' : 'w-8 opacity-100 ml-2'
                    }`}>
                      <button onClick={handleLogout} className="text-gray-400 hover:text-red-600 transition-colors p-1" title="Sign out">
                        <LogOut className="w-5 h-5" strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  {/* Desktop Collapsed LogOut (Animated) */}
                  <div className={`hidden lg:flex overflow-hidden transition-all duration-[250ms] ease-in-out ${
                    isCollapsed ? 'h-10 opacity-100 mt-4' : 'h-0 opacity-0 mt-0'
                  }`}>
                    <button onClick={handleLogout} className="text-red-600 hover:text-red-700 transition-colors p-2 rounded-full hover:bg-red-50" title="Sign out">
                      <LogOut className="w-5 h-5" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div 
                className={`flex-1 overflow-y-auto min-w-0 flex flex-col transition-all ease-in-out
                  ${isCollapsed ? 'lg:pl-20' : 'lg:pl-64'}
                `}
                style={{ transitionDuration: '250ms' }}
              >
                {/* Mobile header */}
                <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center space-x-3 shrink-0">
                  <button onClick={() => setSidebarOpen(true)} className="p-1 hover:bg-gray-100 rounded">
                    <Menu className="w-5 h-5 text-gray-600" />
                  </button>
                  <div className="flex items-center space-x-2">
                    <img src={WebsiteLogo} alt="RDSO" className="w-[32px] h-[32px] object-contain" />
                    <span className="font-semibold text-sm">RDSO Indian Railways</span>
                  </div>
                </div>

                <div className="flex-1 p-4 sm:p-8 lg:p-10 max-w-[1400px] w-full mx-auto">
                  <Routes>
                    <Route path="/" element={<Dashboard user={user} token={token} />} />
                    <Route path="/upload" element={<UploadFile user={user} token={token} />} />
                    <Route path="/pending" element={<PendingList user={user} token={token} />} />
                    <Route path="/approved" element={<ApprovedList user={user} token={token} />} />
                    <Route path="/history" element={<ReceiptHistory user={user} token={token} />} />
                    <Route path="/record/:id" element={<RecordDetail user={user} token={token} />} />
                    <Route path="/history/:receiptNoteNo" element={<ReceiptHistory user={user} token={token} />} />
                    {user.username === 'admin' && <Route path="/admin" element={<AdminPanel user={user} token={token} />} />}
                    <Route path="*" element={<Navigate to="/" />} />
                  </Routes>
                </div>
              </div>
            </div>
          ) : (
            <Navigate to="/login" />
          )
        } />
      </Routes>
    </Router>
  );
}
