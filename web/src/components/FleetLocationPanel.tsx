import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { api } from '../api';

// Fix default Leaflet icon paths within bundlers
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

type TelemetryItem = {
  truckId: string;
  plate: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  status?: string;
  address?: string;
  lastUpdated?: string;
  idleMinutes?: number | null;
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverEmail?: string | null;
  source?: string | null;
  capacityT?: number | null;
};

type DriverOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

type StatusMessage = { kind: 'idle' | 'success' | 'error'; message: string };

const DEFAULT_CENTER: [number, number] = [-1.286389, 36.817223]; // Nairobi CBD

export default function FleetLocationPanel({ allowReassign }: { allowReassign: boolean }) {
  const role = (localStorage.getItem('role') || '').toUpperCase();
  const canReassign = allowReassign && (role === 'ADMIN' || role === 'OPS');
  const [telemetry, setTelemetry] = useState<TelemetryItem[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage>({ kind: 'idle', message: '' });
  const [savingDriverFor, setSavingDriverFor] = useState<string | null>(null);

  const fetchTelemetry = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
      try {
        if (!silent) setLoading(true);
        const res = await api.get('/api/telemetry/trucks');
        const list: TelemetryItem[] = Array.isArray(res.data) ? res.data : [];
        setTelemetry(list);
        setError(null);
        if (!selectedTruckId && list.length) {
          const firstWithCoords = list.find((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
          setSelectedTruckId((firstWithCoords || list[0]).truckId);
        } else if (selectedTruckId && list.every((item) => item.truckId !== selectedTruckId)) {
          setSelectedTruckId(list[0]?.truckId || null);
        }
      } catch (err: any) {
        if (!silent) {
          setError(err?.response?.data?.error || err?.message || 'Unable to fetch live truck data');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedTruckId]
  );

  useEffect(() => {
    fetchTelemetry();
    const timer = setInterval(() => fetchTelemetry({ silent: true }), 30000);
    return () => clearInterval(timer);
  }, [fetchTelemetry]);

  useEffect(() => {
    if (!canReassign) return;
    (async () => {
      try {
        const res = await api.get('/api/admin/drivers');
        const list: DriverOption[] = Array.isArray(res.data)
          ? res.data.map((d: any) => ({
              id: d.id,
              name: d.name || d.id,
              phone: d.phone || '',
              email: d.email || '',
            }))
          : [];
        setDrivers(list);
      } catch (err) {
        console.warn('Driver list fetch failed', err);
      }
    })();
  }, [canReassign]);

  const markers = useMemo(
    () => telemetry.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)),
    [telemetry]
  );

  const selectedTelemetry = useMemo(() => telemetry.find((item) => item.truckId === selectedTruckId) || null, [
    telemetry,
    selectedTruckId,
  ]);

  const mapCenter = useMemo<[number, number]>(() => {
    if (selectedTelemetry && Number.isFinite(selectedTelemetry.lat) && Number.isFinite(selectedTelemetry.lng)) {
      return [Number(selectedTelemetry.lat), Number(selectedTelemetry.lng)];
    }
    const firstMarker = markers[0];
    if (firstMarker && Number.isFinite(firstMarker.lat) && Number.isFinite(firstMarker.lng)) {
      return [Number(firstMarker.lat), Number(firstMarker.lng)];
    }
    return DEFAULT_CENTER;
  }, [selectedTelemetry, markers]);

  const assignDriver = useCallback(
    async (truckId: string, driverId: string | null) => {
      if (!canReassign) return;
      setSavingDriverFor(truckId);
      setStatus({ kind: 'idle', message: '' });
      try {
        await api.patch(`/api/admin/trucks/${truckId}`, { primaryDriverId: driverId || null });
        setStatus({
          kind: 'success',
          message: 'Driver assignment updated.',
        });
        await fetchTelemetry({ silent: true });
      } catch (err: any) {
        setStatus({
          kind: 'error',
          message: err?.response?.data?.error || err?.message || 'Failed to update assignment.',
        });
      } finally {
        setSavingDriverFor(null);
      }
    },
    [canReassign, fetchTelemetry]
  );

  const renderDriverSelect = (item: TelemetryItem) => {
    if (!canReassign) {
      return (
        <div className='text-xs text-slate-500'>
          Driver: {item.driverName || 'Unassigned'}
          {item.driverPhone ? ` | ${item.driverPhone}` : ''}
        </div>
      );
    }
    return (
      <div className='flex flex-col gap-2 text-xs text-slate-600'>
        <label className='flex items-center gap-2'>
          <span className='font-semibold text-slate-500'>Driver</span>
          <select
            value={item.driverId || ''}
            onChange={(e) => assignDriver(item.truckId, e.target.value || null)}
            disabled={savingDriverFor === item.truckId}
            className='rounded border border-slate-300 px-2 py-1 focus:border-teal-600 focus:outline-none'
          >
            <option value=''>Unassigned</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </label>
        {item.driverPhone || item.driverEmail ? (
          <span className='text-slate-500'>
            {[item.driverPhone, item.driverEmail].filter(Boolean).join(' | ') || 'No contact details recorded'}
          </span>
        ) : null}
      </div>
    );
  };

  const idleLabel = (item: TelemetryItem) => {
    if (item.idleMinutes === null || item.idleMinutes === undefined) return 'Idle time n/a';
    if (item.idleMinutes < 1) return 'Idle < 1 min';
    return `Idle ${item.idleMinutes} min`;
  };

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Truck locations</h2>
          <p className='text-xs text-slate-500'>
            Live positions refresh automatically every 30 seconds. Click a marker or card to focus a truck.
          </p>
        </div>
        <div className='flex items-center gap-3 text-xs text-slate-600'>
          {status.kind !== 'idle' && (
            <span
              className={`rounded-full px-3 py-1 font-semibold ${
                status.kind === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
              }`}
            >
              {status.message}
            </span>
          )}
          {error && <span className='text-rose-600'>{error}</span>}
          <button
            onClick={() => fetchTelemetry()}
            className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
          >
            Refresh
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-2xl border border-slate-200'>
        <MapContainer center={mapCenter} zoom={9} style={{ height: 420 }}>
          <TileLayer url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' attribution='© OpenStreetMap contributors' />
          {markers.map((item) => (
            <Marker
              key={item.truckId}
              position={[Number(item.lat), Number(item.lng)]}
              eventHandlers={{
                click: () => setSelectedTruckId(item.truckId),
              }}
            >
              <Popup>
                <div className='space-y-1 text-xs text-slate-700'>
                  <div className='font-semibold text-slate-900'>{item.plate || item.truckId}</div>
                  <div>{item.address || 'Address updating...'}</div>
                  <div>{item.status || 'Status pending'} · {item.speed !== null ? `${Math.round(item.speed)} km/h` : 'speed n/a'}</div>
                  <div>{idleLabel(item)}</div>
                  <div>
                    Driver: {item.driverName || 'Unassigned'}
                    {item.driverPhone ? ` (${item.driverPhone})` : ''}
                  </div>
                  <div className='text-slate-500'>
                    Updated {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString() : 'just now'}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {loading && telemetry.length === 0 ? (
        <div className='rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600'>
          Loading live truck feed...
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
          {telemetry.map((item) => {
            const isActive = item.truckId === selectedTruckId;
            return (
              <div
                key={item.truckId}
                className={`flex flex-col gap-2 rounded-xl border p-4 transition shadow-sm ${
                  isActive ? 'border-teal-400 bg-teal-50/60' : 'border-slate-200 bg-slate-50/70'
                }`}
                onClick={() => setSelectedTruckId(item.truckId)}
                role='button'
              >
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='text-sm font-semibold text-slate-900'>{item.plate || item.truckId}</div>
                    <div className='text-xs text-slate-500'>{item.status || 'Status pending'}</div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      Number(item.speed || 0) > 5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.speed !== null && item.speed !== undefined ? `${Math.round(item.speed)} km/h` : 'n/a'}
                  </span>
                </div>
                <div className='text-xs text-slate-500'>
                  {item.address
                    ? item.address
                    : Number.isFinite(item.lat) && Number.isFinite(item.lng)
                    ? `Lat ${Number(item.lat).toFixed(3)}, Lng ${Number(item.lng).toFixed(3)}`
                    : 'Location update pending'}
                </div>
                <div className='flex items-center justify-between text-xs text-slate-500'>
                  <span>
                    Updated {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString() : 'just now'}
                  </span>
                  <span>{idleLabel(item)}</span>
                </div>
                {renderDriverSelect(item)}
              </div>
            );
          })}
          {telemetry.length === 0 && (
            <div className='rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500'>
              No trucks are reporting positions yet. Add trucks or connect your telematics feed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
