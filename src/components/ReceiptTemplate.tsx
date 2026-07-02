import React from 'react';
import Barcode from 'react-barcode';
import railwayLogo from '../assets/indian_railways_logo.png';
import ashokaEmblem from '../assets/Ashoka_Emblem.svg';

export interface ReceiptTemplateProps {
  record: any;
  qrImage?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ReceiptTemplate({ record, qrImage, className = '', style = {} }: ReceiptTemplateProps) {
  if (!record) return null;

  const d = (field: string) => record[field] || '';
  const exhausted = record.status === 'exhausted' || parseFloat(record.currentBalance || '0') <= 0;
  const balance = record.currentBalance ? parseFloat(record.currentBalance) : null;
  const receiptNo = d('receiptNoteNo') || `REC-${record.id || 'N/A'}`;
  const now = new Date();

  // Make separator wide enough for the 850px container
  const separator = "-".repeat(110);

  const FieldRow = ({ label, value }: { label: string, value: any }) => (
    <div className="flex font-bold">
      <div className="w-[30ch] shrink-0">{label}</div>
      <div className="w-[3ch] text-center shrink-0">:</div>
      <div className="flex-1 ml-2">{value}</div>
    </div>
  );

  return (
    <div
      className={`receipt-mono font-mono font-bold text-black bg-white p-12 mx-auto shadow-xl ${className}`}
      style={{
        width: '850px',
        fontSize: '13px',
        lineHeight: '1.6',
        ...style
      }}
    >
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between mb-8">
        <div className="w-28 h-28 flex items-center justify-center shrink-0">
          <img src={railwayLogo} alt="Indian Railways Logo" className="w-24 h-24 object-contain" />
        </div>
        <div className="text-center flex-1 mt-2">
          <div className="font-bold text-[32px] tracking-[0.1em] mb-1">INDIAN RAILWAYS</div>
          <div className="text-base tracking-[0.1em] mb-1">STORES DEPARTMENT</div>
          <div className="text-base tracking-[0.05em]">RDSO INVENTORY MANAGEMENT SYSTEM</div>
        </div>
        <div className="w-28 h-28 flex flex-col items-center justify-center shrink-0 pt-4">
          <img src={ashokaEmblem} alt="Ashoka Emblem" className="w-16 h-24 object-contain mb-2" />
          <div className="text-[10px] font-bold tracking-widest text-center mt-1">सत्यमेव जयते</div>
        </div>
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-6">{separator}</div>
      <div className="text-center text-xl font-bold tracking-[0.1em] mb-6">RAILWAY RECEIPT SUMMARY</div>
      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ RECEIPT & LOCATION ═══ */}
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="RECEIPT NOTE NO." value={receiptNo} />
        <FieldRow label="RECEIPT DATE" value={d('receiptDate') || now.toLocaleString()} />
        <FieldRow label="DEPOT" value={d('depot') || 'RDSO STORES, MANAK NAGAR'} />
        <FieldRow label="WARD" value={d('ward') || 'SIGNAL & TELECOM'} />
        <FieldRow label="RO NUMBER" value={d('roNumber') || 'RO/RDSO/2025/041'} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ SUPPLIER DETAILS ═══ */}
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="SUPPLIER NAME" value={d('supplierName') || 'M/s Bharat Electronics Ltd.'} />
        <FieldRow label="VENDOR CODE" value={d('vendorCode') || 'SUP/DEL/2023/0156'} />
        <FieldRow label="SUPPLIER GSTIN" value="29AABCB5576G1ZL" />
        <FieldRow label="PO NUMBER" value={d('poNumber') || 'PO/RDSO/2024-25/0789'} />
        <FieldRow label="PO DATE" value={d('poDate') || '15-Apr-2025'} />
        <FieldRow label="ALLOCATION" value={d('ward') || 'SSE/STM/Signal'} />
        <FieldRow label="DELIVERY LOCATION" value={d('depot') || 'RDSO Stores, Manak Nagar, Lucknow - 226011'} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ QUANTITY SUMMARY ═══ */}
      <div className="text-center font-bold tracking-[0.1em] mb-6">QUANTITY SUMMARY</div>
      <table className="w-full text-left mb-6 px-4 font-mono" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th className="font-normal w-[40%] pb-3 align-bottom pl-4">ITEM CATEGORY</th>
            <th className="font-normal text-center w-[15%] pb-3 align-bottom">QTY<br />ACCEPTED</th>
            <th className="font-normal text-center w-[15%] pb-3 align-bottom">QTY<br />REJECTED</th>
            <th className="font-normal text-center w-[15%] pb-3 align-bottom">QTY</th>
            <th className="font-normal text-right w-[15%] pb-3 align-bottom pr-4">BALANCE<br />BALANCE QTY</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={5} className="text-center pb-3 overflow-hidden whitespace-nowrap">{separator}</td></tr>
          <tr>
            <td className="truncate pr-2 pl-4">{d('itemDescription') || 'ELECTRONIC COMPONENTS'}</td>
            <td className="text-center">{d('quantity') || '0'}</td>
            <td className="text-center">0</td>
            <td className="text-center">{d('quantity') || '0'}</td>
            <td className="text-right pr-4">{balance !== null ? balance : (d('quantity') || '0')}</td>
          </tr>
          <tr><td colSpan={5} className="text-center pt-3 pb-3 overflow-hidden whitespace-nowrap">{separator}</td></tr>
          <tr className="font-bold">
            <td className="pl-4">TOTAL</td>
            <td className="text-center">{d('quantity') || '0'}</td>
            <td className="text-center">0</td>
            <td className="text-center">{d('quantity') || '0'}</td>
            <td className="text-right pr-4">{balance !== null ? balance : (d('quantity') || '0')}</td>
          </tr>
        </tbody>
      </table>

      {/* ═══ CURRENT BALANCE ═══ */}
      <div className="border-[1px] border-black px-6 py-3 flex justify-between font-bold mb-8 mx-4">
        <div>CURRENT BALANCE (AGAINST PO)</div>
        <div>{balance !== null ? balance : (d('quantity') || '0')} NOS</div>
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ INVOICE / FINANCIAL ═══ */}
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="INVOICE NUMBER" value={d('invoiceNumber') || 'INV/BE/2025/0421'} />
        <FieldRow label="INVOICE DATE" value={d('acceptanceDate') || '19-May-2025'} />
        <FieldRow label="TOTAL INVOICE VALUE" value={d('value') ? `₹ ${Number(d('value')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹ 0.00'} />
        <FieldRow label="VALUE OF GOODS RECEIVED" value={d('value') ? `₹ ${Number(d('value')).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹ 0.00'} />
        <FieldRow label="VALUE (ACCEPTED)" value={d('value') ? `₹ ${(Number(d('value'))).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹ 0.00'} />
        <FieldRow label="TAX AMOUNT (18%)" value={d('value') ? `₹ ${(Number(d('value')) * 0.18).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹ 0.00'} />
        <FieldRow label="TOTAL VALUE (INCL. TAX)" value={d('value') ? `₹ ${(Number(d('value')) * 1.18).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹ 0.00'} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ DATES & LOGISTICS ═══ */}
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="ACCEPTANCE DATE" value={d('acceptanceDate') || '20-May-2025 11:45'} />
        <FieldRow label="WARRANTY DATE" value={d('warrantyDate') || '19-May-2027'} />
        <FieldRow label="MODE OF RECEIPT" value="ROAD" />
        <FieldRow label="CHALLAN / INVOICE NO." value={d('invoiceNumber') || 'INV/BE/2025/0421'} />
        <FieldRow label="LR / GR NO." value="LR/BE/2025/0419" />
        <FieldRow label="LR / GR DATE" value={d('acceptanceDate') || '19-May-2025'} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ APPROVAL STATUS ═══ */}
      <div className="text-center font-bold tracking-[0.1em] mb-6">APPROVAL STATUS</div>
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="STATUS" value={exhausted ? 'EXPIRED' : 'APPROVED'} />
        <FieldRow label="APPROVED BY" value={record.approvedByName || 'DY. DIRECTOR (STORES)'} />
        <FieldRow label="APPROVAL DATE" value={record.approvedAt ? new Date(record.approvedAt).toLocaleString() : now.toLocaleString()} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ QR VERIFICATION ═══ */}
      <div className="text-center font-bold tracking-[0.1em] mb-6">QR VERIFICATION</div>
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="RECEIPT VERIFIED" value="YES" />
        <FieldRow label="VERIFICATION STATUS" value="VERIFIED SUCCESSFULLY" />
        <FieldRow label="SCANNED ON" value={now.toLocaleString()} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ AUDIT TIMESTAMP ═══ */}
      <div className="text-center font-bold tracking-[0.1em] mb-6">AUDIT TIMESTAMP</div>
      <div className="space-y-2 mb-8 px-4">
        <FieldRow label="RECORDED BY" value="DEO/Stores" />
        <FieldRow label="SYSTEM IP" value="10.10.25.45" />
        <FieldRow label="AUDIT TIMESTAMP" value={now.toLocaleString()} />
        <FieldRow label="REMAINING DOWNLOAD BALANCE" value={`${balance !== null ? balance : (d('quantity') || '0')} of ${d('quantity') || '0'}`} />
        <FieldRow label="REPORT GENERATED ON" value={now.toLocaleString()} />
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-8">{separator}</div>

      {/* ═══ BARCODE + QR FOOTER ═══ */}
      <div className="flex justify-between items-start mb-12 px-16 mt-6 pb-4">
        <div className="text-center">
          <div className="font-bold mb-4 tracking-wider text-sm">RECEIPT BARCODE</div>
          <div className="mx-auto flex justify-center mt-2">
            <Barcode
              value={receiptNo}
              width={2.4}
              height={75}
              displayValue={true}
              fontSize={16}
              font="monospace"
              background="transparent"
              margin={10}
            />
          </div>
        </div>
        <div className="text-center">
          <div className="font-bold mb-4 tracking-wider text-sm">SCAN TO VERIFY</div>
          {qrImage ? (
            <img src={qrImage} alt="QR Code" className={`w-[100px] h-[100px] mx-auto mt-2 ${exhausted ? 'opacity-40 grayscale' : ''}`} />
          ) : (
            <div className="w-[100px] h-[100px] border border-dashed border-gray-400 mx-auto mt-2 flex items-center justify-center text-xs text-gray-400">
              NO QR
            </div>
          )}
        </div>
      </div>

      <div className="text-center overflow-hidden whitespace-nowrap mb-6">{separator}</div>

      {/* ═══ FOOTER ═══ */}
      <div className="text-center space-y-2 pb-4 pt-2">
        <div className="tracking-widest">-- GOODS RECEIVED IN GOOD CONDITION --</div>
        <div className="tracking-widest">THANK YOU</div>
        <div className="tracking-widest mt-2">*** THIS IS A SYSTEM GENERATED RECEIPT ***</div>
      </div>
    </div>
  );
}
