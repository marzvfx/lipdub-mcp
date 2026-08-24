import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the stdio transport's most damaging failure mode.
 *
 * On stdio, stdout carries the JSON-RPC frames. A single stray `console.log` — or a
 * dependency that prints a banner — corrupts the stream, and the client reports a bare
 * "failed to connect" with nothing pointing at the cause. This test drives the real
 * built server and asserts that every stdout line is a valid JSON-RPC message, and
 * that diagnostics go to stderr instead.
 */

const REPOSITORY_ROOT = join(import.meta.dirname, '..');
const ENTRY_POINT = join(REPOSITORY_ROOT, 'dist', 'index.js');

const HANDSHAKE = [
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'no-stdout-test', version: '0' },
    },
  }),
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
].join('\n');

interface SessionOutput {
  stdout: string;
  stderr: string;
}

/**
 * Run the built entry point with arguments and no stdin, capturing both streams.
 *
 * Used for the flag paths, which exit immediately rather than serving a session.
 *
 * @param args Command-line arguments to pass.
 * @returns Whatever the process wrote to stdout and stderr.
 */
function runOnce(args: string[]): Promise<SessionOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY_POINT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

/** Run the built server through one handshake and capture both streams. */
function runSession(environment: NodeJS.ProcessEnv): Promise<SessionOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY_POINT], {
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));

    child.stdin.write(`${HANDSHAKE}\n`);
    // Give the server a moment to answer before closing stdin, which ends the session.
    setTimeout(() => child.stdin.end(), 2000);
  });
}

describe('stdout carries only JSON-RPC', () => {
  it.runIf(existsSync(ENTRY_POINT))(
    'emits nothing but valid JSON-RPC messages, even with no API key',
    async () => {
      const { stdout } = await runSession({
        LIPDUB_API_KEY: '',
        LIPDUB_API_KEY_FILE: '',
        LIPDUB_LOG_LEVEL: 'debug',
      });

      const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const parsed: unknown = JSON.parse(line);
        expect(parsed).toHaveProperty('jsonrpc', '2.0');
      }
    },
    30_000,
  );

  it.runIf(existsSync(ENTRY_POINT))(
    'starts successfully without a key and still lists its tools',
    async () => {
      // A server that exits on a missing key shows up in every client as an
      // undiagnosable connection failure, so starting cleanly is the desired behaviour.
      const { stdout } = await runSession({ LIPDUB_API_KEY: '', LIPDUB_API_KEY_FILE: '' });

      const messages = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } });

      const toolList = messages.find((message) => message.id === 2);
      expect(toolList?.result?.tools).toHaveLength(5);
    },
    30_000,
  );

  it.runIf(existsSync(ENTRY_POINT))(
    'answers --version and --help without polluting stdout',
    async () => {
      // These are the first things anyone reaches for when a client config looks
      // broken, so they must work — but they must still leave stdout clean, because
      // a client may already be listening on it for JSON-RPC.
      for (const flag of ['--version', '--help']) {
        const { stdout, stderr } = await runOnce([flag]);
        expect(stdout, `${flag} wrote to stdout`).toBe('');
        expect(stderr).toContain('lipdub-mcp');
      }
    },
    30_000,
  );

  it.runIf(existsSync(ENTRY_POINT))(
    'never writes the API key to stderr, even at debug level',
    async () => {
      const secret = 'super-secret-key-abcdef123456';
      const { stdout, stderr } = await runSession({
        LIPDUB_API_KEY: secret,
        LIPDUB_LOG_LEVEL: 'debug',
      });

      expect(stderr).not.toContain(secret);
      expect(stdout).not.toContain(secret);
    },
    30_000,
  );
});
