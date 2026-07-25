import { test, expect } from '@playwright/test';
import { connectToApp, login, navigateTo } from '../helpers';

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

test('quick duration/extend buttons on a time-based session', async () => {
  const page = await connectToApp();
  await login(page);

  await navigateTo(page, 'Daily Sales');
  const stationCard = page.getByTestId('resource-card-8-Ball-Table 1');
  await stationCard.getByRole('button', { name: '+ Add session' }).click();
  const row = stationCard.getByTestId('session-row').last();

  // Duration chips are disabled with no Start yet -- nothing to compute
  // an End from.
  await expect(row.getByRole('button', { name: '+1h', exact: true })).toBeDisabled();

  await row.getByLabel('Start time').fill('00:00');

  // "+1h" sets End = Start + 1h, and the amount recalculates the same way
  // it already does for a manually-typed End (8-Ball is ₹200/hr).
  await row.getByRole('button', { name: '+1h', exact: true }).click();
  await expect(row.getByLabel('End time')).toHaveValue('01:00');
  await expect(row.getByLabel('Amount')).toHaveValue('200');

  // Chips overwrite End from Start each time (not additive) -- "+30m" after
  // "+1h" lands on 00:30, not 1h30m.
  await row.getByRole('button', { name: '+30m', exact: true }).click();
  await expect(row.getByLabel('End time')).toHaveValue('00:30');
  await expect(row.getByLabel('Amount')).toHaveValue('100');

  // This session's End (00:30) is long past in real time -- Extend is
  // disabled rather than offering a canned +30m on a closed-out session.
  await expect(row.getByRole('button', { name: 'Extend +30m', exact: true })).toBeDisabled();

  // A session whose End is still ahead of the real clock: Extend is enabled
  // and adds 30 real minutes on top of whatever End currently holds.
  const start = hhmm(new Date());
  const end = hhmm(new Date(Date.now() + 90 * 60_000));
  const expectedAfterExtend = hhmm(new Date(Date.now() + 120 * 60_000));
  await row.getByLabel('Start time').fill(start);
  await row.getByLabel('End time').fill(end);
  await expect(row.getByRole('button', { name: 'Extend +30m', exact: true })).toBeEnabled();
  await row.getByRole('button', { name: 'Extend +30m', exact: true }).click();
  await expect(row.getByLabel('End time')).toHaveValue(expectedAfterExtend);

  await row.getByRole('button', { name: 'Delete session' }).click();
  await page.getByTestId('logout-button').click();
});
