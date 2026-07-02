import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Download, AlertTriangle, Ban, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { ReceiptTemplate } from './ReceiptTemplate.tsx';

export default function PublicReceipt() {
  const { receiptId } = useParams();
  const [record, setRecord] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [qrImage, setQrImage] = useState<string>('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    const fetchRecord = async () => {
      try {
        const res = await fetch(`/api/receipts/public/${receiptId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Receipt not found');
        setRecord(data);

        // Generate QR image from URL
        if (data.qrCodeData && !data.qrCodeData.startsWith('data:')) {
          try {
            const img = await QRCode.toDataURL(data.qrCodeData, { errorCorrectionLevel: 'M', margin: 2 });
            setQrImage(img);
          } catch {}
        } else if (data.qrCodeData) {
          setQrImage(data.qrCodeData);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchRecord();
  }, [receiptId]);

  const d = (field: string) => record?.[field] || '';
  const exhausted = record?.isExhausted || record?.status === 'exhausted';
  const balance = record?.currentBalance ? parseFloat(record.currentBalance) : null;

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="receipt-mono text-xl tracking-widest text-gray-600 animate-pulse">LOADING...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="receipt-container max-w-lg w-full text-center py-12">
          <div className="text-2xl receipt-mono mb-4">RECEIPT NOT FOUND</div>
          <div className="text-sm text-gray-500">{error}</div>
        </div>
      </div>
    );
  }

  const receiptNo = d('receiptNoteNo') || `REC-${record?.id || ''}`;
  const now = new Date();

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

  const handleDownloadPdf = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (exhausted || !record?.id || isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    setDownloadError("");
    
    try {
      await fetch(`/api/receipts/master/${record.id}/log-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      const res = await fetch(`/api/receipts/master/${record.id}/pdf`);
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
    <div className="min-h-screen bg-gray-100 py-8 px-4 flex flex-col items-center print:bg-white print:py-0 print:block">
      {/* Exhaustion Banner */}
      {exhausted && (
        <div className="w-full max-w-[700px] mb-4 print:hidden">
          <div className="bg-orange-500 text-white p-4 rounded-xl flex items-center space-x-3">
            <Ban className="w-6 h-6 shrink-0" />
            <div>
              <div className="font-bold">Receipt Expired</div>
              <div className="text-sm opacity-90">This receipt's balance has reached zero. Downloads are disabled.</div>
            </div>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        <ReceiptTemplate record={record} qrImage={qrImage} className="w-full max-w-[800px]" />
      </div>

      {downloadError && (
        <div className="w-full max-w-[700px] mb-4 print:hidden text-center">
          <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm w-full">
            {downloadError}
          </div>
        </div>
      )}

      {/* ═══ ACTION BUTTONS (hidden in print) ═══ */}
      <div className="w-full max-w-[700px] mt-4 flex flex-col sm:flex-row gap-4 justify-center print:hidden">
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
          disabled={exhausted || isDownloadingPdf}
          title={exhausted ? "Unavailable for expired receipts" : undefined}
          className={`flex-1 flex items-center justify-center space-x-2 px-6 py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition shadow-sm ${
            exhausted
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : isDownloadingPdf
              ? 'bg-blue-600 text-white cursor-wait'
              : 'bg-blue-800 text-white hover:bg-blue-900'
          }`}
        >
          {isDownloadingPdf ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          <span>{isDownloadingPdf ? 'Downloading...' : (exhausted ? 'Download Locked' : 'Download PDF')}</span>
        </button>
        <button
          onClick={handlePrint}
          className="flex-1 flex items-center justify-center px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold uppercase tracking-wider text-sm hover:bg-gray-50 transition shadow-sm"
        >
          Print Receipt
        </button>
      </div>
    </div>
  );
}

/** Dashed line separator matching Indian Railways receipt style */
function Separator() {
  return (
    <div className="px-4 overflow-hidden">
      <div className="receipt-mono text-gray-400 text-xs leading-none select-none" style={{ letterSpacing: '2px' }}>
        {'─'.repeat(80)}
      </div>
    </div>
  );
}

/** Monospace field row: LABEL    : VALUE */
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
