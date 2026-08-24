import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ServerContext } from '../context.js';
import { toErrorResult, toTextResult } from './result.js';

/**
 * Recovery tool.
 *
 * Exists for one specific and very common failure: the agent loses the render_id when
 * the conversation is compacted. Without this, a render the user has already paid for
 * becomes unreachable. The upstream entries carry deeply nested project, scene and dub
 * objects; only four flat fields are surfaced, both to keep the agent's context small
 * and because forwarding unmodelled upstream data is how internal vocabulary escapes.
 */

const DEFAULT_LIMIT = 10;
const MAXIMUM_LIMIT = 50;

const DESCRIPTION = [
  'List recent LipDub renders on this account, newest first.',
  '',
  'Use this when:',
  '- you have lost a render_id, for example because earlier conversation was trimmed',
  '  away and a render is still running or already finished',
  '- the user asks what they have rendered recently',
  '',
  'Returns a short summary of each. Call lipdub_get_render with one of the returned',
  'render_ids to get its download link.',
  '',
  'Free and never rate-limited.',
].join('\n');

export function registerListRendersTool(server: McpServer, context: ServerContext): void {
  server.registerTool(
    'lipdub_list_renders',
    {
      title: 'List recent LipDub renders',
      description: DESCRIPTION,
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAXIMUM_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe('How many renders to return.'),
      },
      annotations: {
        title: 'List recent LipDub renders',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const renders = await context.renders.list(args.limit);

        if (renders.length === 0) {
          return toTextResult('No renders found on this account yet.', {
            renders: [],
            count: 0,
          });
        }

        const lines = renders.map(
          (render) => `- ${render.renderId} — ${render.status} — ${render.outputFilename}`,
        );

        return toTextResult(
          [`${renders.length} recent render(s):`, '', ...lines].join('\n'),
          {
            renders: renders.map((render) => ({
              render_id: render.renderId,
              job_id: render.jobId,
              status: render.status,
              output_filename: render.outputFilename,
            })),
            count: renders.length,
          },
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
