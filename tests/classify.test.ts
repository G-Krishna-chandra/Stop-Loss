import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractLoginCode, extractMagicLink, parseSender } from '../src/inbox/classify.js';

test('classifies the emails a trial produces', () => {
  assert.equal(classify('Welcome to Notion!', 'Thanks for signing up.'), 'welcome');
  assert.equal(classify('Your free trial has started', 'Enjoy 14 days of Pro.'), 'welcome');
  assert.equal(classify('Your trial ends in 3 days', 'After that you will be charged $10.'), 'trial_ending');
  assert.equal(classify('Reminder', 'You have 3 days left in your trial.'), 'trial_ending');
  assert.equal(classify('Your verification code', 'Your code is 482913'), 'login_code');
  assert.equal(classify('Your receipt from Linear', 'Payment received: $8.00'), 'receipt');
  assert.equal(classify('Your subscription has been cancelled', 'Sorry to see you go.'), 'cancellation');
  assert.equal(classify('We have cancelled your plan', ''), 'cancellation');
  assert.equal(classify('Product update: new features', 'Check out what is new.'), 'other');
});

test('a welcome email that mentions cancelling anytime is still a welcome', () => {
  assert.equal(classify('Welcome to Pro', 'You can cancel anytime from settings.'), 'welcome');
});

test('extracts login codes', () => {
  assert.equal(extractLoginCode('Sign in to Acme', 'Your verification code is: 482913'), '482913');
  assert.equal(extractLoginCode('Your code', 'Use code ABC-123 to log in'), 'ABC-123');
  assert.equal(extractLoginCode('Hello', 'No code here'), null);
});

test('only accepts magic links on the service domain', () => {
  const body = 'Click https://evil.example.com/login?t=1 or https://app.notion.so/loginwithemail?token=abc';
  assert.equal(extractMagicLink(body, 'notion.so'), 'https://app.notion.so/loginwithemail?token=abc');
  assert.equal(extractMagicLink('https://evil.example.com/login?t=1', 'notion.so'), null);
});

test('parses sender into service name and domain', () => {
  assert.deepEqual(parseSender('Notion Team <team@mail.notion.so>'), { name: 'Notion', domain: 'notion.so' });
  assert.deepEqual(parseSender('noreply@linear.app'), { name: 'Linear', domain: 'linear.app' });
  assert.deepEqual(parseSender('"Acme" <billing@acme.co.uk>'), { name: 'Acme', domain: 'acme.co.uk' });
});

test('sign-up codes are login codes', () => {
  assert.equal(classify('869352 is your Vercel sign up code', ''), 'login_code');
  assert.equal(extractLoginCode('869352 is your Vercel sign up code', ''), '869352');
});
