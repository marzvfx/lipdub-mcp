/**
 * Hand-written types for the parts of the LipDub API this server uses.
 *
 * These are deliberately NOT generated from the public OpenAPI document. That
 * document's descriptions carry internal implementation vocabulary, and generating
 * from it would pull those names into a package that third-party language models
 * read verbatim. See CONTRIBUTING.md.
 *
 * Only the fields this server actually consumes are modelled. Anything else in a
 * response is ignored rather than forwarded, which keeps upstream additions from
 * silently reaching a model's context.
 */

/** Raw status values returned while source assets are being fetched. */
export enum IngestStatus {
  Ingesting = 'ingesting',
  Dispatching = 'dispatching',
  Dispatched = 'dispatched',
  Failed = 'failed',
}

/** Raw status values returned for a render job once it exists. */
export enum RenderJobStatus {
  NotStarted = 'not_started',
  Pending = 'pending',
  Running = 'running',
  Finished = 'finished',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Skipped = 'skipped',
}

/**
 * The single lifecycle vocabulary this server exposes.
 *
 * The API splits a render across two endpoints with two disjoint status vocabularies
 * (four ingest values, seven job values). Agents handle one small vocabulary far
 * better than two overlapping ones, so everything collapses to these five phases.
 */
export enum RenderPhase {
  /** Source video and audio are being downloaded. */
  Preparing = 'preparing',
  /** Accepted and waiting for a render slot. */
  Queued = 'queued',
  /** Actively generating. */
  Rendering = 'rendering',
  /** Finished; a download link is available. */
  Succeeded = 'succeeded',
  /** Ended without producing a video. */
  Failed = 'failed',
}

/** Terminal phases. Once a render reaches one of these it will not change again. */
export const TERMINAL_PHASES: readonly RenderPhase[] = [
  RenderPhase.Succeeded,
  RenderPhase.Failed,
] as const;

/**
 * A render's state, unified across both upstream endpoints.
 *
 * This is the shape every status-returning tool produces.
 */
export interface RenderState {
  /** Opaque handle the caller passes back in. */
  renderId: string;
  /** Numeric job id, once one exists. Findable in the LipDub web app. */
  jobId: number | null;
  /** Current lifecycle phase. */
  status: RenderPhase;
  /** Human-readable, already sanitised explanation when `status` is `failed`. */
  failureReason: string | null;
  /** Signed, short-lived link to the finished video. Only set when `succeeded`. */
  downloadUrl: string | null;
  /** Suggested seconds to wait before checking again. Zero once terminal. */
  nextPollSeconds: number;
}

/** Response body of a successful synchronous render creation (HTTP 201). */
export interface DirectRenderCreated {
  generate_id: number;
  credit?: { balance?: number };
}

/** Response body of an accepted asynchronous render creation (HTTP 202). */
export interface DirectRenderAccepted {
  tracking_id: string;
}

/** Response body of the ingest-tracking endpoint. */
export interface DirectRenderTracking {
  tracking_id: string;
  status: string;
  generate_id?: number | null;
  failure_reason?: string | null;
}

/** Response body of the render-status endpoint. */
export interface RenderStatusBody {
  status: string;
  generate_id: number;
}

/** A single entry from the render-listing endpoint, trimmed to what we surface. */
export interface RenderListEntry {
  generate_id: number;
  shot_file_name?: string | null;
  render_generation_status?: string | null;
}

/** Identity of the account a key belongs to. */
export interface AccountIdentity {
  user_id: number;
  users_tenant_id: number;
  email: string;
}
