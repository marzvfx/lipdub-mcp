import { describe, expect, it } from 'vitest';
import { LipDubClient } from '../src/lipdub/client.js';
import { LipDubErrorCode } from '../src/lipdub/errors.js';
import { RenderService } from '../src/lipdub/renders.js';
import { RenderPhase } from '../src/lipdub/types.js';
import { Logger, LogLevel } from '../src/logging.js';

/**
 * Exercises the unified state machine against a scripted API.
 *
 * These are the behaviours that justify the MCP layer existing at all: hiding the
 * two-endpoint handoff, and never asking for a download link before one exists.
 */

interface ScriptedResponse {
  status?: number;
  body?: unknown;
  contentType?: string;
}

/** Build a client whose fetch answers from a path-keyed script, recording calls. */
function scriptedClient(script: Record<string, ScriptedResponse | ScriptedResponse[]>): {
  service: RenderService;
  calls: string[];
} {
  const calls: string[] = [];
  const cursors: Record<string, number> = {};

  const fetchImplementation = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace('https://api.lipdub.ai', '');
    calls.push(path);

    const entry = script[path];
    if (entry === undefined) {
      return new Response('{}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // An array lets a single path return a different answer on each successive call,
    // which is how a render progressing through phases is simulated.
    let chosen: ScriptedResponse;
    if (Array.isArray(entry)) {
      const index = Math.min(cursors[path] ?? 0, entry.length - 1);
      cursors[path] = index + 1;
      chosen = entry[index] as ScriptedResponse;
    } else {
      chosen = entry;
    }

    const contentType = chosen.contentType ?? 'application/json';
    const payload =
      contentType === 'application/json' ? JSON.stringify(chosen.body ?? {}) : String(chosen.body);

    return new Response(payload, {
      status: chosen.status ?? 200,
      headers: { 'content-type': contentType },
    });
  }) as unknown as typeof fetch;

  const client = new LipDubClient({
    apiKey: 'test-key-0000000000',
    logger: new Logger(LogLevel.Error),
    fetchImplementation,
  });

  return { service: new RenderService(client), calls };
}

describe('create', () => {
  it('returns a tracking handle for a URL-based render (HTTP 202)', async () => {
    const { service } = scriptedClient({
      '/v1/renders': { status: 202, body: { data: { tracking_id: 'abc' } } },
    });

    const result = await service.create({
      videoUrl: 'https://x.test/v.mp4',
      audioUrl: 'https://x.test/a.mp3',
      outputFilename: 'out.mp4',
    });

    expect(result.renderId).toBe('trk_abc');
    expect(result.status).toBe(RenderPhase.Preparing);
    expect(result.creditsRemaining).toBeNull();
  });

  it('returns a render-job handle and the new balance for an id-based render (HTTP 201)', async () => {
    const { service } = scriptedClient({
      '/v1/renders': {
        status: 201,
        body: { data: { generate_id: 42, credit: { balance: 17.5 } } },
      },
    });

    const result = await service.create({
      videoId: 1,
      audioId: 'a1',
      outputFilename: 'out.mp4',
    });

    expect(result.renderId).toBe('rnd_42');
    expect(result.jobId).toBe(42);
    expect(result.status).toBe(RenderPhase.Queued);
    expect(result.creditsRemaining).toBe(17.5);
  });
});

describe('getState', () => {
  it('reports preparing while assets are still downloading', async () => {
    const { service, calls } = scriptedClient({
      '/v1/renders/track/abc': { body: { data: { tracking_id: 'abc', status: 'ingesting' } } },
    });

    const state = await service.getState('trk_abc');

    expect(state.status).toBe(RenderPhase.Preparing);
    expect(state.downloadUrl).toBeNull();
    // Crucially, no download call while unfinished.
    expect(calls).toEqual(['/v1/renders/track/abc']);
  });

  it('follows the ingest-to-render handoff in a single call', async () => {
    // This is the seam the MCP layer exists to hide: upstream, `dispatched` means the
    // caller must switch to a different endpoint keyed by a different id.
    const { service, calls } = scriptedClient({
      '/v1/renders/track/abc': {
        body: { data: { tracking_id: 'abc', status: 'dispatched', generate_id: 77 } },
      },
      '/v1/renders/77/status': { body: { data: { status: 'running', generate_id: 77 } } },
    });

    const state = await service.getState('trk_abc');

    expect(state.status).toBe(RenderPhase.Rendering);
    expect(state.jobId).toBe(77);
    // The handle is upgraded, so the next poll costs one request instead of two.
    expect(state.renderId).toBe('rnd_77');
    expect(calls).toEqual(['/v1/renders/track/abc', '/v1/renders/77/status']);
  });

  it('fetches a download link only once the render is finished', async () => {
    const { service, calls } = scriptedClient({
      '/v1/renders/77/status': { body: { data: { status: 'finished', generate_id: 77 } } },
      '/v1/renders/77/download': { body: { data: { download_url: 'https://signed.test/out.mp4' } } },
    });

    const state = await service.getState('rnd_77');

    expect(state.status).toBe(RenderPhase.Succeeded);
    expect(state.downloadUrl).toBe('https://signed.test/out.mp4');
    expect(calls).toContain('/v1/renders/77/download');
  });

  it('never calls download while queued, so the upstream 400 is unreachable', async () => {
    const { service, calls } = scriptedClient({
      '/v1/renders/77/status': { body: { data: { status: 'pending', generate_id: 77 } } },
    });

    const state = await service.getState('rnd_77');

    expect(state.status).toBe(RenderPhase.Queued);
    expect(calls.some((path) => path.includes('/download'))).toBe(false);
  });

  it('translates a known ingest failure and does not echo the upstream reason', async () => {
    const { service } = scriptedClient({
      '/v1/renders/track/abc': {
        body: {
          data: { tracking_id: 'abc', status: 'failed', failure_reason: 'asset download failed' },
        },
      },
    });

    const state = await service.getState('trk_abc');

    expect(state.status).toBe(RenderPhase.Failed);
    expect(state.failureReason).toContain('could not download');
    expect(state.failureReason).toContain('Nothing was charged');
  });

  it('falls back to a fixed message for an unrecognised failure reason', async () => {
    const { service } = scriptedClient({
      '/v1/renders/track/abc': {
        body: {
          data: {
            tracking_id: 'abc',
            status: 'failed',
            failure_reason: 'some new internal reason',
          },
        },
      },
    });

    const state = await service.getState('trk_abc');

    expect(state.status).toBe(RenderPhase.Failed);
    // The upstream string must not be forwarded — that is how internal names escape.
    expect(state.failureReason).not.toContain('some new internal reason');
    expect(state.failureReason).toContain('could not prepare your source files');
  });

  it.each(['cancelled', 'skipped'])('treats %s as failed, since no video was produced', async (raw) => {
    const { service } = scriptedClient({
      '/v1/renders/9/status': { body: { data: { status: raw, generate_id: 9 } } },
    });

    const state = await service.getState('rnd_9');
    expect(state.status).toBe(RenderPhase.Failed);
  });
});

describe('error translation through the client', () => {
  it('turns an HTML 5xx into a service-unavailable error rather than a parse failure', async () => {
    const { service } = scriptedClient({
      '/v1/renders/1/status': {
        status: 502,
        contentType: 'text/html',
        body: '<html><head><meta http-equiv="refresh" /></head></html>',
      },
    });

    await expect(service.getState('rnd_1')).rejects.toMatchObject({
      code: LipDubErrorCode.ServiceUnavailable,
    });
  });

  it('surfaces a bad key as an actionable setup error', async () => {
    const { service } = scriptedClient({
      '/v1/whoami': { status: 403, body: { message: 'Forbidden' } },
    });

    await expect(service.whoAmI()).rejects.toMatchObject({
      code: LipDubErrorCode.InvalidApiKey,
    });
  });
});

describe('list', () => {
  it('trims deeply nested upstream entries to four flat fields', async () => {
    const { service } = scriptedClient({
      '/v1/renders?page=1&page_size=2': {
        body: {
          data: [
            {
              generate_id: 5,
              shot_file_name: 'keynote.mp4',
              render_generation_status: 'finished',
              // Fields that must not be forwarded into the model's context.
              render: { nested: { lots: 'of detail' } },
              dubs: [{ more: 'detail' }],
            },
          ],
        },
      },
    });

    const renders = await service.list(2);

    expect(renders).toEqual([
      {
        renderId: 'rnd_5',
        jobId: 5,
        outputFilename: 'keynote.mp4',
        status: RenderPhase.Succeeded,
      },
    ]);
  });
});
