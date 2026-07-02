import React, { useState } from 'react';
import { KeyRound, ArrowLeft } from 'lucide-react';
import WebsiteLogo from '../assets/Website-Logo.png';
import { Link, useNavigate } from 'react-router-dom';
import { SuccessModal, ErrorModal } from './Modal.tsx';

type Step = 'username' | 'reset';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    setError('');
    setStep('reset');
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed');
      setShowSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center">
          <img src={WebsiteLogo} alt="RDSO" className="w-[64px] h-[64px] object-contain shrink-0 mb-3" />
          <div className="flex flex-col items-center">
            <span className="font-extrabold text-[24px] tracking-tight text-gray-900 leading-tight">RDSO</span>
            <span className="text-[14px] font-semibold tracking-wide uppercase text-gray-500 leading-tight mt-1">Indian Railways</span>
          </div>
          <p className="text-gray-500 mt-6 font-medium">
            {step === 'username' && 'Enter your username to begin'}
            {step === 'reset' && 'Set your new password'}
          </p>
        </div>

        <div className="flex items-center justify-center mb-6 space-x-2">
          {['username', 'reset'].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? 'bg-blue-600 text-white' :
                (['username', 'reset'].indexOf(step) > i) ? 'bg-green-100 text-green-700' :
                'bg-gray-100 text-gray-400'
              }`}>
                {i + 1}
              </div>
              {i < 1 && <div className={`w-8 h-0.5 ${(['username', 'reset'].indexOf(step) > i) ? 'bg-green-300' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm border border-red-200">
            {error}
          </div>
        )}

        {/* Step 1: Username */}
        {step === 'username' && (
          <form onSubmit={handleUsernameSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                required
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-blue-500 focus:border-blue-500"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 px-4 hover:bg-blue-700 transition font-medium"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        )}



        {/* Step 3: New Password */}
        {step === 'reset' && (
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                required
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-blue-500 focus:border-blue-500"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-blue-500 focus:border-blue-500"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 px-4 hover:bg-blue-700 transition flex justify-center items-center font-medium"
            >
              {loading ? 'Resetting...' : <><KeyRound className="w-4 h-4 mr-2" /> Reset Password</>}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-600">
          <Link to="/login" className="text-blue-600 hover:underline font-medium inline-flex items-center">
            <ArrowLeft className="w-3 h-3 mr-1" /> Back to Sign In
          </Link>
        </div>
      </div>

      <SuccessModal
        open={showSuccess}
        onClose={() => { setShowSuccess(false); navigate('/login'); }}
        title="Password Reset Successful"
        message="Your password has been changed. You can now sign in with your new password."
        buttonLabel="Sign In"
        autoCloseMs={3000}
      />
    </div>
  );
}
