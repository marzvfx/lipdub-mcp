import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerContext } from './context.js';
import { registerQuickDubPrompt } from './prompts/quick-dub.js';
import { registerGuideResources } from './resources/guides.js';
import { registerCheckConnectionTool } from './tools/check-connection.js';
import { registerCreateRenderTool } from './tools/create-render.js';
import { registerGetRenderTool } from './tools/get-render.js';
import { registerListRendersTool } from './tools/list-renders.js';
import { registerWaitForRenderTool } from './tools/wait-for-render.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';
import { TYPICAL_RENDER_DURATION_TEXT } from './lipdub/constants.js';

/**
 * Server assembly.
 *
 * Deliberately knows nothing about transport. The stdio entry point wires this to a
 * stdio transport; a future HTTP transport would wire the same function to a
 * streamable-HTTP one, differing only in how the API key is resolved. Keeping that
 * boundary from day one is what makes a hosted deployment a small change later.
 */

/**
 * Instructions sent once at initialisation.
 *
 * Stating the product's shape here — especially that it does not translate — saves
 * repeating it in all five tool descriptions and, more importantly, reaches the model
 * before it has chosen a tool.
 */
const INSTRUCTIONS = [
  'LipDub 2 makes a person in a video appear to speak a different audio track, with',
  'matched lip movement.',
  '',
  'You supply two things: a source video of a person speaking, and the audio you want',
  'them to appear to say. LipDub 2 does NOT translate, transcribe or generate speech —',
  'bring your own finished audio, from a text-to-speech or voice tool, or a real',
  'recording.',
  '',
  'Both inputs are given as public URLs, not local file paths.',
  '',
  `Renders take about ${TYPICAL_RENDER_DURATION_TEXT} and consume credits from the`,
  "user's LipDub account. Checking status is free and never rate-limited, so check as",
  'often as you like.',
  '',
  'Normal flow:',
  '1. Ask the user to approve the charge, then call lipdub_create_render with a',
  '   video_url and an audio_url. Keep the render_id it returns.',
  '2. Call lipdub_wait_for_render. It waits for a few minutes and then returns; if the',
  '   render is not done yet it says so and you simply call it again. That is normal.',
  '3. Use lipdub_get_render for a single immediate status check without waiting, or to',
  '   fetch a fresh download link later.',
  '4. When the status is "succeeded", give the user the download link — it expires.',
  '',
  'If you lose a render_id, lipdub_list_renders will find it. If anything fails with an',
  'authentication error, lipdub_check_connection will tell you whether the key is the',
  'problem.',
  '',
  'This tool generates synthetic video of a real person. Only use it on material the',
  'user has the rights and consent to alter, and never to impersonate someone.',
].join('\n');

/**
 * Build a fully configured MCP server.
 *
 * @param context Per-session dependencies and state.
 * @returns The server, ready to connect to a transport.
 */
export function createServer(context: ServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerCheckConnectionTool(server, context);
  registerCreateRenderTool(server, context);
  registerGetRenderTool(server, context);
  registerWaitForRenderTool(server, context);
  registerListRendersTool(server, context);

  registerQuickDubPrompt(server);
  registerGuideResources(server);

  return server;
}
