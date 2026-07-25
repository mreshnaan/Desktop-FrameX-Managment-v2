export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function durationMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function nowTimeStr(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Wraps past midnight, matching durationMinutes' convention -- a quick
// duration/extend action a few minutes before midnight should still produce
// a valid time-of-day rather than one past 24:00.
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const dayMinutes = 24 * 60;
  const total = ((h * 60 + m + minutes) % dayMinutes + dayMinutes) % dayMinutes;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
