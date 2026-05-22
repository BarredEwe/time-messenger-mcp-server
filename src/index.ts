#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TimeClient } from './client/time-client.js';
import { loadSavedAuth, saveAuth } from './client/auth-store.js';
import { messageTools } from './tools/messages.js';
import { threadTools } from './tools/threads.js';
import { channelTools } from './tools/channels.js';
import { teamTools } from './tools/teams.js';
import { userTools } from './tools/users.js';
import { authTools } from './tools/auth.js';
import type { MfaLoginResult } from './tools/auth.js';
import express from "express";
import os from "os";
import path from "path";
import fs from "fs";
import winston from "winston";

function getDefaultLogDirectory() {
    if (process.platform === "win32") {
        const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        return path.join(base, "time-mcp");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Logs", "time-mcp");
    }
    const xdgStateHome = process.env.XDG_STATE_HOME;
    if (xdgStateHome && xdgStateHome.length > 0) {
        return path.join(xdgStateHome, "time-mcp");
    }
    return path.join(os.homedir(), ".local", "state", "time-mcp");
}
function isTruthyEnv(value) {
    if (value === undefined || value === null)
        return false;
    const normalized = String(value).toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
}

function getHttpPort() {
    const rawPort = process.env.MCP_HTTP_PORT || process.env.PORT;
    const parsedPort = Number(rawPort);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
        return parsedPort;
    }
    return 8000;
}

function getLogFilePath() {
    if (isTruthyEnv(process.env.TIME_LOG_DISABLE)) {
        return undefined;
    }
    const explicitFile = process.env.TIME_LOG_FILE;
    if (explicitFile && explicitFile.trim().length > 0) {
        return explicitFile;
    }
    const baseDir = process.env.TIME_LOG_DIR &&
        process.env.TIME_LOG_DIR.trim().length > 0
        ? process.env.TIME_LOG_DIR
        : getDefaultLogDirectory();
    let effectiveDir = baseDir;
    if (isTruthyEnv(process.env.TIME_LOG_PER_CWD)) {
        const sanitizedCwd = process
            .cwd()
            .replace(/[\\/]/g, "_")
            .replace(/[:*?"<>|]/g, "");
        effectiveDir = path.join(baseDir, sanitizedCwd);
    }
    try {
        fs.mkdirSync(effectiveDir, { recursive: true });
    }
    catch {
        return undefined; // If we cannot create the directory, disable file logging rather than polluting CWD
    }
    return path.join(effectiveDir, "time.log");
}
const resolvedLogFile = getLogFilePath();
const logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: resolvedLogFile
        ? [new winston.transports.File({ filename: resolvedLogFile })]
        : [],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allTools: any[] = [...authTools, ...messageTools, ...threadTools, ...channelTools, ...teamTools, ...userTools];

class TimeMcpServer {
  private server: Server;
  private client: TimeClient | null = null;
  private userId: string = '';
  private timeUrl: string;
  private timeToken: string | undefined;
  private timeLoginId: string | undefined;
  private timePassword: string | undefined;
  private initPromise: Promise<void> | null = null;
  private mfaRequired = false;

  constructor() {
    this.timeUrl = process.env.TIME_URL || '';
    this.timeToken = process.env.TIME_TOKEN;
    this.timeLoginId = process.env.TIME_LOGIN_ID;
    this.timePassword = process.env.TIME_PASSWORD;

    if (!this.timeUrl) {
      throw new Error('TIME_URL environment variable is required');
    }

    if (!this.timeToken && !(this.timeLoginId && this.timePassword)) {
      throw new Error(
        'Authentication required: set TIME_TOKEN (Personal Access Token) or TIME_LOGIN_ID + TIME_PASSWORD'
      );
    }

    this.server = new Server(
      {
        name: 'time-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async ensureClient(): Promise<TimeClient> {
    if (this.client) {
      return this.client;
    }

    if (this.mfaRequired) {
      throw new Error(
        'MFA verification required. Please use the login_with_mfa tool with your authenticator code to complete login.'
      );
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.client!;
    }

    this.initPromise = this.initClient();
    await this.initPromise;
    return this.client!;
  }

  private async initClient(): Promise<void> {
    // 1. Try TIME_TOKEN env var first
    if (this.timeToken) {
      this.client = new TimeClient(this.timeUrl, this.timeToken);
      try {
        const me = await this.client.getMe();
        this.userId = me.id;
        console.error('Authenticated with TIME_TOKEN');
        return;
      } catch {
        console.error('TIME_TOKEN is invalid, falling back to saved/session auth');
        this.client = null;
      }
    }

    // 2. Try saved auth token
    const saved = loadSavedAuth(this.timeUrl);
    if (saved) {
      this.client = new TimeClient(this.timeUrl, saved.token);
      try {
        const me = await this.client.getMe();
        this.userId = me.id;
        console.error('Authenticated with saved token');
        return;
      } catch {
        console.error('Saved token expired, re-authenticating...');
        this.client = null;
      }
    }

    // 3. Login with credentials
    if (this.timeLoginId && this.timePassword) {
      console.error('Logging in with credentials...');
      try {
        this.client = await TimeClient.login(this.timeUrl, this.timeLoginId, this.timePassword);
        const me = await this.client.getMe();
        this.userId = me.id;
        saveAuth(this.timeUrl, this.client.tokenValue, this.userId);
        console.error('Login successful, token saved');
        return;
      } catch (error: unknown) {
        const err = error as Error & { mfaRequired?: boolean };
        if (err.mfaRequired) {
          this.mfaRequired = true;
          console.error('MFA required - waiting for login_with_mfa tool call');
        } else {
          throw error;
        }
      }
    }
  }

  private async onClientAuthenticated(client: TimeClient): Promise<void> {
    this.client = client;
    this.mfaRequired = false;
    try {
      const me = await client.getMe();
      this.userId = me.id;
      saveAuth(client.baseUrlValue, client.tokenValue, this.userId);
      console.error('Auth token saved for future sessions');
    } catch {
      // ignore
    }
  }

  async connect(transport) {
        await this.server.connect(transport);
    }
    async close() {
        await this.server.close();
    }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = allTools.find((t) => t.name === name);

      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      try {
        if (name === 'login_with_mfa') {
          const result = (await tool.handler(
            null,
            args,
            '',
            {
              loginId: this.timeLoginId,
              password: this.timePassword,
              timeUrl: this.timeUrl,
              loginFn: TimeClient.login.bind(TimeClient),
            }
          )) as MfaLoginResult;

          if (result.client) {
            await this.onClientAuthenticated(result.client);
          }

          return { content: result.content };
        }

        const client = await this.ensureClient();

        if (!this.userId) {
          const me = await client.getMe();
          this.userId = me.id;
        }

        const result = await tool.handler(client, args, this.userId);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw error;
      }
    });
  }
}

const app = express();
app.use(express.json());
app.post("/mcp", async (req, res) => {
    const server = new TimeMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    res.on("close", () => {
        transport.close().catch((error) => {
            logger.error("Error closing /mcp transport", { error });
        });
        server.close().catch((error) => {
            logger.error("Error closing /mcp server", { error });
        });
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        logger.error("Error handling /mcp request", { error });
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: "Internal server error",
                },
                id: null,
            });
        }
    }
});
const port = getHttpPort();
const serverPromise = new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, () => {
        logger.info("Time MCP HTTP server running", {
            port,
            streamableHttpEndpoint: "/mcp",
        });
        resolve();
    });
    httpServer.on("error", reject);
});
serverPromise.catch((error) => {
    logger.error("Server error", error);
    process.exit(1);
});