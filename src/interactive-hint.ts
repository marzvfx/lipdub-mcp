import { SERVER_NAME } from './version.js';

/**
 * Decide whether a human just typed `npx lipdub-mcp` in a terminal.
 *
 * MCP clients always pipe stdin, so `isTTY` is false for them. A terminal is the
 * opposite: stdin is a TTY and there are no flags. Printing a hint then exiting
 * is what stops the process looking hung.
 */
export function shouldPrintInteractiveHint(isTty: boolean, args: readonly string[]): boolean {
  return isTty && args.length === 0;
}

/** One short explanation for a human who ran the binary by hand. */
export function interactiveHint(): string {
  return (
    `${SERVER_NAME} is an MCP server. It waits for Claude or Cursor on stdin — it is not stuck.\n` +
    `Add it: claude mcp add lipdub --env LIPDUB_API_KEY=<key> -- npx -y ${SERVER_NAME}\n` +
    `Test without an agent: LIPDUB_API_KEY=<key> npx -y ${SERVER_NAME} --smoke\n`
  );
}
