import { existsSync, readFileSync } from 'node:fs';

/**
 * Leak scanning for the published artifact and the public docs.
 *
 * ## Why the sensitive list is not in this repository
 *
 * The obvious implementation — a constant listing every internal codename — is itself
 * a leak. A public file enumerating "the systems LipDub runs on" discloses exactly
 * what it is meant to protect, and it would be published twice over: in this
 * repository, and compiled into the npm package.
 *
 * So the scan is split in two:
 *
 * - **Structural patterns (here, public).** These describe the *shape* of a leak
 *   rather than its content — a Python docstring artifact, a dependency-injection
 *   noun, a confidentiality banner, an internal-looking hostname. They name no
 *   internal system and are safe to publish.
 * - **The codename list (private).** Supplied at scan time through
 *   `LIPDUB_FORBIDDEN_TERMS_FILE`, a newline-delimited file that CI materialises from
 *   a private source. When it is absent the structural scan still runs, and the test
 *   reports that the full check did not.
 *
 * Structural patterns catch the realistic accident: text copied out of the upstream
 * OpenAPI document, whose descriptions carry raw Python docstrings. The codename list
 * catches the deliberate-but-careless case, and only CI needs to be able to do that.
 */

/** Environment variable pointing at a newline-delimited private term list. */
export const FORBIDDEN_TERMS_FILE_ENV_VAR = 'LIPDUB_FORBIDDEN_TERMS_FILE';

/** A structural marker of leaked internal content, safe to describe publicly. */
export interface StructuralPattern {
  name: string;
  pattern: RegExp;
  explanation: string;
}

/**
 * Patterns describing the shape of a leak.
 *
 * Each has a stated rationale so a future contributor can tell a real hit from a
 * false positive without having to guess.
 */
export const STRUCTURAL_PATTERNS: readonly StructuralPattern[] = [
  {
    name: 'python-docstring-args',
    // No leading \b: in a compiled artifact the block is usually preceded by an
    // escaped "\n", and the "n" of that escape is itself a word character, so a word
    // boundary would never match there.
    pattern: /Args:(?:\\n|\s)+\w+\s*[:(]/,
    explanation:
      'A Python docstring "Args:" block. The upstream OpenAPI document contains these; copying a description from it drags internal parameter names along.',
  },
  {
    name: 'python-docstring-returns',
    pattern: /Returns:(?:\\n|\s)+(?:Dict|List|Optional|Tuple)\b/,
    explanation:
      'A Python docstring "Returns:" block naming a Python type. Same origin as the "Args:" marker.',
  },
  {
    name: 'dependency-injection-noun',
    pattern: /\bInjected\s+\w+\s+(?:resource|dependency)\b/i,
    explanation:
      'Server-side dependency-injection vocabulary. Only reaches this package by copying an upstream description verbatim.',
  },
  {
    name: 'confidentiality-banner',
    pattern: /\bMARZ CONFIDENTIAL\b/,
    explanation:
      'The banner carried by every file in the private monorepo. Its presence means scaffolding was copied across the public/private boundary.',
  },
  {
    name: 'internal-hostname',
    // Deliberately generic: any host under a non-public, internal-looking TLD.
    pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vfx|internal|local|cluster\.local)\b/i,
    explanation: 'An internal hostname. Public documentation should only reference public endpoints.',
  },
  {
    name: 'internal-mount-path',
    pattern: /\/mnt\/ml\/|\/net\/[a-z0-9-]+\/|\bgs:\/\/[a-z0-9-]*(?:models|weights)/i,
    explanation: 'An internal storage path. These describe infrastructure layout.',
  },
  {
    name: 'kubernetes-workload-reference',
    pattern: /\bworkflowTemplateRef\b|\bWorkflowTemplate\b|\bkubectl\b/,
    explanation: 'Internal orchestration vocabulary.',
  },
] as const;

/** One scan hit. */
export interface LeakMatch {
  /** Structural pattern name, or `codename` for a private-list hit. */
  rule: string;
  /** Surrounding text, so a CI failure is actionable. */
  context: string;
}

const CONTEXT_RADIUS = 70;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contextAround(text: string, index: number, length: number): string {
  return text.slice(Math.max(0, index - CONTEXT_RADIUS), index + length + CONTEXT_RADIUS).trim();
}

/**
 * Load the private codename list, if CI provided one.
 *
 * @param environment Process environment.
 * @returns The terms, or null when no list is configured.
 */
export function loadPrivateTerms(environment: NodeJS.ProcessEnv): string[] | null {
  const path = environment[FORBIDDEN_TERMS_FILE_ENV_VAR]?.trim();
  if (!path || !existsSync(path)) {
    return null;
  }

  const terms = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return terms.length > 0 ? terms : null;
}

/**
 * Scan text for structural leak markers.
 *
 * @param text Content to scan.
 * @returns One entry per match.
 */
export function scanStructural(text: string): LeakMatch[] {
  const matches: LeakMatch[] = [];

  for (const { name, pattern } of STRUCTURAL_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    let hit: RegExpExecArray | null;
    while ((hit = global.exec(text)) !== null) {
      matches.push({ rule: name, context: contextAround(text, hit.index, hit[0].length) });
    }
  }

  return matches;
}

/**
 * Scan text for private codenames.
 *
 * @param text Content to scan.
 * @param terms Private term list.
 * @returns One entry per match.
 */
export function scanCodenames(text: string, terms: readonly string[]): LeakMatch[] {
  const matches: LeakMatch[] = [];

  for (const term of terms) {
    const pattern = new RegExp(`\\b${escapeForRegExp(term)}\\b`, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(text)) !== null) {
      // The term itself is deliberately not echoed into the failure message, so a CI
      // log stays publishable.
      matches.push({ rule: 'codename', context: contextAround(text, hit.index, term.length) });
    }
  }

  return matches;
}
