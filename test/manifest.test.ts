import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_BASE_URL_ENV_VAR,
  API_KEY_ENV_VAR,
  API_KEY_FILE_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MAX_RENDERS_PER_SESSION_ENV_VAR,
  REQUIRE_SPEND_CONFIRMATION_ENV_VAR,
} from '../src/lipdub/constants.js';
import { SERVER_VERSION } from '../src/version.js';

/**
 * Keeps `server.json` honest.
 *
 * That file is what the MCP registry publishes to clients, so anything it omits is a
 * setting users never discover. It is edited by hand and is easy to forget when a new
 * environment variable is added — which already happened once — so the check is
 * automated rather than left to review.
 */

const REPOSITORY_ROOT = join(import.meta.dirname, '..');

interface ServerManifest {
  name: string;
  version: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string;
    transport: { type: string };
    environmentVariables: Array<{ name: string; isRequired?: boolean; isSecret?: boolean }>;
  }>;
}

const manifest = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, 'server.json'), 'utf8'),
) as ServerManifest;

const packageManifest = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
) as { name: string; version: string };

describe('server.json', () => {
  const entry = manifest.packages[0];
  const declared = new Set((entry?.environmentVariables ?? []).map((variable) => variable.name));

  it('declares every environment variable the server actually reads', () => {
    // LIPDUB_API_BASE_URL is deliberately excluded: it exists to point the server at a
    // test deployment and advertising it in the registry would only invite misuse.
    const userFacing = [
      API_KEY_ENV_VAR,
      API_KEY_FILE_ENV_VAR,
      MAX_RENDERS_PER_SESSION_ENV_VAR,
      REQUIRE_SPEND_CONFIRMATION_ENV_VAR,
      LOG_LEVEL_ENV_VAR,
    ];

    for (const name of userFacing) {
      expect(declared.has(name), `server.json does not declare ${name}`).toBe(true);
    }
  });

  it('does not advertise the internal base-URL override', () => {
    expect(declared.has(API_BASE_URL_ENV_VAR)).toBe(false);
  });

  it('marks the API key as required and secret, and nothing else as secret', () => {
    for (const variable of entry?.environmentVariables ?? []) {
      if (variable.name === API_KEY_ENV_VAR) {
        expect(variable.isRequired).toBe(true);
        expect(variable.isSecret).toBe(true);
      } else {
        expect(variable.isSecret, `${variable.name} should not be marked secret`).toBe(false);
      }
    }
  });

  it('stays in step with the package version', () => {
    expect(manifest.version).toBe(SERVER_VERSION);
    expect(entry?.version).toBe(SERVER_VERSION);
    expect(entry?.version).toBe(packageManifest.version);
  });

  it('points at the published npm package over stdio', () => {
    expect(entry?.registryType).toBe('npm');
    expect(entry?.identifier).toBe(packageManifest.name);
    expect(entry?.transport.type).toBe('stdio');
  });

  it('uses a namespace derived from a domain the company owns', () => {
    // Reverse-DNS of lipdub.ai. A domain-verified namespace reads as first-party in a
    // way that io.github.* does not.
    expect(manifest.name).toBe('ai.lipdub/lipdub-mcp');
  });
});

describe('changelog', () => {
  it('documents the version being published', () => {
    const changelog = readFileSync(join(REPOSITORY_ROOT, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain(`## [${SERVER_VERSION}]`);
  });
});

describe('documented field names match what the tools return', () => {
  // Renaming a result field is easy; finding every prose mention of the old name is
  // not. A rename during review left three stale references behind — in a schema
  // description, the README and a resource guide — each of which would have sent a
  // reader looking for a field that no longer exists. This guards the general case.
  const RETIRED_FIELD_NAMES = ['timed_out_waiting'];

  const DOCUMENT_PATHS = [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CHANGELOG.md',
    'llms.txt',
    'server.json',
    'src/resources/guides.ts',
    'src/tools/wait-for-render.ts',
    'src/tools/get-render.ts',
    'src/server.ts',
  ];

  it.each(RETIRED_FIELD_NAMES)('no document still refers to %s', (retired) => {
    const offenders = DOCUMENT_PATHS.filter((relativePath) =>
      readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8').includes(retired),
    );

    expect(offenders, `these still mention the removed field "${retired}"`).toEqual([]);
  });
});
