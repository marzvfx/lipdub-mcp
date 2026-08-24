import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from '../context.js';
import { createServer } from '../server.js';

/**
 * Start the server on the stdio transport.
 *
 * The key is resolved once, from the environment, and stays on the user's machine —
 * it is never sent anywhere except the LipDub API.
 *
 * The server starts successfully even with no key configured. That is deliberate: a
 * stdio server that exits during startup appears in every client as a bare "failed to
 * connect", with nothing telling the user that a missing key was the reason. Starting
 * cleanly means the tools are listed, and the first call returns setup instructions
 * the agent can relay verbatim.
 */
export async function startStdioServer(): Promise<void> {
  const context = createContext(process.env);
  const server = createServer(context);

  if (!context.client.hasApiKey()) {
    context.logger.warn(
      'no API key configured; tools will return setup instructions until LIPDUB_API_KEY is set',
    );
  }

  // Turning the spend gate off is legitimate for an unattended pipeline, but it is
  // exactly the kind of setting that gets copied into a shared config and forgotten.
  // Say so once at startup so it shows up in the client's server log.
  if (!context.requireSpendConfirmation) {
    context.logger.warn(
      'spend confirmation is DISABLED: renders will start without asking the user and will charge credits. Only safe when no human is watching.',
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
