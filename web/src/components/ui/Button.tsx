import React from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantCls: Record<Variant, string> = {
  primary:   'bg-slate-900 text-white hover:bg-slate-800 border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50',
  ghost:     'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100',
  danger:    'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 hover:border-rose-300',
};

const sizeCls: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-5 py-2.5 text-sm gap-2 rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50',
        variantCls[variant],
        sizeCls[size],
        className,
      ].join(' ')}
    >
      {loading ? (
        <Loader2 className='h-3.5 w-3.5 animate-spin' />
      ) : icon ? (
        <span className='flex-shrink-0'>{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
