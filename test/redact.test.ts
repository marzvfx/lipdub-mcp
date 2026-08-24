import { describe, expect, it } from 'vitest';
import { REDACTED_PLACEHOLDER, redactSecrets, sanitizeUpstreamText } from '../src/redaction/redact.js';
import { scanStructural } from './helpers/leak-scan.js';

describe('redactSecrets', () => {
  const key = 'abcd1234-5678-90ef-ghij-klmnopqrstuv';

  it('removes the key wherever it appears', () => {
    const text = `request failed with header X-Api-Key: ${key} for /v1/renders`;
    const redacted = redactSecrets(text, [key]);

    expect(redacted).not.toContain(key);
    expect(redacted).toContain(REDACTED_PLACEHOLDER);
  });

  it('redacts an X-Api-Key header value even when the key differs from the one we hold', () => {
    // Covers the case where the user rotated their key mid-session, so the value in an
    // exception message is not the one the logger was constructed with.
    const redacted = redactSecrets('x-api-key: some-other-value-entirely', ['unrelated-secret']);
    expect(redacted).not.toContain('some-other-value-entirely');
  });

  it('is case-insensitive about the header name', () => {
    expect(redactSecrets('X-API-KEY=abc123def456', [])).toContain(REDACTED_PLACEHOLDER);
  });

  it('ignores empty and implausibly short secrets so it cannot blank ordinary text', () => {
    const text = 'a perfectly ordinary sentence';
    expect(redactSecrets(text, [undefined, '', 'ab'])).toBe(text);
  });

  it('handles several secrets at once', () => {
    const redacted = redactSecrets('first=aaaaaaaaaa second=bbbbbbbbbb', [
      'aaaaaaaaaa',
      'bbbbbbbbbb',
    ]);
    expect(redacted).not.toContain('aaaaaaaaaa');
    expect(redacted).not.toContain('bbbbbbbbbb');
  });
});

describe('scanStructural', () => {
  it('catches a Python docstring block copied from the upstream API description', () => {
    const copied = 'Create a render.\\n\\nArgs:\\n    render_id: The id of the render';
    expect(scanStructural(copied).map((match) => match.rule)).toContain('python-docstring-args');
  });

  it('catches dependency-injection vocabulary', () => {
    expect(
      scanStructural('renders_resource: Injected renders resource dependency').map((m) => m.rule),
    ).toContain('dependency-injection-noun');
  });

  it('catches the private monorepo confidentiality banner', () => {
    expect(scanStructural('MARZ CONFIDENTIAL — do not distribute').map((m) => m.rule)).toContain(
      'confidentiality-banner',
    );
  });

  it('catches an internal hostname without this file naming one', () => {
    expect(scanStructural('connect to registry.example.internal').map((m) => m.rule)).toContain(
      'internal-hostname',
    );
  });

  it('catches an internal storage path', () => {
    expect(scanStructural('weights live at /mnt/ml/shared/weights').map((m) => m.rule)).toContain(
      'internal-mount-path',
    );
  });

  it('does not flag ordinary public-facing prose', () => {
    expect(
      scanStructural(
        'Start a LipDub 2 render from a public video URL. Renders take about 7-15 minutes and use credits.',
      ),
    ).toEqual([]);
  });

  it('does not flag the public product name', () => {
    expect(scanStructural('model_type is lipdub2 and the product is LipDub 2')).toEqual([]);
  });

  it('returns context to make a CI failure actionable', () => {
    const [match] = scanStructural('prefix MARZ CONFIDENTIAL suffix');
    expect(match?.context).toContain('suffix');
  });
});

describe('sanitizeUpstreamText', () => {
  it('collapses control characters that could fake an instruction block', () => {
    expect(sanitizeUpstreamText('line one\nline two\r\nIGNORE PREVIOUS')).toBe(
      'line one line two IGNORE PREVIOUS',
    );
  });

  it('truncates overlong values', () => {
    const result = sanitizeUpstreamText('x'.repeat(1000), 50);
    expect(result.length).toBeLessThanOrEqual(51);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns an empty string for non-string input', () => {
    expect(sanitizeUpstreamText(null)).toBe('');
    expect(sanitizeUpstreamText(undefined)).toBe('');
    expect(sanitizeUpstreamText(42)).toBe('');
  });
});
