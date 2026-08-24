import { LOG_LEVEL_ENV_VAR } from './lipdub/constants.js';
import { redactSecrets } from './redaction/redact.js';

/**
 * Structured logging for the MCP server.
 *
 * Everything goes to **stderr**. On the stdio transport, stdout carries the JSON-RPC
 * frames — a single stray `console.log` corrupts the stream and the client drops the
 * connection with no useful diagnostic. `test/no-stdout.test.ts` enforces this, and
 * the `no-console` ESLint rule stops it being reintroduced by hand.
 */

/** Severity levels, ordered from most to least verbose. */
export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  [LogLevel.Debug]: 10,
  [LogLevel.Info]: 20,
  [LogLevel.Warn]: 30,
  [LogLevel.Error]: 40,
};

/**
 * Default level.
 *
 * `warn` keeps a normal session silent. Anything chattier risks a user pasting a
 * debug transcript — which is one of the ways credentials escape — into a bug report.
 */
const DEFAULT_LOG_LEVEL = LogLevel.Warn;

function parseLogLevel(value: string | undefined): LogLevel {
  const candidate = (value ?? '').trim().toLowerCase();
  const known = Object.values(LogLevel).find((level) => level === candidate);
  return known ?? DEFAULT_LOG_LEVEL;
}

/** Additional structured fields attached to a log line. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * Writes redacted, level-filtered lines to stderr.
 *
 * The logger owns the list of secrets to scrub so that every call site is covered by
 * default rather than relying on each one remembering to redact.
 */
export class Logger {
  private readonly minimumPriority: number;
  private readonly secrets: readonly (string | undefined)[];

  /**
   * @param level Minimum level to emit.
   * @param secrets Credential values to scrub from every message.
   */
  constructor(level: LogLevel = DEFAULT_LOG_LEVEL, secrets: readonly (string | undefined)[] = []) {
    this.minimumPriority = LEVEL_PRIORITY[level];
    this.secrets = secrets;
  }

  /**
   * Build a logger from the environment.
   *
   * @param environment Process environment to read `LIPDUB_LOG_LEVEL` from.
   * @param secrets Credential values to scrub from every message.
   * @returns A configured logger.
   */
  static fromEnvironment(
    environment: NodeJS.ProcessEnv,
    secrets: readonly (string | undefined)[] = [],
  ): Logger {
    return new Logger(parseLogLevel(environment[LOG_LEVEL_ENV_VAR]), secrets);
  }

  debug(message: string, fields?: LogFields): void {
    this.write(LogLevel.Debug, message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write(LogLevel.Info, message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write(LogLevel.Warn, message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write(LogLevel.Error, message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_PRIORITY[level] < this.minimumPriority) {
      return;
    }

    const record = {
      level,
      message,
      ...(fields ?? {}),
    };

    // Redact after serialising so a secret hiding inside a nested field value is
    // still caught, not just one passed as the message.
    const line = redactSecrets(JSON.stringify(record), this.secrets);
    process.stderr.write(`${line}\n`);
  }
}
