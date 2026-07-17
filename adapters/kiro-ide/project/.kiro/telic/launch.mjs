import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Kiro can launch an MCP child from a parent workspace after an editor reload.
// Bind Telic to the project that owns this checked-in overlay, not process.cwd().
const overlayDirectory = dirname(fileURLToPath(import.meta.url));
process.env.TELIC_REPOSITORY_ROOT = resolve(overlayDirectory, "../..");

const { startStdioServer } = await import("./dist/mcp/server.js");
await startStdioServer();
