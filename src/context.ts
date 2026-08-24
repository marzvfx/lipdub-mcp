import { readFileSync } from 'node:fs';
import { LipDubClient } from './lipdub/client.js';
import {
  API_BASE_URL_ENV_VAR,
  API_KEY_ENV_VAR,
  API_KEY_FILE_ENV_VAR,
  DEFAULT_API_BASE_URL,
  DEFAULT_MAX_RENDERS_PER_SESSION,
  MAX_RENDERS_PER_SESSION_ENV_VAR,
  REQUIRE_SPEND_CONFIRMATION_ENV_VAR,
} from './lipdub/constants.js';
import { RenderService } from './lipdub/renders.js';
import { Logger } from './logging.js';

/**
 * Per-session state and dependencies.
 *
 * Deliberately transport-agnostic. The stdio transport resolves the API key once from
 * the environment; a future HTTP transport would resolve it per request from an
 * Authorization header. Keeping the key behind this boundary is what makes that a
 * small change rather than a rewrite.
 */
export interface ServerContext {
  client: LipDubClient;
  renders: RenderService;
  logger: Logger;
  /** Whether a render must be explicitly confirmed before it can spend credits. */
  requireSpendConfirmation: boolean;
  /** Ceiling on renders started by this process. */
  maxRendersPerSession: number;
  /** How many renders this process has started so far. */
  rendersStarted: number;
}

/**
 * Read the API key.
 *
 * Only two sources are supported, both out-of-band: an environment variable, or a
 * file it points at. A command-line flag is deliberately unsupported because argv is
 * readable by other processes and lands in shell history, and the key is never
 * accepted as a tool parameter because that would place it in the model's context
 * where prompt injection could exfiltrate it.
 *
 * @param environment Process environment.
 * @returns The key, or undefined when none is configured.
 */
export function resolveApiKey(environment: NodeJS.ProcessEnv): string | undefined {
  const keyFilePath = environment[API_KEY_FILE_ENV_VAR]?.trim();
  if (keyFilePath) {
    try {
      const fromFile = readFileSync(keyFilePath, 'utf8').trim();
      if (fromFile.length > 0) {
        return fromFile;
      }
    } catch {
      // Fall through to the environment variable. The tool layer reports a missing
      // key with actionable setup instructions, which is more useful than crashing
      // at startup over an unreadable path.
    }
  }

  const fromEnvironment = environment[API_KEY_ENV_VAR]?.trim();
  return fromEnvironment && fromEnvironment.length > 0 ? fromEnvironment : undefined;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build the server context from the environment.
 *
 * @param environment Process environment.
 * @returns A ready-to-use context.
 */
export function createContext(environment: NodeJS.ProcessEnv): ServerContext {
  const apiKey = resolveApiKey(environment);
  const logger = Logger.fromEnvironment(environment, [apiKey]);

  const client = new LipDubClient({
    apiKey,
    baseUrl: environment[API_BASE_URL_ENV_VAR]?.trim() || DEFAULT_API_BASE_URL,
    logger,
  });

  return {
    client,
    renders: new RenderService(client),
    logger,
    requireSpendConfirmation: parseBooleanEnv(
      environment[REQUIRE_SPEND_CONFIRMATION_ENV_VAR],
      true,
    ),
    maxRendersPerSession: parsePositiveIntegerEnv(
      environment[MAX_RENDERS_PER_SESSION_ENV_VAR],
      DEFAULT_MAX_RENDERS_PER_SESSION,
    ),
    rendersStarted: 0,
  };
}
