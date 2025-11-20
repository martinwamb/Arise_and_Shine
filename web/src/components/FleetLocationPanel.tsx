import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
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
  heading?: number | null;
  status?: string;
  address?: string;
  lastUpdated?: string;
  idleMinutes?: number | null;
  engineOn?: boolean | null;
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverEmail?: string | null;
  driverAssignedAt?: string | null;
  source?: string | null;
  capacityT?: number | null;
};

type TelemetrySnapshot = {
  id: string | number;
  truckId: string;
  lat: number | null;
  lng: number | null;
  speed?: number | null;
  heading?: number | null;
  status?: string | null;
  address?: string | null;
  idleMinutes?: number | null;
  plate?: string | null;
  capturedAt?: string | null;
};

type DriverOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

type StatusMessage = { kind: 'idle' | 'success' | 'error'; message: string };

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

const DEFAULT_CENTER: [number, number] = [-1.286389, 36.817223]; // Nairobi CBD

function MapViewUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (!center) return;
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

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
  const [historyPoints, setHistoryPoints] = useState<TelemetrySnapshot[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackHint, setPlaybackHint] = useState<string>('');
  const [playbackRange, setPlaybackRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [isPlaying, setIsPlaying] = useState(false);

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

  const iconCache = useMemo(() => new Map<string, L.DivIcon>(), []);

  const createMarkerIcon = useCallback((selected: boolean, heading?: number | null) => {
    const size = selected ? 30 : 22;
    const radius = size / 2;
    const color = selected ? '#ea580c' : '#2563eb';
    const glow = selected ? '8px rgba(234,88,12,0.35)' : '4px rgba(37,99,235,0.3)';
    const normalizedHeading =
      heading === null || heading === undefined || Number.isNaN(Number(heading))
        ? null
        : ((Number(heading) % 360) + 360) % 360;

    const arrow =
      normalizedHeading === null
        ? ''
        : `<g transform="rotate(${normalizedHeading} ${radius} ${radius})">
             <path d="M${radius} ${radius - (selected ? 9 : 7)} L${radius - 5} ${radius + (selected ? 6 : 5)} L${radius} ${
            radius + (selected ? 2 : 1)
          } L${radius + 5} ${radius + (selected ? 6 : 5)} Z" fill="${color}" opacity="0.9" />
           </g>`;

    return L.divIcon({
      className: 'fleet-marker',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter: drop-shadow(0 0 0 ${glow}); ${
        selected ? 'transform:scale(1.05);' : ''
      }">
        ${arrow}
        <circle cx="${radius}" cy="${radius}" r="${radius - 3}" fill="${color}" stroke="white" stroke-width="3" />
      </svg>`,
      iconSize: [size, size],
      iconAnchor: [radius, radius],
      popupAnchor: [0, -radius / 2],
    });
  }, []);

  const getMarkerIcon = useCallback(
    (selected: boolean, heading?: number | null) => {
      const normalized =
        heading === null || heading === undefined || Number.isNaN(Number(heading))
          ? 'na'
          : String(Math.round(((Number(heading) % 360) + 360) % 360));
      const key = `${selected ? '1' : '0'}-${normalized}`;
      const cached = iconCache.get(key);
      if (cached) return cached;
      const icon = createMarkerIcon(selected, heading);
      iconCache.set(key, icon);
      return icon;
    },
    [createMarkerIcon, iconCache]
  );

  const selectedTelemetry = useMemo(
    () => telemetry.find((item) => item.truckId === selectedTruckId) || null,
    [telemetry, selectedTruckId]
  );

  const playbackTrail = useMemo(() => {
    const ordered = historyPoints.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    ordered.sort((a, b) => new Date(a.capturedAt || '').getTime() - new Date(b.capturedAt || '').getTime());
    return ordered;
  }, [historyPoints]);

  const currentPlayback = playbackTrail[playbackIndex] || null;

  const mapCenter = useMemo<[number, number]>(() => {
    if (isPlaying && currentPlayback) {
      return [Number(currentPlayback.lat), Number(currentPlayback.lng)];
    }
    if (selectedTelemetry && Number.isFinite(selectedTelemetry.lat) && Number.isFinite(selectedTelemetry.lng)) {
      return [Number(selectedTelemetry.lat), Number(selectedTelemetry.lng)];
    }
    const firstMarker = markers[0];
    if (firstMarker && Number.isFinite(firstMarker.lat) && Number.isFinite(firstMarker.lng)) {
      return [Number(firstMarker.lat), Number(firstMarker.lng)];
    }
    return DEFAULT_CENTER;
  }, [isPlaying, currentPlayback, selectedTelemetry, markers]);

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
        <div className='flex flex-col gap-1 text-xs text-slate-500'>
          <div>
            Driver: {item.driverName || 'Unassigned'}
            {item.driverPhone ? ` | ${item.driverPhone}` : ''}
          </div>
          {item.driverAssignedAt ? (
            <div className='text-[11px] text-slate-400'>Assigned {formatDateTime(item.driverAssignedAt)}</div>
          ) : null}
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
          <div className='flex flex-col gap-1 text-slate-500'>
            {item.driverPhone && <span>Phone: {item.driverPhone}</span>}
            {item.driverEmail && <span>Email: {item.driverEmail}</span>}
          </div>
        ) : (
          <div className='text-slate-400'>No contact details recorded</div>
        )}
        {item.driverAssignedAt ? (
          <div className='text-[11px] text-slate-400'>Assigned {formatDateTime(item.driverAssignedAt)}</div>
        ) : null}
      </div>
    );
  };

  const idleLabel = (item: TelemetryItem) => {
    if (item.idleMinutes === null || item.idleMinutes === undefined) return 'Idle time n/a';
    if (item.idleMinutes <= 0) return 'Idle 0 min';
    if (item.idleMinutes < 1) return 'Idle < 1 min';
    return `Idle ${item.idleMinutes} min`;
  };

  const startPlayback = useCallback(async () => {
    if (!selectedTruckId) return;
    setPlaybackLoading(true);
    setPlaybackError(null);
    setPlaybackHint('');
    setIsPlaying(false);
    try {
      const res = await api.get(`/api/telemetry/trucks/${selectedTruckId}/history`, { params: { limit: 300 } });
      const points: TelemetrySnapshot[] = Array.isArray(res.data) ? res.data : [];
      const ordered = points
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.capturedAt)
        .sort((a, b) => new Date(a.capturedAt || '').getTime() - new Date(b.capturedAt || '').getTime());

      const fromTs = playbackRange.from ? new Date(playbackRange.from).getTime() : null;
      const toTs = playbackRange.to ? new Date(playbackRange.to).getTime() : null;
      const filtered = ordered.filter((p) => {
        const ts = p.capturedAt ? new Date(p.capturedAt).getTime() : NaN;
        if (Number.isNaN(ts)) return false;
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        return true;
      });

      setHistoryPoints(filtered);
      if (filtered.length < 2) {
        setPlaybackHint('Not enough history in that window for playback.');
        setPlaybackIndex(0);
        setIsPlaying(false);
        return;
      }
      setPlaybackIndex(0);
      setPlaybackHint(`Playing ${filtered.length} points`);
      setIsPlaying(true);
    } catch (err: any) {
      setPlaybackError(err?.response?.data?.error || err?.message || 'Failed to load route history.');
    } finally {
      setPlaybackLoading(false);
    }
  }, [selectedTruckId, playbackRange]);

  useEffect(() => {
    if (!isPlaying || playbackTrail.length === 0) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex((idx) => {
        if (idx >= playbackTrail.length - 1) {
          setIsPlaying(false);
          return idx;
        }
        return idx + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackTrail.length]);

  useEffect(() => {
    setHistoryPoints([]);
    setPlaybackIndex(0);
    setIsPlaying(false);
    setPlaybackHint('');
    setPlaybackError(null);
  }, [selectedTruckId]);

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Truck locations</h2>
          <p className='text-xs text-slate-500'>
            Live positions refresh automatically every 30 seconds. Click a marker or card to focus a truck.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-3 text-xs text-slate-600'>
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

      <div className='flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-semibold text-slate-700'>Route playback</span>
          <input
            type='datetime-local'
            value={playbackRange.from}
            onChange={(e) => setPlaybackRange((prev) => ({ ...prev, from: e.target.value }))}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none'
          />
          <span className='text-slate-400'>to</span>
          <input
            type='datetime-local'
            value={playbackRange.to}
            onChange={(e) => setPlaybackRange((prev) => ({ ...prev, to: e.target.value }))}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none'
          />
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {playbackError && <span className='text-rose-600'>{playbackError}</span>}
          {playbackHint && !playbackError && <span className='text-slate-500'>{playbackHint}</span>}
          {isPlaying && (
            <span className='rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700'>
              {playbackIndex + 1}/{playbackTrail.length || 0}
            </span>
          )}
          <button
            onClick={() => (isPlaying ? setIsPlaying(false) : startPlayback())}
            disabled={playbackLoading || !selectedTruckId}
            className={`rounded border px-3 py-1 font-semibold ${
              isPlaying
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {isPlaying ? 'Pause' : playbackLoading ? 'Loading...' : 'Play route'}
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-2xl border border-slate-200'>
        <MapContainer center={mapCenter} zoom={9} style={{ height: 420 }}>
          <MapViewUpdater center={mapCenter} />
          <TileLayer
            url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
            attribution='&copy; OpenStreetMap contributors'
          />
          {playbackTrail.length > 1 && (
            <Polyline
              positions={playbackTrail.map((p) => [Number(p.lat), Number(p.lng)]) as [number, number][]}
              pathOptions={{ color: '#0ea5e9', weight: 4, opacity: 0.45 }}
            />
          )}
          {currentPlayback && (
            <Marker
              position={[Number(currentPlayback.lat), Number(currentPlayback.lng)]}
              icon={getMarkerIcon(true, currentPlayback.heading ?? selectedTelemetry?.heading ?? null)}
              zIndexOffset={1200}
            >
              <Tooltip direction='top' offset={[0, -12]} opacity={1}>
                <span className='text-[11px] font-semibold text-slate-800'>
                  Playback |{' '}
                  {currentPlayback.capturedAt ? new Date(currentPlayback.capturedAt).toLocaleTimeString() : ''}
                </span>
              </Tooltip>
            </Marker>
          )}
          {markers.map((item) => (
            <Marker
              key={item.truckId}
              position={[Number(item.lat), Number(item.lng)]}
              icon={getMarkerIcon(item.truckId === selectedTruckId, item.heading)}
              zIndexOffset={item.truckId === selectedTruckId ? 1000 : 0}
              eventHandlers={{
                click: () => setSelectedTruckId(item.truckId),
              }}
            >
              <Tooltip direction='top' offset={[0, -12]} opacity={1} permanent>
                <span className='text-[11px] font-semibold text-slate-800'>{item.plate || item.truckId}</span>
              </Tooltip>
              <Popup>
                <div className='space-y-1 text-xs text-slate-700'>
                  <div className='font-semibold text-slate-900'>{item.plate || item.truckId}</div>
                  <div>{item.address || 'Address updating...'}</div>
                  <div>
                    {item.status || 'Status pending'} |{' '}
                    {item.speed !== null ? `${Math.round(item.speed)} km/h` : 'speed n/a'}
                  </div>
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
                  isActive ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-200' : 'border-slate-200 bg-slate-50/70'
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
                  <span>Updated {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString() : 'just now'}</span>
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
