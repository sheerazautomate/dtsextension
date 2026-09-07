// lib/time-helpers.js — Pure timezone/time utility functions for the scheduler.
// Extracted from scheduler.js for testability.

/**
 * Get the current time as parts (hour, minute, weekday) in Asia/Karachi (UTC+5),
 * without pulling in a date library — Karachi is a fixed UTC+5, no DST.
 *
 * @param {Date} [date=new Date()] - The date to convert
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: number }}
 */
function karachiParts(date = new Date()) {
  const utcMs = date.getTime();
  const karachiMs = utcMs + 5 * 60 * 60 * 1000;
  const k = new Date(karachiMs);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth(), // 0-indexed
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: k.getUTCDay() // 0 = Sunday
  };
}

/**
 * Build a UTC Date corresponding to a given Karachi wall-clock date+time.
 *
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} parts
 * @returns {Date}
 */
function karachiWallClockToUtc({ year, month, day, hour, minute }) {
  const asIfUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  return new Date(asIfUtcMs - 5 * 60 * 60 * 1000);
}

/**
 * Compute the next run time (as ISO string) for a recurring schedule.
 *
 * @param {{ frequency: string, time: string, daysOfWeek: number[] }} recurring
 * @param {Date} [fromDate=new Date()]
 * @returns {string} ISO string of the next run time
 */
function computeNextRunAtRecurring(recurring, fromDate = new Date()) {
  const { frequency, time, daysOfWeek } = recurring;
  const [hh, mm] = time.split(':').map(Number);
  const kp = karachiParts(fromDate);

  if (frequency === 'daily') {
    let candidate = karachiWallClockToUtc({
      year: kp.year,
      month: kp.month,
      day: kp.day,
      hour: hh,
      minute: mm
    });
    if (candidate.getTime() <= fromDate.getTime()) {
      const nextDay = karachiWallClockToUtc({
        year: kp.year,
        month: kp.month,
        day: kp.day + 1,
        hour: hh,
        minute: mm
      });
      candidate = nextDay;
    }
    return candidate.toISOString();
  }

  if (frequency === 'weekly') {
    const days = [...daysOfWeek].sort((a, b) => a - b);
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = karachiWallClockToUtc({
        year: kp.year,
        month: kp.month,
        day: kp.day + offset,
        hour: hh,
        minute: mm
      });
      const checkWeekday = karachiParts(checkDate).weekday;
      if (days.includes(checkWeekday) && checkDate.getTime() > fromDate.getTime()) {
        return checkDate.toISOString();
      }
    }
    // Fallback: one week out on the first configured day
    const fallback = karachiWallClockToUtc({
      year: kp.year,
      month: kp.month,
      day: kp.day + 7,
      hour: hh,
      minute: mm
    });
    return fallback.toISOString();
  }

  throw new Error(`Unknown frequency: ${frequency}`);
}

module.exports = {
  karachiParts,
  karachiWallClockToUtc,
  computeNextRunAtRecurring
};
