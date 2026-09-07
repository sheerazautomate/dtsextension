// lib/captcha.js — Pure CAPTCHA solver logic, extracted from content.js for testability.
// Works in both Node.js (CommonJS) and browser (ES module via script tag) contexts.

/**
 * Parse a simple arithmetic CAPTCHA text and return the answer as a string.
 *
 * Supports expressions like:
 *   "3 + 5"  → "8"
 *   "12 - 4" → "8"
 *   "6 * 7"  → "42"
 *   "6 x 7"  → "42"
 *   "6 × 7"  → "42"
 *   "20 / 4" → "5"
 *   "-3 + 7" → "4"
 *
 * @param {string} text - The CAPTCHA prompt text
 * @returns {string|null} The answer as a string, or null if parsing fails
 */
function solveCaptchaText(text) {
  if (!text) return null;
  const match = text.match(/(-?\d+)\s*([+\-*x×/])\s*(-?\d+)/i);
  if (!match) return null;
  const a = Number.parseFloat(match[1]);
  const opRaw = match[2].toLowerCase();
  const b = Number.parseFloat(match[3]);
  let result;
  switch (opRaw) {
    case '+':
      result = a + b;
      break;
    case '-':
      result = a - b;
      break;
    case '*':
    case 'x':
    case '×':
      result = a * b;
      break;
    case '/':
      result = a / b;
      break;
    default:
      return null;
  }
  return String(result);
}

// Support both CommonJS (Node/tests) and browser (no module system)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { solveCaptchaText };
}
