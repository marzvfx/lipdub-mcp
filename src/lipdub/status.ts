import { IngestStatus, RenderJobStatus, RenderPhase, TERMINAL_PHASES } from './types.js';

/**
 * Handle encoding and the merged render state machine.
 *
 * The API exposes a render through two different identifiers on two different
 * endpoints. A URL-based render starts life as a `tracking_id` on
 * `/v1/renders/track/{id}` and only later yields a numeric `generate_id`, which must
 * then be polled on `/v1/renders/{id}/status`. Making an agent carry two id types and
 * know when to switch is a reliable source of wrong tool calls, so this module wraps
 * both in one opaque handle and one status vocabulary.
 */

/** Prefix for a handle that refers to a numeric render job. */
const RENDER_JOB_PREFIX = 'rnd_';

/** Prefix for a handle that refers to an in-flight asset ingest. */
const TRACKING_PREFIX = 'trk_';

/** Poll interval while source assets are downloading. */
const PREPARING_POLL_SECONDS = 10;

/**
 * Poll interval while queued or rendering.
 *
 * A render takes 7–15 minutes, so a tight interval buys nothing. Status endpoints are
 * not rate-limited (they fall under the gateway's catch-all), so this is chosen for
 * context economy in the agent's transcript rather than to protect the API.
 */
const RENDERING_POLL_SECONDS = 30;

/** What a handle points at. */
export enum HandleKind {
  /** A numeric render job; poll the render-status endpoint. */
  RenderJob = 'render_job',
  /** An asset ingest that has not yet produced a render job. */
  Tracking = 'tracking',
}

/** A parsed handle. */
export interface ParsedHandle {
  kind: HandleKind;
  /** Numeric job id when `kind` is `RenderJob`. */
  jobId?: number;
  /** Tracking id when `kind` is `Tracking`. */
  trackingId?: string;
}

/** Raised when a handle cannot be interpreted. */
export class InvalidHandleError extends Error {}

/** Build the handle for a numeric render job. */
export function encodeRenderJobHandle(jobId: number): string {
  return `${RENDER_JOB_PREFIX}${jobId}`;
}

/** Build the handle for an in-flight ingest. */
export function encodeTrackingHandle(trackingId: string): string {
  return `${TRACKING_PREFIX}${trackingId}`;
}

/**
 * Interpret a handle produced by this server.
 *
 * A bare integer is accepted as a render job id. Agents routinely echo back the
 * numeric id they saw in a previous result or in the web app, and rejecting that
 * would strand a render the user has already paid for.
 *
 * @param handle Value supplied by the caller.
 * @returns The parsed handle.
 * @throws InvalidHandleError When the value is empty or unrecognisable.
 */
export function parseHandle(handle: string): ParsedHandle {
  const trimmed = (handle ?? '').trim();

  if (trimmed.length === 0) {
    throw new InvalidHandleError('A render id is required.');
  }

  if (trimmed.startsWith(RENDER_JOB_PREFIX)) {
    const jobId = Number.parseInt(trimmed.slice(RENDER_JOB_PREFIX.length), 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new InvalidHandleError(`"${trimmed}" is not a valid render id.`);
    }
    return { kind: HandleKind.RenderJob, jobId };
  }

  if (trimmed.startsWith(TRACKING_PREFIX)) {
    const trackingId = trimmed.slice(TRACKING_PREFIX.length);
    if (trackingId.length === 0) {
      throw new InvalidHandleError(`"${trimmed}" is not a valid render id.`);
    }
    return { kind: HandleKind.Tracking, trackingId };
  }

  if (/^\d+$/.test(trimmed)) {
    return { kind: HandleKind.RenderJob, jobId: Number.parseInt(trimmed, 10) };
  }

  throw new InvalidHandleError(
    `"${trimmed}" is not a render id from this server. Use the render_id returned by lipdub_create_render.`,
  );
}

/**
 * Map an ingest status onto a lifecycle phase.
 *
 * `dispatched` is deliberately absent: it is the handoff signal meaning a render job
 * now exists, so the caller must follow through to the render-status endpoint rather
 * than report a phase. Callers handle that case before calling this.
 *
 * @param status Raw value from the tracking endpoint.
 * @returns The corresponding phase; unknown values are treated as still preparing.
 */
export function phaseFromIngestStatus(status: string): RenderPhase {
  switch (status) {
    case IngestStatus.Ingesting:
    case IngestStatus.Dispatching:
      return RenderPhase.Preparing;
    case IngestStatus.Failed:
      return RenderPhase.Failed;
    default:
      // An unrecognised value means the API grew a state we do not know yet. Staying
      // in `preparing` keeps the caller polling, which converges once it reaches a
      // state we do understand — reporting `failed` would abandon a paid render.
      return RenderPhase.Preparing;
  }
}

/**
 * Map a render job status onto a lifecycle phase.
 *
 * `cancelled` and `skipped` collapse into `failed`: from the caller's perspective all
 * three mean the same thing — no video was produced and no further polling will help.
 *
 * @param status Raw value from the render-status endpoint.
 * @returns The corresponding phase; unknown values are treated as still queued.
 */
export function phaseFromRenderJobStatus(status: string): RenderPhase {
  switch (status) {
    case RenderJobStatus.NotStarted:
    case RenderJobStatus.Pending:
      return RenderPhase.Queued;
    case RenderJobStatus.Running:
      return RenderPhase.Rendering;
    case RenderJobStatus.Finished:
      return RenderPhase.Succeeded;
    case RenderJobStatus.Failed:
    case RenderJobStatus.Cancelled:
    case RenderJobStatus.Skipped:
      return RenderPhase.Failed;
    default:
      // As above: keep polling rather than declaring a paid render dead.
      return RenderPhase.Queued;
  }
}

/** Whether a phase can still change. */
export function isTerminal(phase: RenderPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/**
 * Suggested seconds before the next status check.
 *
 * @param phase Current lifecycle phase.
 * @returns Seconds to wait, or zero when the phase is terminal.
 */
export function nextPollSeconds(phase: RenderPhase): number {
  if (isTerminal(phase)) {
    return 0;
  }
  return phase === RenderPhase.Preparing ? PREPARING_POLL_SECONDS : RENDERING_POLL_SECONDS;
}
