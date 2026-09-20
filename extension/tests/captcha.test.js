// Tests for the CAPTCHA solver logic
const { solveCaptchaText } = require('../lib/captcha');

describe('solveCaptchaText', () => {
  test('addition', () => {
    expect(solveCaptchaText('3 + 5')).toBe('8');
  });

  test('subtraction', () => {
    expect(solveCaptchaText('12 - 4')).toBe('8');
  });

  test('multiplication with *', () => {
    expect(solveCaptchaText('6 * 7')).toBe('42');
  });

  test('multiplication with x', () => {
    expect(solveCaptchaText('6 x 7')).toBe('42');
  });

  test('multiplication with ×', () => {
    expect(solveCaptchaText('6 × 7')).toBe('42');
  });

  test('division', () => {
    expect(solveCaptchaText('20 / 4')).toBe('5');
  });

  test('negative numbers', () => {
    expect(solveCaptchaText('-3 + 7')).toBe('4');
  });

  test('embedded in longer text', () => {
    expect(solveCaptchaText('Solve: 8 + 3 to continue')).toBe('11');
  });

  test('extra whitespace', () => {
    expect(solveCaptchaText('  5  +  3  ')).toBe('8');
  });

  test('returns null for empty input', () => {
    expect(solveCaptchaText('')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(solveCaptchaText(null)).toBeNull();
  });

  test('returns null for non-math text', () => {
    expect(solveCaptchaText('hello world')).toBeNull();
  });

  test('decimal result from division', () => {
    expect(solveCaptchaText('7 / 2')).toBe('3.5');
  });

  test('negative result from subtraction', () => {
    expect(solveCaptchaText('3 - 10')).toBe('-7');
  });
});
