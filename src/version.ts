/**
 * Server version, reported in MCP handshakes and the outbound User-Agent.
 *
 * Declared here rather than imported from package.json because a JSON import would
 * change the shape of the compiled output and pull the whole manifest into `dist/`.
 * `test/version.test.ts` asserts this stays equal to package.json, so the duplication
 * cannot drift silently.
 */
export const SERVER_VERSION = '0.1.0';

/** MCP server name, also used as the User-Agent product token. */
export const SERVER_NAME = 'lipdub-mcp';
