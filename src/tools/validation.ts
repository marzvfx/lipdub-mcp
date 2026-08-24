import { MAX_URL_LENGTH } from '../lipdub/constants.js';
import { LipDubErrorCode, lipdubError } from '../lipdub/errors.js';

/**
 * Input validation performed before any upstream call.
 *
 * The goal is a fast, specific error the model can act on, not security. In
 * particular this module deliberately does **not** try to block internal or
 * private-network URLs by resolving them:
 *
 * - The API already does that properly, at ingest time and again at fetch time,
 *   re-validating every redirect hop.
 * - A check here is trivially bypassed by calling the API directly, so it protects
 *   nobody.
 * - Worse, resolving a hostname here would run on the *user's* machine, turning this
 *   server into an oracle that reveals whether an internal host exists on their
 *   corporate network. The mitigation would be the vulnerability.
 *
 * So we check only what is cheap and purely syntactic, and let the API be the
 * authority on reachability.
 */

/** Prefixes and shapes that indicate a local filesystem path rather than a URL. */
const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  /^\.{1,2}[/\\]/, //  ./clip.mp4  or  ../clip.mp4
  /^~[/\\]/, //         ~/Videos/clip.mp4
  /^\//, //             /home/me/clip.mp4
  /^[A-Za-z]:[/\\]/, // C:\Users\me\clip.mp4
  /^file:\/\//i, //     file:///home/me/clip.mp4
] as const;

/** Whether a value looks like a path on the caller's machine. */
export function looksLikeLocalPath(value: string): boolean {
  const trimmed = value.trim();
  return LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Validate a caller-supplied source URL.
 *
 * @param value The URL.
 * @param label Which side it is, used only to make the error concrete.
 * @returns The trimmed URL.
 * @throws LipDubError When the value is a local path or not an http(s) URL.
 */
export function validateSourceUrl(value: string, label: 'video_url' | 'audio_url'): string {
  const trimmed = value.trim();

  if (looksLikeLocalPath(trimmed)) {
    throw lipdubError(
      LipDubErrorCode.LocalPathNotSupported,
      null,
      `The value supplied for ${label} was "${trimmed}".`,
    );
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    throw lipdubError(
      LipDubErrorCode.UnsupportedMedia,
      null,
      `The ${label} is longer than ${MAX_URL_LENGTH} characters, which LipDub cannot accept.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw lipdubError(
      LipDubErrorCode.LocalPathNotSupported,
      null,
      `The value supplied for ${label} was "${trimmed}", which is not a URL.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw lipdubError(
      LipDubErrorCode.LocalPathNotSupported,
      null,
      `The ${label} uses "${parsed.protocol}", but LipDub can only download http and https links.`,
    );
  }

  return trimmed;
}

/** A validated pair of sources for one side of a render. */
export interface ResolvedSource {
  url?: string;
  id?: string | number;
}

/**
 * Enforce "exactly one of URL or id" for one side of a render.
 *
 * Expressed in code rather than as a JSON-Schema `oneOf` because models generate
 * arguments far more reliably against a flat schema, and a schema-composition failure
 * surfaces to the model as an opaque validation error instead of the actionable
 * message produced here.
 *
 * @param url Candidate URL, if supplied.
 * @param id Candidate id, if supplied.
 * @param label Which side is being resolved.
 * @returns Whichever one was supplied.
 * @throws LipDubError When neither or both were supplied.
 */
export function resolveExactlyOneSource(
  url: string | undefined,
  id: string | number | undefined,
  label: 'video' | 'audio',
): ResolvedSource {
  const hasUrl = typeof url === 'string' && url.trim().length > 0;
  const hasId = id !== undefined && id !== null && `${id}`.trim().length > 0;

  if (hasUrl && hasId) {
    throw lipdubError(
      LipDubErrorCode.ConflictingSource,
      null,
      `Both ${label}_url and ${label}_id were supplied.`,
    );
  }

  if (!hasUrl && !hasId) {
    throw lipdubError(
      LipDubErrorCode.MissingSource,
      null,
      `Neither ${label}_url nor ${label}_id was supplied.`,
    );
  }

  return hasUrl
    ? { url: validateSourceUrl(url as string, `${label}_url` as 'video_url' | 'audio_url') }
    : { id };
}
