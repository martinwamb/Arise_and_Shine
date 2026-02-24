import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

const baseCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50';

export function Input({ label, hint, error, className = '', ...props }: InputProps) {
  return (
    <div className='space-y-1'>
      {label && <label className='block text-xs font-medium text-slate-500'>{label}</label>}
      <input className={[baseCls, error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-300' : '', className].join(' ')} {...props} />
      {error && <p className='text-xs text-rose-600'>{error}</p>}
      {hint && !error && <p className='text-xs text-slate-400'>{hint}</p>}
    </div>
  );
}

export function Select({ label, hint, error, children, className = '', ...props }: SelectProps) {
  return (
    <div className='space-y-1'>
      {label && <label className='block text-xs font-medium text-slate-500'>{label}</label>}
      <select className={[baseCls, error ? 'border-rose-300' : '', className].join(' ')} {...props}>
        {children}
      </select>
      {error && <p className='text-xs text-rose-600'>{error}</p>}
      {hint && !error && <p className='text-xs text-slate-400'>{hint}</p>}
    </div>
  );
}
