import { describe, it, expect } from 'vitest';
import { pad, parseDate, dateStrOf, durationMinutes } from '../utils/dates';

describe('dates', () => {
  it('pads single digits', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
  });

  it('round-trips a date string', () => {
    const d = parseDate('2026-07-23');
    expect(dateStrOf(d)).toBe('2026-07-23');
  });

  it('computes duration across the hour', () => {
    expect(durationMinutes('09:15', '10:45')).toBe(90);
  });

  it('wraps past midnight', () => {
    expect(durationMinutes('23:30', '00:30')).toBe(60);
  });

  it('returns 0 for missing times', () => {
    expect(durationMinutes('', '10:00')).toBe(0);
    expect(durationMinutes('09:00', '')).toBe(0);
  });
});
