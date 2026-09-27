#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Files } from './files.js';
import { SERVER_NAME, SERVER_VERSION, createServer } from './server.js';

/**
 * stdio entry point. Configuration (environment):
 *   VECTR_ALLOWED_DIRS  folders the server may read/write, separated by , or : (default: cwd)
 *   VECTR_APP_URL       Vectr app URL used for share links (default: http://localhost:5173/)
 * stdout carries the protocol, so all logging goes to stderr.
 */
async function main() {
  const files = Files.fromEnv();
  const server = createServer({ files, appUrl: process.env.VECTR_APP_URL ?? 'http://localhost:5173/' });
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} ${SERVER_VERSION} ready (stdio). Files: ${files.describe()}`);
}

main().catch((e) => {
  console.error(`${SERVER_NAME} failed to start:`, e);
  process.exit(1);
});
