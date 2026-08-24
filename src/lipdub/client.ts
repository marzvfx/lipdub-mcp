import { Logger } from '../logging.js';
import { SERVER_NAME, SERVER_VERSION } from '../version.js';
import { API_KEY_HEADER, DEFAULT_API_BASE_URL, HTTP_TIMEOUT_MILLISECONDS } from './constants.js';
import { classifyHttpFailure, LipDubError, LipDubErrorCode, lipdubError } from './errors.js';

/**
 * Thin HTTP client for the LipDub API.
 *
 * Responsibilities beyond issuing the request:
 *
 * - Attach the API key, and never let it reach a log line or an exception message.
 * - Sniff the response content type. The gateway serves 5xx responses as an HTML
 *   error page, so calling `.json()` unconditionally throws a parse error that
 *   obscures the real failure.
 * - Convert every non-2xx response into a {@link LipDubError} carrying one of our own
 *   messages, so no upstream body ever reaches the caller.
 */

/** Options for constructing a client. */
export interface LipDubClientOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  logger: Logger;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImplementation?: typeof fetch;
  timeoutMilliseconds?: number;
}

/** Headers that may carry a correlation id useful for support. */
const REQUEST_ID_HEADERS: readonly string[] = ['x-amzn-requestid', 'x-amzn-trace-id', 'x-request-id'];

export class LipDubClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMilliseconds: number;

  constructor(options: LipDubClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.logger = options.logger;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? HTTP_TIMEOUT_MILLISECONDS;
  }

  /** Whether a key is configured. Tools check this to give the setup message. */
  hasApiKey(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
  }

  /**
   * Issue a GET request and return the decoded JSON body.
   *
   * @param path API path beginning with a slash.
   * @returns The parsed body.
   * @throws LipDubError For any non-2xx response or transport failure.
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /**
   * Issue a POST request and return the decoded JSON body.
   *
   * @param path API path beginning with a slash.
   * @param body JSON-serialisable request body.
   * @returns The parsed body.
   * @throws LipDubError For any non-2xx response or transport failure.
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.hasApiKey()) {
      throw lipdubError(LipDubErrorCode.NoApiKey);
    }

    const url = `${this.baseUrl}${path}`;
    const startedAt = Date.now();

    // The key is placed directly into the header object at the call site and is never
    // stored on a request record, so it cannot be picked up by a logger later.
    const headers: Record<string, string> = {
      [API_KEY_HEADER]: this.apiKey as string,
      Accept: 'application/json',
      'User-Agent': `${SERVER_NAME}/${SERVER_VERSION}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      });
    } catch (cause) {
      // Transport-level failures (DNS, TLS, timeout). The cause is logged but never
      // returned, because a fetch error message can embed the full request.
      this.logger.warn('upstream request failed', {
        method,
        path,
        durationMs: Date.now() - startedAt,
        reason: cause instanceof Error ? cause.name : 'unknown',
      });
      throw lipdubError(LipDubErrorCode.ServiceUnavailable);
    }

    const requestId = this.extractRequestId(response);

    this.logger.debug('upstream response', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId,
    });

    const parsedBody = await this.parseJsonBody(response);

    if (!response.ok) {
      throw classifyHttpFailure(response.status, parsedBody, requestId);
    }

    if (parsedBody === null) {
      throw lipdubError(LipDubErrorCode.Unexpected, requestId);
    }

    return parsedBody as T;
  }

  /**
   * Parse a response body as JSON, tolerating non-JSON content.
   *
   * The gateway serves 5xx as `text/html`, and a truncated response can fail to parse
   * even with a JSON content type, so both cases return null rather than throwing.
   *
   * @param response Response to read.
   * @returns The parsed object, or null when the body was not a JSON object.
   */
  private async parseJsonBody(response: Response): Promise<Record<string, unknown> | null> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return null;
    }

    try {
      const parsed: unknown = await response.json();
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private extractRequestId(response: Response): string | null {
    for (const header of REQUEST_ID_HEADERS) {
      const value = response.headers.get(header);
      if (value) {
        return value;
      }
    }
    return null;
  }
}

/**
 * Unwrap the `{ data: ... }` envelope most endpoints use.
 *
 * @param body Parsed response body.
 * @returns The `data` member when present, otherwise the body itself.
 */
export function unwrapData<T>(body: Record<string, unknown>): T {
  return (Object.hasOwn(body, 'data') ? body.data : body) as T;
}

export { LipDubError };
