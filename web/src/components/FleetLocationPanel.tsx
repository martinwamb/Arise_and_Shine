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
  pairedTrailerPlate?: string | null;
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
const MOVING_SPEED_THRESHOLD = 2; // km/h above which we show heading

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
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackTruckId, setPlaybackTruckId] = useState<string>('');

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

  const createMarkerIcon = useCallback((selected: boolean, heading?: number | null, showArrow?: boolean) => {
    const size = selected ? 34 : 26;
    const radius = size / 2;
    const color = selected ? '#ea580c' : '#2563eb';
    const glow = selected ? '8px rgba(234,88,12,0.35)' : '4px rgba(37,99,235,0.3)';
    const normalizedHeading =
      !showArrow || heading === null || heading === undefined || Number.isNaN(Number(heading))
        ? null
        : ((Number(heading) % 360) + 360) % 360;

    const arrow =
      normalizedHeading === null
        ? ''
        : `<g transform="rotate(${normalizedHeading} ${radius} ${radius})">
             <path d="M${radius} ${radius - (selected ? 16 : 13)} L${radius - 7} ${radius + (selected ? 3 : 2)} L${radius + 7} ${
            radius + (selected ? 3 : 2)
          } Z"
               fill="#0f172a" stroke="${color}" stroke-width="2" opacity="0.9" />
           </g>`;

    return L.divIcon({
      className: 'fleet-marker',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter: drop-shadow(0 0 0 ${glow}); ${
        selected ? 'transform:scale(1.05);' : ''
      }">
        <circle cx="${radius}" cy="${radius}" r="${radius - 3}" fill="${color}" stroke="white" stroke-width="3" />
        ${arrow}
      </svg>`,
      iconSize: [size, size],
      iconAnchor: [radius, radius],
      popupAnchor: [0, -radius / 2],
    });
  }, []);

  const getMarkerIcon = useCallback(
    (selected: boolean, heading?: number | null, showArrow?: boolean) => {
      const normalized =
        !showArrow || heading === null || heading === undefined || Number.isNaN(Number(heading))
          ? 'na'
          : String(Math.round(((Number(heading) % 360) + 360) % 360));
      const key = `${selected ? '1' : '0'}-${normalized}-${showArrow ? 'a' : 'n'}`;
      const cached = iconCache.get(key);
      if (cached) return cached;
      const icon = createMarkerIcon(selected, heading, showArrow);
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

  const effectivePlaybackTruckId = playbackTruckId || selectedTruckId || '';

  const startPlayback = useCallback(async () => {
    const truckForPlayback = playbackTruckId || selectedTruckId;
    if (!truckForPlayback) return;
    setPlaybackLoading(true);
    setPlaybackError(null);
    setPlaybackHint('');
    setIsPlaying(false);
    try {
      const params: Record<string, string | number> = { limit: 1000 };
      if (playbackRange.from) params.from = playbackRange.from;
      if (playbackRange.to) params.to = playbackRange.to;
      const res = await api.get(`/api/telemetry/trucks/${truckForPlayback}/history`, { params });
      const points: TelemetrySnapshot[] = Array.isArray(res.data) ? res.data : [];
      const filtered = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.capturedAt);
      // API returns ASC order already; no client-side re-filter needed
      setHistoryPoints(filtered);
      if (filtered.length < 2) {
        setPlaybackHint('Not enough GPS points in that window. Try a wider time range.');
        setPlaybackIndex(0);
        setIsPlaying(false);
        return;
      }
      setPlaybackIndex(0);
      setPlaybackHint(`Loaded ${filtered.length} points`);
      setIsPlaying(true);
    } catch (err: any) {
      setPlaybackError(err?.response?.data?.error || err?.message || 'Failed to load route history.');
    } finally {
      setPlaybackLoading(false);
    }
  }, [playbackTruckId, selectedTruckId, playbackRange]);

  useEffect(() => {
    if (!isPlaying || playbackTrail.length === 0) return;
    const stepMs = Math.max(200, Math.round(900 / playbackSpeed));
    const timer = window.setInterval(() => {
      setPlaybackIndex((idx) => {
        if (idx >= playbackTrail.length - 1) {
          setIsPlaying(false);
          return idx;
        }
        return idx + 1;
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackTrail.length, playbackSpeed]);

  useEffect(() => {
    setHistoryPoints([]);
    setPlaybackIndex(0);
    setIsPlaying(false);
    setPlaybackHint('');
    setPlaybackError(null);
  }, [selectedTruckId, playbackTruckId]);

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

      {/* Route playback controls */}
      <div className='rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-2'>
        <div className='font-semibold text-slate-700 text-[11px] uppercase tracking-wide'>Route playback</div>
        <div className='flex flex-wrap items-center gap-2'>
          {/* Truck selector */}
          <select
            value={effectivePlaybackTruckId}
            onChange={(e) => setPlaybackTruckId(e.target.value)}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none bg-white'
          >
            <option value=''>— select truck —</option>
            {telemetry.map((item) => (
              <option key={item.truckId} value={item.truckId}>
                {item.plate || item.truckId}
              </option>
            ))}
          </select>
          <span className='text-slate-300'>|</span>
          {/* Date-time range */}
          <input
            type='datetime-local'
            value={playbackRange.from}
            onChange={(e) => setPlaybackRange((prev) => ({ ...prev, from: e.target.value }))}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none bg-white'
          />
          <span className='text-slate-400'>to</span>
          <input
            type='datetime-local'
            value={playbackRange.to}
            onChange={(e) => setPlaybackRange((prev) => ({ ...prev, to: e.target.value }))}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none bg-white'
          />
          <span className='text-slate-300'>|</span>
          {/* Speed */}
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value) || 1)}
            className='rounded border border-slate-200 px-2 py-[6px] text-[11px] focus:border-teal-600 focus:outline-none bg-white'
          >
            {[0.5, 1, 2, 4, 8].map((v) => (
              <option key={v} value={v}>{v}x</option>
            ))}
          </select>
          {/* Play / Pause */}
          <button
            onClick={() => (isPlaying ? setIsPlaying(false) : startPlayback())}
            disabled={playbackLoading || !effectivePlaybackTruckId}
            className={`rounded border px-3 py-1 font-semibold ${
              isPlaying
                ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {playbackLoading ? 'Loading…' : isPlaying ? '⏸ Pause' : '▶ Play route'}
          </button>
          {/* Restart */}
          {playbackTrail.length > 0 && !isPlaying && (
            <button
              onClick={() => { setPlaybackIndex(0); setIsPlaying(true); }}
              className='rounded border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 hover:border-slate-400'
            >
              ↺ Restart
            </button>
          )}
          {/* Stop / Clear */}
          {playbackTrail.length > 0 && (
            <button
              onClick={() => { setHistoryPoints([]); setPlaybackIndex(0); setIsPlaying(false); setPlaybackHint(''); }}
              className='rounded border border-slate-200 bg-white px-3 py-1 text-slate-400 hover:border-slate-400 hover:text-slate-600'
            >
              ✕ Clear
            </button>
          )}
        </div>
        {/* Status row */}
        <div className='flex flex-wrap items-center gap-3'>
          {playbackError && <span className='text-rose-600'>{playbackError}</span>}
          {!playbackError && playbackHint && (
            <span className='text-slate-500'>{playbackHint}</span>
          )}
          {isPlaying && currentPlayback && (
            <span className='rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 tabular-nums'>
              {playbackIndex + 1} / {playbackTrail.length}
              {Number.isFinite(Number(currentPlayback.speed)) && ` · ${Math.round(Number(currentPlayback.speed))} km/h`}
              {currentPlayback.capturedAt && ` · ${new Date(currentPlayback.capturedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
            </span>
          )}
          {/* Progress bar */}
          {playbackTrail.length > 1 && (
            <input
              type='range'
              min={0}
              max={playbackTrail.length - 1}
              value={playbackIndex}
              onChange={(e) => { setIsPlaying(false); setPlaybackIndex(Number(e.target.value)); }}
              className='h-1.5 flex-1 min-w-[120px] accent-teal-600 cursor-pointer'
            />
          )}
        </div>
      </div>

      {/* isolate creates a new stacking context so Leaflet z-indexes don't bleed outside the map */}
      <div className='overflow-hidden rounded-2xl border border-slate-200 isolate'>
        <MapContainer center={mapCenter} zoom={9} style={{ height: 440 }}>
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
              icon={getMarkerIcon(
                true,
                currentPlayback.heading ?? selectedTelemetry?.heading ?? null,
                Number(currentPlayback.speed || 0) > MOVING_SPEED_THRESHOLD
              )}
              zIndexOffset={1200}
            >
              <Tooltip direction='top' offset={[0, -16]} opacity={1} permanent>
                <div className='text-[11px] leading-snug'>
                  <span className='font-semibold text-slate-800'>
                    {telemetry.find(t => t.truckId === (effectivePlaybackTruckId || selectedTruckId))?.plate || effectivePlaybackTruckId || selectedTruckId}
                  </span>
                  {Number.isFinite(Number(currentPlayback.speed)) && (
                    <span className={`ml-1.5 font-bold ${Number(currentPlayback.speed) >= 80 ? 'text-rose-600' : Number(currentPlayback.speed) >= 65 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {Math.round(Number(currentPlayback.speed))} km/h
                    </span>
                  )}
                  {currentPlayback.capturedAt && (
                    <div className='text-slate-500'>
                      {new Date(currentPlayback.capturedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </div>
                  )}
                  {currentPlayback.address && (
                    <div className='text-slate-400 max-w-[200px] truncate'>{currentPlayback.address}</div>
                  )}
                </div>
              </Tooltip>
            </Marker>
          )}
          {markers.map((item) => (
            <Marker
              key={item.truckId}
              position={[Number(item.lat), Number(item.lng)]}
              icon={getMarkerIcon(
                item.truckId === selectedTruckId,
                item.heading,
                Number(item.speed || 0) > MOVING_SPEED_THRESHOLD
              )}
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
                  {item.pairedTrailerPlate && (
                    <div className='font-medium text-orange-700'>Trailer: {item.pairedTrailerPlate}</div>
                  )}
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
                  <div className='flex items-center gap-1.5'>
                    {item.pairedTrailerPlate && (
                      <span className='rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700' title={`Trailer attached: ${item.pairedTrailerPlate}`}>
                        +{item.pairedTrailerPlate}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        Number(item.speed || 0) > 5 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {item.speed !== null && item.speed !== undefined ? `${Math.round(item.speed)} km/h` : 'n/a'}
                    </span>
                  </div>
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
