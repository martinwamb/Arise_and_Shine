// Pure, timezone-safe date helpers shared across fuel views. UTC math keeps the
// week boundaries in sync with the server (which uses the same Monday offset).

export const pad = (n: number) => String(n).padStart(2, '0');

export const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Monday of the week containing `dateStr` (UTC math to avoid TZ drift).
export const mondayOf = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset));
};

export const addDays = (dateStr: string, n: number) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return fmt(new Date(d.getTime() + n * 86400000));
};

export const dayIso = (dateStr: string) => `${dateStr}T12:00:00.000Z`;

export const weekdayLabel = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

export const dayNum = (dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDate();

// Shape returned by GET /api/admin/finance/fuel-matrix
export type FuelMatrixRow = { truckId: string; plate: string; cells: Record<string, number>; weekTotal: number };
export type FuelMatrix = {
  from: string;
  to: string;
  days: string[];
  rows: FuelMatrixRow[];
  columnTotals: Record<string, number>;
  grandTotal: number;
};
