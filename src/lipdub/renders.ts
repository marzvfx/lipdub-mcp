import { sanitizeUpstreamText } from '../redaction/redact.js';
import { LipDubClient, unwrapData } from './client.js';
import { explainIngestFailure, LipDubErrorCode, lipdubError } from './errors.js';
import {
  encodeRenderJobHandle,
  encodeTrackingHandle,
  HandleKind,
  nextPollSeconds,
  parseHandle,
  phaseFromIngestStatus,
  phaseFromRenderJobStatus,
} from './status.js';
import {
  AccountIdentity,
  DirectRenderAccepted,
  DirectRenderCreated,
  DirectRenderTracking,
  IngestStatus,
  RenderListEntry,
  RenderPhase,
  RenderState,
  RenderStatusBody,
} from './types.js';

/**
 * Render operations, expressed in this server's own vocabulary.
 *
 * The important piece is {@link RenderService.getState}, which hides the API's
 * two-endpoint, two-vocabulary status flow behind a single call.
 */

/** Used when the API reports an ingest failure whose reason we do not recognise. */
const GENERIC_INGEST_FAILURE_MESSAGE = [
  'LipDub could not prepare your source files, so the render did not start. Nothing was charged.',
  '',
  'Check that both links are direct, publicly reachable, and return the media file',
  'itself rather than a web page, then try again.',
].join('\n');

/** Everything needed to start a render. */
export interface CreateRenderInput {
  videoUrl?: string;
  videoId?: number;
  audioUrl?: string;
  audioId?: string;
  outputFilename: string;
  transcript?: string;
  callbackUrl?: string;
}

/** Outcome of starting a render. */
export interface CreateRenderOutput {
  renderId: string;
  jobId: number | null;
  status: RenderPhase;
  outputFilename: string;
  /** Remaining balance, only reported when the API returned one. */
  creditsRemaining: number | null;
  nextPollSeconds: number;
}

export class RenderService {
  constructor(private readonly client: LipDubClient) {}

  /**
   * Start a render.
   *
   * The API answers either 201 (both sides were already-uploaded ids, so the render
   * is dispatched immediately) or 202 (at least one side is a URL, so the assets are
   * fetched first). Both are normalised into one shape here.
   *
   * @param input Validated render request.
   * @returns The new render's handle and initial phase.
   */
  async create(input: CreateRenderInput): Promise<CreateRenderOutput> {
    const requestBody: Record<string, unknown> = {
      output_filename: input.outputFilename,
    };

    if (input.videoUrl !== undefined) requestBody.video_url = input.videoUrl;
    if (input.videoId !== undefined) requestBody.video_id = input.videoId;
    if (input.audioUrl !== undefined) requestBody.audio_url = input.audioUrl;
    if (input.audioId !== undefined) requestBody.audio_id = input.audioId;
    if (input.transcript !== undefined) requestBody.transcript = input.transcript;
    if (input.callbackUrl !== undefined) requestBody.callback_url = input.callbackUrl;

    const body = await this.client.post<Record<string, unknown>>('/v1/renders', requestBody);
    const data = unwrapData<Partial<DirectRenderCreated & DirectRenderAccepted>>(body);

    if (typeof data?.tracking_id === 'string') {
      return {
        renderId: encodeTrackingHandle(data.tracking_id),
        jobId: null,
        status: RenderPhase.Preparing,
        outputFilename: input.outputFilename,
        creditsRemaining: null,
        nextPollSeconds: nextPollSeconds(RenderPhase.Preparing),
      };
    }

    if (typeof data?.generate_id === 'number') {
      return {
        renderId: encodeRenderJobHandle(data.generate_id),
        jobId: data.generate_id,
        status: RenderPhase.Queued,
        outputFilename: input.outputFilename,
        creditsRemaining: typeof data.credit?.balance === 'number' ? data.credit.balance : null,
        nextPollSeconds: nextPollSeconds(RenderPhase.Queued),
      };
    }

    throw lipdubError(LipDubErrorCode.Unexpected);
  }

  /**
   * Resolve a render's current state from either kind of handle.
   *
   * For a tracking handle this follows the ingest endpoint and, once the ingest has
   * produced a render job, continues straight into the job's status in the same call.
   * The returned `renderId` is then the render-job handle, so subsequent polls cost
   * one request instead of two. Older tracking handles keep working, because
   * {@link parseHandle} accepts both.
   *
   * @param handle Handle from a previous call, or a bare numeric render id.
   * @returns The unified state, including a download link once finished.
   */
  async getState(handle: string): Promise<RenderState> {
    const parsed = parseHandle(handle);

    if (parsed.kind === HandleKind.Tracking) {
      return this.resolveFromTracking(parsed.trackingId as string);
    }

    return this.resolveFromRenderJob(parsed.jobId as number);
  }

  private async resolveFromTracking(trackingId: string): Promise<RenderState> {
    const body = await this.client.get<Record<string, unknown>>(
      `/v1/renders/track/${encodeURIComponent(trackingId)}`,
    );
    const tracking = unwrapData<DirectRenderTracking>(body);
    const rawStatus = (tracking?.status ?? '').toLowerCase();

    // The ingest has produced a render job: continue into the job's own status so the
    // caller sees one continuous lifecycle rather than a handoff.
    if (rawStatus === IngestStatus.Dispatched && typeof tracking.generate_id === 'number') {
      return this.resolveFromRenderJob(tracking.generate_id);
    }

    const phase = phaseFromIngestStatus(rawStatus);

    return {
      renderId: encodeTrackingHandle(trackingId),
      jobId: typeof tracking.generate_id === 'number' ? tracking.generate_id : null,
      status: phase,
      // Only our own explanations are surfaced. An unrecognised upstream reason falls
      // back to a fixed message rather than being echoed, because upstream error text
      // is exactly where internal names would leak.
      failureReason:
        phase === RenderPhase.Failed
          ? (explainIngestFailure(tracking.failure_reason) ?? GENERIC_INGEST_FAILURE_MESSAGE)
          : null,
      downloadUrl: null,
      nextPollSeconds: nextPollSeconds(phase),
    };
  }

  private async resolveFromRenderJob(jobId: number): Promise<RenderState> {
    const body = await this.client.get<Record<string, unknown>>(`/v1/renders/${jobId}/status`);
    const statusBody = unwrapData<RenderStatusBody>(body);
    const phase = phaseFromRenderJobStatus((statusBody?.status ?? '').toLowerCase());

    // Only ask for a link once the render is finished. The download endpoint returns
    // 400 before then, so gating here makes that error unreachable through this
    // server rather than something the agent has to learn to avoid.
    const downloadUrl =
      phase === RenderPhase.Succeeded ? await this.fetchDownloadUrl(jobId) : null;

    return {
      renderId: encodeRenderJobHandle(jobId),
      jobId,
      status: phase,
      failureReason:
        phase === RenderPhase.Failed
          ? 'The render ended without producing a video. This is usually a source video with no clearly visible speaking face, or an interrupted render. Try again with a different source video.'
          : null,
      downloadUrl,
      nextPollSeconds: nextPollSeconds(phase),
    };
  }

  private async fetchDownloadUrl(jobId: number): Promise<string | null> {
    const body = await this.client.get<Record<string, unknown>>(`/v1/renders/${jobId}/download`);
    const data = unwrapData<{ download_url?: string }>(body);
    return typeof data?.download_url === 'string' ? data.download_url : null;
  }

  /**
   * List recent renders on the account.
   *
   * The upstream entries carry deeply nested project, scene and dub objects. Only
   * four flat fields are kept: the rest would cost a great deal of the agent's
   * context for no benefit, and forwarding unmodelled upstream data is exactly how
   * internal vocabulary escapes.
   *
   * @param limit Maximum entries to return.
   * @returns Trimmed summaries, newest first as returned by the API.
   */
  async list(limit: number): Promise<
    Array<{ renderId: string; jobId: number; outputFilename: string; status: RenderPhase }>
  > {
    const body = await this.client.get<Record<string, unknown>>(
      `/v1/renders?page=1&page_size=${limit}`,
    );
    const entries = unwrapData<RenderListEntry[]>(body);

    if (!Array.isArray(entries)) {
      return [];
    }

    return entries.slice(0, limit).map((entry) => ({
      renderId: encodeRenderJobHandle(entry.generate_id),
      jobId: entry.generate_id,
      outputFilename: sanitizeUpstreamText(entry.shot_file_name, 200),
      status: phaseFromRenderJobStatus((entry.render_generation_status ?? '').toLowerCase()),
    }));
  }

  /**
   * Confirm the key works and identify the account.
   *
   * @returns The tenant id. The account email is deliberately not returned to the
   *   caller — see the tool layer.
   */
  async whoAmI(): Promise<AccountIdentity> {
    const body = await this.client.get<Record<string, unknown>>('/v1/whoami');
    return unwrapData<AccountIdentity>(body);
  }
}
