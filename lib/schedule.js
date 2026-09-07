// lib/schedule.js — Pure schedule logic, extracted from content.js for testability.
// Works in both Node.js (CommonJS) and browser (ES module via script tag) contexts.

const DEFAULT_SCHEDULE_TIMES = [
  '08:05',
  '08:35',
  '09:05',
  '09:35',
  '10:05',
  '10:35',
  '11:05',
  '11:35',
  '12:05',
  '12:35',
  '13:05',
  '13:35',
  '14:05',
  '14:35',
  '15:05',
  '15:35',
  '16:05'
];

/**
 * Given an array of time strings ("HH:MM") and a reference Date,
 * find the next scheduled time that is >= fromDate.
 * Returns a Date object, or null if no more slots today.
 *
 * @param {string[]} scheduleTimes - Sorted array of "HH:MM" strings
 * @param {Date} fromDate - Reference time to find the next slot after
 * @returns {Date|null}
 */
function getNextScheduledTime(scheduleTimes, fromDate) {
  for (const t of scheduleTimes) {
    const [h, m] = t.split(':').map(Number);
    const candidate = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), h, m, 0, 0);
    if (candidate.getTime() >= fromDate.getTime()) return candidate;
  }
  return null;
}

/**
 * Generate an array of "HH:MM" time strings from start to end with a given interval.
 *
 * @param {string} startTime - "HH:MM" start time
 * @param {string} endTime - "HH:MM" end time (inclusive)
 * @param {number} intervalMinutes - Interval in minutes
 * @returns {string[]} Array of "HH:MM" strings
 */
function generateScheduleTimes(startTime, endTime, intervalMinutes) {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const times = [];
  let current = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  while (current <= endMin) {
    const h = String(Math.floor(current / 60)).padStart(2, '0');
    const m = String(current % 60).padStart(2, '0');
    times.push(`${h}:${m}`);
    current += intervalMinutes;
  }
  return times;
}

/**
 * Validate a "HH:MM" time string.
 * @param {string} time
 * @returns {boolean}
 */
function isValidTime(time) {
  if (typeof time !== 'string') return false;
  return (
    /^\d{2}:\d{2}$/.test(time) &&
    Number.parseInt(time.slice(0, 2), 10) <= 23 &&
    Number.parseInt(time.slice(3, 5), 10) <= 59
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SCHEDULE_TIMES,
    getNextScheduledTime,
    generateScheduleTimes,
    isValidTime
  };
}
