import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION } from '../src/version.js';

/**
 * Keeps the hand-declared version in step with the manifest.
 *
 * `src/version.ts` deliberately does not import package.json — a JSON import would
 * pull the whole manifest into the published bundle. This test is what makes that
 * duplication safe.
 */
describe('version metadata', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { name: string; version: string; bin: Record<string, string> };

  it('matches the package version', () => {
    expect(SERVER_VERSION).toBe(manifest.version);
  });

  it('matches the package name', () => {
    expect(SERVER_NAME).toBe(manifest.name);
  });

  it('exposes a bin entry under the same name, so `npx lipdub-mcp` works', () => {
    expect(Object.keys(manifest.bin)).toContain(SERVER_NAME);
  });
});
