import { describe, expect, it } from 'vitest';
import {
  classifyHttpFailure,
  explainIngestFailure,
  LipDubErrorCode,
  lipdubError,
} from '../src/lipdub/errors.js';
import { loadPrivateTerms, scanCodenames, scanStructural } from './helpers/leak-scan.js';

describe('classifyHttpFailure', () => {
  it('treats a bare gateway 403 as a bad API key', () => {
    // Verified against the live API: an invalid key returns 403 (not 401) carrying the
    // gateway envelope {"message": "Forbidden"} with no `detail` member.
    const error = classifyHttpFailure(403, { message: 'Forbidden' });
    expect(error.code).toBe(LipDubErrorCode.InvalidApiKey);
  });

  it('treats a 403 carrying an application detail as an out-of-credits rejection', () => {
    // Same status, different envelope: the application answers with `detail`, which is
    // the only way to tell these two apart.
    const error = classifyHttpFailure(403, { detail: 'Client error 403: Not enough credits' });
    expect(error.code).toBe(LipDubErrorCode.OutOfCredits);
  });

  it.each([402, 424])('maps %i to out of credits', (status) => {
    expect(classifyHttpFailure(status, {}).code).toBe(LipDubErrorCode.OutOfCredits);
  });

  it('maps 429 to a rate-limit message that does not promise a Retry-After', () => {
    const error = classifyHttpFailure(429, null);
    expect(error.code).toBe(LipDubErrorCode.RateLimited);
    expect(error.message).not.toContain('Retry-After');
  });

  it('maps 404 to not found', () => {
    expect(classifyHttpFailure(404, {}).code).toBe(LipDubErrorCode.NotFound);
  });

  it.each([500, 502, 503, 504])('maps %i to service unavailable with a null body', (status) => {
    // The gateway serves 5xx as HTML, so the body arrives as null after content-type
    // sniffing; classification must not depend on parsing it.
    expect(classifyHttpFailure(status, null).code).toBe(LipDubErrorCode.ServiceUnavailable);
  });

  it('never echoes the upstream body', () => {
    const secretish = 'internal detail that must not be forwarded';
    const error = classifyHttpFailure(400, { detail: secretish });
    expect(error.message).not.toContain(secretish);
  });

  it('carries a request id through for support', () => {
    const error = classifyHttpFailure(500, null, 'req-123');
    expect(error.requestId).toBe('req-123');
    expect(error.toToolMessage()).toContain('req-123');
  });
});

describe('explainIngestFailure', () => {
  it.each([
    ['asset download failed', 'could not download'],
    ['render dispatch failed', 'could not start the render'],
    ['request timed out', 'timed out while preparing'],
  ])('translates %o into an actionable explanation', (reason, expectedFragment) => {
    const explanation = explainIngestFailure(reason);
    expect(explanation).toBeTruthy();
    expect(explanation).toContain(expectedFragment);
  });

  it('is case and whitespace insensitive', () => {
    expect(explainIngestFailure('  ASSET DOWNLOAD FAILED  ')).toBeTruthy();
  });

  it('returns null for an unrecognised reason so the caller uses a fixed fallback', () => {
    expect(explainIngestFailure('something new upstream')).toBeNull();
    expect(explainIngestFailure(null)).toBeNull();
    expect(explainIngestFailure(undefined)).toBeNull();
  });
});

describe('every error message is publishable and actionable', () => {
  const allCodes = Object.values(LipDubErrorCode);

  it.each(allCodes)('%s carries no structural leak marker', (code) => {
    const message = lipdubError(code).message;
    expect(scanStructural(message).map((match) => match.rule), `leak in ${code}`).toEqual([]);
  });

  it.each(allCodes)('%s names no internal system', (code) => {
    // The codename list is private and supplied by CI; locally this degrades to the
    // structural check above rather than silently passing on an empty list.
    const privateTerms = loadPrivateTerms(process.env);
    if (privateTerms === null) {
      return;
    }
    const message = lipdubError(code).message;
    expect(scanCodenames(message, privateTerms), `leak in ${code}`).toEqual([]);
  });

  it.each(allCodes)('%s is non-empty and reasonably specific', (code) => {
    const message = lipdubError(code).message;
    expect(message.length).toBeGreaterThan(40);
  });
});
