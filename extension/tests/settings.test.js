const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../settings.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../settings.js'), 'utf8');
let dom, window, storage;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  storage = {};
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://extension.test/settings.html' });
  window = dom.window;
  window.browser = { runtime: { getManifest: () => ({ version: '1.1.3' }) }, storage: { local: {
    get: async keys => Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]])),
    set: async patch => Object.assign(storage, patch)
  } } };
  window.eval(script);
  await settle();
});
afterEach(() => dom.window.close());
const el = id => window.document.getElementById(id);

test('controls use extension-compatible event listeners and save simple schedules', async () => {
  expect(window.document.querySelector('[onclick], [onchange]')).toBeNull();
  el('scheduleStart').value = '09:00';
  el('scheduleEnd').value = '10:00';
  el('scheduleInterval').value = '30';
  el('saveAll').click();
  await settle();
  expect(storage.scheduleTimes).toEqual(['09:00', '09:30', '10:00']);
  expect(el('status').textContent).toContain('saved');
});

test('advanced slots can be added, edited, removed and saved', async () => {
  el('modeAdvanced').click();
  while (window.document.querySelector('.btn-remove')) window.document.querySelector('.btn-remove').click();
  el('addTimeSlot').click();
  const input = el('timeSlotsList').querySelector('input');
  input.value = '18:20';
  input.dispatchEvent(new window.Event('input'));
  el('saveAll').click();
  await settle();
  expect(storage.scheduleMode).toBe('advanced');
  expect(storage.scheduleTimes).toEqual(['18:20']);
});

test('invalid schedule is rejected without writing', async () => {
  el('scheduleInterval').value = '-5';
  el('saveAll').click();
  await settle();
  expect(storage).toEqual({});
  expect(el('status').textContent).toContain('Interval');
});

test('imports a schedule and rejects malformed settings atomically', async () => {
  const input = el('importFile');
  const selectFile = async data => {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(data) }] });
    input.dispatchEvent(new window.Event('change'));
    await settle();
  };
  await selectFile({ scheduleMode: 'simple', scheduleStart: '10:00', scheduleEnd: '11:00', scheduleInterval: 30 });
  expect(storage.scheduleTimes).toEqual(['10:00', '10:30', '11:00']);
  await selectFile({ username: 'changed', scheduleInterval: 0 });
  expect(storage.username).toBeUndefined();
  expect(el('status').textContent).toContain('Import failed');
});

test('exports saved settings', async () => {
  storage.username = 'saved-user';
  let blob;
  window.URL.createObjectURL = value => { blob = value; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  el('exportSettings').click();
  await settle();
  expect(blob).toBeDefined();
  expect(el('status').textContent).toContain('exported');
});
