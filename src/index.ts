#!/usr/bin/env node
import { interactiveHint, shouldPrintInteractiveHint } from './interactive-hint.js';
import { SUPPORT_URLS } from './lipdub/constants.js';
import { runSmoke } from './smoke.js';
import { startStdioServer } from './transports/stdio.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/**
 * Entry point for `npx lipdub-mcp`.
 *
 * Normally this speaks MCP over stdio and produces no human-readable output at all.
 * `--version`, `--help` and `--smoke` are the exceptions, because anyone debugging a
 * broken client config will reach for them first, and a server that answers none of
 * them looks broken even when it is fine.
 *
 * Everything non-protocol is written to stderr, never stdout: on the stdio transport
 * stdout carries the JSON-RPC frames and a stray write corrupts the stream. `--smoke`
 * is the one human-facing command that writes a pass/fail report to stdout.
 */

const HELP = `${SERVER_NAME} ${SERVER_VERSION}

An MCP server that lets an AI agent lip-sync a video to a different audio track
using LipDub 2.

This is not run by hand — an MCP client starts it and talks to it over stdin and
stdout. To use it, add it to your client's configuration:

  claude mcp add lipdub --env LIPDUB_API_KEY=<your key> -- npx -y ${SERVER_NAME}

Setup for Claude Desktop, Cursor, VS Code, Gemini CLI and Codex:
  ${SUPPORT_URLS.setupDocs}

To test the install without an agent (needs a key, spends nothing):

  LIPDUB_API_KEY=<your key> npx -y ${SERVER_NAME} --smoke

Environment:
  LIPDUB_API_KEY                     Your LipDub API key. Required.
                                     Get one at ${SUPPORT_URLS.apiKeys}
  LIPDUB_API_KEY_FILE                Path to a file containing the key instead.
  LIPDUB_MAX_RENDERS_PER_SESSION     Renders allowed per run. Default 5.
  LIPDUB_REQUIRE_SPEND_CONFIRMATION  Ask before spending credits. Default true.
  LIPDUB_LOG_LEVEL                   debug | info | warn | error. Default warn.

Options:
  --version   Print the version and exit.
  --help      Print this message and exit.
  --smoke     Drive the server as a real MCP client. Handshake, tool list, API key.
              Add --render to run a paid render.
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    process.stderr.write(HELP);
    return;
  }

  if (args.includes('--smoke')) {
    runSmoke(args).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`smoke test crashed: ${reason}\n`);
      process.exitCode = 1;
    });
    return;
  }

  if (shouldPrintInteractiveHint(Boolean(process.stdin.isTTY), args)) {
    process.stderr.write(interactiveHint());
    return;
  }

  startStdioServer().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${SERVER_NAME} failed to start: ${reason}\n`);
    process.exitCode = 1;
  });
}

main();
