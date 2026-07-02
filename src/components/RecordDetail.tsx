import { useState, useEffect } from 'react';
import { User } from '../App.tsx';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, AlertTriangle, History, ArrowDownRight, CheckCircle, XCircle, Upload as UploadIcon, Ban, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { ReceiptTemplate } from './ReceiptTemplate.tsx';

const ACTION_ICONS: Record<string, any> = {
  UPLOADED: UploadIcon,
  APPROVED: CheckCircle,
  REJECTED: XCircle,
  BALANCE_DEDUCTED: ArrowDownRight,
  RECEIPT_EXHAUSTED: AlertTriangle,
  QR_DISABLED: AlertTriangle,
  RECEIPT_ADJUSTED: ArrowDownRight,
};

const ACTION_COLORS: Record<string, string> = {
  UPLOADED: 'text-blue-600 bg-blue-50',
  APPROVED: 'text-green-600 bg-green-50',
  REJECTED: 'text-red-600 bg-red-50',
  BALANCE_DEDUCTED: 'text-purple-600 bg-purple-50',
  RECEIPT_EXHAUSTED: 'text-orange-600 bg-orange-50',
  QR_DISABLED: 'text-orange-600 bg-orange-50',
  RECEIPT_ADJUSTED: 'text-indigo-600 bg-indigo-50',
};

export default function RecordDetail({ user, token }: { user: User, token: string | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<any>(null);
  const [error, setError] = useState("");
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [qrImage, setQrImage] = useState<string>('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    const fetchRecord = async () => {
      try {
        const res = await fetch(`/api/receipts/master/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRecord(data);

        // Generate QR image from URL
        if (data.qrCodeData && !data.qrCodeData.startsWith('data:')) {
          try {
            const img = await QRCode.toDataURL(data.qrCodeData, { errorCorrectionLevel: 'M', margin: 2 });
            setQrImage(img);
          } catch { }
        } else if (data.qrCodeData) {
          setQrImage(data.qrCodeData);
        }

        // Fetch history if we have a receipt note no
        if (data.receiptNoteNo) {
          try {
            const hRes = await fetch(`/api/receipts/history/${encodeURIComponent(data.receiptNoteNo)}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const hData = await hRes.json();
            setHistoryEntries(Array.isArray(hData) ? hData : []);
          } catch { }
        }
      } catch (e: any) {
        setError(e.message);
      }
    };
    fetchRecord();
  }, [id, user]);

  if (error) return <div className="p-8 text-red-600 bg-red-50 rounded-xl border border-red-200">Error: {error}</div>;
  if (!record) return <div className="text-gray-600 py-8 text-center">Loading record details...</div>;

  const d = (field: string) => record[field] || '';
  const exhausted = record.status === 'exhausted' || parseFloat(record.currentBalance || '0') <= 0;
  const balance = record.currentBalance ? parseFloat(record.currentBalance) : null;
  const receiptNo = d('receiptNoteNo') || `REC-${record.id}`;

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(url), 100);
  };

  const handleDownloadPdf = async () => {
    if (!record.pdfData || exhausted || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    setDownloadError("");
    
    try {
      await fetch(`/api/receipts/master/${record.id}/log-download`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      const res = await fetch(`/api/receipts/master/${record.id}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error("Unable to download receipt. Please try again.");
      
      const blob = await res.blob();
      triggerBlobDownload(blob, `Receipt_${receiptNo}.pdf`);
    } catch (e: any) {
      setDownloadError(e.message || "Unable to download receipt. Please try again.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDownloadQr = async () => {
    if (!qrImage || exhausted || isDownloadingQr) return;
    setIsDownloadingQr(true);
    setDownloadError("");

    try {
      let blob: Blob;
      if (qrImage.startsWith('data:')) {
        const [header, base64] = qrImage.split(',');
        const mimeString = header.split(':')[1].split(';')[0];
        const byteString = atob(base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        blob = new Blob([ab], { type: mimeString });
      } else {
        const res = await fetch(qrImage);
        if (!res.ok) throw new Error();
        blob = await res.blob();
      }
      triggerBlobDownload(blob, `QR_${receiptNo}.png`);
    } catch (e) {
      setDownloadError("QR download failed. Please retry.");
    } finally {
      setIsDownloadingQr(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 flex flex-col items-center">
      {/* Exhaustion Banner */}
      {exhausted && (
        <div className="bg-orange-500 text-white p-4 rounded-xl flex items-center space-x-3 w-full">
          <Ban className="w-6 h-6 shrink-0" />
          <div>
            <div className="font-bold">Receipt Expired</div>
            <div className="text-sm opacity-90">This receipt's balance has reached zero. Downloads are disabled.</div>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        <ReceiptTemplate record={record} qrImage={qrImage} />
      </div>

      {downloadError && (
        <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm w-full max-w-md text-center">
          {downloadError}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-md">
        {qrImage && !exhausted && (
          <button
            onClick={handleDownloadQr}
            disabled={isDownloadingQr}
            className={`flex-1 flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition shadow-sm ${
              isDownloadingQr ? 'bg-gray-600 text-white cursor-wait' : 'bg-gray-800 text-white hover:bg-gray-900'
            }`}
          >
            {isDownloadingQr ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            <span>{isDownloadingQr ? 'Saving...' : 'Save QR Code'}</span>
          </button>
        )}
        <button
          onClick={handleDownloadPdf}
          disabled={exhausted || !record.pdfData || isDownloadingPdf}
          title={exhausted ? "Unavailable for expired receipts" : undefined}
          className={`flex-1 flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition shadow-sm ${
            exhausted || !record.pdfData
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : isDownloadingPdf
              ? 'bg-blue-600 text-white cursor-wait'
              : 'bg-blue-800 text-white hover:bg-blue-900'
            }`}
        >
          {isDownloadingPdf ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          <span>{isDownloadingPdf ? 'Downloading...' : 'Download'}</span>
        </button>

      </div>


    </div>
  );
}

/** Dashed line separator */
function Separator() {
  return (
    <div className="px-4 overflow-hidden">
      <div className="receipt-mono text-gray-400 text-xs leading-none select-none" style={{ letterSpacing: '2px' }}>
        {'─'.repeat(80)}
      </div>
    </div>
  );
}

/** Monospace field row */
function FieldRow({ label, value }: { label: string; value: string }) {
  const displayValue = value || '—';
  return (
    <div className="receipt-mono text-xs flex">
      <span className="text-gray-700 shrink-0" style={{ width: '240px' }}>{label}</span>
      <span className="text-gray-500 mx-2 shrink-0">:</span>
      <span className="text-gray-900 font-medium break-words">{displayValue}</span>
    </div>
  );
}
