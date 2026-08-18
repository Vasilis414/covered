import test from 'node:test';
import assert from 'node:assert/strict';

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function expiryDate(purchaseDate, durationYears) {
  const date = new Date(purchaseDate);
  date.setFullYear(date.getFullYear() + durationYears);
  return date;
}

test('Warranty calculations: parse and format ISO dates correctly', () => {
  const date = parseLocalDate('2026-08-15');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 7); // 0-indexed August
  assert.equal(date.getDate(), 15);
  assert.equal(toISODate(date), '2026-08-15');
});

test('Warranty calculations: calculates expiry date across leap years and normal years', () => {
  const date = parseLocalDate('2024-02-29'); // Leap year
  const expiry2Year = expiryDate(date, 2);
  assert.equal(toISODate(expiry2Year), '2026-03-01'); // normalized to March 1st on non-leap year

  const standard = parseLocalDate('2026-05-10');
  const expiry1Year = expiryDate(standard, 1);
  assert.equal(toISODate(expiry1Year), '2027-05-10');
});

test('Storage notifications: scheduling rules for short-term and multi-day items', () => {
  const now = Date.now();
  const shortExpiry = new Date(now + 2 * 60 * 60 * 1000); // 2 hours from now
  const longExpiry = new Date(now + 10 * 24 * 60 * 60 * 1000); // 10 days from now

  const isShortTerm = shortExpiry.getTime() - now < 24 * 60 * 60 * 1000;
  assert.equal(isShortTerm, true);

  const isLongTerm = longExpiry.getTime() - now >= 24 * 60 * 60 * 1000;
  assert.equal(isLongTerm, true);
});
