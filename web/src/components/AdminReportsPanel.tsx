import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Send } from 'lucide-react';
import { api } from '../api';

const formatLabels: Record<string, string> = {
  excel: 'Excel',
  pdf: 'PDF',
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
    allowFrequencyMinutes?: boolean;
  };
};

type ExportResponse = {
  fileName: string;
  mimeType: string;
  data: string;
  rowCount?: number;
  meta?: Record<string, unknown>;
};

type ReportSchedule = {
  id: string;
  reportKey: string;
  format: string;
  channels: string[];
  emailRecipients: string[];
  telegramRecipients: string[];
  timeOfDay: string;
  frequencyMinutes: number;
  timezoneOffsetMinutes: number;
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
};

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none';
const selectCls = inputCls;

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

  // Telegram send-now
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramSuccess, setTelegramSuccess] = useState<string | null>(null);

  // Schedules
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleReport, setScheduleReport] = useState<string>('');
  const [scheduleFormat, setScheduleFormat] = useState<string>('excel');
  const [scheduleTime, setScheduleTime] = useState<string>('20:00');
  const [scheduleTimezone, setScheduleTimezone] = useState<number>(180);
  const [scheduleFrequencyMinutes, setScheduleFrequencyMinutes] = useState<number>(1440);
  const [scheduleEmails, setScheduleEmails] = useState<string>('');
  const [scheduleTelegrams, setScheduleTelegrams] = useState<string>('');
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await api.get('/api/reports/definitions');
        if (ignore) return;
        setDefinitions(res.data?.definitions || []);
        setFormats(res.data?.formats || ['excel', 'pdf']);
        if (!selectedReport && res.data?.definitions?.length) {
          setSelectedReport(res.data.definitions[0].key);
          setScheduleReport(res.data.definitions[0].key);
        }
      } catch (err: any) {
        if (!ignore) setError(err?.response?.data?.error || 'Unable to load report definitions.');
      }
    })();
    return () => { ignore = true; };
  }, []);

  useEffect(() => { loadSchedules(); }, []);

  async function loadSchedules() {
    try {
      setScheduleLoading(true);
      setScheduleError(null);
      const res = await api.get('/api/admin/report-schedules');
      setSchedules(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to load schedules.');
    } finally {
      setScheduleLoading(false);
    }
  }

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

  const requiresDateRange = selectedDefinition?.filters?.requiresDateRange !== false;

  function buildFilters() {
    const filters: any = {};
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (driverId && selectedDefinition?.filters?.allowDriverId) filters.driverId = driverId.trim();
    if (truckId && selectedDefinition?.filters?.allowTruckId) filters.truckId = truckId.trim();
    return filters;
  }

  const handleExport = async () => {
    if (!selectedReport) { setError('Select a report.'); return; }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<ExportResponse>('/api/reports/export', {
        reportKey: selectedReport,
        format: selectedFormat,
        filters: buildFilters(),
      });
      triggerDownload(res.data);
      setSuccess(`${res.data?.rowCount ?? 0} rows → ${res.data?.fileName || 'report'}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Export failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendTelegram = async () => {
    if (!selectedReport) { setTelegramError('Select a report.'); return; }
    if (!telegramChatId.trim()) { setTelegramError('Enter a Telegram chat ID.'); return; }
    setTelegramLoading(true);
    setTelegramError(null);
    setTelegramSuccess(null);
    try {
      const res = await api.post('/api/reports/send-telegram', {
        reportKey: selectedReport,
        format: selectedFormat === 'telegram' ? 'pdf' : selectedFormat,
        filters: buildFilters(),
        telegramChatId: telegramChatId.trim(),
      });
      setTelegramSuccess(res.data?.message || 'Sent to Telegram.');
    } catch (err: any) {
      setTelegramError(err?.response?.data?.error || 'Failed to send to Telegram.');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleScheduleSave = async () => {
    if (!scheduleReport) { setScheduleError('Select a report.'); return; }
    if (!scheduleTime || !/^\d{1,2}:\d{2}$/.test(scheduleTime.trim())) {
      setScheduleError('Enter time as HH:mm.');
      return;
    }
    setScheduleLoading(true);
    setScheduleError(null);
    setScheduleSuccess(null);
    try {
      const payload: any = {
        reportKey: scheduleReport,
        format: scheduleFormat,
        timeOfDay: scheduleTime,
        timezoneOffsetMinutes: scheduleTimezone,
        frequencyMinutes: scheduleFrequencyMinutes || 1440,
        channels: ['EMAIL', ...(scheduleTelegrams.trim() ? ['TELEGRAM'] : [])],
        emailRecipients: scheduleEmails.split(',').map((v) => v.trim()).filter(Boolean),
        telegramRecipients: scheduleTelegrams.split(',').map((v) => v.trim()).filter(Boolean),
        enabled: scheduleEnabled,
      };
      if (editingScheduleId) {
        await api.put(`/api/admin/report-schedules/${editingScheduleId}`, payload);
        setScheduleSuccess('Updated.');
      } else {
        await api.post('/api/admin/report-schedules', payload);
        setScheduleSuccess('Saved.');
      }
      resetScheduleForm();
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to save schedule.');
    } finally {
      setScheduleLoading(false);
    }
  };

  function resetScheduleForm() {
    setEditingScheduleId(null);
    setShowScheduleForm(false);
    setScheduleReport(definitions[0]?.key || '');
    setScheduleFormat('excel');
    setScheduleTime('20:00');
    setScheduleTimezone(180);
    setScheduleFrequencyMinutes(1440);
    setScheduleEmails('');
    setScheduleTelegrams('');
    setScheduleEnabled(true);
    setScheduleError(null);
    setScheduleSuccess(null);
  }

  function loadFormFromSchedule(s: ReportSchedule) {
    setEditingScheduleId(s.id);
    setScheduleReport(s.reportKey);
    setScheduleFormat(s.format || 'excel');
    setScheduleTime(s.timeOfDay || '20:00');
    setScheduleTimezone(s.timezoneOffsetMinutes || 0);
    setScheduleFrequencyMinutes(s.frequencyMinutes || 1440);
    setScheduleEmails((s.emailRecipients || []).join(', '));
    setScheduleTelegrams((s.telegramRecipients || []).join(', '));
    setScheduleEnabled(s.enabled);
    setScheduleSuccess(null);
    setScheduleError(null);
    setShowScheduleForm(true);
  }

  async function handleDeleteSchedule(id: string) {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      setScheduleLoading(true);
      await api.delete(`/api/admin/report-schedules/${id}`);
      if (editingScheduleId === id) resetScheduleForm();
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to delete.');
    } finally {
      setScheduleLoading(false);
    }
  }

  async function handleToggleEnabled(s: ReportSchedule) {
    try {
      setScheduleLoading(true);
      await api.put(`/api/admin/report-schedules/${s.id}`, { enabled: !s.enabled });
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to update.');
    } finally {
      setScheduleLoading(false);
    }
  }

  return (
    <div className='space-y-6'>

      {/* ── Export card ── */}
      <div className='rounded-2xl border border-slate-200 bg-white p-5'>
        <h2 className='mb-4 text-base font-semibold text-slate-900'>Export report</h2>

        <div className='grid gap-3 sm:grid-cols-2'>
          {/* Report */}
          <div>
            <label className='mb-1 block text-xs font-medium text-slate-500'>Report</label>
            <select className={selectCls} value={selectedReport} onChange={(e) => setSelectedReport(e.target.value)}>
              <option value=''>Select…</option>
              {definitions.map((def) => (
                <option key={def.key} value={def.key}>{def.title}</option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label className='mb-1 block text-xs font-medium text-slate-500'>Format</label>
            <div className='flex rounded-lg border border-slate-200 overflow-hidden'>
              {formats.map((fmt) => (
                <button
                  key={fmt}
                  type='button'
                  onClick={() => setSelectedFormat(fmt)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    selectedFormat === fmt
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {formatLabels[fmt] || fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          {requiresDateRange && (
            <>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>From</label>
                <input type='date' className={inputCls} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>To</label>
                <input type='date' className={inputCls} value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </>
          )}

          {/* Optional filters */}
          {selectedDefinition?.filters?.allowDriverId && (
            <div>
              <label className='mb-1 block text-xs font-medium text-slate-500'>Driver ID <span className='font-normal text-slate-400'>(optional)</span></label>
              <input className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder='e.g. DRV-001' />
            </div>
          )}
          {selectedDefinition?.filters?.allowTruckId && (
            <div>
              <label className='mb-1 block text-xs font-medium text-slate-500'>Truck ID <span className='font-normal text-slate-400'>(optional)</span></label>
              <input className={inputCls} value={truckId} onChange={(e) => setTruckId(e.target.value)} placeholder='e.g. KDA-123X' />
            </div>
          )}
        </div>

        {selectedDefinition?.description && (
          <p className='mt-3 text-xs text-slate-400'>{selectedDefinition.description}</p>
        )}

        {error && <p className='mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600'>{error}</p>}
        {success && <p className='mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600'>{success}</p>}

        <div className='mt-4 flex items-center gap-2'>
          <button
            type='button'
            onClick={handleExport}
            disabled={!selectedReport || loading}
            className='inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
          >
            {loading && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
            {loading ? 'Preparing…' : 'Download'}
          </button>
        </div>

        {/* Telegram send now */}
        <div className='mt-4 border-t border-slate-100 pt-4'>
          <label className='mb-1 block text-xs font-medium text-slate-500'>Send to Telegram</label>
          <div className='flex gap-2'>
            <input
              className={inputCls + ' max-w-xs'}
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder='Chat ID (e.g. -1001234567)'
            />
            <button
              type='button'
              onClick={handleSendTelegram}
              disabled={!selectedReport || telegramLoading}
              className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-50'
            >
              {telegramLoading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Send className='h-3.5 w-3.5' />}
              Send
            </button>
          </div>
          {telegramError && <p className='mt-1.5 text-xs text-rose-600'>{telegramError}</p>}
          {telegramSuccess && <p className='mt-1.5 text-xs text-emerald-600'>{telegramSuccess}</p>}
        </div>
      </div>

      {/* ── Scheduled reports card ── */}
      <div className='rounded-2xl border border-slate-200 bg-white p-5'>
        <div className='flex items-center justify-between'>
          <h2 className='text-base font-semibold text-slate-900'>Scheduled reports</h2>
          <button
            type='button'
            onClick={() => { resetScheduleForm(); setShowScheduleForm(true); }}
            className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400'
          >
            <Plus className='h-3.5 w-3.5' />
            New
          </button>
        </div>

        {/* Schedule form */}
        {showScheduleForm && (
          <div className='mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4'>
            <p className='mb-3 text-xs font-semibold text-slate-500'>
              {editingScheduleId ? 'Edit schedule' : 'New schedule'}
            </p>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Report</label>
                <select className={selectCls} value={scheduleReport} onChange={(e) => setScheduleReport(e.target.value)}>
                  <option value=''>Select…</option>
                  {definitions.map((def) => (
                    <option key={def.key} value={def.key}>{def.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Format</label>
                <select className={selectCls} value={scheduleFormat} onChange={(e) => setScheduleFormat(e.target.value)}>
                  {formats.map((fmt) => (
                    <option key={fmt} value={fmt}>{formatLabels[fmt] || fmt.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Time (HH:mm)</label>
                <input className={inputCls} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} placeholder='20:00' />
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Timezone offset (min)</label>
                <input type='number' className={inputCls} value={scheduleTimezone} onChange={(e) => setScheduleTimezone(Number(e.target.value))} placeholder='180 = GMT+3' />
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Frequency (min)</label>
                <input type='number' className={inputCls} value={scheduleFrequencyMinutes} onChange={(e) => setScheduleFrequencyMinutes(Number(e.target.value))} placeholder='1440 = daily' />
              </div>
              <div>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Email recipients</label>
                <input className={inputCls} value={scheduleEmails} onChange={(e) => setScheduleEmails(e.target.value)} placeholder='a@b.com, c@d.com' />
              </div>
              <div className='sm:col-span-2'>
                <label className='mb-1 block text-xs font-medium text-slate-500'>Telegram chat IDs</label>
                <input className={inputCls} value={scheduleTelegrams} onChange={(e) => setScheduleTelegrams(e.target.value)} placeholder='-1001234' />
              </div>
              <div className='sm:col-span-2 flex items-center gap-2'>
                <input
                  type='checkbox'
                  id='sch-enabled'
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className='h-3.5 w-3.5 accent-slate-900'
                />
                <label htmlFor='sch-enabled' className='text-xs font-medium text-slate-700'>Enable schedule</label>
              </div>
            </div>

            {scheduleError && <p className='mt-2 text-xs text-rose-600'>{scheduleError}</p>}
            {scheduleSuccess && <p className='mt-2 text-xs text-emerald-600'>{scheduleSuccess}</p>}

            <div className='mt-3 flex gap-2'>
              <button
                type='button'
                onClick={handleScheduleSave}
                disabled={scheduleLoading || !scheduleReport}
                className='inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50'
              >
                {scheduleLoading && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                {editingScheduleId ? 'Update' : 'Save'}
              </button>
              <button
                type='button'
                onClick={resetScheduleForm}
                className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Schedules table */}
        <div className='mt-4'>
          {scheduleLoading && !schedules.length && (
            <p className='text-xs text-slate-400'>Loading…</p>
          )}
          {!scheduleLoading && schedules.length === 0 && (
            <p className='text-xs text-slate-400'>No schedules yet.</p>
          )}
          {schedules.length > 0 && (
            <div className='divide-y divide-slate-100'>
              {schedules.map((s) => (
                <div key={s.id} className='flex items-center justify-between gap-3 py-2.5'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <span className='text-sm font-medium text-slate-800'>{s.reportKey}</span>
                      <span className='rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500'>{s.format}</span>
                      {!s.enabled && <span className='rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600'>paused</span>}
                    </div>
                    <div className='mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400'>
                      <span>{s.timeOfDay} UTC{(s.timezoneOffsetMinutes || 0) >= 0 ? '+' : ''}{(s.timezoneOffsetMinutes || 0) / 60}</span>
                      <span>every {s.frequencyMinutes >= 1440 ? `${s.frequencyMinutes / 1440}d` : `${s.frequencyMinutes}m`}</span>
                      <span>{s.channels.join(', ')}</span>
                      {s.nextRunAt && <span>next {new Date(s.nextRunAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className='flex shrink-0 items-center gap-1.5'>
                    <button
                      onClick={() => handleToggleEnabled(s)}
                      disabled={scheduleLoading}
                      className='rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-40'
                    >
                      {s.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => loadFormFromSchedule(s)}
                      disabled={scheduleLoading}
                      className='rounded-md border border-slate-200 p-1 text-slate-500 hover:border-slate-300 disabled:opacity-40'
                    >
                      <Pencil className='h-3.5 w-3.5' />
                    </button>
                    <button
                      onClick={() => handleDeleteSchedule(s.id)}
                      disabled={scheduleLoading}
                      className='rounded-md border border-rose-100 p-1 text-rose-500 hover:border-rose-200 disabled:opacity-40'
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
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
