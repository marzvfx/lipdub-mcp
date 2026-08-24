import { LipDubError } from '../lipdub/errors.js';
import { InvalidHandleError } from '../lipdub/status.js';

/**
 * Tool result helpers.
 *
 * Failures are returned as tool *execution* errors (`isError: true`) rather than
 * JSON-RPC protocol errors, because the MCP specification is explicit that execution
 * errors are handed to the model so it can correct itself. A protocol error would be
 * swallowed by the client and the agent would learn nothing.
 */

/** Shape returned by every tool in this server. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Build a successful result.
 *
 * @param text Human- and model-readable rendering.
 * @param structured Machine-readable payload for clients that use it.
 * @returns The tool result.
 */
export function toTextResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * Build an error result from a thrown value.
 *
 * Only errors this package created are rendered verbatim. Anything else collapses to
 * a fixed message, because an arbitrary exception may embed an upstream response — or
 * even the request headers, and therefore the API key.
 *
 * @param error The thrown value, or a ready-made message string.
 * @returns A tool result flagged as an error.
 */
export function toErrorResult(error: unknown): ToolResult {
  if (typeof error === 'string') {
    return { content: [{ type: 'text', text: error }], isError: true };
  }

  if (error instanceof LipDubError) {
    return {
      content: [{ type: 'text', text: error.toToolMessage() }],
      structuredContent: { error_code: error.code, request_id: error.requestId },
      isError: true,
    };
  }

  if (error instanceof InvalidHandleError) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
  }

  return {
    content: [
      {
        type: 'text',
        text: [
          'Something went wrong while talking to LipDub, so this request did not complete.',
          '',
          'Wait a moment and try again. If a render was already created it is unaffected —',
          'use lipdub_get_render to check on it.',
        ].join('\n'),
      },
    ],
    structuredContent: { error_code: 'unexpected' },
    isError: true,
  };
}
