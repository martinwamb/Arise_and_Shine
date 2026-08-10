// Plate helpers shared by the API and the Protrack device sync. Kept in their own module so
// the sync logic can be exercised from a script without booting the server.

export function normalisePlateKey(value){
  if(value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalisePlateDisplay(value){
  const trimmed = String(value ?? '').trim().toUpperCase();
  if(!trimmed) return '';
  if(/\s/.test(trimmed)) return trimmed;
  const match = /^([A-Z]{3})(\d{3})([A-Z]?)(.*)$/.exec(trimmed);
  if(!match) return trimmed;
  const [, prefix, digits, suffix, rest] = match;
  const core = suffix ? `${prefix} ${digits}${suffix}` : `${prefix} ${digits}`;
  return rest ? `${core}${rest}` : core;
}
