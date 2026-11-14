import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWhatsAppUrl,
  extractPhoneCandidate,
  parseInternational,
  parseNational
} from '../lib/phone-number-parser.js';
import { countries, filterCountries, sortCountries } from '../data/countries.js';

const WA_URL = /^https:\/\/wa\.me\/\d{6,15}$/;

test('international numbers from the spec', () => {
  const cases = [
    ['+8801712345678', '8801712345678'],
    ['+1 415 555 1234', '14155551234'],
    ['+44 20 7946 0958', '442079460958'],
    ['+49 30 123456', '4930123456'],
    ['+91 9876543210', '919876543210'],
    ['+880-1712-345678', '8801712345678'],
    ['+1 (415) 555-1234', '14155551234'],
    ['+44 (20) 7946-0958', '442079460958'],
    ['008801712345678', '8801712345678'],
    ['0014155551234', '14155551234'],
    ['00442079460958', '442079460958']
  ];

  for (const [input, digits] of cases) {
    assert.deepEqual(parseInternational(input)?.digits, digits, input);
    assert.match(buildWhatsAppUrl(digits), WA_URL);
  }
});

test('international numbers embedded in prose', () => {
  assert.equal(parseInternational('Call us at +880 1712-345678 today')?.digits, '8801712345678');
  assert.equal(extractPhoneCandidate('Call us at +880 1712-345678 today'), '+8801712345678');
  assert.equal(extractPhoneCandidate('Phone: (415) 555-1234'), '4155551234');
});

test('local numbers convert with the selected country', () => {
  const cases = [
    ['01712345678', 'BD', '8801712345678'],
    ['4155551234', 'US', '14155551234'],
    ['02079460958', 'GB', '442079460958'],
    ['030123456', 'DE', '4930123456'],
    ['01712-345678', 'BD', '8801712345678'],
    ['020 7946 0958', 'GB', '442079460958'],
    ['Phone: (415) 555-1234', 'US', '14155551234'],
    // Canada shares the US numbering plan; parsing with US keeps the digits.
    ['6045551234', 'US', '16045551234']
  ];

  for (const [input, isoCode, digits] of cases) {
    assert.deepEqual(parseNational(input, isoCode)?.digits, digits, `${input} ${isoCode}`);
  }
});

test('international numbers are not treated as national', () => {
  assert.equal(parseNational('+8801712345678', 'BD'), null);
  assert.equal(parseNational('008801712345678', 'BD'), null);
});

test('invalid selections do not parse', () => {
  const invalid = ['hello', 'abc123', '123', '2026-09-23', 'abc@example.com'];
  for (const input of invalid) {
    assert.equal(extractPhoneCandidate(input), null, input);
    assert.equal(parseInternational(input), null, input);
  }
});

test('identifier-like numbers are ignored', () => {
  const inputs = ['Order #123456', 'Invoice 2026-12345', 'Product 12345', 'SKU: 987654321'];
  for (const input of inputs) {
    assert.equal(extractPhoneCandidate(input), null, input);
  }
});

test('WhatsApp URLs contain digits only', () => {
  assert.equal(buildWhatsAppUrl('8801712345678'), 'https://wa.me/8801712345678');
  assert.equal(buildWhatsAppUrl('+8801712345678'), 'https://wa.me/8801712345678');
  assert.equal(buildWhatsAppUrl('+1 (415) 555-1234'), 'https://wa.me/14155551234');
  assert.match(buildWhatsAppUrl('442079460958'), WA_URL);

  for (const bad of ['123', '1234567890123456', 'hello', 'abc123456', '']) {
    assert.throws(() => buildWhatsAppUrl(bad), /Invalid phone digits|Unable to create WhatsApp link/, bad);
  }
});

test('USA and Canada merge into one option', () => {
  const merged = countries.filter((country) => country.name === 'USA/CANADA');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].isoCode, 'US');
  assert.equal(merged[0].secondaryIsoCode, 'CA');
  assert.equal(merged[0].callingCode, '1');
  assert.equal(merged[0].priorityGroup, 1);
  assert.equal(merged[0].priorityOrder, 1);

  assert.equal(countries.some((country) => country.isoCode === 'CA'), false);
  assert.equal(countries.filter((country) => country.isoCode === 'US').length, 1);
});

test('dataset is complete and well formed', () => {
  assert.ok(countries.length >= 240);

  const seen = new Set();
  for (const country of countries) {
    assert.ok(country.name.length > 0);
    assert.match(country.isoCode, /^[A-Z]{2}$/);
    assert.match(country.callingCode, /^\d{1,4}$/);
    assert.ok(country.flag.length > 0);
    assert.ok(country.priorityGroup >= 1 && country.priorityGroup <= 5);
    assert.ok(country.priorityOrder >= 1);
    assert.equal(seen.has(country.isoCode), false, country.isoCode);
    seen.add(country.isoCode);
  }
});

test('priority ordering matches the spec', () => {
  const expected = [
    'USA/CANADA',
    'Australia',
    'New Zealand',
    'United Kingdom',
    'Germany',
    'France',
    'Netherlands',
    'Belgium',
    'Switzerland',
    'Austria',
    'Sweden',
    'Norway',
    'Denmark',
    'Finland',
    'Ireland',
    'Iceland',
    'Luxembourg',
    'Japan',
    'South Korea',
    'Singapore',
    'Israel'
  ];

  assert.deepEqual(countries.slice(0, expected.length).map((country) => country.name), expected);
  assert.deepEqual(sortCountries(countries).map((country) => country.isoCode), countries.map((country) => country.isoCode));
});

test('remaining countries are alphabetical after the priority groups', () => {
  const remaining = countries.filter((country) => country.priorityGroup === 5).map((country) => country.name);
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const sorted = [...remaining].sort((a, b) => collator.compare(a, b));
  assert.deepEqual(remaining, sorted);
});

test('country search matches name, ISO code, and calling code', () => {
  const find = (query) => filterCountries(countries, query).map((country) => country.name);

  assert.ok(find('bang').includes('Bangladesh'));
  assert.ok(find('usa').includes('USA/CANADA'));
  assert.ok(find('+880').includes('Bangladesh'));
  assert.ok(find('880').includes('Bangladesh'));
  assert.ok(find('gb').includes('United Kingdom'));
  assert.ok(find('de').includes('Germany'));
  assert.ok(find('ca').includes('USA/CANADA'));
  assert.deepEqual(filterCountries(countries, 'zzz'), []);
  assert.deepEqual(filterCountries(countries, ''), countries);
});

test('search preserves priority ordering', () => {
  const filtered = filterCountries(countries, 'an');
  const indexes = filtered.map((country) => countries.indexOf(country));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
  assert.equal(filtered[0].name, 'USA/CANADA');
});
