// Tests for the timezone/time helper functions
const { karachiParts, karachiWallClockToUtc, computeNextRunAtRecurring } = require('../lib/time-helpers');

describe('karachiParts', () => {
  test('converts UTC midnight to 05:00 Karachi time', () => {
    const utcMidnight = new Date('2026-09-07T00:00:00Z');
    const parts = karachiParts(utcMidnight);
    expect(parts.hour).toBe(5);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(7);
    expect(parts.month).toBe(8); // September (0-indexed)
    expect(parts.year).toBe(2026);
  });

  test('converts UTC 19:00 to midnight Karachi time (next day)', () => {
    const utc = new Date('2026-09-06T19:00:00Z');
    const parts = karachiParts(utc);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(7); // rolled to next day
  });

  test('handles date that stays same day', () => {
    const utc = new Date('2026-09-07T12:30:00Z');
    const parts = karachiParts(utc);
    expect(parts.hour).toBe(17);
    expect(parts.minute).toBe(30);
    expect(parts.day).toBe(7);
  });

  test('returns correct weekday', () => {
    // 2026-09-07 is a Monday
    const utc = new Date('2026-09-07T12:00:00Z');
    const parts = karachiParts(utc);
    expect(parts.weekday).toBe(1); // Monday
  });
});

describe('karachiWallClockToUtc', () => {
  test('converts Karachi midnight to UTC 19:00 previous day', () => {
    const utc = karachiWallClockToUtc({
      year: 2026,
      month: 8,
      day: 7,
      hour: 0,
      minute: 0
    });
    expect(utc.toISOString()).toBe('2026-09-06T19:00:00.000Z');
  });

  test('converts Karachi 05:00 to UTC midnight', () => {
    const utc = karachiWallClockToUtc({
      year: 2026,
      month: 8,
      day: 7,
      hour: 5,
      minute: 0
    });
    expect(utc.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  test('converts Karachi 14:30 to UTC 09:30 same day', () => {
    const utc = karachiWallClockToUtc({
      year: 2026,
      month: 8,
      day: 7,
      hour: 14,
      minute: 30
    });
    expect(utc.toISOString()).toBe('2026-09-07T09:30:00.000Z');
  });

  test('round-trip with karachiParts', () => {
    const original = { year: 2026, month: 5, day: 15, hour: 10, minute: 45 };
    const utc = karachiWallClockToUtc(original);
    const parts = karachiParts(utc);
    expect(parts.year).toBe(original.year);
    expect(parts.month).toBe(original.month);
    expect(parts.day).toBe(original.day);
    expect(parts.hour).toBe(original.hour);
    expect(parts.minute).toBe(original.minute);
  });
});

describe('computeNextRunAtRecurring', () => {
  test('daily: returns today if time is still ahead', () => {
    // From 08:00 Karachi, next daily at 09:00 Karachi should be today at 09:00
    const fromUtc = new Date('2026-09-07T03:00:00Z'); // 08:00 Karachi
    const result = computeNextRunAtRecurring({ frequency: 'daily', time: '09:00', daysOfWeek: [] }, fromUtc);
    const resultDate = new Date(result);
    // Expected: 09:00 Karachi = 04:00 UTC on same day
    expect(resultDate.toISOString()).toBe('2026-09-07T04:00:00.000Z');
  });

  test('daily: returns tomorrow if time has passed', () => {
    // From 10:00 Karachi, next daily at 09:00 Karachi should be tomorrow
    const fromUtc = new Date('2026-09-07T05:00:00Z'); // 10:00 Karachi
    const result = computeNextRunAtRecurring({ frequency: 'daily', time: '09:00', daysOfWeek: [] }, fromUtc);
    const resultDate = new Date(result);
    // Expected: 09:00 Karachi next day = 04:00 UTC on Sept 8
    expect(resultDate.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  test('weekly: finds the next matching weekday', () => {
    // 2026-09-07 is Monday (weekday 1)
    // Looking for Wednesday (weekday 3) at 10:00 Karachi
    const fromUtc = new Date('2026-09-07T03:00:00Z'); // Monday 08:00 Karachi
    const result = computeNextRunAtRecurring({ frequency: 'weekly', time: '10:00', daysOfWeek: [3] }, fromUtc);
    const resultDate = new Date(result);
    // Wednesday 10:00 Karachi = Sept 9 at 05:00 UTC
    expect(resultDate.toISOString()).toBe('2026-09-09T05:00:00.000Z');
  });

  test('weekly: skips today if time already passed', () => {
    // Monday at 11:00 Karachi, looking for Monday at 09:00
    // Should skip to next Monday
    const fromUtc = new Date('2026-09-07T06:00:00Z'); // Monday 11:00 Karachi
    const result = computeNextRunAtRecurring({ frequency: 'weekly', time: '09:00', daysOfWeek: [1] }, fromUtc);
    const resultDate = new Date(result);
    // Next Monday (Sept 14) at 09:00 Karachi = 04:00 UTC
    expect(resultDate.toISOString()).toBe('2026-09-14T04:00:00.000Z');
  });

  test('throws on unknown frequency', () => {
    const fromUtc = new Date('2026-09-07T03:00:00Z');
    expect(() => {
      computeNextRunAtRecurring({ frequency: 'monthly', time: '09:00', daysOfWeek: [] }, fromUtc);
    }).toThrow('Unknown frequency: monthly');
  });
});
