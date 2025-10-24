
import React, { useEffect, useState } from 'react';
import { api } from '../api';

const DISTANCE_SOURCE_LABELS: Record<string, string> = {
  manual: "manual distance",
  geocoded: "geocoded",
  heuristic: "name heuristic",
  default: "default estimate",
};

type CustomerOrder = {
  id: string;
  site: string;
  sand_type?: string;
  trucks: number;
  per_truck?: number;
  total?: number;
  status: string;
  payment_status?: string;
  distance_km?: number;
  distance_source?: string;
  created_at: string;
  assignments?: {
    id: string;
    truckId: string;
    plate?: string;
    status: string;
    scheduledAt?: string;
    tonnes?: number;
  }[];
};

export default function Customer() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get('/api/orders/my');
        setOrders(res.data || []);
        setError(null);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to load orders. Please refresh.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className='mx-auto max-w-5xl px-4 py-16'>
      <div className='mb-6'>
        <h1 className='text-3xl font-bold text-slate-900'>My orders</h1>
        <p className='text-sm text-slate-600'>
          Track order status, payment review, and assigned trucks. Orders move through{' '}
          <strong>Awaiting Payment → Awaiting Payment Review → Received → In Transit → Delivered</strong>.
        </p>
      </div>

      {loading && (
        <div className='rounded-3xl border border-amber-100 bg-white p-6 text-sm text-slate-600'>
          Loading your latest orders...
        </div>
      )}

      {error && (
        <div className='rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600'>
          {error}
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className='rounded-3xl border border-dashed border-amber-200 bg-white p-12 text-center text-sm text-slate-500'>
          No orders yet. Use the <strong>Order</strong> tab to place your first request.
        </div>
      )}

      <div className='space-y-4'>
        {orders.map((order) => (
          <article key={order.id} className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='text-lg font-semibold text-slate-900'>{order.site}</h2>
                <p className='text-xs text-slate-500'>
                  Created {new Date(order.created_at).toLocaleString()}
                </p>
              </div>
              <div className='flex items-center gap-2 text-xs'>
                <span className='rounded-full bg-slate-900 px-3 py-1 text-white'>
                  Status: {order.status}
                </span>
                <span className='rounded-full bg-amber-100 px-3 py-1 text-amber-700'>
                  Payment: {order.payment_status || 'PENDING'}
                </span>
              </div>
            </div>
            <div className='mt-4 grid gap-3 text-sm sm:grid-cols-3'>
              <SummaryItem label='Sand type' value={order.sand_type ? order.sand_type.toUpperCase() : 'n/a'} />
              <SummaryItem label='Trucks' value={order.trucks.toString()} />
              <SummaryItem
                label='Per truck'
                value={order.per_truck ? `KES ${Number(order.per_truck).toLocaleString()}` : 'n/a'}
              />
              <SummaryItem
                label='Total'
                value={order.total ? `KES ${Number(order.total).toLocaleString()}` : 'n/a'}
              />
              <SummaryItem
                label='Distance'
                value={
                  Number.isFinite(order.distance_km)
                    ? `${Math.round(Number(order.distance_km))} km (${
                        DISTANCE_SOURCE_LABELS[order.distance_source ?? ''] || 'estimated'
                      })`
                    : 'n/a'
                }
              />
              <SummaryItem
                label='Assignments'
                value={order.assignments && order.assignments.length > 0 ? `${order.assignments.length}` : '0'}
              />
            </div>
            <AssignmentList assignments={order.assignments || []} />
          </article>
        ))}
      </div>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-2xl border border-amber-50 bg-amber-50/70 p-3 text-xs text-slate-600'>
      <div className='font-semibold text-slate-900'>{value}</div>
      <div className='mt-1 uppercase tracking-wide'>{label}</div>
    </div>
  );
}

function AssignmentList({
  assignments,
}: {
  assignments: {
    id: string;
    truckId: string;
    plate?: string;
    status: string;
    scheduledAt?: string;
    tonnes?: number;
  }[];
}) {
  if (!assignments.length) {
    return (
      <div className='mt-4 rounded-2xl border border-dashed border-amber-200 p-3 text-xs text-slate-500'>
        Dispatch has not assigned trucks yet. Payment confirmation moves orders into scheduling.
      </div>
    );
  }
  return (
    <div className='mt-4 space-y-2 text-xs'>
      {assignments.map((assignment) => (
        <div
          key={assignment.id}
          className='flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-50 bg-amber-50/50 px-3 py-2'
        >
          <div>
            <div className='font-semibold text-slate-900'>
              {assignment.plate || assignment.truckId} &middot; {assignment.tonnes || 0} tonnes
            </div>
            <div className='text-[11px] text-slate-500'>
              Scheduled {assignment.scheduledAt ? new Date(assignment.scheduledAt).toLocaleString() : 'TBC'}
            </div>
          </div>
          <span className='rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white'>
            {assignment.status}
          </span>
        </div>
      ))}
    </div>
  );
}
