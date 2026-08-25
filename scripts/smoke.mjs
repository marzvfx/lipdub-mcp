#!/usr/bin/env node
/**
 * End-to-end smoke test against the real LipDub API.
 *
 * This drives the built server the way a real MCP client does — over stdio, through
 * the official client SDK — rather than calling functions directly. That means a pass
 * here is evidence the thing a user installs actually works, not just that the code
 * compiles.
 *
 * Two levels, because one of them costs money:
 *
 *   npm run smoke              connection only. Free. Verifies the key, the handshake
 *                              and the tool list.
 *   npm run smoke -- --render  the whole flow, including a real render. SPENDS CREDITS
 *                              from the account the key belongs to.
 *
 * Requires LIPDUB_API_KEY. --render needs media, given either as public URLs
 * (--video=<url> --audio=<url>) or as ids from an earlier upload
 * (--video-id=<shot id> --audio-id=<upload id>), which is handy when you have no
 * public hosting to hand.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINT = join(REPOSITORY_ROOT, 'dist', 'index.js');

// There are deliberately no default media URLs. Baking in a sample would mean either
// hosting one forever or shipping a link that quietly rots into a 404 — and a smoke
// test that fails on its own fixture teaches you nothing about your installation.

/** How long to keep waiting for a render before giving up and reporting the id. */
const RENDER_WAIT_BUDGET_SECONDS = 30 * 60;

/** Server-side wait per call. Longer than the tool's chat-safe default, on purpose. */
const WAIT_PER_CALL_SECONDS = 300;

function argValue(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function report(step, ok, detail) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}\n`);
  if (detail) {
    process.stdout.write(`${detail.replace(/^/gm, '      ')}\n`);
  }
}

async function main() {
  const apiKey = (process.env.LIPDUB_API_KEY ?? '').trim();
  if (!apiKey) {
    process.stderr.write(
      'LIPDUB_API_KEY is not set.\n\n' +
        'Get a key from Settings -> API Keys at https://app.lipdub.ai/settings/api-keys\n' +
        '(you must be an Owner or Admin), then:\n\n' +
        '  LIPDUB_API_KEY=<key> npm run smoke\n',
    );
    process.exitCode = 2;
    return;
  }

  if (!existsSync(ENTRY_POINT)) {
    process.stderr.write(`No build found at ${ENTRY_POINT}. Run: npm run build\n`);
    process.exitCode = 2;
    return;
  }

  const wantsRender = process.argv.includes('--render');
  const videoUrl = argValue('video', '');
  const audioUrl = argValue('audio', '');
  const videoId = argValue('video-id', '');
  const audioId = argValue('audio-id', '');
  // Lets you re-attach to a render that is already running, so a crashed or
  // interrupted run does not mean paying for another one.
  const existingRenderId = argValue('render-id', '');

  const hasVideo = Boolean(videoUrl || videoId);
  const hasAudio = Boolean(audioUrl || audioId);

  if (wantsRender && !existingRenderId && (!hasVideo || !hasAudio)) {
    process.stderr.write(
      '--render needs media to render.\n\n' +
        'Supply a video of one person speaking and the audio they should appear to say,\n' +
        'either as public URLs (a YouTube link works for the video):\n\n' +
        '  npm run smoke -- --render \\\n' +
        '    --video=https://example.com/speaker.mp4 \\\n' +
        '    --audio=https://example.com/speech.mp3\n\n' +
        'or as ids from an earlier upload:\n\n' +
        '  npm run smoke -- --render --video-id=913772 --audio-id=<upload id>\n',
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Driving ${ENTRY_POINT} as a real MCP client.\n\n`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY_POINT],
    env: { ...process.env, LIPDUB_API_KEY: apiKey, LIPDUB_LOG_LEVEL: 'warn' },
  });

  const client = new Client({ name: 'lipdub-mcp-smoke', version: '1' });
  await client.connect(transport);

  let failures = 0;

  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    const ok = names.length === 5;
    report(`tool list (${names.length} tools)`, ok, names.join('\n'));
    if (!ok) failures += 1;

    const connection = await client.callTool({
      name: 'lipdub_check_connection',
      arguments: {},
    });
    const connected = connection.isError !== true;
    report('connection to api.lipdub.ai', connected, textOf(connection));
    if (!connected) {
      failures += 1;
      return;
    }

    if (!wantsRender) {
      process.stdout.write(
        '\nConnection verified. This did not render anything and cost nothing.\n' +
          'To test a real render (SPENDS CREDITS): npm run smoke -- --render\n',
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

    const renderArgs = { confirm_spend: true };
    if (videoUrl) renderArgs.video_url = videoUrl;
    else renderArgs.video_id = Number(videoId);
    if (audioUrl) renderArgs.audio_url = audioUrl;
    else renderArgs.audio_id = audioId;

    const created = await client.callTool({
      name: 'lipdub_create_render',
      arguments: renderArgs,
    });
    const started = created.isError !== true;
    report('render started', started, textOf(created));
    if (!started) {
      failures += 1;
      return;
    }

      renderId = created.structuredContent?.render_id;
    }

    let waited = 0;
    let final = null;

    while (waited < RENDER_WAIT_BUDGET_SECONDS) {
      const waitResult = await client.callTool(
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
      process.stdout.write(`      still ${structured.status} after ~${waited}s...\n`);
    }

    if (!final) {
      report('render finished', false, `Still running after ${waited}s. Render id: ${renderId}`);
      failures += 1;
      return;
    }

    const succeeded = final.status === 'succeeded' && Boolean(final.download_url);
    report(`render ${final.status}`, succeeded, final.download_url ?? final.failure_reason ?? '');
    if (!succeeded) failures += 1;
  } finally {
    await client.close().catch(() => {});
    process.stdout.write(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

main().catch((error) => {
  process.stderr.write(`smoke test crashed: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
