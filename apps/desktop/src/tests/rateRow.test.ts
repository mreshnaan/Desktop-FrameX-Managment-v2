import { describe, it, expect } from 'vitest';
import { toRateRow } from '../lib/tauri/commands';

describe('toRateRow', () => {
  it('maps hourRate/halfRate/frameRate to hour/half/value without swapping', () => {
    const row = toRateRow({
      id: 'r1', categoryId: 'c1', hourRate: 100, halfRate: 50, frameRate: null, updatedAt: '2026-07-26T00:00:00.000Z',
    });
    expect(row).toEqual({
      id: 'r1', categoryId: 'c1', hour: 100, half: 50, value: null, updatedAt: '2026-07-26T00:00:00.000Z',
    });
  });
});
