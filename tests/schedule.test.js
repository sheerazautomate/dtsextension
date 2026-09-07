// Tests for the schedule logic
const { DEFAULT_SCHEDULE_TIMES, getNextScheduledTime, generateScheduleTimes, isValidTime } = require('../lib/schedule');

describe('DEFAULT_SCHEDULE_TIMES', () => {
  test('has 17 entries', () => {
    expect(DEFAULT_SCHEDULE_TIMES).toHaveLength(17);
  });

  test('starts at 08:05 and ends at 16:05', () => {
    expect(DEFAULT_SCHEDULE_TIMES[0]).toBe('08:05');
    expect(DEFAULT_SCHEDULE_TIMES[DEFAULT_SCHEDULE_TIMES.length - 1]).toBe('16:05');
  });

  test('is sorted', () => {
    const sorted = [...DEFAULT_SCHEDULE_TIMES].sort();
    expect(DEFAULT_SCHEDULE_TIMES).toEqual(sorted);
  });
});

describe('getNextScheduledTime', () => {
  test('returns the next slot when before any slot', () => {
    const times = ['08:05', '08:35', '09:05'];
    const fromDate = new Date(2026, 8, 7, 7, 0, 0); // 07:00
    const result = getNextScheduledTime(times, fromDate);
    expect(result).toEqual(new Date(2026, 8, 7, 8, 5, 0));
  });

  test('returns the current slot when exactly at a slot time', () => {
    const times = ['08:05', '08:35', '09:05'];
    const fromDate = new Date(2026, 8, 7, 8, 5, 0); // exactly 08:05
    const result = getNextScheduledTime(times, fromDate);
    expect(result).toEqual(new Date(2026, 8, 7, 8, 5, 0));
  });

  test('returns the next slot when between slots', () => {
    const times = ['08:05', '08:35', '09:05'];
    const fromDate = new Date(2026, 8, 7, 8, 20, 0); // 08:20
    const result = getNextScheduledTime(times, fromDate);
    expect(result).toEqual(new Date(2026, 8, 7, 8, 35, 0));
  });

  test('returns null when past all slots', () => {
    const times = ['08:05', '08:35', '09:05'];
    const fromDate = new Date(2026, 8, 7, 10, 0, 0); // 10:00
    const result = getNextScheduledTime(times, fromDate);
    expect(result).toBeNull();
  });

  test('returns null for empty schedule', () => {
    const fromDate = new Date(2026, 8, 7, 8, 0, 0);
    const result = getNextScheduledTime([], fromDate);
    expect(result).toBeNull();
  });

  test('uses the default schedule correctly', () => {
    const fromDate = new Date(2026, 8, 7, 12, 0, 0); // 12:00
    const result = getNextScheduledTime(DEFAULT_SCHEDULE_TIMES, fromDate);
    expect(result).toEqual(new Date(2026, 8, 7, 12, 5, 0));
  });
});

describe('generateScheduleTimes', () => {
  test('generates correct slots with 30-min interval', () => {
    const times = generateScheduleTimes('08:00', '10:00', 30);
    expect(times).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00']);
  });

  test('generates correct slots with 60-min interval', () => {
    const times = generateScheduleTimes('09:00', '12:00', 60);
    expect(times).toEqual(['09:00', '10:00', '11:00', '12:00']);
  });

  test('handles non-round start time', () => {
    const times = generateScheduleTimes('08:05', '09:35', 30);
    expect(times).toEqual(['08:05', '08:35', '09:05', '09:35']);
  });

  test('returns single slot when start equals end', () => {
    const times = generateScheduleTimes('12:00', '12:00', 30);
    expect(times).toEqual(['12:00']);
  });

  test('returns empty when start is after end', () => {
    const times = generateScheduleTimes('14:00', '08:00', 30);
    expect(times).toEqual([]);
  });

  test('matches default schedule', () => {
    const times = generateScheduleTimes('08:05', '16:05', 30);
    expect(times).toEqual(DEFAULT_SCHEDULE_TIMES);
  });

  test('handles 5-minute interval', () => {
    const times = generateScheduleTimes('10:00', '10:15', 5);
    expect(times).toEqual(['10:00', '10:05', '10:10', '10:15']);
  });
});

describe('isValidTime', () => {
  test('accepts valid times', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('08:05')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('12:30')).toBe(true);
  });

  test('rejects invalid times', () => {
    expect(isValidTime('25:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
    expect(isValidTime('8:05')).toBe(false); // needs leading zero
    expect(isValidTime('abc')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });

  test('rejects non-string input', () => {
    expect(isValidTime(null)).toBe(false);
    expect(isValidTime(undefined)).toBe(false);
    expect(isValidTime(123)).toBe(false);
  });
});
