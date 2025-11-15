import type { GuestOrderForm, WorkspaceSection } from './types';

export const BANK_OPTIONS = [
  { bank: 'ABSA', paybill: '103030', account: 'ARISE-SHINE' },
  { bank: 'Equity', paybill: '247247', account: 'ARISESHINE' },
  { bank: 'KCB', paybill: '522522', account: 'ARISE SHINE LTD' },
  { bank: 'NCBA', paybill: '880100', account: 'ARISESHINE' },
  { bank: 'Cooperative', paybill: '400200', account: 'ARISE SHINE LOGISTICS' },
] as const;

export const DISTANCE_SOURCE_LABELS: Record<string, string> = {
  manual: 'manual distance',
  geocoded: 'geocoded',
  heuristic: 'name heuristic',
  default: 'estimated',
};

export const INITIAL_ORDER_FORM: GuestOrderForm = {
  name: '',
  phone: '',
  email: '',
  site: '',
  sandType: 'coarse',
  trucks: 2,
  distanceKm: '',
  dateNeeded: '',
};

export const HERO_FACTS = [
  { label: 'Fleet coverage', value: '38 active trucks' },
  { label: 'Dispatch hours', value: '24/7 control room' },
  { label: 'Customer rating', value: '4.9 / 5' },
] as const;

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { key: 'orders', label: 'Orders desk', description: 'Create and track sand requests.', roles: ['CUSTOMER', 'ADMIN', 'OPS'] },
  { key: 'driver', label: 'Driver pulse', description: 'Assignments and earnings.', roles: ['DRIVER', 'ADMIN', 'OPS'] },
  {
    key: 'driverDocs',
    label: 'Driver onboarding',
    description: 'Update employment forms and documents.',
    roles: ['DRIVER', 'ADMIN', 'OPS'],
  },
  { key: 'fuel', label: 'Fuel monitor', description: 'Capture pump slips and mileage.', roles: ['FUEL', 'ADMIN'] },
  { key: 'reports', label: 'Reports & exports', description: 'Download Excel or PDF packs.', roles: ['ADMIN', 'OPS'] },
  { key: 'fleet', label: 'Fleet view', description: 'Live telemetry and truck status.', roles: ['ADMIN', 'OPS', 'FUEL'] },
  { key: 'ai', label: 'AI workspace', description: 'Assistant, audit co-pilot, automation.', roles: ['ADMIN'] },
  { key: 'news', label: 'Updates', description: 'Latest advisories and bulletins.', roles: ['CUSTOMER', 'DRIVER', 'FUEL', 'ADMIN', 'OPS'] },
];
