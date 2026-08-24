import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerContext } from '../context.js';
import { SUPPORT_URLS } from '../lipdub/constants.js';
import { LipDubErrorCode, lipdubError } from '../lipdub/errors.js';
import { toErrorResult, toTextResult } from './result.js';

/**
 * Connection check, onboarding entry point and self-diagnosis tool.
 *
 * Note what this deliberately does not return: the account **email**. The upstream
 * endpoint provides it, but an agent workflow never needs it, and every field placed
 * in a model's context is a field that prompt injection can exfiltrate. The tenant id
 * is enough to tell two accounts apart.
 *
 * Credit balance is likewise absent because the API has no balance endpoint — the
 * balance is only reported after a render has already been charged. Rather than
 * pretend, the tool says so and points at the web app.
 */

const DESCRIPTION = [
  'Verify that this server can reach LipDub and report which account it is using.',
  '',
  'Call this first if any other LipDub tool fails with an authentication error, or when',
  'a user asks whether LipDub is set up.',
  '',
  'Does not use credits and does not start anything.',
  '',
  `Credit balance is not available through the API — direct the user to ${SUPPORT_URLS.app}`,
  'to see it.',
].join('\n');

export function registerCheckConnectionTool(server: McpServer, context: ServerContext): void {
  server.registerTool(
    'lipdub_check_connection',
    {
      title: 'Check LipDub connection',
      description: DESCRIPTION,
      inputSchema: {},
      annotations: {
        title: 'Check LipDub connection',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        if (!context.client.hasApiKey()) {
          throw lipdubError(LipDubErrorCode.NoApiKey);
        }

        const identity = await context.renders.whoAmI();

        return toTextResult(
          [
            'Connected to LipDub.',
            '',
            `account id: ${identity.users_tenant_id}`,
            '',
            "You're ready. Try: \"lip-sync this video to this audio\", giving a direct link",
            'to each file.',
            '',
            `Credit balance is not available through the API — check it at ${SUPPORT_URLS.app}.`,
          ].join('\n'),
          {
            connected: true,
            // The account email is intentionally omitted; see the note at the top.
            account_id: identity.users_tenant_id,
            credit_balance: null,
            credit_balance_note: `Not available through the API. See ${SUPPORT_URLS.app}.`,
          },
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
