export const formatKes = (value?: number | null) => {
  if (!Number.isFinite(value || NaN)) return 'n/a';
  return `KES ${Number(value).toLocaleString()}`;
};

import { DISTANCE_SOURCE_LABELS } from '../constants';

export const formatDistance = (value?: number | null, source?: string | null) => {
  if (!Number.isFinite(value || NaN)) return 'n/a';
  const label = source ? DISTANCE_SOURCE_LABELS[source] || 'estimated' : 'estimated';
  return `${Math.round(Number(value))} km (${label})`;
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};
