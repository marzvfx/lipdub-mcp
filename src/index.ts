#!/usr/bin/env node
import { startStdioServer } from './transports/stdio.js';

/**
 * Entry point for `npx lipdub-mcp`.
 *
 * Failures are written to stderr, never stdout: on the stdio transport stdout carries
 * the JSON-RPC frames, and a stray write corrupts the stream.
 */
startStdioServer().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`lipdub-mcp failed to start: ${reason}\n`);
  process.exitCode = 1;
});
