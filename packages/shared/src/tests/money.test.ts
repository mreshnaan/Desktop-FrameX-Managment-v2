import { describe, it, expect } from 'vitest';
import { calcTimeAmount, calcFrameAmount, calcCustomerBalance, formatCurrency } from '../utils/money';

describe('calcTimeAmount', () => {
  it('charges only the hourly rate for exact hours', () => {
    expect(calcTimeAmount('09:00', '11:00', { hour: 200, half: 100 })).toBe(400);
  });

  it('adds the half-hour rate for a 30-minute remainder', () => {
    expect(calcTimeAmount('09:00', '10:30', { hour: 200, half: 100 })).toBe(300);
  });

  it('prorates an odd remainder off the hourly rate when half rate is 0', () => {
    expect(calcTimeAmount('09:00', '09:45', { hour: 200, half: 0 })).toBe(150);
  });
});

describe('calcFrameAmount', () => {
  it('seeds the amount from the per-frame rate', () => {
    expect(calcFrameAmount(150)).toBe(150);
  });
});

describe('calcCustomerBalance', () => {
  const sessions = [
    { method: 'Credit', customerId: 'c1', amount: 300 },
    { method: 'Cash', customerId: 'c1', amount: 100 },
    { method: 'Credit', customerId: 'c2', amount: 999 },
  ];
  const history = [
    { customerId: 'c1', type: 'CREDIT_GIVEN' as const, amount: 100 },
    { customerId: 'c1', type: 'PAYMENT_RECEIVED' as const, amount: 150 },
  ];

  it('sums credit sessions + manual credit − manual payments, for one customer only', () => {
    expect(calcCustomerBalance(sessions, history, 'c1')).toBe(300 + 100 - 150);
  });
});

describe('formatCurrency', () => {
  it('prefixes the rupee symbol and groups thousands', () => {
    expect(formatCurrency(12345)).toBe('₹12,345');
  });
  it('treats non-numeric input as 0', () => {
    expect(formatCurrency(NaN)).toBe('₹0');
  });
});
