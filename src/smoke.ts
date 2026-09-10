/**
 * End-to-end smoke test against the real LipDub API.
 *
 * Drives the built server the way a real MCP client does — over stdio, through the
 * official client SDK — rather than calling functions directly. A pass is evidence
 * the thing a user installs actually works, not just that the code compiles.
 *
 * Two levels, because one of them costs money:
 *
 *   npx -y lipdub-mcp --smoke              connection only. Free.
 *   npx -y lipdub-mcp --smoke --render     the whole flow. SPENDS CREDITS.
 *
 * There are deliberately no default media URLs. Baking in a sample would mean either
 * hosting one forever or shipping a link that quietly rots into a 404 — and a smoke
 * test that fails on its own fixture teaches you nothing about your installation.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveApiKey } from './context.js';
import { SUPPORT_URLS } from './lipdub/constants.js';
import { SERVER_NAME } from './version.js';

const EXPECTED_TOOLS = [
  'lipdub_check_connection',
  'lipdub_create_render',
  'lipdub_get_render',
  'lipdub_list_renders',
  'lipdub_wait_for_render',
];

/** How long to keep waiting for a render before giving up and reporting the id. */
const RENDER_WAIT_BUDGET_SECONDS = 30 * 60;

/** Server-side wait per call. Longer than the tool's chat-safe default, on purpose. */
const WAIT_PER_CALL_SECONDS = 300;

const NPX_SMOKE = `npx -y ${SERVER_NAME} --smoke`;

interface TextPart {
  type: string;
  text?: string;
}

interface ToolCallResult {
  isError?: boolean;
  content?: TextPart[];
  structuredContent?: Record<string, unknown>;
}

function serverEntryPoint(): string {
  return fileURLToPath(new URL('./index.js', import.meta.url));
}

function argValue(argv: readonly string[], name: string, fallback: string): string {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function textOf(result: ToolCallResult): string {
  return (result.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

function report(step: string, ok: boolean, detail: string): void {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}\n`);
  if (detail) {
    process.stdout.write(`${detail.replace(/^/gm, '      ')}\n`);
  }
}

function asToolResult(value: unknown): ToolCallResult {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as ToolCallResult;
}

/**
 * Env for the child MCP server. The SDK wants `Record<string, string>`; a raw
 * `process.env` spread includes `undefined` values.
 */
function childEnvironment(apiKey: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env.LIPDUB_API_KEY = apiKey;
  env.LIPDUB_LOG_LEVEL = 'warn';
  return env;
}

export async function runSmoke(argv: readonly string[]): Promise<void> {
  const apiKey = resolveApiKey(process.env);
  if (!apiKey) {
    process.stderr.write(
      'LIPDUB_API_KEY is not set.\n\n' +
        `Get a key from Settings -> API Keys at ${SUPPORT_URLS.apiKeys}\n` +
        '(you must be an Owner or Admin), then:\n\n' +
        `  LIPDUB_API_KEY=<key> ${NPX_SMOKE}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const entryPoint = serverEntryPoint();
  if (!existsSync(entryPoint)) {
    process.stderr.write(`No build found at ${entryPoint}. Run: npm run build\n`);
    process.exitCode = 2;
    return;
  }

  const wantsRender = argv.includes('--render');
  const videoUrl = argValue(argv, 'video', '');
  const audioUrl = argValue(argv, 'audio', '');
  const videoId = argValue(argv, 'video-id', '');
  const audioId = argValue(argv, 'audio-id', '');
  const existingRenderId = argValue(argv, 'render-id', '');

  const hasVideo = Boolean(videoUrl || videoId);
  const hasAudio = Boolean(audioUrl || audioId);

  if (wantsRender && !existingRenderId && (!hasVideo || !hasAudio)) {
    process.stderr.write(
      '--render needs media to render.\n\n' +
        'Supply a video of one person speaking and the audio they should appear to say,\n' +
        'either as public URLs (a YouTube link works for the video):\n\n' +
        `  ${NPX_SMOKE} --render \\\n` +
        '    --video=https://example.com/speaker.mp4 \\\n' +
        '    --audio=https://example.com/speech.mp3\n\n' +
        'or as ids from an earlier upload:\n\n' +
        `  ${NPX_SMOKE} --render --video-id=913772 --audio-id=<upload id>\n`,
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Driving ${entryPoint} as a real MCP client.\n\n`);

  // Spawn the same binary *without* `--smoke`. That child is the MCP server; this
  // process is the client. Passing `--smoke` here would recurse.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPoint],
    env: childEnvironment(apiKey),
  });

  const client = new Client({ name: `${SERVER_NAME}-smoke`, version: '1' });
  await client.connect(transport);

  let failures = 0;

  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    const expected = [...EXPECTED_TOOLS].sort();
    const ok =
      names.length === expected.length && names.every((name, index) => name === expected[index]);
    report(`tool list (${names.length} tools)`, ok, names.join('\n'));
    if (!ok) failures += 1;

    const connection = asToolResult(
      await client.callTool({
        name: 'lipdub_check_connection',
        arguments: {},
      }),
    );
    const connected = connection.isError !== true;
    report('connection to api.lipdub.ai', connected, textOf(connection));
    if (!connected) {
      failures += 1;
      return;
    }

    if (!wantsRender) {
      process.stdout.write(
        '\nConnection verified. This did not render anything and cost nothing.\n' +
          `To test a real render (SPENDS CREDITS): ${NPX_SMOKE} --render\n`,
      );
      return;
    }

    let renderId = existingRenderId;

    if (renderId) {
      process.stdout.write(`\nAttaching to existing render ${renderId}. No new spend.\n\n`);
    } else {
      process.stdout.write(
        `\nStarting a real render. This SPENDS CREDITS.\n` +
          `  video: ${videoUrl || `id ${videoId}`}\n` +
          `  audio: ${audioUrl || `id ${audioId}`}\n\n`,
      );

      const renderArgs: Record<string, unknown> = { confirm_spend: true };
      if (videoUrl) renderArgs.video_url = videoUrl;
      else renderArgs.video_id = Number(videoId);
      if (audioUrl) renderArgs.audio_url = audioUrl;
      else renderArgs.audio_id = audioId;

      const created = asToolResult(
        await client.callTool({
          name: 'lipdub_create_render',
          arguments: renderArgs,
        }),
      );
      const started = created.isError !== true;
      report('render started', started, textOf(created));
      if (!started) {
        failures += 1;
        return;
      }

      const createdId = created.structuredContent?.render_id;
      renderId = typeof createdId === 'string' ? createdId : '';
    }

    let waited = 0;
    let final: Record<string, unknown> | null = null;

    while (waited < RENDER_WAIT_BUDGET_SECONDS) {
      const waitResult = asToolResult(
        await client.callTool(
          {
            name: 'lipdub_wait_for_render',
            arguments: { render_id: renderId, max_wait_seconds: WAIT_PER_CALL_SECONDS },
          },
          undefined,
          // The client's own timeout has to outlast the server-side wait, or the client
          // gives up first and reports a healthy render as failed. This script can
          // afford to wait; a chat client generally cannot, which is why the tool's own
          // default is deliberately much shorter.
          {
            timeout: (WAIT_PER_CALL_SECONDS + 30) * 1000,
            resetTimeoutOnProgress: true,
          },
        ),
      );

      if (waitResult.isError === true) {
        report('waiting for render', false, textOf(waitResult));
        failures += 1;
        return;
      }

      const structured = waitResult.structuredContent ?? {};
      if (structured.still_running !== true) {
        final = structured;
        break;
      }

      waited += Number(structured.waited_seconds ?? WAIT_PER_CALL_SECONDS);
      process.stdout.write(`      still ${String(structured.status)} after ~${waited}s...\n`);
    }

    if (!final) {
      report('render finished', false, `Still running after ${waited}s. Render id: ${renderId}`);
      failures += 1;
      return;
    }

    const succeeded = final.status === 'succeeded' && Boolean(final.download_url);
    const detail =
      typeof final.download_url === 'string'
        ? final.download_url
        : typeof final.failure_reason === 'string'
          ? final.failure_reason
          : '';
    report(`render ${String(final.status)}`, succeeded, detail);
    if (!succeeded) failures += 1;
  } finally {
    await client.close().catch(() => {});
    process.stdout.write(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
}
