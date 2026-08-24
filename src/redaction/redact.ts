/**
 * Runtime redaction and sanitisation.
 *
 * Note what is deliberately NOT here: the list of internal codenames, and the scanner
 * that looks for them. A constant enumerating "the systems LipDub runs on" would be
 * published both in this repository and inside the npm package — disclosing exactly
 * what it exists to protect. That scan lives in the test helpers instead, driven by a
 * private term list that CI supplies. See `test/helpers/leak-scan.ts`.
 */

/** Placeholder substituted wherever a credential was found. */
export const REDACTED_PLACEHOLDER = '[redacted]';

/**
 * Shortest string treated as a credential.
 *
 * Guards against a misconfigured or empty key turning every space in a message into a
 * placeholder. LipDub keys are UUID strings, so anything shorter is not a real key.
 */
const MINIMUM_REDACTABLE_SECRET_LENGTH = 8;

/**
 * Remove every occurrence of the caller's API key from a string.
 *
 * Applied to everything leaving this process — log lines, error messages and tool
 * results. Redaction is by literal value rather than by looking for a header name,
 * because the most likely leak path is an HTTP client exception whose message embeds
 * the whole request, headers included.
 *
 * @param text Text that may contain the credential.
 * @param secrets Credential values to remove. Empty and short values are ignored.
 * @returns The text with every occurrence of every secret replaced.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let redacted = text;

  for (const secret of secrets) {
    if (!secret || secret.length < MINIMUM_REDACTABLE_SECRET_LENGTH) {
      continue;
    }
    redacted = redacted.replaceAll(secret, REDACTED_PLACEHOLDER);
  }

  // Also blank the value of a serialised `X-Api-Key` header. This covers the case
  // where the key in the text is not the one we hold — for example after the user
  // rotated it mid-session.
  return redacted.replace(/(x-api-key\s*[:=]\s*)(\S+)/gi, `$1${REDACTED_PLACEHOLDER}`);
}

/**
 * Strip control characters and cap the length of text that came from upstream.
 *
 * Values such as `failure_reason` and `output_filename` are echoed into a language
 * model's context, so they are untrusted *to the model* even though they arrive over
 * an authenticated channel. Collapsing control characters denies the simplest
 * prompt-injection formatting trick, and the length cap bounds context spend.
 *
 * @param value Text received from the API.
 * @param maximumLength Longest string to keep before truncating.
 * @returns Sanitised single-paragraph text, or an empty string when absent.
 */
export function sanitizeUpstreamText(value: unknown, maximumLength = 500): string {
  if (typeof value !== 'string') {
    return '';
  }

  // Control characters (newlines, ANSI escapes) are the cheapest way to make injected
  // text look like a fresh instruction block, so they collapse to plain spaces.
  // eslint-disable-next-line no-control-regex
  const withoutControlCharacters = value.replace(/[\x00-\x1F\x7F]+/g, ' ');
  const collapsed = withoutControlCharacters.replace(/\s+/g, ' ').trim();

  return collapsed.length > maximumLength ? `${collapsed.slice(0, maximumLength)}…` : collapsed;
}
