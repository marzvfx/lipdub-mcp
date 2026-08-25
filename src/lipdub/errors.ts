/**
 * Error translation.
 *
 * Two rules govern this module.
 *
 * 1. **Allowlist, never denylist.** Upstream error bodies may carry internal detail —
 *    exception class names, component names, stack fragments. We therefore never
 *    forward an upstream message. Every failure maps onto one of the fixed messages
 *    below, and anything unrecognised collapses to a single generic string. A
 *    denylist would fail the first time someone upstream adds a new internal noun.
 *
 * 2. **Every message ends with the next action.** These strings are read by a
 *    language model that must decide what to do next. "Invalid request" produces a
 *    stuck agent; "provide a direct link to an .mp4, then call X again" does not.
 */

import {
  formatExtensionList,
  MAX_SOURCE_FILE_SIZE_TEXT,
  SUPPORT_URLS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from './constants.js';

/** Stable machine-readable codes. Safe to expose; they name no internal component. */
export enum LipDubErrorCode {
  NoApiKey = 'no_api_key',
  InvalidApiKey = 'invalid_api_key',
  OutOfCredits = 'out_of_credits',
  RateLimited = 'rate_limited',
  SpendNotConfirmed = 'spend_not_confirmed',
  MissingSource = 'missing_source',
  ConflictingSource = 'conflicting_source',
  LocalPathNotSupported = 'local_path_not_supported',
  UnreachableSourceUrl = 'unreachable_source_url',
  UnsupportedMedia = 'unsupported_media',
  SourceDownloadFailed = 'source_download_failed',
  RenderCouldNotStart = 'render_could_not_start',
  IngestTimedOut = 'ingest_timed_out',
  NotFinished = 'not_finished',
  NotFound = 'not_found',
  ServiceUnavailable = 'service_unavailable',
  Unexpected = 'unexpected',
}

/**
 * An error safe to hand to a language model.
 *
 * Carries only a fixed code, one of our own messages, and an optional upstream
 * request id for support. It never carries an upstream body.
 */
export class LipDubError extends Error {
  readonly code: LipDubErrorCode;
  readonly requestId: string | null;

  constructor(code: LipDubErrorCode, message: string, requestId: string | null = null) {
    super(message);
    this.name = 'LipDubError';
    this.code = code;
    this.requestId = requestId;
  }

  /** Render for a tool result, appending the request id when one is available. */
  toToolMessage(): string {
    return this.requestId ? `${this.message}\n\n(Reference: ${this.requestId})` : this.message;
  }
}

/** Fixed message for each code. */
const MESSAGES: Readonly<Record<LipDubErrorCode, string>> = {
  [LipDubErrorCode.NoApiKey]: [
    "No LipDub API key is configured, so I can't reach your LipDub account.",
    '',
    'To set one up:',
    `1. Sign in at ${SUPPORT_URLS.app}`,
    `2. Open Settings → API Keys: ${SUPPORT_URLS.apiKeys}`,
    '   You must be an Owner or Admin on the account. Other roles are redirected to the',
    '   dashboard with no message — if that link bounces you, ask an Owner or Admin on',
    '   your team to generate the key.',
    '3. Click to generate a key and copy it.',
    '4. Set it as the LIPDUB_API_KEY environment variable for this MCP server and',
    `   restart your client. Per-client snippets: ${SUPPORT_URLS.setupDocs}`,
    '',
    'Heads-up: LipDub issues one API key per user, and generating a new one replaces',
    'the old one. If this account already uses its key for another integration,',
    'generating a fresh key will break it — reuse the existing key instead.',
  ].join('\n'),

  [LipDubErrorCode.InvalidApiKey]: [
    'LipDub rejected the API key. It may be mistyped, or it may have been regenerated',
    'or deleted since it was copied.',
    '',
    'You cannot fix this yourself — it needs a change to the server configuration, so',
    'relay these steps to the user:',
    `1. Go to ${SUPPORT_URLS.apiKeys} (Owner or Admin only)`,
    '2. Generate a fresh key and copy it',
    '3. Update the LIPDUB_API_KEY environment variable for this MCP server',
    '4. Restart the client',
    '',
    'Warning to pass on: generating a new key replaces the old one everywhere, so any',
    'other integration using that key will stop working.',
    '',
    'Once they have done that, call lipdub_check_connection to confirm it worked before',
    'retrying anything that costs credits.',
  ].join('\n'),

  [LipDubErrorCode.OutOfCredits]: [
    'This render was not started because the account is out of credits. Nothing was charged.',
    '',
    `Top up at ${SUPPORT_URLS.app}, then call lipdub_create_render again. Render cost`,
    'scales with the length of the source video, so a shorter clip costs less.',
  ].join('\n'),

  [LipDubErrorCode.RateLimited]: [
    'LipDub rate-limited this request.',
    '',
    'Any render already in progress is unaffected, and checking status is never',
    'rate-limited — keep using lipdub_get_render.',
    '',
    'Wait about 60 seconds before retrying this call. If it keeps happening, the',
    'account has hit its plan limit and the account owner can request a higher one.',
  ].join('\n'),

  // Worded to counter the specific failure this gate exists to prevent: a model that
  // reads "ask the user", agrees with itself, and immediately retries with the flag
  // set. Hence the explicit prohibition rather than a polite instruction.
  [LipDubErrorCode.SpendNotConfirmed]: [
    'STOP. This spends the user\'s money and needs their approval first.',
    '',
    'A LipDub 2 render charges credits to the account and CANNOT be undone or refunded.',
    'The cost scales with the length of the source video.',
    '',
    'Do NOT call this tool again with confirm_spend set to true on your own authority.',
    'Setting that flag yourself is not consent — it spends real money the user has not',
    'agreed to spend.',
    '',
    'Instead, reply to the user now and ask them, in words like these:',
    '  "Rendering this will charge credits to your LipDub account and cannot be',
    '   refunded. Do you want me to go ahead?"',
    '',
    'Then wait for their answer. Only if they say yes, call lipdub_create_render again',
    'with confirm_spend set to true.',
  ].join('\n'),

  [LipDubErrorCode.MissingSource]: [
    'lipdub_create_render needs both a source video and a target audio track.',
    '',
    'Provide video_url (a direct link to a video of the person) and audio_url (a direct',
    'link to the audio you want them to appear to say).',
    '',
    'LipDub 2 does not translate or generate speech. If the user wants another',
    'language, create that audio first with a text-to-speech or voice tool, host it at',
    'a URL, and pass that URL as audio_url.',
  ].join('\n'),

  [LipDubErrorCode.ConflictingSource]: [
    'Provide either a URL or an id for each side, not both.',
    '',
    'Use video_url and audio_url for files on the internet. Use video_id or audio_id',
    'only if you already have ids from an earlier upload to LipDub.',
  ].join('\n'),

  [LipDubErrorCode.LocalPathNotSupported]: [
    'That looks like a local file path, but LipDub needs a URL it can download from',
    'the internet.',
    '',
    'Upload the file somewhere publicly reachable — an S3 pre-signed link, Google Cloud',
    'Storage, or any web server — and pass that link instead. This server does not',
    'upload local files.',
  ].join('\n'),

  [LipDubErrorCode.UnreachableSourceUrl]: [
    'That URL points to a private or internal network address, which LipDub cannot',
    'reach. Please provide a publicly accessible https link.',
  ].join('\n'),

  [LipDubErrorCode.UnsupportedMedia]: [
    `LipDub can't accept that file. The source video must be ${formatExtensionList(SUPPORTED_VIDEO_EXTENSIONS)},`,
    `and the audio must be ${formatExtensionList(SUPPORTED_AUDIO_EXTENSIONS)}, each served with a`,
    'matching content type.',
    '',
    'Please provide direct links to supported formats.',
  ].join('\n'),

  [LipDubErrorCode.SourceDownloadFailed]: [
    'LipDub could not download one of your source files. Nothing was charged.',
    '',
    'Both links must be publicly reachable, and must return the media file itself',
    'rather than a web page. YouTube links are the exception — those are resolved for',
    'you and do work.',
    '',
    'The usual causes are a Google Drive or Dropbox share page instead of a direct file',
    'link, a link that requires a login, a link that has expired, or a file larger than',
    `${MAX_SOURCE_FILE_SIZE_TEXT}.`,
    '',
    'Check both URLs and call lipdub_create_render again.',
  ].join('\n'),

  [LipDubErrorCode.RenderCouldNotStart]: [
    'LipDub downloaded your files but could not start the render.',
    '',
    'The two most common causes are an empty credit balance, and a source video that',
    "does not show one clearly visible speaking face. Check the account's credit",
    `balance at ${SUPPORT_URLS.app} first. If there are credits available, try a`,
    'different source video — a single person, face on camera, well lit.',
  ].join('\n'),

  [LipDubErrorCode.IngestTimedOut]: [
    'The render timed out while preparing your files — LipDub waits up to 15 minutes',
    'for both downloads to finish. Nothing was charged.',
    '',
    'This usually means one of the source URLs was very slow or stopped responding.',
    'Try again with smaller files, or with links on faster hosting.',
  ].join('\n'),

  [LipDubErrorCode.NotFinished]: [
    "That render isn't finished yet, so there is no file to download.",
    '',
    'A LipDub 2 render usually takes 7–15 minutes. Call lipdub_wait_for_render with the',
    'same render id — checking costs nothing and is never rate-limited.',
  ].join('\n'),

  [LipDubErrorCode.NotFound]: [
    'LipDub has no render with that id on this account.',
    '',
    'Check the id, or call lipdub_list_renders to see recent renders and their ids.',
  ].join('\n'),

  [LipDubErrorCode.ServiceUnavailable]: [
    "LipDub's API is temporarily unavailable. This is not a problem with your request.",
    '',
    'Wait about a minute and try again. If a render was already created it is',
    'unaffected — use lipdub_get_render to check on it.',
  ].join('\n'),

  [LipDubErrorCode.Unexpected]: [
    'LipDub returned an unexpected response, so this request did not complete.',
    '',
    'Wait a moment and try again. If a render was already created it is unaffected —',
    'use lipdub_get_render to check on it.',
  ].join('\n'),
};

/**
 * Build a translated error.
 *
 * @param code Which failure occurred.
 * @param requestId Upstream correlation id, when the response carried one.
 * @param detail Extra caller-facing context appended to the fixed message. Must be
 *   generated by this package — never an upstream body.
 * @returns An error safe to return to a language model.
 */
export function lipdubError(
  code: LipDubErrorCode,
  requestId: string | null = null,
  detail?: string,
): LipDubError {
  const base = MESSAGES[code];
  return new LipDubError(code, detail ? `${base}\n\n${detail}` : base, requestId);
}

/**
 * Classify an HTTP failure response.
 *
 * Two upstream quirks are handled here, both verified against the live API:
 *
 * - A bad key returns **403**, not 401, and it shares that status with the
 *   out-of-credits condition. They are told apart by envelope shape: the gateway's
 *   rejection is `{"message": "Forbidden"}` with no `detail`, whereas the application
 *   returns a `detail` field.
 * - 5xx responses are served as **HTML**, not JSON, so the body is not parsed for
 *   them at all.
 *
 * @param status HTTP status code.
 * @param body Parsed JSON body, or null when the body was not JSON.
 * @param requestId Upstream correlation id, when present.
 * @returns The translated error.
 */
export function classifyHttpFailure(
  status: number,
  body: Record<string, unknown> | null,
  requestId: string | null = null,
): LipDubError {
  if (status >= 500) {
    return lipdubError(LipDubErrorCode.ServiceUnavailable, requestId);
  }

  if (status === 429) {
    return lipdubError(LipDubErrorCode.RateLimited, requestId);
  }

  if (status === 404) {
    return lipdubError(LipDubErrorCode.NotFound, requestId);
  }

  // Application-level credit rejections.
  if (status === 402 || status === 424) {
    return lipdubError(LipDubErrorCode.OutOfCredits, requestId);
  }

  if (status === 401 || status === 403) {
    const hasApplicationDetail = typeof body?.detail === 'string';
    // A `detail` field means the request authenticated and the application rejected
    // it; on this endpoint set that means credits. No `detail` means the gateway
    // rejected the key itself.
    return hasApplicationDetail
      ? lipdubError(LipDubErrorCode.OutOfCredits, requestId)
      : lipdubError(LipDubErrorCode.InvalidApiKey, requestId);
  }

  if (status === 400) {
    return lipdubError(LipDubErrorCode.NotFinished, requestId);
  }

  return lipdubError(LipDubErrorCode.Unexpected, requestId);
}

/** Upstream `failure_reason` strings, which are a small deliberate set. */
const INGEST_FAILURE_REASONS: Readonly<Record<string, LipDubErrorCode>> = {
  'asset download failed': LipDubErrorCode.SourceDownloadFailed,
  'render dispatch failed': LipDubErrorCode.RenderCouldNotStart,
  'request timed out': LipDubErrorCode.IngestTimedOut,
};

/**
 * Translate an upstream ingest failure reason into a caller-facing explanation.
 *
 * @param reason Raw `failure_reason` from the tracking endpoint.
 * @returns Our own explanation, or null when the reason is not one we recognise.
 */
export function explainIngestFailure(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  const code = INGEST_FAILURE_REASONS[reason.trim().toLowerCase()];
  return code ? MESSAGES[code] : null;
}
