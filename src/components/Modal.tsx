import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, AlertTriangle, XCircle, Ban } from 'lucide-react';

// ─── Base Modal Shell ────────────────────────────────────────────────────────

interface BaseModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** If true, clicking outside or pressing ESC will NOT close the modal */
  persistent?: boolean;
}

function BaseModal({ open, onClose, children, persistent = false }: BaseModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose();
    },
    [onClose, persistent],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      // Focus the modal content for accessibility
      setTimeout(() => contentRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !persistent) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            ref={contentRef}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md outline-none overflow-hidden"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Success Modal ───────────────────────────────────────────────────────────

interface SuccessModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  /** Label for the primary button. Defaults to "Continue" */
  buttonLabel?: string;
  /** Auto-close after N milliseconds. 0 = no auto-close */
  autoCloseMs?: number;
}

export function SuccessModal({
  open,
  onClose,
  title = 'Success',
  message = 'Operation completed successfully.',
  buttonLabel = 'Continue',
  autoCloseMs = 0,
}: SuccessModalProps) {
  useEffect(() => {
    if (open && autoCloseMs > 0) {
      const t = setTimeout(onClose, autoCloseMs);
      return () => clearTimeout(t);
    }
  }, [open, autoCloseMs, onClose]);

  return (
    <BaseModal open={open} onClose={onClose}>
      <div className="p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
             style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
          <CheckCircle className="w-9 h-9" style={{ color: '#059669' }} />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{message}</p>
        <button
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl font-semibold text-white transition-all duration-200 hover:shadow-lg"
          style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)' }}
        >
          {buttonLabel}
        </button>
      </div>
    </BaseModal>
  );
}

// ─── Error Modal ─────────────────────────────────────────────────────────────

interface ErrorModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}

export function ErrorModal({
  open,
  onClose,
  title = 'Error',
  message = 'Something went wrong. Please try again.',
}: ErrorModalProps) {
  return (
    <BaseModal open={open} onClose={onClose}>
      <div className="p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
             style={{ background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)' }}>
          <XCircle className="w-9 h-9" style={{ color: '#dc2626' }} />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">{message}</p>
        <button
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl font-semibold text-white transition-all duration-200 hover:shadow-lg"
          style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' }}
        >
          Dismiss
        </button>
      </div>
    </BaseModal>
  );
}

// ─── Confirmation Modal ──────────────────────────────────────────────────────

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' shows red confirm button. 'warning' shows orange. */
  variant?: 'danger' | 'warning';
  loading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  const isDanger = variant === 'danger';
  const iconColor = isDanger ? '#dc2626' : '#ea580c';
  const iconBg = isDanger
    ? 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)'
    : 'linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)';
  const btnBg = isDanger
    ? 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)'
    : 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)';

  return (
    <BaseModal open={open} onClose={onClose}>
      <div className="p-8">
        <div className="text-center mb-6">
          <div
            className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
            style={{ background: iconBg }}
          >
            <AlertTriangle className="w-9 h-9" style={{ color: iconColor }} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-600 text-sm leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-white transition-all duration-200 hover:shadow-lg disabled:opacity-50"
            style={{ background: btnBg }}
          >
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

// ─── Reject Modal ────────────────────────────────────────────────────────────

interface RejectModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title?: string;
  message?: string;
  loading?: boolean;
}

export function RejectModal({
  open,
  onClose,
  onConfirm,
  title = 'Reject Receipt',
  message = 'Please provide a reason for rejecting this receipt. This is required.',
  loading = false,
}: RejectModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError('Rejection reason is required');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Please provide a more detailed reason (at least 5 characters)');
      return;
    }
    setError('');
    onConfirm(reason.trim());
  };

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!open) {
      setReason('');
      setError('');
    }
  }, [open]);

  return (
    <BaseModal open={open} onClose={onClose}>
      <div className="p-8">
        <div className="text-center mb-6">
          <div
            className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)' }}
          >
            <Ban className="w-9 h-9" style={{ color: '#dc2626' }} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-600 text-sm leading-relaxed">{message}</p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(''); }}
            placeholder="Enter the reason for rejection..."
            rows={4}
            className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none ${
              error ? 'border-red-300 bg-red-50' : 'border-gray-300'
            }`}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !reason.trim()}
            className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-white transition-all duration-200 hover:shadow-lg disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' }}
          >
            {loading ? 'Rejecting…' : 'Reject Receipt'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
