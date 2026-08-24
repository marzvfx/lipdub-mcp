import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TYPICAL_RENDER_DURATION_TEXT } from '../lipdub/constants.js';

/**
 * The one prompt this server ships.
 *
 * Prompts are user-invoked (a slash command in Claude Code, a picker entry in Claude
 * Desktop), which makes them a genuine discovery surface rather than another thing in
 * the model's context budget.
 *
 * There is deliberately no "dub this video into Spanish" prompt. LipDub 2 does not
 * translate — the caller supplies finished audio. A translation-shaped prompt would
 * produce an agent that renders the ORIGINAL audio under a foreign-language filename,
 * reports success, and charges the user for it. Instead this template tells the agent
 * to generate the target audio with a separate text-to-speech tool first, which is
 * both honest and genuinely more useful.
 */
export function registerQuickDubPrompt(server: McpServer): void {
  server.registerPrompt(
    'lipdub_quick_dub',
    {
      title: 'Lip-sync a video to new audio',
      description:
        'Walk through a LipDub 2 render: confirm the cost, start it, wait, and hand back the finished video.',
      argsSchema: {
        video: z.string().describe('A direct URL to the source video of a person speaking.'),
        audio: z
          .string()
          .describe('A direct URL to the audio they should appear to say.')
          .optional(),
      },
    },
    ({ video, audio }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `I want to lip-sync this video to new audio using LipDub 2.`,
              '',
              `Source video: ${video}`,
              audio
                ? `Target audio: ${audio}`
                : 'I have not given you the target audio yet — ask me for it, or offer to generate it.',
              '',
              'Please:',
              '1. Check the LipDub connection first if you have not already.',
              '2. Remember LipDub 2 does not translate or generate speech. If I want another',
              '   language, generate that audio with a text-to-speech tool first and host it',
              '   somewhere with a public URL.',
              '3. Tell me this will charge credits to my LipDub account and cannot be refunded,',
              '   and wait for me to confirm before starting.',
              `4. Start the render, then wait for it — it takes about ${TYPICAL_RENDER_DURATION_TEXT}.`,
              '5. Give me the download link when it is ready, and remind me the link expires.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
