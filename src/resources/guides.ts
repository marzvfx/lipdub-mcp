import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  formatExtensionList,
  MAX_SOURCE_FILE_SIZE_TEXT,
  RESOLVABLE_VIDEO_HOSTS,
  SOURCE_INGEST_TIMEOUT_TEXT,
  SUPPORT_URLS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  TYPICAL_RENDER_DURATION_TEXT,
} from '../lipdub/constants.js';

/**
 * Long-form guidance, served as resources.
 *
 * Resources are pulled by the client, so they cost nothing in the model's context
 * until something actually reads them. That lets tool descriptions stay short while a
 * confused agent still has somewhere to go.
 *
 * The hard rule that follows: because resource support is uneven across clients,
 * **nothing may be reachable only through a resource**. Every tool description has to
 * stand on its own. These are elaboration, never the load-bearing path.
 */

const QUICKSTART = `# LipDub 2 quickstart

LipDub 2 makes a person in a video appear to speak a different audio track, with
matched lip movement.

## What it does not do

It does **not** translate, transcribe, or generate speech. You bring finished audio.
If you want a video dubbed into another language, produce that audio first with a
text-to-speech or voice-cloning tool, host it at a public URL, and pass that URL.

## The flow

1. \`lipdub_check_connection\` — confirm the API key works.
2. \`lipdub_create_render\` — pass \`video_url\` and \`audio_url\`. Charges credits.
3. \`lipdub_wait_for_render\` — takes ${TYPICAL_RENDER_DURATION_TEXT}.
4. The finished result comes back as a temporary signed download link.

If you lose the render id, \`lipdub_list_renders\` will find it.

## Inputs

Both sides are **public URLs**, not local files. The link must return the media file
itself — with one exception: **YouTube links work** (${formatExtensionList(RESOLVABLE_VIDEO_HOSTS)}),
because they are resolved for you. Google Drive and Dropbox share pages, and anything
behind a login, do not work.

Video: ${formatExtensionList(SUPPORTED_VIDEO_EXTENSIONS)}.
Audio: ${formatExtensionList(SUPPORTED_AUDIO_EXTENSIONS)} (\`.mp4\` and \`.mov\` are accepted
here too, since those containers can carry an audio-only track).

Sources are capped at ${MAX_SOURCE_FILE_SIZE_TEXT}, and LipDub waits up to
${SOURCE_INGEST_TIMEOUT_TEXT} for both downloads before giving up.

A good source video shows **one** person, face clearly visible and well lit.

## Cost and timing

Renders consume credits from the account and cannot be refunded. Cost scales with the
length of the source video, so shorter clips cost less. Check the balance at
${SUPPORT_URLS.app} — it is not available through the API.

Checking status is free and is never rate-limited, so poll as often as you like.
`;

const TROUBLESHOOTING = `# LipDub 2 troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No LipDub API key is configured" | The server has no key | Generate one at ${SUPPORT_URLS.apiKeys} (Owner/Admin only) and set \`LIPDUB_API_KEY\` |
| "LipDub rejected the API key" | Mistyped, or rotated since it was copied | Generate a fresh key and restart the client. Note it replaces the old one everywhere |
| "out of credits" | Balance is empty | Top up at ${SUPPORT_URLS.app} |
| "could not download one of your source files" | Link is a share page, needs a login, or expired | Use a direct link that returns the file itself |
| "downloaded your files but could not start the render" | Usually no credits, or no clearly visible speaking face | Check the balance, then try a different source video |
| "timed out while preparing your files" | A source URL was very slow | Use smaller files or faster hosting |
| Wait tool returned \`still_running\` | Normal — renders take ${TYPICAL_RENDER_DURATION_TEXT} | Not a failure. Call the wait tool again with the same render id |
| Download link stopped working | Links are signed and short-lived | Call \`lipdub_get_render\` again for a fresh link |

## Rate limits

Creating a render and checking status are not meaningfully rate-limited. If you do see
a rate-limit error, wait about 60 seconds; any render already running is unaffected.

Full API documentation: ${SUPPORT_URLS.docs}
`;

/** Register the guide resources. */
export function registerGuideResources(server: McpServer): void {
  server.registerResource(
    'quickstart',
    'lipdub://guide/quickstart',
    {
      title: 'LipDub 2 quickstart',
      description: 'What LipDub 2 does, the render flow, input requirements, cost and timing.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: QUICKSTART }],
    }),
  );

  server.registerResource(
    'troubleshooting',
    'lipdub://guide/troubleshooting',
    {
      title: 'LipDub 2 troubleshooting',
      description: 'Symptom, cause and fix for the common LipDub 2 failures.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: TROUBLESHOOTING }],
    }),
  );
}
