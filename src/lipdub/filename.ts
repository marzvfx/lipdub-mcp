import { MAX_OUTPUT_FILENAME_LENGTH, SUPPORTED_VIDEO_EXTENSIONS } from './constants.js';

/**
 * Output filename derivation.
 *
 * The API requires `output_filename`, but it is meaningless to an agent, so this
 * server makes it optional and derives one. That is not cosmetic: on the URL-based
 * render path the value is also used upstream as the auto-created project, scene and
 * actor name, so it is what the customer later sees in the LipDub web app. A random
 * identifier would fill their project list with noise.
 *
 * The same reasoning drives sanitisation: the value crosses into other systems, so
 * path separators and control characters are stripped rather than passed along.
 */

/** Extension used when none can be derived. */
const DEFAULT_EXTENSION = '.mp4';

/** Suffix distinguishing the output from the source it was derived from. */
const DERIVED_SUFFIX = '-lipdub';

/** Fallback stem when there is nothing to derive from. */
const FALLBACK_STEM = 'lipdub-render';

/**
 * Strip anything unsafe from a caller-supplied filename.
 *
 * @param value Raw filename.
 * @returns A single path segment with a supported video extension, capped in length.
 */
export function sanitizeOutputFilename(value: string): string {
  // Take the last path segment so a caller passing a path cannot influence where the
  // file is written, then drop characters that are awkward in a filename or a name
  // field. Control characters go too: this string is echoed back to a model.
  const lastSegment = value.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = lastSegment.replace(/[\x00-\x1F\x7F<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (cleaned.length === 0) {
    return `${FALLBACK_STEM}${DEFAULT_EXTENSION}`;
  }

  const withExtension = hasSupportedVideoExtension(cleaned)
    ? cleaned
    : `${cleaned}${DEFAULT_EXTENSION}`;

  if (withExtension.length <= MAX_OUTPUT_FILENAME_LENGTH) {
    return withExtension;
  }

  // Truncate the stem rather than the extension, so the result stays a valid video
  // filename.
  const extension = extensionOf(withExtension) ?? DEFAULT_EXTENSION;
  const stemBudget = MAX_OUTPUT_FILENAME_LENGTH - extension.length;
  return `${withExtension.slice(0, stemBudget)}${extension}`;
}

/**
 * Choose an output filename.
 *
 * Preference order: the caller's value, then the source video's basename with a
 * suffix, then a fixed fallback. A timestamp is deliberately not used — it would make
 * results non-deterministic and therefore untestable, and the upstream id already
 * disambiguates two renders of the same source.
 *
 * @param requested Caller-supplied filename, if any.
 * @param videoUrl Source video URL, used to derive a name when none was supplied.
 * @returns A sanitised filename.
 */
export function resolveOutputFilename(
  requested: string | undefined,
  videoUrl: string | undefined,
): string {
  if (requested && requested.trim().length > 0) {
    return sanitizeOutputFilename(requested);
  }

  const derived = deriveFromUrl(videoUrl);
  return derived ?? `${FALLBACK_STEM}${DEFAULT_EXTENSION}`;
}

function deriveFromUrl(videoUrl: string | undefined): string | null {
  if (!videoUrl) {
    return null;
  }

  let pathname: string;
  try {
    pathname = new URL(videoUrl).pathname;
  } catch {
    return null;
  }

  const basename = decodeURIComponent(pathname.split('/').pop() ?? '');
  if (basename.length === 0) {
    return null;
  }

  const extension = extensionOf(basename);
  const stem = extension ? basename.slice(0, -extension.length) : basename;
  if (stem.trim().length === 0) {
    return null;
  }

  return sanitizeOutputFilename(`${stem}${DERIVED_SUFFIX}${extension ?? DEFAULT_EXTENSION}`);
}

function extensionOf(filename: string): string | null {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(dotIndex).toLowerCase() : null;
}

function hasSupportedVideoExtension(filename: string): boolean {
  const extension = extensionOf(filename);
  return extension !== null && SUPPORTED_VIDEO_EXTENSIONS.includes(extension);
}
