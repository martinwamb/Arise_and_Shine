import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingCls = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={['bg-white border border-slate-200 rounded-xl', paddingCls[padding], className].join(' ')}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}

export function StatCard({ label, value, sub, accent }: StatCardProps) {
  return (
    <Card>
      <p className='text-xs font-medium uppercase tracking-wide text-slate-400'>{label}</p>
      <p className={['mt-1.5 text-2xl font-bold', accent ? 'text-amber-600' : 'text-slate-900'].join(' ')}>
        {value}
      </p>
      {sub && <p className='mt-0.5 text-xs text-slate-500'>{sub}</p>}
    </Card>
  );
}
