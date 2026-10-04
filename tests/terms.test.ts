import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renewalDate, termsFromEmail } from '../src/terms/index.js';

test('reads trial length and price from a welcome email', () => {
  assert.deepEqual(termsFromEmail('Your 14-day free trial has started. Then $20/month.'), {
    trial_days: 14,
    renewal_price_cents: 2000,
    currency: 'USD',
  });
  assert.equal(termsFromEmail('Enjoy your 2-week trial').trial_days, 14);
  assert.equal(termsFromEmail('Your one-month free trial').trial_days, 30);
  assert.equal(termsFromEmail('You will be billed €9.99 when it ends').renewal_price_cents, 999);
  assert.deepEqual(termsFromEmail('Welcome aboard!'), { trial_days: null, renewal_price_cents: null, currency: null });
});

test('computes the renewal date', () => {
  const opened = new Date('2026-10-04T12:00:00Z');
  assert.equal(renewalDate(opened, 7)?.toISOString(), '2026-10-11T12:00:00.000Z');
  assert.equal(renewalDate(opened, null), null);
});
