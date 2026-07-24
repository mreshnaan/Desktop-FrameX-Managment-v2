export type Billing = 'time' | 'frame';

export interface Category {
  name: string;
  resources: string[];
  billing: Billing;
}

export const CATEGORIES: Category[] = [
  { name: '8-Ball', resources: ['Table 1', 'Table 2', 'Table 3'], billing: 'time' },
  { name: 'Snooker', resources: ['Table 1'], billing: 'frame' },
  { name: 'PlayStation', resources: ['Station 1', 'Station 2'], billing: 'time' },
];

export type TimeRate = { hour: number; half: number };

export const DEFAULT_RATES: Record<string, TimeRate | number> = {
  '8-Ball': { hour: 200, half: 100 },
  Snooker: 150,
  PlayStation: { hour: 100, half: 50 },
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
