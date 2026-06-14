#!/usr/bin/env node
/**
 * CATAAM MCP connector — entry point.
 *
 * Transports (select with MCP_TRANSPORT):
 *   - stdio (default)         — used by the Claude plugin / `claude mcp add`.
 *   - http  (streamable-HTTP) — used for remote/hosted SaaS deployment.
 *                               Reads a per-request `X-API-Key` header so a single
 *                               hosted server can serve many CATAAM orgs.
 */

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type CataamConfig } from "./config.js";
import { CataamClient } from "./client.js";
import { registerTools } from "./tools.js";

const NAME = "cataam";
const VERSION = "0.1.0";

function buildServer(overrides: Partial<CataamConfig> = {}): McpServer {
  const cfg = loadConfig(overrides);
  const client = new CataamClient(cfg);
  const server = new McpServer({ name: NAME, version: VERSION });
  registerTools(server, client);
  return server;
}

async function runStdio(): Promise<void> {
  // Validate env auth up front so misconfig fails fast with a clear message.
  loadConfig();
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[cataam-mcp] stdio transport ready`);
}

async function runHttp(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req: Request, res: Response) => res.json({ status: "ok", server: NAME }));

  // Stateless: a fresh server+transport per request, so each can use its own
  // X-API-Key without cross-request session state.
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const headerKey = req.header("x-api-key");
      const server = buildServer(headerKey ? { apiKey: headerKey } : {});
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal error: ${(err as Error).message}` },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server; use POST)." },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(port, () => console.error(`[cataam-mcp] streamable-http transport on :${port}/mcp`));
}

async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  if (transport === "http" || transport === "streamable-http") {
    await runHttp(Number(process.env.PORT ?? 3000));
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error(`[cataam-mcp] fatal: ${(err as Error).message}`);
  process.exit(1);
});
