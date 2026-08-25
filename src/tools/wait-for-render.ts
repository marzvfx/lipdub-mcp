import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ServerContext } from '../context.js';
import { TYPICAL_RENDER_DURATION_TEXT } from '../lipdub/constants.js';
import { isTerminal } from '../lipdub/status.js';
import { RenderState } from '../lipdub/types.js';
import { describeState, structureState } from './get-render.js';
import { toErrorResult, toTextResult } from './result.js';

/**
 * Bounded server-side wait.
 *
 * A render outlasts every mainstream client's default tool timeout, so this
 * deliberately does NOT wait for the whole render. It waits for a bounded window and
 * then returns normally, which turns many polling turns into one or two calls without
 * ever outliving the client's patience.
 *
 * The single most important line in this file is the "NOT an error" wording. Without
 * it, a model that receives a timeout result reliably tells the user the render
 * failed — when in fact it is still running and the credits are already spent.
 */

/**
 * Default wait.
 *
 * This has to stay under the CLIENT's request timeout, not just under something that
 * feels reasonable. The MCP SDK's default is 60 seconds
 * (`DEFAULT_REQUEST_TIMEOUT_MSEC`), so a longer default here means the client gives up
 * and reports an error while the render is progressing perfectly well — which is
 * exactly the false failure this tool exists to prevent. 45 seconds leaves headroom
 * for the round trip.
 *
 * A real end-to-end run is what caught this: every unit test passed with a 240-second
 * default, because none of them went through a client that enforces a timeout.
 */
export const DEFAULT_MAX_WAIT_SECONDS = 45;

/**
 * Hard ceiling.
 *
 * Only reachable on clients configured with a longer request timeout, or clients that
 * reset the timeout on progress notifications. Callers opt into that explicitly.
 */
const MAXIMUM_MAX_WAIT_SECONDS = 600;

/** Floor, so a caller cannot turn this into a busy loop. */
const MINIMUM_MAX_WAIT_SECONDS = 10;

/**
 * How often progress is reported while waiting.
 *
 * Also the interval at which a client using `resetTimeoutOnProgress` refreshes its
 * timeout, so it is kept well below the 60-second floor rather than tuned purely for
 * how often a human wants an update.
 */
const PROGRESS_INTERVAL_SECONDS = 10;

const DESCRIPTION = [
  'Wait for a LipDub render to finish, then return its download link. Use this straight',
  'after lipdub_create_render instead of checking in a loop — it uses far less context.',
  '',
  `This call blocks for up to max_wait_seconds (default ${DEFAULT_MAX_WAIT_SECONDS},`,
  `maximum ${MAXIMUM_MAX_WAIT_SECONDS}) while tracking the render for you. A render`,
  `takes ${TYPICAL_RENDER_DURATION_TEXT}, so expect to call this several times — that`,
  'is normal and costs nothing.',
  '',
  'If the render is still going when the wait is up, this returns normally with',
  'still_running set to true. That is NOT an error and NOT a failure — the render is',
  'fine and is still going. When it happens: tell the user it is still in progress,',
  'give them the render_id so they can come back to it, and call this tool again to',
  'keep waiting.',
  '',
  'Waiting and status checks are free and never rate-limited.',
].join('\n');

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function registerWaitForRenderTool(server: McpServer, context: ServerContext): void {
  server.registerTool(
    'lipdub_wait_for_render',
    {
      title: 'Wait for LipDub render to finish',
      description: DESCRIPTION,
      inputSchema: {
        render_id: z.string().describe('The render_id from lipdub_create_render.'),
        max_wait_seconds: z
          .number()
          .int()
          .min(MINIMUM_MAX_WAIT_SECONDS)
          .max(MAXIMUM_MAX_WAIT_SECONDS)
          .default(DEFAULT_MAX_WAIT_SECONDS)
          .describe(
            `How long to wait before returning. Returning early with still_running set to true is normal, not a failure. The default of ${DEFAULT_MAX_WAIT_SECONDS} stays under the 60-second request timeout most MCP clients use; only raise it if your client is configured to wait longer.`,
          ),
      },
      annotations: {
        title: 'Wait for LipDub render to finish',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      try {
        const deadline = Date.now() + args.max_wait_seconds * 1000;
        const progressToken = extra?._meta?.progressToken;
        let waitedSeconds = 0;
        let state: RenderState = await context.renders.getState(args.render_id);
        let lastProgressAt = 0;

        while (!isTerminal(state.status) && Date.now() < deadline) {
          const pollSeconds = Math.max(1, state.nextPollSeconds);
          const remainingMilliseconds = deadline - Date.now();
          const sleepMilliseconds = Math.min(pollSeconds * 1000, remainingMilliseconds);
          if (sleepMilliseconds <= 0) {
            break;
          }

          await sleep(sleepMilliseconds);
          waitedSeconds += Math.round(sleepMilliseconds / 1000);

          // Progress notifications are only meaningful when the client asked for them
          // by sending a token; sending otherwise is noise the client will drop.
          if (
            progressToken !== undefined &&
            waitedSeconds - lastProgressAt >= PROGRESS_INTERVAL_SECONDS
          ) {
            lastProgressAt = waitedSeconds;
            try {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: waitedSeconds,
                  total: args.max_wait_seconds,
                  message: `Render is ${state.status} — usually ${TYPICAL_RENDER_DURATION_TEXT}.`,
                },
              });
            } catch (notificationError) {
              // A progress update is decoration. If the client rejects it — stale
              // token, transport hiccup, no support — that must not abort the wait:
              // the render is already paid for, and throwing here would report a
              // perfectly healthy render to the user as failed.
              context.logger.warn('progress notification failed; continuing to wait', {
                reason:
                  notificationError instanceof Error ? notificationError.name : 'unknown',
              });
            }
          }

          state = await context.renders.getState(state.renderId);
        }

        if (isTerminal(state.status)) {
          return toTextResult(describeState(state), {
            ...structureState(state),
            still_running: false,
            waited_seconds: waitedSeconds,
          });
        }

        // The "not a failure" wording leads, because a model that reads "timed out"
        // first will report the render as failed to the user — while it is in fact
        // still running and already paid for.
        const text = [
          `NOT an error and NOT a failure: the render is still ${state.status} after ${waitedSeconds} seconds,`,
          `which is normal — a render takes ${TYPICAL_RENDER_DURATION_TEXT}.`,
          '',
          `render_id: ${state.renderId}`,
          `status: ${state.status}`,
          '',
          'Tell the user it is still in progress and give them the render_id, then call',
          'lipdub_wait_for_render again to keep waiting.',
        ].join('\n');

        return toTextResult(text, {
          ...structureState(state),
          still_running: true,
          is_failure: false,
          next_action: 'call lipdub_wait_for_render again with the same render_id',
          waited_seconds: waitedSeconds,
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
