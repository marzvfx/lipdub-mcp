/**
 * Named constants shared across the server.
 *
 * Anything that would otherwise be a repeated literal lives here so that a change is
 * a one-line edit rather than a grep-and-replace.
 */

/** Default LipDub API origin. */
export const DEFAULT_API_BASE_URL = 'https://api.lipdub.ai';

/** Environment variable holding the caller's API key. */
export const API_KEY_ENV_VAR = 'LIPDUB_API_KEY';

/** Environment variable holding a path to a file containing the API key. */
export const API_KEY_FILE_ENV_VAR = 'LIPDUB_API_KEY_FILE';

/** Environment variable overriding the API origin (for staging). */
export const API_BASE_URL_ENV_VAR = 'LIPDUB_API_BASE_URL';

/** Environment variable disabling the spend-confirmation gate for headless use. */
export const REQUIRE_SPEND_CONFIRMATION_ENV_VAR = 'LIPDUB_REQUIRE_SPEND_CONFIRMATION';

/** Environment variable capping how many renders one process may start. */
export const MAX_RENDERS_PER_SESSION_ENV_VAR = 'LIPDUB_MAX_RENDERS_PER_SESSION';

/** Header carrying the API key. */
export const API_KEY_HEADER = 'X-Api-Key';

/**
 * Default ceiling on renders started by a single server process.
 *
 * This is a usability guardrail, not a security control: anyone can bypass it by
 * calling the API directly, and the file is on the user's own machine. Its purpose is
 * to stop a looping agent quietly draining a prepaid balance. Real spend limits have
 * to live in the API.
 */
export const DEFAULT_MAX_RENDERS_PER_SESSION = 5;

/** Typical end-to-end render duration, quoted to agents so they wait rather than give up. */
export const TYPICAL_RENDER_DURATION_TEXT = '7–15 minutes';

/** Request timeout for a single upstream HTTP call. */
export const HTTP_TIMEOUT_MILLISECONDS = 30_000;

/** Longest `output_filename` accepted. Also becomes the project name upstream. */
export const MAX_OUTPUT_FILENAME_LENGTH = 200;

/** Longest transcript accepted, mirroring the upstream cap. */
export const MAX_TRANSCRIPT_LENGTH = 4096;

/** Longest URL accepted, mirroring the upstream cap. */
export const MAX_URL_LENGTH = 2048;

/** Video container extensions the product accepts. */
export const SUPPORTED_VIDEO_EXTENSIONS: readonly string[] = [
  '.mp4',
  '.mov',
  '.avi',
  '.webm',
] as const;

/** Audio container extensions the product accepts. */
export const SUPPORTED_AUDIO_EXTENSIONS: readonly string[] = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
] as const;

/** Customer-facing URLs referenced in errors and docs. */
export const SUPPORT_URLS = {
  app: 'https://app.lipdub.ai',
  apiKeys: 'https://app.lipdub.ai/settings/api-keys',
  docs: 'https://lipdub.readme.io/',
  setupDocs: 'https://github.com/marzvfx/lipdub-mcp#setup',
} as const;
