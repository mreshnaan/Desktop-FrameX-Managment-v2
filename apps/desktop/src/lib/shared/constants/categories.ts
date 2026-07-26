// Category/station data is now real, relational data synced into local
// SQLite -- see lib/hooks/useCategories.ts.
export type Billing = 'time' | 'frame';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
