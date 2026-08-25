import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_FILENAME_LENGTH, SUPPORTED_VIDEO_EXTENSIONS } from '../src/lipdub/constants.js';
import { resolveOutputFilename, sanitizeOutputFilename } from '../src/lipdub/filename.js';

describe('sanitizeOutputFilename', () => {
  it('keeps a already-valid name unchanged', () => {
    expect(sanitizeOutputFilename('ceo-welcome-spanish.mp4')).toBe('ceo-welcome-spanish.mp4');
  });

  it('appends a video extension when none is present', () => {
    expect(sanitizeOutputFilename('my render')).toBe('my render.mp4');
  });

  it('keeps other supported video extensions', () => {
    expect(sanitizeOutputFilename('clip.mov')).toBe('clip.mov');
    expect(sanitizeOutputFilename('clip.avi')).toBe('clip.avi');
  });

  it('does not treat .webm as a video extension, because the API rejects it', () => {
    // Regression guard: we previously advertised .webm support the API does not have.
    expect(sanitizeOutputFilename('clip.webm')).toBe('clip.webm.mp4');
  });

  it('derives the accepted list from the constant rather than a hardcoded copy', () => {
    for (const extension of SUPPORTED_VIDEO_EXTENSIONS) {
      expect(sanitizeOutputFilename(`clip${extension}`)).toBe(`clip${extension}`);
    }
  });

  it('treats an unsupported extension as part of the name', () => {
    // The value also becomes the customer's project name upstream, so a stray
    // extension is preserved rather than silently dropped.
    expect(sanitizeOutputFilename('clip.txt')).toBe('clip.txt.mp4');
  });

  it('strips directory components so the value cannot steer where a file lands', () => {
    expect(sanitizeOutputFilename('../../etc/passwd.mp4')).toBe('passwd.mp4');
    expect(sanitizeOutputFilename('C:\\Users\\me\\clip.mp4')).toBe('clip.mp4');
  });

  it('removes control characters, which are a prompt-injection formatting trick', () => {
    expect(sanitizeOutputFilename('good \x1b[31mbad.mp4')).toBe('good [31mbad.mp4');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeOutputFilename('///')).toBe('lipdub-render.mp4');
    expect(sanitizeOutputFilename('   ')).toBe('lipdub-render.mp4');
  });

  it('caps length while keeping a valid extension', () => {
    const result = sanitizeOutputFilename(`${'a'.repeat(500)}.mp4`);
    expect(result.length).toBeLessThanOrEqual(MAX_OUTPUT_FILENAME_LENGTH);
    expect(result.endsWith('.mp4')).toBe(true);
  });
});

describe('resolveOutputFilename', () => {
  it('prefers the caller-supplied name', () => {
    expect(resolveOutputFilename('chosen.mp4', 'https://x.test/source.mp4')).toBe('chosen.mp4');
  });

  it('derives a meaningful name from the source URL', () => {
    // Meaningful matters: upstream reuses this as the project name shown in the
    // customer's web app, so a random id would clutter their project list.
    expect(resolveOutputFilename(undefined, 'https://x.test/videos/keynote.mp4')).toBe(
      'keynote-lipdub.mp4',
    );
  });

  it('decodes percent-encoded basenames', () => {
    expect(resolveOutputFilename(undefined, 'https://x.test/my%20clip.mov')).toBe(
      'my clip-lipdub.mov',
    );
  });

  it('ignores query strings when deriving', () => {
    expect(resolveOutputFilename(undefined, 'https://x.test/a/take3.mp4?sig=abc&x=1')).toBe(
      'take3-lipdub.mp4',
    );
  });

  it('falls back when the URL has no usable basename', () => {
    expect(resolveOutputFilename(undefined, 'https://x.test/')).toBe('lipdub-render.mp4');
    expect(resolveOutputFilename(undefined, 'not a url')).toBe('lipdub-render.mp4');
    expect(resolveOutputFilename(undefined, undefined)).toBe('lipdub-render.mp4');
  });

  it('treats a blank requested name as absent', () => {
    expect(resolveOutputFilename('   ', 'https://x.test/a.mp4')).toBe('a-lipdub.mp4');
  });

  it('is deterministic, so the same inputs always give the same name', () => {
    const first = resolveOutputFilename(undefined, 'https://x.test/a.mp4');
    const second = resolveOutputFilename(undefined, 'https://x.test/a.mp4');
    expect(first).toBe(second);
  });
});
