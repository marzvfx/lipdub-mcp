import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ServerContext } from '../context.js';
import { TYPICAL_RENDER_DURATION_TEXT } from '../lipdub/constants.js';
import { RenderPhase, RenderState } from '../lipdub/types.js';
import { toErrorResult, toTextResult, ToolResult } from './result.js';

/**
 * Unified status lookup — the main thing this server adds over the raw API.
 *
 * The API splits a render across two endpoints keyed by two different identifiers,
 * with two disjoint status vocabularies, plus a third endpoint that returns an error
 * unless the second one reported "finished". This tool presents one id, one
 * vocabulary of five phases, and a download link that simply appears when it exists.
 */

const DESCRIPTION = [
  'Check a LipDub render once, right now, and return its download link if it has',
  'finished. This does NOT wait — it answers immediately with whatever the current',
  'status is. To wait for a render to finish, use lipdub_wait_for_render instead.',
  '',
  'Takes the render_id from lipdub_create_render.',
  '',
  'Free and never rate-limited — check as often as you need.',
  '',
  'status is one of:',
  '- preparing — LipDub is downloading your source files (usually under 2 minutes)',
  '- queued — waiting for a render slot',
  '- rendering — generating the video',
  '- succeeded — done; download_url is included',
  '- failed — see failure_reason',
  '',
  'download_url is a temporary signed link that expires. Give it to the user or',
  'download it promptly; do not save it for later.',
  '',
  'If the render is not finished yet, prefer lipdub_wait_for_render — it waits for you',
  'instead of making you check repeatedly.',
].join('\n');

/**
 * Render a state as text for the model.
 *
 * @param state Unified render state.
 * @returns Text describing the state and the next action to take.
 */
export function describeState(state: RenderState): string {
  const lines = [`render_id: ${state.renderId}`, `status: ${state.status}`];

  if (state.jobId !== null) {
    lines.push(`job id: ${state.jobId}`);
  }

  if (state.status === RenderPhase.Succeeded && state.downloadUrl) {
    lines.push('', 'The render is finished.', `download_url: ${state.downloadUrl}`, '', 'This link is temporary and will expire — use it promptly.');
    return lines.join('\n');
  }

  if (state.status === RenderPhase.Failed) {
    lines.push('', state.failureReason ?? 'The render did not complete.');
    return lines.join('\n');
  }

  lines.push(
    '',
    `Not finished yet. A render takes about ${TYPICAL_RENDER_DURATION_TEXT} in total.`,
    `Call lipdub_wait_for_render with render_id "${state.renderId}", or wait about`,
    `${state.nextPollSeconds} seconds and check again. Checking is free and never rate-limited.`,
  );
  return lines.join('\n');
}

/** Machine-readable projection of a state. */
export function structureState(state: RenderState): Record<string, unknown> {
  return {
    render_id: state.renderId,
    job_id: state.jobId,
    status: state.status,
    download_url: state.downloadUrl,
    failure_reason: state.failureReason,
    next_poll_seconds: state.nextPollSeconds,
  };
}

/** Build the standard result for a resolved state. */
export function stateResult(state: RenderState): ToolResult {
  return toTextResult(describeState(state), structureState(state));
}

export function registerGetRenderTool(server: McpServer, context: ServerContext): void {
  server.registerTool(
    'lipdub_get_render',
    {
      title: 'Check LipDub render status',
      description: DESCRIPTION,
      inputSchema: {
        render_id: z
          .string()
          .describe(
            'The render_id from lipdub_create_render. A plain number is also accepted.',
          ),
      },
      annotations: {
        title: 'Check LipDub render status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const state = await context.renders.getState(args.render_id);
        return stateResult(state);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
