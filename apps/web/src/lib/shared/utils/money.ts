import { durationMinutes } from './dates.js';
import { branding } from '@/config/branding';

export type TimeRate = { hour: number; half: number };

export function calcTimeAmount(start: string, end: string, rate: TimeRate): number {
  const mins = durationMinutes(start, end);
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  let amt = hours * rate.hour;
  if (rem > 0) {
    amt += rate.half > 0 ? rate.half * (rem / 30) : rate.hour * (rem / 60);
  }
  return Math.round(amt);
}

export function calcFrameAmount(rate: number): number {
  return Math.round(rate);
}

export interface BalanceSession { method: string; customerId: string | null; amount: number }
export interface BalanceHistoryEntry { customerId: string; type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED'; amount: number }

export function calcCustomerBalance(
  sessions: BalanceSession[],
  history: BalanceHistoryEntry[],
  customerId: string
): number {
  const sessionCredit = sessions
    .filter(s => s.method === 'Credit' && s.customerId === customerId)
    .reduce((a, s) => a + s.amount, 0);
  const given = history
    .filter(h => h.customerId === customerId && h.type === 'CREDIT_GIVEN')
    .reduce((a, h) => a + h.amount, 0);
  const paid = history
    .filter(h => h.customerId === customerId && h.type === 'PAYMENT_RECEIVED')
    .reduce((a, h) => a + h.amount, 0);
  return sessionCredit + given - paid;
}

export function formatCurrency(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return branding.currencySymbol + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
