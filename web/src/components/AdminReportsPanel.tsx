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
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
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
        setError(null);
        const res = await api.get('/api/reports/definitions');
        if (ignore) return;
        setDefinitions(res.data?.definitions || []);
        setFormats(res.data?.formats || ['excel', 'pdf']);
        if (!selectedReport && res.data?.definitions?.length) {
          setSelectedReport(res.data.definitions[0].key);
        }
        if (!scheduleReport && res.data?.definitions?.length) {
          setScheduleReport(res.data.definitions[0].key);
        }
      } catch (err: any) {
        if (ignore) return;
        setError(err?.response?.data?.error || 'Unable to load report definitions.');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [selectedReport, scheduleReport]);

  useEffect(() => {
    loadSchedules();
  }, []);

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

  const handleScheduleCreate = async () => {
    if (!scheduleReport) {
      setScheduleError('Select a report to schedule.');
      return;
    }
    if (!scheduleTime || !/^\d{1,2}:\d{2}$/.test(scheduleTime.trim())) {
      setScheduleError('Enter time as HH:mm.');
      return;
    }
    if (!Number.isFinite(scheduleFrequencyMinutes) || scheduleFrequencyMinutes <= 0) {
      setScheduleError('Frequency must be a positive number of minutes.');
      return;
    }
    setScheduleLoading(true);
    setScheduleError(null);
    setScheduleSuccess(null);
    try {
      const payload: any = {
        reportKey: scheduleReport,
        format: scheduleFormat,
        timeOfDay: scheduleTime || '20:00',
        timezoneOffsetMinutes: scheduleTimezone,
        frequencyMinutes: scheduleFrequencyMinutes || 1440,
        channels: ['EMAIL', ...(scheduleTelegrams.trim() ? ['TELEGRAM'] : [])],
        emailRecipients: scheduleEmails
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        telegramRecipients: scheduleTelegrams
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        enabled: scheduleEnabled,
        filters: {
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          driverId: driverId || undefined,
          truckId: truckId || undefined,
        },
      };
      if (editingScheduleId) {
        await api.put(`/api/admin/report-schedules/${editingScheduleId}`, payload);
        setScheduleSuccess('Schedule updated.');
      } else {
        await api.post('/api/admin/report-schedules', payload);
        setScheduleSuccess('Schedule saved.');
      }
      setEditingScheduleId(null);
      await loadSchedules();
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to save schedule.');
    } finally {
      setScheduleLoading(false);
    }
  };

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
  }

  async function handleDeleteSchedule(id: string) {
    if (!id) return;
    const confirmed = window.confirm('Delete this schedule? This cannot be undone.');
    if (!confirmed) return;
    try {
      setScheduleLoading(true);
      setScheduleError(null);
      await api.delete(`/api/admin/report-schedules/${id}`);
      if (editingScheduleId === id) {
        setEditingScheduleId(null);
      }
      await loadSchedules();
      setScheduleSuccess('Schedule deleted.');
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error || 'Failed to delete schedule.');
    } finally {
      setScheduleLoading(false);
    }
  }

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

      <div className='mt-8 border-t border-slate-200 pt-6'>
        <div className='mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Scheduled deliveries</p>
            <h3 className='text-lg font-semibold text-slate-900'>Automate report sending</h3>
            <p className='text-sm text-slate-500'>Pick time, frequency, and recipients (email/Telegram).</p>
          </div>
          <button
            type='button'
            onClick={loadSchedules}
            className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-600 disabled:opacity-60'
            disabled={scheduleLoading}
          >
            Refresh
          </button>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Report
            <select
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleReport}
              onChange={(e) => setScheduleReport(e.target.value)}
            >
              <option value=''>Select report.</option>
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
              value={scheduleFormat}
              onChange={(e) => setScheduleFormat(e.target.value)}
            >
              {formats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {formatLabels[fmt] || fmt.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Time of day (HH:mm)
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              placeholder='20:00'
            />
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Timezone offset (minutes)
            <input
              type='number'
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleTimezone}
              onChange={(e) => setScheduleTimezone(Number(e.target.value))}
              placeholder='180 (GMT+3)'
            />
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Frequency (minutes)
            <input
              type='number'
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleFrequencyMinutes}
              onChange={(e) => setScheduleFrequencyMinutes(Number(e.target.value))}
              placeholder='1440 = daily'
            />
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Email recipients (comma-separated)
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleEmails}
              onChange={(e) => setScheduleEmails(e.target.value)}
              placeholder='ops@example.com, admin@example.com'
            />
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Telegram chat IDs (comma-separated)
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none'
              value={scheduleTelegrams}
              onChange={(e) => setScheduleTelegrams(e.target.value)}
              placeholder='-1001234'
            />
          </label>
          <label className='mt-1 flex items-center gap-2 text-sm font-semibold text-slate-700'>
            <input
              type='checkbox'
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
            />
            Enable schedule
          </label>
        </div>

        <div className='mt-4 flex flex-wrap items-center gap-3'>
          <button
            type='button'
            onClick={handleScheduleCreate}
            className='inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
            disabled={scheduleLoading || !scheduleReport}
          >
            {scheduleLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
            {scheduleLoading ? 'Saving...' : editingScheduleId ? 'Update schedule' : 'Save schedule'}
          </button>
          {editingScheduleId ? (
            <button
              type='button'
              onClick={() => {
                setEditingScheduleId(null);
                setScheduleSuccess(null);
                setScheduleError(null);
              }}
              className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-600 disabled:opacity-60'
              disabled={scheduleLoading}
            >
              Cancel edit
            </button>
          ) : null}
          {scheduleError && <span className='text-sm text-rose-600'>{scheduleError}</span>}
          {scheduleSuccess && <span className='text-sm text-emerald-600'>{scheduleSuccess}</span>}
        </div>

        <div className='mt-5 rounded-2xl border border-slate-200'>
          <table className='min-w-full text-left text-sm'>
            <thead className='bg-slate-50 text-xs uppercase tracking-wide text-slate-500'>
              <tr>
                <th className='px-3 py-2'>Report</th>
                <th className='px-3 py-2'>Time</th>
                <th className='px-3 py-2'>Frequency</th>
                <th className='px-3 py-2'>Channels</th>
                <th className='px-3 py-2'>Next run</th>
              </tr>
            </thead>
            <tbody>
              {scheduleLoading && (
                <tr>
                  <td className='px-3 py-3 text-slate-500' colSpan={5}>
                    Loading schedules...
                  </td>
                </tr>
              )}
              {!scheduleLoading && schedules.length === 0 && (
                <tr>
                  <td className='px-3 py-3 text-slate-500' colSpan={5}>
                    No schedules yet.
                  </td>
                </tr>
              )}
              {schedules.map((s) => (
                <tr key={s.id} className='border-t border-slate-100'>
                  <td className='px-3 py-2'>
                    <div className='font-semibold text-slate-800'>{s.reportKey}</div>
                    <div className='text-xs text-slate-500'>{s.format.toUpperCase()}</div>
                  </td>
                  <td className='px-3 py-2 text-sm text-slate-700'>
                    {s.timeOfDay} (UTC{(s.timezoneOffsetMinutes || 0) / 60 >= 0 ? '+' : ''}
                    {(s.timezoneOffsetMinutes || 0) / 60})
                  </td>
                  <td className='px-3 py-2 text-sm text-slate-700'>
                    Every {s.frequencyMinutes} min
                  </td>
                  <td className='px-3 py-2 text-xs text-slate-600'>
                    {s.channels.join(', ')}
                  </td>
                  <td className='px-3 py-2 text-xs text-slate-600'>
                    {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'pending'}
                  </td>
                  <td className='px-3 py-2 text-xs text-slate-600'>
                    <div className='flex gap-2'>
                      <button
                        className='rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-600'
                        onClick={() => loadFormFromSchedule(s)}
                        disabled={scheduleLoading}
                      >
                        Edit
                      </button>
                      <button
                        className='rounded-full border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:border-rose-300'
                        onClick={() => handleDeleteSchedule(s.id)}
                        disabled={scheduleLoading}
                      >
                        Delete
                      </button>
                      <button
                        className='rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-600'
                        onClick={async () => {
                          try {
                            setScheduleLoading(true);
                            setScheduleError(null);
                            await api.put(`/api/admin/report-schedules/${s.id}`, { enabled: !s.enabled });
                            await loadSchedules();
                          } catch (err: any) {
                            setScheduleError(err?.response?.data?.error || 'Failed to update schedule.');
                          } finally {
                            setScheduleLoading(false);
                          }
                        }}
                        disabled={scheduleLoading}
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

