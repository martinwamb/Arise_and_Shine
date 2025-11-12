import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';

const formatLabels: Record<string, string> = {
  excel: 'Excel (.xlsx)',
  pdf: 'PDF (.pdf)',
};

type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  filters?: {
    requiresDateRange?: boolean;
    defaultRangeDays?: number;
    allowDriverId?: boolean;
    allowTruckId?: boolean;
  };
};

type ExportResponse = {
  fileName: string;
  mimeType: string;
  data: string;
  rowCount?: number;
  meta?: Record<string, unknown>;
};

export default function AdminReportsPanel() {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [formats, setFormats] = useState<string[]>(['excel', 'pdf']);
  const [selectedReport, setSelectedReport] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<string>('excel');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [driverId, setDriverId] = useState('');
  const [truckId, setTruckId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setError(null);
        const res = await api.get('/api/reports/definitions');
        if (ignore) return;
        setDefinitions(res.data?.definitions || []);
        setFormats(res.data?.formats || ['excel', 'pdf']);
        if (!selectedReport && res.data?.definitions?.length) {
          setSelectedReport(res.data.definitions[0].key);
        }
      } catch (err: any) {
        if (ignore) return;
        setError(err?.response?.data?.error || 'Unable to load report definitions.');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [selectedReport]);

  const selectedDefinition = useMemo(
    () => definitions.find((def) => def.key === selectedReport) || null,
    [definitions, selectedReport]
  );

  useEffect(() => {
    if (!selectedDefinition?.filters?.defaultRangeDays) return;
    const days = selectedDefinition.filters.defaultRangeDays;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.max(1, days));
    setToDate(end.toISOString().slice(0, 10));
    setFromDate(start.toISOString().slice(0, 10));
  }, [selectedDefinition?.key]);

  const handleExport = async () => {
    if (!selectedReport) {
      setError('Select a report to export.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: any = {
        reportKey: selectedReport,
        format: selectedFormat,
        filters: {
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        },
      };
      if (driverId) payload.filters.driverId = driverId.trim();
      if (truckId) payload.filters.truckId = truckId.trim();
      const res = await api.post<ExportResponse>('/api/reports/export', payload);
      triggerDownload(res.data);
      setSuccess(`Exported ${res.data?.rowCount ?? 0} rows to ${res.data?.fileName || 'report'}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to export report.');
    } finally {
      setLoading(false);
    }
  };

  const requiresDateRange = selectedDefinition?.filters?.requiresDateRange !== false;

  return (
    <section className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
      <header className='mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Analytics & exports</p>
          <h2 className='text-lg font-semibold text-slate-900'>Reports workspace</h2>
          <p className='text-sm text-slate-500'>Generate Excel or PDF extracts for finance, fleet, and compliance summaries.</p>
        </div>
        <button
          type='button'
          onClick={handleExport}
          className='inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
          disabled={!selectedReport || loading}
        >
          {loading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
          {loading ? 'Preparing file…' : 'Export report'}
        </button>
      </header>

      <div className='grid gap-4 md:grid-cols-2'>
        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Report
          <select
            className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value)}
          >
            <option value=''>Select report…</option>
            {definitions.map((def) => (
              <option key={def.key} value={def.key}>
                {def.title}
              </option>
            ))}
          </select>
        </label>
        <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Format
          <select
            className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value)}
          >
            {formats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {formatLabels[fmt] || fmt.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedDefinition && (
        <p className='mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600'>{selectedDefinition.description}</p>
      )}

      <div className='mt-4 grid gap-3 md:grid-cols-2'>
        {requiresDateRange && (
          <>
            <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              From date
              <input
                type='date'
                className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              To date
              <input
                type='date'
                className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </>
        )}
        {selectedDefinition?.filters?.allowDriverId && (
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Driver ID (optional)
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              placeholder='e.g. DRV-001'
            />
          </label>
        )}
        {selectedDefinition?.filters?.allowTruckId && (
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Truck ID (optional)
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
              placeholder='e.g. KDA-123X'
            />
          </label>
        )}
      </div>

      {error && <p className='mt-4 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-700'>{error}</p>}
      {success && <p className='mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700'>{success}</p>}
    </section>
  );
}

function triggerDownload(payload: ExportResponse) {
  if (!payload?.data) return;
  const binary = atob(payload.data);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([buffer], { type: payload.mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.fileName || 'report';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

