#!/usr/bin/env node
/**
 * Repo-local wrapper. Forwards to the built binary so `npm run smoke` and
 * `npx lipdub-mcp --smoke` are the same test.
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = join(repositoryRoot, 'dist', 'index.js');

if (!existsSync(entryPoint)) {
  process.stderr.write(`No build found at ${entryPoint}. Run: npm run build\n`);
  process.exit(2);
}

const child = spawn(process.execPath, [entryPoint, '--smoke', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
