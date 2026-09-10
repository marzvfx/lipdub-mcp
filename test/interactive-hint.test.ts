import { describe, expect, it } from 'vitest';
import { interactiveHint, shouldPrintInteractiveHint } from '../src/interactive-hint.js';

describe('interactive hint', () => {
  it('fires only for a bare TTY invocation, never for an MCP client', () => {
    expect(shouldPrintInteractiveHint(true, [])).toBe(true);
    expect(shouldPrintInteractiveHint(false, [])).toBe(false);
    expect(shouldPrintInteractiveHint(true, ['--smoke'])).toBe(false);
    expect(shouldPrintInteractiveHint(true, ['--help'])).toBe(false);
  });

  it('tells a human about --smoke rather than looking hung', () => {
    const text = interactiveHint();
    expect(text).toContain('not stuck');
    expect(text).toContain('--smoke');
    expect(text).toContain('npx -y lipdub-mcp');
  });
});
