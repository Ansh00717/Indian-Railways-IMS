import React, { useState } from 'react';
import { User } from '../App.tsx';
import { Upload, Flag, ArrowDownRight, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ErrorModal } from './Modal.tsx';

const FLAG_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  DUPLICATE_RNOTE: { label: 'Duplicate R/Note No', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  MISSING_FIELDS: { label: 'Missing Required Fields', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  LOW_OCR_CONFIDENCE: { label: 'Low OCR Confidence', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  INVALID_FORMAT: { label: 'Invalid Format Detected', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
};

export default function UploadFile({ user, token }: { user: User, token: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [errorModal, setErrorModal] = useState({ open: false, title: '', message: '' });
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError("");
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/receipts/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned an invalid response. Please check server logs.");
      }

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Upload failed");
      
      // Always navigate to pending after successful upload
      navigate("/pending");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-gray-800">Upload Document</h2>
      <div className="bg-white p-6 sm:p-8 rounded-xl border border-gray-200 shadow-sm">
        <label className="block w-full border-2 border-dashed border-gray-300 rounded-xl p-8 sm:p-12 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition">
          <Upload className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-gray-400 mb-4" />
          <span className="text-base sm:text-lg font-medium text-gray-700">
            {file ? file.name : "Click to browse or drag PDF here"}
          </span>
          <input type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
        </label>

        {error && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">{error}</div>}

        <button 
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-4 w-full bg-blue-600 text-white rounded-xl py-3 px-4 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {uploading ? "Extracting data..." : "Upload"}
        </button>
      </div>

      <ErrorModal
        open={errorModal.open}
        onClose={() => setErrorModal({ open: false, title: '', message: '' })}
        title={errorModal.title}
        message={errorModal.message}
      />
    </div>
  );
}
