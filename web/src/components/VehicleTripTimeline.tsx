import React from 'react';

type ArrivalEvent = {
  type: 'arrival';
  startDisplay: string;
  endDisplay: string;
  location: string;
  durationMin: number;
};

type StopEvent = {
  type: 'stop';
  startDisplay: string;
  endDisplay: string;
  location: string;
  durationMin: number;
};

type TripEvent = {
  type: 'trip';
  startDisplay: string;
  endDisplay: string;
  destination: string;
  distanceKm: number | null;
  durationMin: number;
};

type OngoingEvent = {
  type: 'ongoing';
  startDisplay: string;
  destination: string;
};

type TimelineEvent = ArrivalEvent | StopEvent | TripEvent | OngoingEvent;

type TimelineDay = {
  date: string;
  dateDisplay: string;
  events: TimelineEvent[];
};

type TimelineTruck = {
  plate: string;
  truckId: string;
  days: TimelineDay[];
};

type TimelineData = {
  trucks: TimelineTruck[];
};

interface VehicleTripTimelineProps {
  timeline: TimelineData | null;
  loading: boolean;
}

function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function EventRow({ event, index }: { event: TimelineEvent; index: number }) {
  if (event.type === 'arrival') {
    return (
      <div className='relative flex items-start gap-3 py-1.5'>
        <span className='absolute -left-[1.3rem] mt-[0.35rem] h-3 w-3 rounded-full bg-slate-900 ring-2 ring-white shrink-0' />
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
          <span className='font-mono text-slate-400 tabular-nums'>{event.startDisplay}–{event.endDisplay}</span>
          <span className='font-semibold text-slate-900'>{event.location}</span>
          <span className='rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wide'>Arrival</span>
          {event.durationMin > 0 && (
            <span className='text-slate-400'>{formatDuration(event.durationMin)}</span>
          )}
        </div>
      </div>
    );
  }

  if (event.type === 'stop') {
    return (
      <div className='relative flex items-start gap-3 py-1.5'>
        <span className='absolute -left-[1.3rem] mt-[0.35rem] h-3 w-3 rounded-full bg-slate-300 ring-2 ring-white shrink-0' />
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600'>
          <span className='font-mono text-slate-400 tabular-nums'>{event.startDisplay}–{event.endDisplay}</span>
          <span className='font-medium text-slate-700'>{event.location}</span>
          {event.durationMin > 0 && (
            <span className='text-slate-400'>{formatDuration(event.durationMin)}</span>
          )}
        </div>
      </div>
    );
  }

  if (event.type === 'trip') {
    return (
      <div className='relative flex items-start gap-3 py-1.5'>
        <span className='absolute -left-[1.25rem] mt-[0.2rem] text-slate-400 text-sm leading-none select-none'>→</span>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
          <span className='font-mono text-slate-400 tabular-nums'>{event.startDisplay}–{event.endDisplay}</span>
          <span className='text-slate-500'>Drove to</span>
          <span className='font-semibold text-slate-900'>{event.destination}</span>
          {event.distanceKm != null && (
            <span className='rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600'>{event.distanceKm} km</span>
          )}
          {event.durationMin > 0 && (
            <span className='text-slate-400'>{formatDuration(event.durationMin)}</span>
          )}
        </div>
      </div>
    );
  }

  // ongoing
  return (
    <div className='relative flex items-start gap-3 py-1.5'>
      <span className='absolute -left-[1.3rem] mt-[0.35rem] h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white animate-pulse shrink-0' />
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-amber-700'>
        <span className='font-mono tabular-nums'>{event.startDisplay}–now</span>
        <span>Driving to</span>
        <span className='font-semibold'>{event.destination}</span>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className='space-y-3 px-5 py-4'>
      {[80, 60, 90, 50, 70].map((w, i) => (
        <div key={i} className='flex items-center gap-3'>
          <div className='h-3 w-3 rounded-full bg-slate-200 shrink-0' />
          <div className={`h-3 rounded bg-slate-100`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function VehicleTripTimeline({ timeline, loading }: VehicleTripTimelineProps) {
  if (loading) {
    return (
      <div className='space-y-4'>
        {[1, 2].map((i) => (
          <div key={i} className='rounded-xl border border-slate-200 bg-white overflow-hidden animate-pulse'>
            <div className='border-b border-slate-100 px-5 py-3'>
              <div className='h-4 w-24 rounded bg-slate-200' />
            </div>
            <SkeletonRows />
          </div>
        ))}
      </div>
    );
  }

  if (!timeline || timeline.trucks.length === 0) {
    return (
      <div className='rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center'>
        <p className='text-sm text-slate-400'>No trip data for the selected period.</p>
        <p className='mt-1 text-xs text-slate-300'>Try a different date range or truck filter.</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {timeline.trucks.map((truck) => (
        <div key={truck.truckId} className='rounded-xl border border-slate-200 bg-white overflow-hidden'>
          {/* Truck header */}
          <div className='flex items-center justify-between border-b border-slate-100 px-5 py-3'>
            <h3 className='text-sm font-semibold text-slate-900'>{truck.plate}</h3>
            <span className='text-xs text-slate-400'>
              {truck.days.length} day{truck.days.length !== 1 ? 's' : ''}
              {' · '}
              {truck.days.reduce((n, d) => n + d.events.length, 0)} events
            </span>
          </div>

          {/* Days */}
          {truck.days.map((day) => (
            <div key={day.date} className='px-5 py-3 border-b border-slate-50 last:border-b-0'>
              <p className='mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400'>
                {day.dateDisplay}
              </p>
              {/* Timeline line */}
              <div className='relative ml-2 border-l-2 border-slate-100 pl-5 space-y-0'>
                {day.events.map((ev, i) => (
                  <EventRow key={i} event={ev} index={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
