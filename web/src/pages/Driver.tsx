import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api, API_BASE } from '../api';

type Dashboard = {
  driverId: string;
  driverName: string;
  summary: {
    loadsDelivered: number;
    tonnesDelivered: number;
    earningsDelivered: number;
    averageTonnesPerLoad: number;
    weeklyRevenue: number;
    previousWeekRevenue: number;
    trend: number | null;
  };
  assignments: any[];
  leaderboard: any[];
  rank: number | null;
  telemetry: any[];
};

const ADMIN_DRIVER_SELECTION_KEY = 'adminSelectedDriverId';

export default function Driver() {
  const role = (localStorage.getItem('role') || '') as 'ADMIN' | 'DRIVER' | 'OPS' | 'FUEL' | 'CUSTOMER' | '';
  const storedDriverId = () => localStorage.getItem('driverId') || '';
  const [drivers, setDrivers] = useState<
    { id: string; name: string; email?: string; phone?: string; nationalIdPath?: string | null; photoPath?: string | null }[]
  >([]);
  const [driverListError, setDriverListError] = useState<string | null>(null);
  const initialSelectedDriver =
    role === 'DRIVER' ? storedDriverId() : localStorage.getItem(ADMIN_DRIVER_SELECTION_KEY) || '';
  const [selectedDriver, setSelectedDriver] = useState<string>(initialSelectedDriver);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(role === 'DRIVER' ? true : initialSelectedDriver !== '');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ name: '', email: '', phone: '', nationalIdData: '', photoData: '' });
  const [profilePreview, setProfilePreview] = useState<{ nationalId: string; photo: string }>({ nationalId: '', photo: '' });
  const [profileStatus, setProfileStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const assetBase = useMemo(() => API_BASE.replace(/\/$/, ''), []);
  const toAssetUrl = useCallback(
    (path?: string | null) => {
      if (!path) return '';
      if (/^https?:/i.test(path)) return path;
      return `${assetBase}${path.startsWith('/') ? path : `/${path}`}`;
    },
    [assetBase]
  );
  const selectedDriverInfo = useMemo(
    () => drivers.find((drv) => drv.id === selectedDriver) || null,
    [drivers, selectedDriver]
  );
  const profileDisabled = role !== 'DRIVER' && !selectedDriverInfo;
  const driverFormTargetId = role === 'DRIVER' ? storedDriverId() : selectedDriver || '';
  const driverFormName =
    role === 'DRIVER'
      ? profile.name || localStorage.getItem('userName') || ''
      : selectedDriverInfo?.name || selectedDriverInfo?.id || '';

  const load = useCallback(async () => {
    const driverIdToUse = role === 'DRIVER' ? storedDriverId() || selectedDriver : selectedDriver;
    if (!driverIdToUse) {
      setError(role === 'DRIVER' ? 'Driver profile not linked to this account.' : 'Select a driver to view performance.');
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/api/driver/dashboard', { params: { driverId: driverIdToUse } });
      setData(res.data);
      if (role !== 'DRIVER' && driverIdToUse !== selectedDriver) {
        setSelectedDriver(driverIdToUse);
        localStorage.setItem(ADMIN_DRIVER_SELECTION_KEY, driverIdToUse);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load driver dashboard');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [role, selectedDriver]);

  useEffect(() => {
    if (role === 'DRIVER') {
      load();
    }
  }, [load]);
  useEffect(() => {
    if (role !== 'DRIVER' && selectedDriver) {
      load();
    }
  }, [selectedDriver, role, load]);

  useEffect(() => {
    if (role === 'DRIVER') return;
    let ignore = false;
    (async () => {
      try {
        setDriverListError(null);
        const res = await api.get('/api/admin/drivers');
        if (ignore) return;
        const list = Array.isArray(res.data)
          ? res.data.map((d: any) => ({
              id: d.id,
              name: d.name || d.id,
              email: d.email || '',
              phone: d.phone || '',
              nationalIdPath: d.nationalIdPath || null,
              photoPath: d.photoPath || null,
            }))
          : [];
        setDrivers(list);
        if (!selectedDriver && list.length) {
          const first = list[0].id;
          setSelectedDriver(first);
          localStorage.setItem(ADMIN_DRIVER_SELECTION_KEY, first);
        }
      } catch (err: any) {
        if (ignore) return;
        setDriverListError(err?.response?.data?.error || 'Unable to load drivers list.');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [role]);

  useEffect(() => {
    if (role !== 'DRIVER' && selectedDriver) {
      setError(null);
    }
  }, [role, selectedDriver]);

  useEffect(() => {
    if (role === 'DRIVER') return;
    if (!selectedDriver) {
      setProfile({ name: '', email: '', phone: '', nationalIdData: '', photoData: '' });
      setProfilePreview({ nationalId: '', photo: '' });
      setProfileStatus({ kind: 'idle', message: '' });
      return;
    }
    if (selectedDriverInfo) {
      setProfile({
        name: selectedDriverInfo.name || '',
        email: selectedDriverInfo.email || '',
        phone: selectedDriverInfo.phone || '',
        nationalIdData: '',
        photoData: '',
      });
      setProfilePreview({
        nationalId: toAssetUrl(selectedDriverInfo.nationalIdPath),
        photo: toAssetUrl(selectedDriverInfo.photoPath),
      });
      setProfileStatus({ kind: 'idle', message: '' });
    } else {
      setProfile({ name: '', email: '', phone: '', nationalIdData: '', photoData: '' });
      setProfilePreview({ nationalId: '', photo: '' });
    }
  }, [role, selectedDriver, selectedDriverInfo, toAssetUrl]);

  useEffect(() => {
    if (role !== 'DRIVER') return;
    if (!data?.driverName) return;
    if (!profile.name) {
      setProfile((prev) => ({ ...prev, name: data.driverName }));
    }
  }, [role, data?.driverName, profile.name]);

  const trendPct = data?.summary?.trend ?? null;
  const headerMessage = (() => {
    if (loading) return 'Aggregating latest runs...';
    if (role === 'DRIVER') {
      const linkedId = storedDriverId();
      if (!linkedId) {
        return 'Your account is not linked to a driver profile yet. Please contact an admin to assign one.';
      }
      return data ? `Hi ${data.driverName}, here is how you are tracking this week.` : 'Fetching your driver metrics...';
    }
    if (!selectedDriver) return 'Select a driver to review their performance.';
    if (data) return `${data.driverName} - live performance snapshot for this week.`;
    return 'Loading the selected driver metrics...';
  })();
  const handleProfileFile = (key: 'nationalIdData' | 'photoData', previewKey: 'nationalId' | 'photo') => (file: File | null) => {
    if (!file) {
      setProfile((prev) => ({ ...prev, [key]: '' }));
      setProfilePreview((prev) => ({ ...prev, [previewKey]: '' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result?.toString() || '';
      setProfile((prev) => ({ ...prev, [key]: base64 }));
      setProfilePreview((prev) => ({ ...prev, [previewKey]: base64 }));
    };
    reader.readAsDataURL(file);
  };
  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'DRIVER' && !selectedDriverInfo) {
      setProfileStatus({
        kind: 'error',
        message: 'Pick a driver before saving profile changes.',
      });
      return;
    }
    setSavingProfile(true);
    setProfileStatus({ kind: 'idle', message: '' });
    try {
      const payload: Record<string, unknown> = {
        name: profile.name?.trim() || undefined,
        email: profile.email !== undefined ? profile.email : undefined,
        phone: profile.phone !== undefined ? profile.phone : undefined,
      };
      if (profile.nationalIdData) payload.nationalIdData = profile.nationalIdData;
      if (profile.photoData) payload.photoData = profile.photoData;
      let response;
      if (role === 'DRIVER') {
        response = await api.put('/api/driver/profile', payload);
      } else {
        const targetDriverId = selectedDriverInfo?.id || selectedDriver;
        response = await api.patch(`/api/admin/drivers/${targetDriverId}`, payload);
      }
      const updated = response?.data?.driver;
      if (updated) {
        if (role !== 'DRIVER') {
          setDrivers((prev) =>
            prev.map((drv) =>
              drv.id === updated.id
                ? {
                    ...drv,
                    name: updated.name || '',
                    email: updated.email || '',
                    phone: updated.phone || '',
                    nationalIdPath: updated.nationalIdPath || null,
                    photoPath: updated.photoPath || null,
                  }
                : drv
            )
          );
          setProfile((prev) => ({
            ...prev,
            name: updated.name || '',
            email: updated.email || '',
            phone: updated.phone || '',
            nationalIdData: '',
            photoData: '',
          }));
          setProfilePreview({
            nationalId: toAssetUrl(updated.nationalIdPath),
            photo: toAssetUrl(updated.photoPath),
          });
        } else {
          setProfile((prev) => ({ ...prev, nationalIdData: '', photoData: '' }));
          if (!profile.name) {
            setProfile((prev) => ({ ...prev, name: updated.name || '' }));
          }
        }
      }
      load();
      setProfileStatus({
        kind: 'success',
        message: role === 'DRIVER' ? 'Profile updated successfully.' : 'Driver details saved.',
      });
    } catch (err: any) {
      setProfileStatus({
        kind: 'error',
        message: err?.response?.data?.error || 'Failed to update profile.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <main className='mx-auto max-w-6xl px-4 py-16'>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-bold text-slate-900'>Driver performance</h1>
          <p className='text-sm text-slate-600'>{headerMessage}</p>
        </div>
        <div className='flex items-center gap-2'>
          {role !== 'DRIVER' && (
            <div className='flex flex-col gap-1 text-xs text-slate-600'>
              <label className='font-semibold uppercase tracking-wide text-slate-500'>
                Driver
                <select
                  className='mt-1 w-48 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700 focus:border-amber-500 focus:outline-none'
                  value={selectedDriver}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedDriver(next);
                    if (!next) {
                      setData(null);
                      setError('Select a driver to view performance.');
                      localStorage.removeItem(ADMIN_DRIVER_SELECTION_KEY);
                    } else {
                      localStorage.setItem(ADMIN_DRIVER_SELECTION_KEY, next);
                    }
                  }}
                >
                  <option value=''>Pick driver...</option>
                  {drivers.map((drv) => (
                    <option key={drv.id} value={drv.id}>
                      {drv.name || drv.id}
                    </option>
                  ))}
                </select>
                <span className={`mt-1 block text-xs ${selectedDriver ? 'text-slate-500' : 'text-amber-600'}`}>
                  {selectedDriver ? `Driver ID: ${selectedDriver}` : 'No driver selected'}
                </span>
                {selectedDriverInfo && (
                  <span className='text-xs text-slate-500'>
                    {[selectedDriverInfo.email, selectedDriverInfo.phone].filter(Boolean).join(' | ') || 'No contact details recorded'}
                  </span>
                )}
              </label>
              {driverListError && <span className='text-rose-600'>{driverListError}</span>}
            </div>
          )}
          {data?.rank && (
            <span className='rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700'>
              Leaderboard #{data.rank}
            </span>
          )}
          <button
            onClick={load}
            className='rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300'
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className='rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600'>
          Loading latest trips and leaderboard...
        </div>
      )}

      {!loading && error && (
        <div className='rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600'>{error}</div>
      )}

      {!loading && !error && data && (
        <div className='space-y-8'>
          <section className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <SummaryCard label='Loads delivered' value={data.summary.loadsDelivered} />
            <SummaryCard label='Tonnes delivered' value={`${data.summary.tonnesDelivered.toLocaleString()} t`} />
            <SummaryCard
              label='Weekly revenue'
              value={`KES ${data.summary.weeklyRevenue.toLocaleString()}`}
              detail={
                data.summary.previousWeekRevenue
                  ? `Prev week KES ${data.summary.previousWeekRevenue.toLocaleString()}`
                  : undefined
              }
            />
            <SummaryCard
              label='Average tonnes/load'
              value={data.summary.averageTonnesPerLoad.toFixed(1)}
              detail={
                trendPct !== null
                  ? `${trendPct >= 0 ? 'Up' : 'Down'} ${(Math.abs(trendPct) * 100).toFixed(1)}% vs last week`
                  : undefined
              }
            />
          </section>

          <section className='rounded-3xl border border-slate-200 bg-white p-5'>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-sm font-semibold text-slate-900'>
                Driver profile
                {role !== 'DRIVER' && selectedDriverInfo ? ` - ${selectedDriverInfo.name || selectedDriverInfo.id}` : ''}
              </h2>
              {profileStatus.kind !== 'idle' && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    profileStatus.kind === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                  }`}
                >
                  {profileStatus.message}
                </span>
              )}
            </div>
            <form onSubmit={submitProfile} className='grid gap-3 text-sm sm:grid-cols-2'>
              <label className='block'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Name</span>
                <input
                  disabled={profileDisabled || savingProfile}
                  className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                />
              </label>
              <label className='block'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Email</span>
                <input
                  disabled={profileDisabled || savingProfile}
                  type='email'
                  className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
                  value={profile.email}
                  onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                />
              </label>
              <label className='block'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Phone</span>
                <input
                  disabled={profileDisabled || savingProfile}
                  className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder='07XX...'
                />
              </label>
              <div className='block'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>National ID (photo)</span>
                <input
                  type='file'
                  accept='image/*'
                  disabled={profileDisabled || savingProfile}
                  className='mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-amber-100 file:px-4 file:py-2 file:text-amber-700'
                  onChange={(e) => handleProfileFile('nationalIdData', 'nationalId')(e.target.files?.[0] || null)}
                />
                {profilePreview.nationalId && (
                  <img src={profilePreview.nationalId} alt='National ID preview' className='mt-2 h-20 rounded border border-slate-200 object-cover' />
                )}
              </div>
              <div className='block'>
                <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Profile photo</span>
                <input
                  type='file'
                  accept='image/*'
                  disabled={profileDisabled || savingProfile}
                  className='mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-emerald-100 file:px-4 file:py-2 file:text-emerald-700'
                  onChange={(e) => handleProfileFile('photoData', 'photo')(e.target.files?.[0] || null)}
                />
                {profilePreview.photo && (
                  <img src={profilePreview.photo} alt='Profile preview' className='mt-2 h-20 w-20 rounded-full border border-slate-200 object-cover' />
                )}
              </div>
              <div className='sm:col-span-2'>
                <button
                  type='submit'
                  disabled={savingProfile || profileDisabled}
                  className='w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {savingProfile ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </form>
          </section>

          <section className='grid gap-6 lg:grid-cols-3'>
            <div className='lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-5'>
              <div className='mb-3 flex items-center justify-between'>
                <h2 className='text-sm font-semibold text-slate-900'>Recent assignments</h2>
                <span className='text-xs text-slate-500'>Showing latest 10</span>
              </div>
              <div className='overflow-auto text-sm'>
                <table className='min-w-full border-separate border-spacing-y-1'>
                  <thead className='text-left text-xs uppercase tracking-wide text-slate-500'>
                    <tr>
                      <th className='px-3 py-2'>Site</th>
                      <th className='px-3 py-2'>Status</th>
                      <th className='px-3 py-2'>Tonnes</th>
                      <th className='px-3 py-2'>Revenue</th>
                      <th className='px-3 py-2'>Scheduled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assignments.slice(0, 10).map((a: any) => (
                      <tr key={a.id} className='rounded-xl border border-slate-100 bg-slate-50/70'>
                        <td className='px-3 py-2'>
                          <div className='font-medium text-slate-900'>{a.site}</div>
                          <div className='text-xs text-slate-500'>{a.plate || a.truckId || 'Truck TBD'}</div>
                        </td>
                        <td className='px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600'>
                          {a.status}
                        </td>
                        <td className='px-3 py-2 text-sm text-slate-700'>{Number(a.tonnes || 0).toLocaleString()} t</td>
                        <td className='px-3 py-2 text-sm text-slate-700'>
                          KES {Number(a.estimatedRevenue || 0).toLocaleString()}
                        </td>
                        <td className='px-3 py-2 text-xs text-slate-500'>
                          {a.scheduledAt ? new Date(a.scheduledAt).toLocaleString() : 'TBC'}
                        </td>
                      </tr>
                    ))}
                    {data.assignments.length === 0 && (
                      <tr>
                        <td colSpan={5} className='px-3 py-6 text-center text-xs text-slate-500'>
                          No assignments yet. Operations will notify you once a load is scheduled.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='rounded-3xl border border-slate-200 bg-white p-5'>
              <h2 className='text-sm font-semibold text-slate-900'>Leaderboard (KES)</h2>
              <div className='mt-3 h-64'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart data={data.leaderboard.slice(0, 5).map((d: any) => ({ ...d, label: d.name || d.driverId }))}>
                    <CartesianGrid strokeDasharray='3 3' />
                    <XAxis dataKey='label' />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey='revenue' fill='#0f766e' />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className='rounded-3xl border border-slate-200 bg-white p-5'>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-sm font-semibold text-slate-900'>Assigned trucks</h2>
              <span className='text-xs text-slate-500'>Last refresh {new Date().toLocaleTimeString()}</span>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              {data.telemetry.length === 0 && (
                <div className='rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500'>
                  No trucks attached yet. You will see live location once dispatch assigns your next load.
                </div>
              )}
              {data.telemetry.map((t: any) => {
                const idle = typeof t.idleMinutes === 'number' ? t.idleMinutes : null;
                return (
                  <div key={t.truckId || t.plate} className='flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <div className='text-sm font-semibold text-slate-900'>{t.plate || t.truckId}</div>
                        <div className='text-xs text-slate-500'>{t.status || 'Status pending'}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${Number(t.speed || 0) > 5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {t.speed !== null && t.speed !== undefined ? `${Math.round(t.speed)} km/h` : 'n/a'}
                      </span>
                    </div>
                    <div className='text-xs text-slate-500'>
                      {t.address ? t.address : t.lat && t.lng ? `Lat ${Number(t.lat).toFixed(3)}, Lng ${Number(t.lng).toFixed(3)}` : 'Location refreshing'}
                    </div>
                    <div className='flex items-center justify-between text-xs text-slate-500'>
                      <span>Updated {t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString() : 'just now'}</span>
                      {idle !== null && <span>{idle} min idle</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='text-xs font-semibold uppercase tracking-wide text-slate-500'>{label}</div>
      <div className='mt-2 text-xl font-bold text-slate-900'>{value}</div>
      {detail && <div className='mt-1 text-xs text-slate-500'>{detail}</div>}
    </div>
  );
}
