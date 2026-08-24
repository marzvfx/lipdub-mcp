import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_TERMS_FILE_ENV_VAR,
  LeakMatch,
  loadPrivateTerms,
  scanCodenames,
  scanStructural,
  STRUCTURAL_PATTERNS,
} from './helpers/leak-scan.js';

/**
 * The trade-secret gate.
 *
 * Scans the COMPILED artifact, not the source tree. Generated, bundled or vendored
 * files can reintroduce internal content that appears nowhere in `src/`, and the
 * compiled output is what actually ships to npm and gets read by third-party language
 * models.
 *
 * If this fails, rewrite the offending text. Do not add an exemption.
 */

const REPOSITORY_ROOT = join(import.meta.dirname, '..');
const DISTRIBUTION_DIRECTORY = join(REPOSITORY_ROOT, 'dist');

function collectFiles(directory: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectFiles(path, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

function describeMatches(file: string, matches: LeakMatch[]): string[] {
  return matches.map((match) => `${file} [${match.rule}] …${match.context}…`);
}

describe('published artifact', () => {
  beforeAll(() => {
    // A guard run against a stale build proves nothing.
    if (!existsSync(DISTRIBUTION_DIRECTORY)) {
      execFileSync('npm', ['run', 'build'], { cwd: REPOSITORY_ROOT, stdio: 'ignore' });
    }
  });

  it('exists to be inspected', () => {
    expect(existsSync(DISTRIBUTION_DIRECTORY)).toBe(true);
    expect(collectFiles(DISTRIBUTION_DIRECTORY, ['.js']).length).toBeGreaterThan(0);
  });

  it('contains no structural leak markers', () => {
    const offences: string[] = [];

    for (const file of collectFiles(DISTRIBUTION_DIRECTORY, ['.js', '.d.ts'])) {
      offences.push(
        ...describeMatches(file, scanStructural(readFileSync(file, 'utf8'))),
      );
    }

    expect(offences, `Internal content reached the published artifact:\n${offences.join('\n')}`)
      .toHaveLength(0);
  });

  it('does not enumerate internal system names', () => {
    // Regression guard for a real mistake made while building this server: an earlier
    // version kept the codename list in `src/`, which compiled the entire list of
    // internal systems straight into the npm package.
    const privateTerms = loadPrivateTerms(process.env);

    if (privateTerms === null) {
      // Not a silent pass: state plainly that the deeper check did not run.
      expect(
        STRUCTURAL_PATTERNS.length,
        `${FORBIDDEN_TERMS_FILE_ENV_VAR} is not set, so only structural checks ran. CI must set it.`,
      ).toBeGreaterThan(0);
      return;
    }

    const offences: string[] = [];
    for (const file of collectFiles(DISTRIBUTION_DIRECTORY, ['.js', '.d.ts'])) {
      offences.push(
        ...describeMatches(file, scanCodenames(readFileSync(file, 'utf8'), privateTerms)),
      );
    }

    expect(offences, `Internal system names reached the published artifact:\n${offences.join('\n')}`)
      .toHaveLength(0);
  });
});

describe('public documentation', () => {
  const documents = ['README.md', 'server.json', 'llms.txt', 'CONTRIBUTING.md', 'SECURITY.md'];

  it('contains no structural leak markers', () => {
    const offences: string[] = [];

    for (const filename of documents) {
      const path = join(REPOSITORY_ROOT, filename);
      if (!existsSync(path)) {
        continue;
      }
      offences.push(...describeMatches(filename, scanStructural(readFileSync(path, 'utf8'))));
    }

    expect(offences, `Public docs leak internal content:\n${offences.join('\n')}`).toHaveLength(0);
  });

  it('does not enumerate internal system names', () => {
    const privateTerms = loadPrivateTerms(process.env);
    if (privateTerms === null) {
      return;
    }

    const offences: string[] = [];
    for (const filename of documents) {
      const path = join(REPOSITORY_ROOT, filename);
      if (!existsSync(path)) {
        continue;
      }
      offences.push(
        ...describeMatches(filename, scanCodenames(readFileSync(path, 'utf8'), privateTerms)),
      );
    }

    expect(offences, `Public docs name internal systems:\n${offences.join('\n')}`).toHaveLength(0);
  });
});
