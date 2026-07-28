import { describe, it, expect } from 'vitest';
import { offerAppliesTo, isOfferActiveOn } from '../components/views/DailySalesView';
import type { OfferRow } from '../lib/tauri/commands';

function baseOffer(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: 'offer-1',
    name: 'Test Offer',
    active: true,
    appliesToAllCategories: false,
    categoryIds: null,
    days: null,
    startTime: null,
    endTime: null,
    startDate: null,
    endDate: null,
    minDurationMinutes: null,
    minGameCount: null,
    effectType: 'extraTime',
    effectValue: 30,
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('offerAppliesTo', () => {
  it('matches any category when appliesToAllCategories is true', () => {
    expect(offerAppliesTo(baseOffer({ appliesToAllCategories: true, categoryIds: null }), 'cat-xyz')).toBe(true);
  });

  it('matches only a listed category id when appliesToAllCategories is false', () => {
    const offer = baseOffer({ appliesToAllCategories: false, categoryIds: 'cat-1,cat-2' });
    expect(offerAppliesTo(offer, 'cat-1')).toBe(true);
    expect(offerAppliesTo(offer, 'cat-3')).toBe(false);
  });
});

describe('isOfferActiveOn', () => {
  it('matches any time when startTime/endTime are both unset', () => {
    expect(isOfferActiveOn(baseOffer(), '2026-07-27', '03:00')).toBe(true);
  });

  it('matches within a same-day (non-wrapping) window and rejects outside it', () => {
    const offer = baseOffer({ startTime: '13:00', endTime: '18:00' });
    expect(isOfferActiveOn(offer, '2026-07-27', '15:00')).toBe(true);
    expect(isOfferActiveOn(offer, '2026-07-27', '20:00')).toBe(false);
    expect(isOfferActiveOn(offer, '2026-07-27', '08:00')).toBe(false);
  });

  it('matches within a midnight-crossing window and rejects outside it', () => {
    // The exact bug found and fixed during Task 8's review -- a naive
    // string comparison ("23:00" >= "22:00" && "23:00" <= "02:00") always
    // fails for the second half of a wrapping window.
    const offer = baseOffer({ startTime: '22:00', endTime: '02:00' });
    expect(isOfferActiveOn(offer, '2026-07-27', '23:00')).toBe(true);
    expect(isOfferActiveOn(offer, '2026-07-27', '01:00')).toBe(true);
    expect(isOfferActiveOn(offer, '2026-07-27', '12:00')).toBe(false);
  });

  it('respects an optional day-of-week restriction', () => {
    // 2026-07-27 is a Monday.
    const mondayOnly = baseOffer({ days: 'mon' });
    const weekdaysOnly = baseOffer({ days: 'mon,tue,wed,thu,fri' });
    const weekendOnly = baseOffer({ days: 'sat,sun' });
    expect(isOfferActiveOn(mondayOnly, '2026-07-27', '12:00')).toBe(true);
    expect(isOfferActiveOn(weekdaysOnly, '2026-07-27', '12:00')).toBe(true);
    expect(isOfferActiveOn(weekendOnly, '2026-07-27', '12:00')).toBe(false);
  });

  it('respects an optional date range, inclusive on both ends', () => {
    const offer = baseOffer({ startDate: '2026-07-20', endDate: '2026-07-27' });
    expect(isOfferActiveOn(offer, '2026-07-20', '12:00')).toBe(true);
    expect(isOfferActiveOn(offer, '2026-07-27', '12:00')).toBe(true);
    expect(isOfferActiveOn(offer, '2026-07-28', '12:00')).toBe(false);
    expect(isOfferActiveOn(offer, '2026-07-19', '12:00')).toBe(false);
  });
});
