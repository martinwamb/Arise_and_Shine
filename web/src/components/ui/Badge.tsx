import React from 'react';

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'amber';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantCls: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  error:   'bg-rose-50 text-rose-700',
  info:    'bg-blue-50 text-blue-700',
  amber:   'bg-amber-100 text-amber-800',
};

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        variantCls[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
