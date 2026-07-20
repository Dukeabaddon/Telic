#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createTelicMcpServer } from "./server-factory.js";
import { TelicService } from "./service.js";

export async function startStdioServer(): Promise<void> {
  const repositoryRoot = process.env.TELIC_REPOSITORY_ROOT ?? process.cwd();
  const stateDirectory = process.env.TELIC_STATE_DIR;
  const service = new TelicService({
    repositoryRoot,
    ...(stateDirectory ? { stateDirectory } : {}),
  });
  const server = createTelicMcpServer(service);
  const close = async () => {
    await server.close();
    service.close();
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
  await server.connect(new StdioServerTransport());
  console.error(`Telic MCP ready for ${repositoryRoot}`);
}

if (import.meta.main) {
  startStdioServer().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown startup error";
    console.error(
      `Telic MCP failed: ${message.replaceAll(/[\r\n]+/g, " ").slice(0, 800)}`,
    );
    process.exitCode = 1;
  });
}
