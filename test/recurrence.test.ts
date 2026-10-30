import { describe, expect, it } from 'vitest';
import { kitchenToday, occurrenceDates } from '../src/recurrence';

describe('subscription dates', () => {
  it('generates weekly occurrences in the requested window', () => {
    expect(occurrenceDates('2026-11-02', 'weekly', '2026-11-08', '2026-11-23')).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  });
  it('clips month-end dates and returns to the anchor day', () => {
    expect(occurrenceDates('2026-01-31', 'monthly', '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('uses the kitchen timezone for today', () => {
    expect(kitchenToday(new Date('2026-11-01T03:30:00Z'))).toBe('2026-10-31');
  });
  it('continues subscriptions anchored more than ten years ago', () => {
    expect(occurrenceDates('2010-11-02', 'weekly', '2026-11-01', '2026-11-10')).toEqual(['2026-11-03', '2026-11-10']);
  });
});
