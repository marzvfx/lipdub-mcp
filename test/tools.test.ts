import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { LipDubClient } from '../src/lipdub/client.js';
import { RenderService } from '../src/lipdub/renders.js';
import { Logger, LogLevel } from '../src/logging.js';
import { createServer } from '../src/server.js';
import { DEFAULT_MAX_WAIT_SECONDS } from '../src/tools/wait-for-render.js';
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';

/**
 * Tool-level tests driven through a real MCP client over an in-memory transport.
 *
 * These exercise the actual registered tools — schema coercion, annotations, the
 * result envelope — rather than calling the handler functions directly, so they catch
 * the class of bug that only appears once the SDK is in the loop.
 */

interface ScriptedResponse {
  status?: number;
  body?: unknown;
  contentType?: string;
}

interface Harness {
  client: Client;
  calls: string[];
  context: ServerContext;
}

/** Stand up a server + client pair backed by a scripted API. */
async function connect(
  script: Record<string, ScriptedResponse | ScriptedResponse[]>,
  overrides: Partial<ServerContext> = {},
): Promise<Harness> {
  const calls: string[] = [];
  const cursors: Record<string, number> = {};

  const fetchImplementation = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace('https://api.lipdub.ai', '');
    calls.push(path);

    const entry = script[path];
    if (entry === undefined) {
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }

    let chosen: ScriptedResponse;
    if (Array.isArray(entry)) {
      const index = Math.min(cursors[path] ?? 0, entry.length - 1);
      cursors[path] = index + 1;
      chosen = entry[index] as ScriptedResponse;
    } else {
      chosen = entry;
    }

    const contentType = chosen.contentType ?? 'application/json';
    return new Response(
      contentType === 'application/json' ? JSON.stringify(chosen.body ?? {}) : String(chosen.body),
      { status: chosen.status ?? 200, headers: { 'content-type': contentType } },
    );
  }) as unknown as typeof fetch;

  const logger = new Logger(LogLevel.Error);
  const lipdubClient = new LipDubClient({
    apiKey: 'test-key-0000000000',
    logger,
    fetchImplementation,
  });

  const context: ServerContext = {
    client: lipdubClient,
    renders: new RenderService(lipdubClient),
    logger,
    requireSpendConfirmation: true,
    maxRendersPerSession: 5,
    rendersStarted: 0,
    ...overrides,
  };

  const server = createServer(context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, calls, context };
}

/** Extract the text content of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

function structuredOf(result: unknown): Record<string, unknown> {
  return ((result as { structuredContent?: Record<string, unknown> }).structuredContent ??
    {}) as Record<string, unknown>;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

const CREATE_ARGS = {
  video_url: 'https://example.test/source.mp4',
  audio_url: 'https://example.test/target.mp3',
};

describe('the advertised surface', () => {
  it('exposes exactly the five documented tools', async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'lipdub_check_connection',
      'lipdub_create_render',
      'lipdub_get_render',
      'lipdub_list_renders',
      'lipdub_wait_for_render',
    ]);
  });

  it('marks every read-only tool as read-only, and the spending one as not', async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    // Defaults in the protocol are the unsafe ones, so these must be set explicitly.
    for (const name of [
      'lipdub_check_connection',
      'lipdub_get_render',
      'lipdub_wait_for_render',
      'lipdub_list_renders',
    ]) {
      expect(byName[name]?.annotations?.readOnlyHint, name).toBe(true);
    }

    const create = byName.lipdub_create_render;
    expect(create?.annotations?.readOnlyHint).toBe(false);
    // Not idempotent is the load-bearing one: calling twice charges twice.
    expect(create?.annotations?.idempotentHint).toBe(false);
    // The title carries the cost warning, because most clients surface the title.
    expect(create?.annotations?.title).toContain('credits');
  });

  it('tells the model up front that it does not translate', async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    const create = tools.find((tool) => tool.name === 'lipdub_create_render');

    // The most expensive agent mistake is assuming "dub" means "translate" and
    // rendering the original audio under a foreign-language filename.
    expect(create?.description).toMatch(/does NOT translate/i);
  });
});

describe('spend gate', () => {
  it('refuses to render until the user has confirmed', async () => {
    const { client, calls } = await connect({
      '/v1/renders': { status: 202, body: { data: { tracking_id: 'abc' } } },
    });

    const result = await client.callTool({ name: 'lipdub_create_render', arguments: CREATE_ARGS });

    expect(isError(result)).toBe(true);
    // Nothing was spent: the gate runs before any upstream call.
    expect(calls).toEqual([]);
  });

  it('tells the model in plain terms not to confirm on its own behalf', async () => {
    const { client } = await connect({});
    const result = await client.callTool({ name: 'lipdub_create_render', arguments: CREATE_ARGS });
    const text = textOf(result);

    expect(text).toContain('STOP');
    expect(text).toMatch(/do NOT call this tool again with confirm_spend/i);
    expect(text).toMatch(/wait for their answer/i);
  });

  it('proceeds once confirmed', async () => {
    const { client, calls } = await connect({
      '/v1/renders': { status: 202, body: { data: { tracking_id: 'abc' } } },
    });

    const result = await client.callTool({
      name: 'lipdub_create_render',
      arguments: { ...CREATE_ARGS, confirm_spend: true },
    });

    expect(isError(result)).toBe(false);
    expect(structuredOf(result).render_id).toBe('trk_abc');
    expect(calls).toEqual(['/v1/renders']);
  });

  it('can be disabled for unattended pipelines', async () => {
    const { client } = await connect(
      { '/v1/renders': { status: 202, body: { data: { tracking_id: 'abc' } } } },
      { requireSpendConfirmation: false },
    );

    const result = await client.callTool({ name: 'lipdub_create_render', arguments: CREATE_ARGS });
    expect(isError(result)).toBe(false);
  });

  it('stops once the per-session ceiling is reached', async () => {
    const { client } = await connect(
      { '/v1/renders': { status: 202, body: { data: { tracking_id: 'abc' } } } },
      { maxRendersPerSession: 1 },
    );

    const first = await client.callTool({
      name: 'lipdub_create_render',
      arguments: { ...CREATE_ARGS, confirm_spend: true },
    });
    expect(isError(first)).toBe(false);

    const second = await client.callTool({
      name: 'lipdub_create_render',
      arguments: { ...CREATE_ARGS, confirm_spend: true },
    });
    expect(isError(second)).toBe(true);
    expect(textOf(second)).toMatch(/limit/i);
  });

  it('does not consume session budget when the render fails to start', async () => {
    const { client, context } = await connect({
      '/v1/renders': { status: 402, body: { detail: 'no credits' } },
    });

    await client.callTool({
      name: 'lipdub_create_render',
      arguments: { ...CREATE_ARGS, confirm_spend: true },
    });

    expect(context.rendersStarted).toBe(0);
  });
});

describe('local paths are rejected before any spend', () => {
  it.each(['./clip.mp4', '/home/me/clip.mp4', 'C:\\Users\\me\\clip.mp4', 'file:///tmp/clip.mp4'])(
    'rejects %o with an actionable message',
    async (path) => {
      const { client, calls } = await connect({});

      const result = await client.callTool({
        name: 'lipdub_create_render',
        arguments: { ...CREATE_ARGS, video_url: path, confirm_spend: true },
      });

      expect(isError(result)).toBe(true);
      expect(textOf(result)).toMatch(/local file path/i);
      expect(calls).toEqual([]);
    },
  );
});

describe('download links', () => {
  it('returns the link once the render has finished', async () => {
    const { client } = await connect({
      '/v1/renders/7/status': { body: { data: { status: 'finished', generate_id: 7 } } },
      '/v1/renders/7/download': {
        body: { data: { download_url: 'https://storage.example.test/out.mp4?sig=abc' } },
      },
    });

    const result = await client.callTool({
      name: 'lipdub_get_render',
      arguments: { render_id: 'rnd_7' },
    });

    expect(structuredOf(result).download_url).toBe('https://storage.example.test/out.mp4?sig=abc');
  });

  it('accepts a signed link on any storage host, not just the API domain', async () => {
    // Pre-signed links point at the object store, so pinning the API hostname would
    // break every real download.
    const { client } = await connect({
      '/v1/renders/7/status': { body: { data: { status: 'finished', generate_id: 7 } } },
      '/v1/renders/7/download': {
        body: { data: { download_url: 'https://s3.us-east-1.amazonaws.com/bucket/o.mp4' } },
      },
    });

    const result = await client.callTool({
      name: 'lipdub_get_render',
      arguments: { render_id: 'rnd_7' },
    });

    expect(structuredOf(result).download_url).toContain('amazonaws.com');
  });

  it.each(['http://insecure.test/out.mp4', 'javascript:alert(1)', 'not a url'])(
    'drops a non-https link (%o) rather than handing it to the model',
    async (badUrl) => {
      const { client } = await connect({
        '/v1/renders/7/status': { body: { data: { status: 'finished', generate_id: 7 } } },
        '/v1/renders/7/download': { body: { data: { download_url: badUrl } } },
      });

      const result = await client.callTool({
        name: 'lipdub_get_render',
        arguments: { render_id: 'rnd_7' },
      });

      expect(structuredOf(result).download_url).toBeNull();
    },
  );
});

describe('waiting', () => {
  it('defaults to a wait shorter than the client request timeout', () => {
    // Found by a real end-to-end run, not by any unit test: the default used to be
    // 240s against a 60s client timeout, so every default wait_for_render call failed
    // on a stock client while the render was progressing perfectly well.
    expect(DEFAULT_MAX_WAIT_SECONDS * 1000).toBeLessThan(DEFAULT_REQUEST_TIMEOUT_MSEC);
  });

  it('returns the finished result when the render completes during the wait', async () => {
    const { client } = await connect({
      '/v1/renders/7/status': { body: { data: { status: 'finished', generate_id: 7 } } },
      '/v1/renders/7/download': { body: { data: { download_url: 'https://x.test/o.mp4' } } },
    });

    const result = await client.callTool({
      name: 'lipdub_wait_for_render',
      arguments: { render_id: 'rnd_7', max_wait_seconds: 10 },
    });

    expect(structuredOf(result).status).toBe('succeeded');
    expect(structuredOf(result).still_running).toBe(false);
  });

  it(
    'reports an unfinished render as still running, never as a failure',
    async () => {
      const { client } = await connect({
        '/v1/renders/7/status': { body: { data: { status: 'running', generate_id: 7 } } },
      });

      // This genuinely blocks for the full window — 10s is the smallest wait the tool
      // accepts — so the test budget has to exceed it.
      const result = await client.callTool({
        name: 'lipdub_wait_for_render',
        arguments: { render_id: 'rnd_7', max_wait_seconds: 10 },
      });

      const structured = structuredOf(result);
      expect(isError(result)).toBe(false);
      expect(structured.still_running).toBe(true);
      expect(structured.is_failure).toBe(false);
      expect(structured.next_action).toMatch(/wait_for_render/);

      // The leading words matter: a model that reads "timed out" first will tell the
      // user the render failed, when it is running and already paid for.
      expect(textOf(result).startsWith('NOT an error')).toBe(true);
    },
    30_000,
  );

  it(
    'keeps waiting when the client rejects a progress notification',
    async () => {
      // Regression test. A progress update is decoration; if sending one throws, the
      // wait must not abort — the render is already paid for and aborting would
      // report a healthy render to the user as failed.
      const { client } = await connect({
        '/v1/renders/7/status': [
          { body: { data: { status: 'running', generate_id: 7 } } },
          { body: { data: { status: 'finished', generate_id: 7 } } },
        ],
        '/v1/renders/7/download': { body: { data: { download_url: 'https://x.test/o.mp4' } } },
      });

      // Passing a progress token makes the server emit notifications. The in-memory
      // client has no progress handler registered for this token, which is exactly
      // the real-world case this guards.
      const result = await client.callTool(
        { name: 'lipdub_wait_for_render', arguments: { render_id: 'rnd_7', max_wait_seconds: 30 } },
        undefined,
        { onprogress: () => { throw new Error('client rejected the progress notification'); } },
      );

      expect(isError(result)).toBe(false);
      expect(structuredOf(result).status).toBe('succeeded');
    },
    60_000,
  );

  it('surfaces a genuine failure as failed', async () => {
    const { client } = await connect({
      '/v1/renders/7/status': { body: { data: { status: 'failed', generate_id: 7 } } },
    });

    const result = await client.callTool({
      name: 'lipdub_wait_for_render',
      arguments: { render_id: 'rnd_7', max_wait_seconds: 10 },
    });

    expect(structuredOf(result).status).toBe('failed');
  });
});

describe('connection check', () => {
  it('confirms the account without exposing the email address', async () => {
    const { client } = await connect({
      '/v1/whoami': {
        body: { data: { user_id: 1, users_tenant_id: 42, email: 'someone@example.test' } },
      },
    });

    const result = await client.callTool({ name: 'lipdub_check_connection', arguments: {} });

    expect(structuredOf(result).account_id).toBe(42);
    // The email adds nothing to an agent workflow and is pure exfiltration surface.
    expect(textOf(result)).not.toContain('someone@example.test');
    expect(JSON.stringify(structuredOf(result))).not.toContain('someone@example.test');
  });

  it('points at the connection check when the key is rejected', async () => {
    const { client } = await connect({
      '/v1/whoami': { status: 403, body: { message: 'Forbidden' } },
    });

    const result = await client.callTool({ name: 'lipdub_check_connection', arguments: {} });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toMatch(/rejected the API key/i);
  });
});
