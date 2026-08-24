import { describe, expect, it } from 'vitest';
import {
  encodeRenderJobHandle,
  encodeTrackingHandle,
  HandleKind,
  InvalidHandleError,
  isTerminal,
  nextPollSeconds,
  parseHandle,
  phaseFromIngestStatus,
  phaseFromRenderJobStatus,
} from '../src/lipdub/status.js';
import { IngestStatus, RenderJobStatus, RenderPhase } from '../src/lipdub/types.js';

describe('handle encoding and parsing', () => {
  it('round-trips a render job handle', () => {
    const handle = encodeRenderJobHandle(12345);
    expect(handle).toBe('rnd_12345');
    expect(parseHandle(handle)).toEqual({ kind: HandleKind.RenderJob, jobId: 12345 });
  });

  it('round-trips a tracking handle', () => {
    const handle = encodeTrackingHandle('abc-def');
    expect(handle).toBe('trk_abc-def');
    expect(parseHandle(handle)).toEqual({ kind: HandleKind.Tracking, trackingId: 'abc-def' });
  });

  it('accepts a bare integer, because agents echo back the number they saw', () => {
    expect(parseHandle('987')).toEqual({ kind: HandleKind.RenderJob, jobId: 987 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseHandle('  rnd_5  ')).toEqual({ kind: HandleKind.RenderJob, jobId: 5 });
  });

  it.each(['', '   ', 'not-an-id', 'rnd_', 'rnd_abc', 'trk_'])(
    'rejects %o with an actionable error',
    (value) => {
      expect(() => parseHandle(value)).toThrow(InvalidHandleError);
    },
  );
});

describe('ingest status mapping', () => {
  it.each([
    [IngestStatus.Ingesting, RenderPhase.Preparing],
    [IngestStatus.Dispatching, RenderPhase.Preparing],
    [IngestStatus.Failed, RenderPhase.Failed],
  ])('maps %s to %s', (raw, expected) => {
    expect(phaseFromIngestStatus(raw)).toBe(expected);
  });

  it('keeps polling on an unknown value rather than declaring a paid render dead', () => {
    expect(phaseFromIngestStatus('some_future_state')).toBe(RenderPhase.Preparing);
  });
});

describe('render job status mapping', () => {
  it.each([
    [RenderJobStatus.NotStarted, RenderPhase.Queued],
    [RenderJobStatus.Pending, RenderPhase.Queued],
    [RenderJobStatus.Running, RenderPhase.Rendering],
    [RenderJobStatus.Finished, RenderPhase.Succeeded],
    [RenderJobStatus.Failed, RenderPhase.Failed],
    [RenderJobStatus.Cancelled, RenderPhase.Failed],
    [RenderJobStatus.Skipped, RenderPhase.Failed],
  ])('maps %s to %s', (raw, expected) => {
    expect(phaseFromRenderJobStatus(raw)).toBe(expected);
  });

  it('keeps polling on an unknown value', () => {
    expect(phaseFromRenderJobStatus('some_future_state')).toBe(RenderPhase.Queued);
  });

  it('covers every documented upstream job status', () => {
    // Guards against the API adding a state that silently falls into the default.
    const covered = Object.values(RenderJobStatus);
    expect(covered).toHaveLength(7);
    for (const status of covered) {
      expect(Object.values(RenderPhase)).toContain(phaseFromRenderJobStatus(status));
    }
  });
});

describe('terminality and poll pacing', () => {
  it('treats only succeeded and failed as terminal', () => {
    expect(isTerminal(RenderPhase.Succeeded)).toBe(true);
    expect(isTerminal(RenderPhase.Failed)).toBe(true);
    expect(isTerminal(RenderPhase.Preparing)).toBe(false);
    expect(isTerminal(RenderPhase.Queued)).toBe(false);
    expect(isTerminal(RenderPhase.Rendering)).toBe(false);
  });

  it('stops suggesting polls once terminal', () => {
    expect(nextPollSeconds(RenderPhase.Succeeded)).toBe(0);
    expect(nextPollSeconds(RenderPhase.Failed)).toBe(0);
  });

  it('polls faster while preparing, because ingest failures surface early', () => {
    expect(nextPollSeconds(RenderPhase.Preparing)).toBeLessThan(
      nextPollSeconds(RenderPhase.Rendering),
    );
  });
});
