import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageState } from '../src/cancel/index.js';

test('recognises a retention offer before anything else', () => {
  assert.equal(pageState('Before you go, get 50% off for 3 months. Accept offer'), 'retention_offer');
  assert.equal(pageState('Pause your subscription instead?'), 'retention_offer');
});

test('a Stripe-style confirm page is final, not already cancelled', () => {
  const stripe =
    'Cancel your plan. Your plan will be canceled, but is still available until the end of your billing period on October 18. Cancel plan';
  assert.equal(pageState(stripe), 'final_confirm');
  assert.equal(pageState('Are you sure you want to cancel? You will lose access to Pro.'), 'final_confirm');
});

test('recognises success', () => {
  assert.equal(pageState('Your subscription has been cancelled.'), 'cancelled');
  assert.equal(pageState('Done. You will not be charged again.'), 'cancelled');
});

test('ordinary pages are other', () => {
  assert.equal(pageState('Billing. Current plan: Pro, $20/month. Manage subscription'), 'other');
});

test('never offers the model offer, payment, delete, or dismiss buttons', async () => {
  const { isUnsafeClick } = await import('../src/cancel/index.js');
  for (const label of ['Accept offer', 'Claim 50% off', 'Upgrade to Pro', 'Pay now', 'Delete account', 'Log out', 'Cancel', 'Keep my plan', 'Go back']) {
    assert.equal(isUnsafeClick(label), true, label);
  }
  for (const label of ['Billing', 'Manage subscription', 'Cancel plan', 'Continue cancellation', 'Account settings']) {
    assert.equal(isUnsafeClick(label), false, label);
  }
});

test('recognises a trial that ends without a charge', () => {
  const airtable =
    'Workspace plan Team Trial Monthly Your trial ends on 10/18/2026. Your workspace will automatically switch to the Free plan unless you upgrade. Edit current plan';
  assert.equal(pageState(airtable), 'no_charge');
});
