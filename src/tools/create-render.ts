import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ServerContext } from '../context.js';
import {
  formatExtensionList,
  MAX_OUTPUT_FILENAME_LENGTH,
  MAX_URL_LENGTH,
  RESOLVABLE_VIDEO_HOSTS,
  SUPPORT_URLS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  TYPICAL_RENDER_DURATION_TEXT,
} from '../lipdub/constants.js';
import { LipDubErrorCode, lipdubError } from '../lipdub/errors.js';
import { resolveOutputFilename } from '../lipdub/filename.js';
import { resolveExactlyOneSource } from './validation.js';
import { toErrorResult, toTextResult } from './result.js';

/**
 * The only tool that spends money.
 *
 * Three things in the description are load-bearing and should not be trimmed:
 *
 * 1. The credit warning, repeated in the title, because most clients gate their
 *    confirmation UI on `destructiveHint` and a render is honestly non-destructive —
 *    it creates something new and deletes nothing. Rather than lie in the annotation,
 *    the cost is stated where the model will read it.
 * 2. "LipDub 2 does not translate", because "dub" strongly implies translation. An
 *    agent that assumes otherwise will render the original audio under a
 *    foreign-language filename, report success, and charge the user for it.
 * 3. The explicit next step, because agents follow chained instructions in tool
 *    descriptions far more reliably than they infer a workflow.
 */

const DESCRIPTION = [
  'Start a LipDub 2 render: make the person in a source video appear to speak a',
  'different audio track, with matched lip movement.',
  '',
  'USES CREDITS. Each render charges the account and cannot be undone or refunded.',
  'Cost scales with the length of the source video. Confirm with the user first, then',
  'call again with confirm_spend set to true.',
  '',
  'Supply BOTH sides as direct, publicly downloadable URLs:',
  '- video_url — a video of ONE person speaking, face clearly visible.',
  '- audio_url — the audio you want them to appear to say.',
  '',
  'LipDub 2 does NOT translate, transcribe or generate speech. If the user wants',
  'another language, produce that audio first with a separate text-to-speech or voice',
  'tool, host it at a URL, and pass that URL as audio_url.',
  '',
  'Links must return the media file itself, with two exceptions: YouTube links work',
  `(${formatExtensionList(RESOLVABLE_VIDEO_HOSTS)}), because they are resolved for you.`,
  'Google Drive and Dropbox share pages, and anything behind a login, will fail.',
  '',
  `Returns immediately with a render_id — the render is NOT finished. Rendering takes`,
  `${TYPICAL_RENDER_DURATION_TEXT}. Next step: call lipdub_wait_for_render with`,
  'that render_id.',
].join('\n');

const inputSchema = {
  video_url: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe(
      `URL to the source video (one person, face visible). ${formatExtensionList(SUPPORTED_VIDEO_EXTENSIONS)}, or a YouTube link.`,
    ),
  audio_url: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe(
      `Direct URL to the audio the person should appear to say (${formatExtensionList(SUPPORTED_AUDIO_EXTENSIONS)}). You must supply finished audio; LipDub 2 does not generate or translate speech.`,
    ),
  output_filename: z
    .string()
    .max(MAX_OUTPUT_FILENAME_LENGTH)
    .optional()
    .describe(
      "Optional name for the finished file, e.g. 'ceo-welcome-spanish.mp4'. If omitted, a name is derived from video_url. This name is also shown as the project name in the user's LipDub web app, so make it meaningful.",
    ),
  callback_url: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe(
      'Optional https URL to be called when the render finishes. For automated pipelines; in a chat session use lipdub_wait_for_render instead.',
    ),
  confirm_spend: z
    .boolean()
    .default(false)
    .describe(
      'Whether the user has personally approved spending credits on this render. Defaults to false deliberately, as a safety gate — it is not a misconfiguration. Set it to true only after you have asked the user and they have agreed. Setting it yourself without asking spends their money without consent.',
    ),
  video_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Advanced. A LipDub shot id from a previous upload, instead of video_url.'),
  audio_id: z
    .string()
    .optional()
    .describe('Advanced. A LipDub audio upload id from a previous upload, instead of audio_url.'),
};

export function registerCreateRenderTool(server: McpServer, context: ServerContext): void {
  server.registerTool(
    'lipdub_create_render',
    {
      title: 'Create LipDub render (uses account credits)',
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: 'Create LipDub render (uses account credits)',
        // Honest values. A render adds a new job and destroys nothing, so
        // destructiveHint is false even though the call spends money; see the note at
        // the top of this file for how the spend is surfaced instead.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        'ai.lipdub/cost': {
          type: 'credits',
          prepaid: true,
          refundable: false,
          basis: 'per minute of source video',
          estimate_available: false,
          balance_url: SUPPORT_URLS.app,
        },
      },
    },
    async (args) => {
      try {
        if (context.requireSpendConfirmation && args.confirm_spend !== true) {
          throw lipdubError(LipDubErrorCode.SpendNotConfirmed);
        }

        if (context.rendersStarted >= context.maxRendersPerSession) {
          return toErrorResult(
            [
              `This server has already started ${context.rendersStarted} renders in this session,`,
              'which is the configured limit. This guard exists to stop a loop quietly',
              'draining the credit balance.',
              '',
              'If the user genuinely wants more, restart the client, or raise',
              'LIPDUB_MAX_RENDERS_PER_SESSION in the server configuration.',
            ].join('\n'),
          );
        }

        const video = resolveExactlyOneSource(args.video_url, args.video_id, 'video');
        const audio = resolveExactlyOneSource(args.audio_url, args.audio_id, 'audio');

        const outputFilename = resolveOutputFilename(args.output_filename, video.url);

        const result = await context.renders.create({
          videoUrl: video.url,
          videoId: video.id as number | undefined,
          audioUrl: audio.url,
          audioId: audio.id as string | undefined,
          outputFilename,
          callbackUrl: args.callback_url,
        });

        context.rendersStarted += 1;

        const lines = [
          `Render started. Credits have been committed for this render.`,
          '',
          `render_id: ${result.renderId}`,
          `output filename: ${result.outputFilename}`,
          `status: ${result.status}`,
        ];
        if (result.creditsRemaining !== null) {
          lines.push(`credits remaining: ${result.creditsRemaining}`);
        }
        lines.push(
          '',
          `This is NOT finished yet — a render takes ${TYPICAL_RENDER_DURATION_TEXT}.`,
          `Next step: call lipdub_wait_for_render with render_id "${result.renderId}".`,
        );

        return toTextResult(lines.join('\n'), {
          render_id: result.renderId,
          job_id: result.jobId,
          status: result.status,
          output_filename: result.outputFilename,
          credits_remaining: result.creditsRemaining,
          next_poll_seconds: result.nextPollSeconds,
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
