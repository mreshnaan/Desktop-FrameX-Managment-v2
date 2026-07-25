// Billing/category/station data used to be hardcoded here. It's now real,
// relational data owned by apps/api (seeded once server-side, see
// apps/api/prisma/seed.ts) and fetched read-only via /sync/pull -- see
// lib/hooks/useCategories.ts for the runtime equivalent of the old
// CATEGORIES constant.
export type Billing = 'time' | 'frame';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
