import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

const MIN_DIGITS = 6;
const MAX_DIGITS = 15;
const MAX_TEXT_LENGTH = 2000;

/** @type {RegExp} Matches phone-like runs, including a leading +, 00, or parenthesis. */
const CANDIDATE_PATTERN = /(?:\+|00)?\(?\d[\d\s().-]*\d/g;

/**
 * Remove formatting from a candidate, keeping a single leading plus.
 * @param {string} raw
 * @returns {string}
 */
function compactCandidate(raw) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

/**
 * Reject obvious identifiers, dates, and invoice-like strings.
 * @param {string} candidate
 * @param {string} before Text immediately preceding the candidate.
 * @returns {boolean}
 */
function isPlausible(candidate, before) {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return false;

  if (/^(?:19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}$/.test(candidate)) return false;
  if (/^(?:19|20)\d{2}[-./]\d{2,}$/.test(candidate)) return false;
  if (/^\d{1,2}[-./]\d{1,2}[-./](?:19|20)\d{2}$/.test(candidate)) return false;
  if (/(?:#|№)\s*$/.test(before)) return false;
  if (/(?:order|invoice|product|item|sku|ref)\s*[:#]?\s*$/i.test(before)) return false;

  return true;
}

/**
 * Rank candidates so an international number wins over a local one.
 * @param {string} candidate
 * @returns {number}
 */
function candidateScore(candidate) {
  const digits = candidate.replace(/\D/g, '');
  let score = digits.length;
  if (candidate.startsWith('+')) score += 100;
  else if (candidate.startsWith('00')) score += 90;
  if (/[().\s-]/.test(candidate)) score += 5;
  return score;
}

/**
 * Extract a plausible phone candidate from arbitrary selected text.
 * Returns a compact candidate (leading + kept) or null.
 * @param {string} text
 * @returns {string | null}
 */
export function extractPhoneCandidate(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.normalize('NFKC').slice(0, MAX_TEXT_LENGTH);
  if (!normalized.trim()) return null;

  let best = null;
  let bestScore = -1;

  for (const match of normalized.matchAll(CANDIDATE_PATTERN)) {
    const before = normalized.slice(Math.max(0, match.index - 24), match.index);
    if (!isPlausible(match[0], before)) continue;
    const score = candidateScore(match[0]);
    if (score > bestScore) {
      best = match[0];
      bestScore = score;
    }
  }

  if (!best) return null;
  const compact = compactCandidate(best);
  return compact.replace(/\D/g, '').length >= MIN_DIGITS ? compact : null;
}

/**
 * Parse an international number (+… or 00…). Returns { digits, isoCode } or null.
 * @param {string} text
 * @returns {{ digits: string, isoCode: string | null } | null}
 */
export function parseInternational(text) {
  const candidate = extractPhoneCandidate(text);
  if (!candidate) return null;

  let value = candidate;
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (!value.startsWith('+')) return null;

  const parsed = parsePhoneNumberFromString(value);
  if (!parsed || !parsed.isValid()) return null;

  const digits = parsed.number.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return { digits, isoCode: parsed.country ?? null };
}

/**
 * Parse a national number with a country ISO code. Returns { digits, isoCode } or null.
 * @param {string} text
 * @param {string} isoCode ISO 3166-1 alpha-2 code (e.g. "US", "BD").
 * @returns {{ digits: string, isoCode: string } | null}
 */
export function parseNational(text, isoCode) {
  const candidate = extractPhoneCandidate(text);
  if (!candidate) return null;
  if (candidate.startsWith('+') || candidate.startsWith('00')) return null;
  if (typeof isoCode !== 'string' || !/^[A-Z]{2}$/.test(isoCode)) return null;

  const parsed = parsePhoneNumberFromString(candidate, isoCode);
  if (!parsed || !parsed.isValid()) return null;

  const digits = parsed.number.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return { digits, isoCode: parsed.country ?? isoCode };
}

/**
 * Build and validate a wa.me URL. Throws on invalid digits.
 * @param {string} digits E.164 digits without a leading plus.
 * @returns {string}
 */
export function buildWhatsAppUrl(digits) {
  const raw = String(digits ?? '').trim();
  if (!/^[+\d\s().-]+$/.test(raw)) {
    throw new Error('Invalid phone digits');
  }

  const clean = raw.replace(/\D/g, '');
  if (clean.length < MIN_DIGITS || clean.length > MAX_DIGITS) {
    throw new Error('Invalid phone digits');
  }

  const url = `https://wa.me/${clean}`;
  if (!/^https:\/\/wa\.me\/\d{6,15}$/.test(url)) {
    throw new Error('Unable to create WhatsApp link');
  }

  return url;
}
