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

/** Environment variable selecting logging verbosity. */
export const LOG_LEVEL_ENV_VAR = 'LIPDUB_LOG_LEVEL';

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

/**
 * How long a render takes, quoted to agents so they wait rather than give up.
 *
 * Deliberately not a single figure. Generation time scales with the length of the
 * source video, so quoting one range would be wrong for most inputs — it would make
 * an agent abandon a long render that is progressing normally.
 */
export const TYPICAL_RENDER_DURATION_TEXT =
  'several minutes for a short clip, and longer for longer videos';

/** Request timeout for a single upstream HTTP call. */
export const HTTP_TIMEOUT_MILLISECONDS = 30_000;

/** Longest `output_filename` accepted. Also becomes the project name upstream. */
export const MAX_OUTPUT_FILENAME_LENGTH = 200;

/** Longest URL accepted, mirroring the upstream cap. */
export const MAX_URL_LENGTH = 2048;

/**
 * Video container extensions the API accepts.
 *
 * These mirror the ingest gate exactly. Listing a format the API rejects is worse
 * than listing none, because the caller only finds out after the upload has been
 * fetched and the render has failed.
 */
export const SUPPORTED_VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.mov', '.avi'] as const;

/**
 * Audio container extensions the API accepts.
 *
 * `.mp4` and `.mov` appear here as well as in the video list because those
 * containers can legitimately carry an audio-only track.
 */
export const SUPPORTED_AUDIO_EXTENSIONS: readonly string[] = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.mp4',
  '.mov',
] as const;

/**
 * Host suffixes the API resolves as a video-sharing source.
 *
 * These are handled specially upstream: the page itself is HTML rather than a media
 * file, and a dedicated resolver extracts the stream. Passing one of these links
 * therefore works, even though a link to any other web page does not.
 */
export const RESOLVABLE_VIDEO_HOSTS: readonly string[] = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
] as const;

/** Largest source file the API will fetch, on the default plan. */
export const MAX_SOURCE_FILE_SIZE_TEXT = '15 GB (5 GB on the Basic plan)';

/** How long the API waits for both source downloads before giving up. */
export const SOURCE_INGEST_TIMEOUT_TEXT = '15 minutes';

/**
 * Render an extension list as readable prose, e.g. ".mp4, .mov or .avi".
 *
 * The supported formats appear in several tool descriptions and error messages.
 * Deriving that prose from the single list above stops them drifting apart when a
 * format is added or removed — which is exactly the drift that shipped a claim of
 * `.webm` support the API does not have.
 *
 * @param extensions Extensions to list, in the order they should be shown.
 * @returns A comma-separated list with "or" before the final entry.
 */
export function formatExtensionList(extensions: readonly string[]): string {
  if (extensions.length <= 1) {
    return extensions[0] ?? '';
  }
  return `${extensions.slice(0, -1).join(', ')} or ${extensions[extensions.length - 1]}`;
}

/** Customer-facing URLs referenced in errors and docs. */
export const SUPPORT_URLS = {
  app: 'https://app.lipdub.ai',
  apiKeys: 'https://app.lipdub.ai/settings/api-keys',
  docs: 'https://lipdub.readme.io/',
  setupDocs: 'https://github.com/marzvfx/lipdub-mcp#setup',
} as const;
