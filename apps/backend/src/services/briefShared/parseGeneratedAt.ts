/**
 * Parse brief timestamps from ISO or Options Plunge "YYYY-MM-DD HH:MM ET" labels.
 * ET without offset is treated as America/New_York daylight (-04:00) for freshness windows.
 */
export function parseGeneratedAt(value: string): number {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;

  const et = value.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*ET$/i);
  if (et) {
    const [, date, hh, mm] = et;
    const hour = hh.padStart(2, '0');
    return Date.parse(`${date}T${hour}:${mm}:00-04:00`);
  }

  return Number.NaN;
}
