import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { JsonObject, JsonValue } from "../types.js";

interface JsonRpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly method: string;
  readonly params: JsonObject;
}

interface NotificationWaiter {
  readonly method: string;
  readonly predicate: (params: unknown) => boolean;
  readonly resolve: (params: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface AppServerNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface AppServerTraceEvent {
  readonly sequence: number;
  readonly observed_at: string;
  readonly kind:
    | "client-request-sent"
    | "client-response-received"
    | "server-request-received"
    | "server-request-response-sent"
    | "notification-received"
    | "app-server-started"
    | "app-server-close-started"
    | "app-server-signal-sent"
    | "app-server-tree-kill-sent"
    | "app-server-exited"
    | "app-server-close-completed";
  readonly method: string | null;
  readonly request_id: number | string | null;
  readonly thread_id: string | null;
  readonly turn_id: string | null;
  readonly item_id: string | null;
  readonly item_type: string | null;
  readonly item_status: string | null;
  readonly process_id: string | null;
  readonly app_server_pid: number | null;
  readonly detail: string | null;
}

export interface ServerRequestRecord {
  readonly method: string;
  readonly decision:
    | "accept"
    | "decline"
    | "empty-permissions"
    | "scoped-permissions"
    | "unsupported";
}

export interface TurnResult {
  readonly thread_id: string;
  readonly turn_id: string;
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly error: string | null;
  readonly text: string;
  readonly item_types: readonly string[];
  readonly tool_items: readonly string[];
}

export interface AppServerClientOptions {
  readonly executable: string;
  readonly cwd: string;
  readonly requestTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

export function sanitizeAppServerText(value: string): string {
  return value
    .replace(/file:\/\/\/?[A-Za-z]:\/[^\r\n"']+/gi, "file:///<path>")
    .replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\r\n"']+/g, "<path>")
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, "<redacted-token>")
    .slice(0, 500);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("APP_SERVER_PROTOCOL_SHAPE_INVALID");
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boundedChildEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA",
    "CODEX_HOME",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);
  const bounded: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (
      allowed.has(upper) &&
      !/(?:TOKEN|KEY|SECRET|AUTH|COOKIE|PASSWORD)/.test(upper) &&
      value !== undefined
    ) {
      bounded[name] = value;
    }
  }
  return bounded;
}

export class AppServerClient {
  readonly #child;
  readonly #lineReader;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #waiters = new Set<NotificationWaiter>();
  readonly #requestTimeoutMs: number;
  readonly #turnTimeoutMs: number;
  readonly #cwd: string;
  #nextId = 1;
  #approvalDecision: "accept" | "decline" = "decline";
  #closed = false;
  #backpressureWaits = 0;
  #traceSequence = 0;
  public readonly notifications: AppServerNotification[] = [];
  public readonly serverRequests: ServerRequestRecord[] = [];
  public readonly redactedStderr: string[] = [];
  public readonly trace: AppServerTraceEvent[] = [];

  public constructor(options: AppServerClientOptions) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 180_000;
    this.#cwd = options.cwd;
    this.#child = spawn(
      options.executable,
      ["app-server", "-c", "mcp_servers={}", "--stdio"],
      {
        cwd: options.cwd,
        env: options.environment ?? boundedChildEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#lineReader = createInterface({ input: this.#child.stdout, crlfDelay: Infinity });
    this.#lineReader.on("line", (line) => this.#handleLine(line));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        if (this.redactedStderr.length < 50) {
          this.redactedStderr.push(sanitizeAppServerText(line));
        }
      }
    });
    this.#child.once("error", (error) => this.#failAll(new Error(`APP_SERVER_SPAWN_ERROR:${error.name}`)));
    this.#child.once("exit", (code, signal) => {
      this.#recordTrace(
        "app-server-exited",
        null,
        null,
        `code=${code ?? "signal"};signal=${signal ?? "none"}`,
      );
      if (!this.#closed && this.#pending.size > 0) {
        this.#failAll(new Error(`APP_SERVER_EXIT:${code ?? "signal"}:${signal ?? "none"}`));
      }
    });
    this.#recordTrace("app-server-started", null, null, null);
  }

  public get processId(): number {
    if (this.#child.pid === undefined) {
      throw new Error("APP_SERVER_PID_UNAVAILABLE");
    }
    return this.#child.pid;
  }

  public get backpressureWaits(): number {
    return this.#backpressureWaits;
  }

  public setApprovalDecision(decision: "accept" | "decline"): void {
    this.#approvalDecision = decision;
  }

  #recordTrace(
    kind: AppServerTraceEvent["kind"],
    method: string | null,
    message: { readonly id?: number | string; readonly params?: unknown } | null,
    detail: string | null,
  ): void {
    const params = optionalRecord(message?.params);
    const turn = optionalRecord(params?.turn);
    const item = optionalRecord(params?.item);
    this.#traceSequence += 1;
    this.trace.push({
      sequence: this.#traceSequence,
      observed_at: new Date().toISOString(),
      kind,
      method,
      request_id: message?.id ?? null,
      thread_id: optionalString(params?.threadId),
      turn_id: optionalString(params?.turnId) ?? optionalString(turn?.id),
      item_id: optionalString(params?.itemId) ?? optionalString(item?.id),
      item_type: optionalString(item?.type),
      item_status: optionalString(item?.status) ?? optionalString(turn?.status),
      process_id: optionalString(params?.processId) ?? optionalString(item?.processId),
      app_server_pid: this.#child.pid ?? null,
      detail,
    });
  }

  async #write(message: JsonRpcMessage): Promise<void> {
    if (this.#closed || this.#child.stdin.destroyed) {
      throw new Error("APP_SERVER_STDIN_CLOSED");
    }
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line, "utf8") > 2_000_000) {
      throw new Error("APP_SERVER_OUTBOUND_LINE_TOO_LARGE");
    }
    if (!this.#child.stdin.write(line, "utf8")) {
      this.#backpressureWaits += 1;
      await once(this.#child.stdin, "drain");
    }
  }

  #handleLine(line: string): void {
    if (Buffer.byteLength(line, "utf8") > 2_000_000) {
      this.#failAll(new Error("APP_SERVER_INBOUND_LINE_TOO_LARGE"));
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.#failAll(new Error("APP_SERVER_INVALID_JSON"));
      return;
    }
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.#recordTrace(
        "client-response-received",
        pending.method,
        { id: message.id, params: pending.params },
        message.error === undefined ? "result" : `error=${message.error.code ?? "unknown"}`,
      );
      clearTimeout(pending.timeout);
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new Error(
            `APP_SERVER_RESPONSE_ERROR:${message.error.code ?? "unknown"}:${sanitizeAppServerText(message.error.message ?? "error")}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      this.#recordTrace("server-request-received", message.method, message, null);
      void this.#handleServerRequest(message);
      return;
    }
    if (message.method !== undefined) {
      this.#recordTrace("notification-received", message.method, message, null);
      const notification = { method: message.method, params: message.params };
      this.notifications.push(notification);
      if (this.notifications.length > 2_000) {
        this.notifications.shift();
      }
      for (const waiter of this.#waiters) {
        if (waiter.method === message.method && waiter.predicate(message.params)) {
          clearTimeout(waiter.timeout);
          this.#waiters.delete(waiter);
          waiter.resolve(message.params);
        }
      }
    }
  }

  async #handleServerRequest(message: JsonRpcMessage): Promise<void> {
    const method = message.method ?? "unknown";
    const requestId = message.id;
    if (requestId === undefined) {
      throw new Error("APP_SERVER_REQUEST_ID_MISSING");
    }
    if (method === "permissions/requestApproval") {
      if (this.#approvalDecision === "accept") {
        this.serverRequests.push({ method, decision: "scoped-permissions" });
        await this.#write({
          id: requestId,
          result: {
            permissions: {
              fileSystem: {
                entries: [{ access: "write", path: { type: "path", path: this.#cwd } }],
              },
              network: { enabled: false },
            },
            scope: "turn",
            strictAutoReview: true,
          },
        });
        this.#recordTrace(
          "server-request-response-sent",
          method,
          message,
          "decision=scoped-permissions",
        );
      } else {
        this.serverRequests.push({ method, decision: "empty-permissions" });
        await this.#write({ id: requestId, result: { permissions: {}, scope: "turn" } });
        this.#recordTrace(
          "server-request-response-sent",
          method,
          message,
          "decision=empty-permissions",
        );
      }
      return;
    }
    if (method.includes("requestApproval")) {
      const decision = this.#approvalDecision;
      this.serverRequests.push({ method, decision });
      await this.#write({ id: requestId, result: { decision } });
      this.#recordTrace(
        "server-request-response-sent",
        method,
        message,
        `decision=${decision}`,
      );
      return;
    }
    this.serverRequests.push({ method, decision: "unsupported" });
    await this.#write({
      id: requestId,
      error: { code: -32601, message: "client method unsupported by bounded profile" },
    });
    this.#recordTrace("server-request-response-sent", method, message, "unsupported");
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.#waiters.clear();
  }

  public async request(method: string, params: JsonObject, timeoutMs = this.#requestTimeoutMs): Promise<unknown> {
    if (this.#pending.size >= 64) {
      throw new Error("APP_SERVER_PENDING_LIMIT");
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`APP_SERVER_REQUEST_TIMEOUT:${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout, method, params });
    });
    this.#recordTrace("client-request-sent", method, { id, params }, null);
    await this.#write({ id, method, params });
    return response;
  }

  public async notify(method: string): Promise<void> {
    await this.#write({ method });
  }

  public async initialize(): Promise<Record<string, unknown>> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "ados-local-gate0",
        title: "ADOS Local Gate 0",
        version: "0.1.0-public.1",
      },
      capabilities: null,
    });
    await this.notify("initialized");
    return record(result);
  }

  public async waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs = this.#turnTimeoutMs,
  ): Promise<unknown> {
    const existing = this.notifications.find(
      (notification) => notification.method === method && predicate(notification.params),
    );
    if (existing !== undefined) {
      return existing.params;
    }
    return new Promise<unknown>((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new Error(`APP_SERVER_NOTIFICATION_TIMEOUT:${method}`));
        }, timeoutMs),
      };
      this.#waiters.add(waiter);
    });
  }

  public async startThread(params: JsonObject): Promise<Record<string, unknown>> {
    return record(await this.request("thread/start", params));
  }

  public async startTurnAndWait(
    threadId: string,
    text: string,
    outputSchema?: JsonObject,
  ): Promise<TurnResult> {
    const turnId = await this.startTurn(threadId, text, outputSchema);
    return this.waitForTurnCompletion(threadId, turnId);
  }

  public async waitForTurnCompletion(
    threadId: string,
    turnId: string,
  ): Promise<TurnResult> {
    const completed = record(
      await this.waitForNotification(
        "turn/completed",
        (value) => {
          const paramsRecord = value as Record<string, unknown>;
          const turnRecord = paramsRecord.turn as Record<string, unknown> | undefined;
          return paramsRecord.threadId === threadId && turnRecord?.id === turnId;
        },
      ),
    );
    const completedTurn = record(completed.turn);
    const itemNotifications = this.notifications.filter((notification) => {
      if (notification.method !== "item/completed") {
        return false;
      }
      const itemParams = notification.params as Record<string, unknown>;
      return itemParams.threadId === threadId && itemParams.turnId === turnId;
    });
    let textResult = "";
    const itemTypes: string[] = [];
    const toolItems: string[] = [];
    for (const notification of itemNotifications) {
      const itemParams = record(notification.params);
      const item = record(itemParams.item);
      const type = String(item.type);
      itemTypes.push(type);
      if (type === "agentMessage") {
        textResult = String(item.text);
      } else if (["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch"].includes(type)) {
        toolItems.push(type);
      }
    }
    return {
      thread_id: threadId,
      turn_id: turnId,
      status: String(completedTurn.status) as TurnResult["status"],
      error:
        completedTurn.error === null || completedTurn.error === undefined
          ? null
          : sanitizeAppServerText(JSON.stringify(completedTurn.error)),
      text: textResult,
      item_types: itemTypes,
      tool_items: toolItems,
    };
  }

  public async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  public async startTurn(
    threadId: string,
    text: string,
    outputSchema?: JsonObject,
  ): Promise<string> {
    const params: JsonObject = {
      threadId,
      input: [{ type: "text", text }],
    };
    if (outputSchema !== undefined) {
      params.outputSchema = outputSchema;
    }
    const response = record(await this.request("turn/start", params));
    return String(record(response.turn).id);
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#recordTrace("app-server-close-started", null, null, null);
    this.#child.stdin.end();
    await this.#waitForExit(1_000);
    if (this.#isAlive()) {
      this.#recordTrace("app-server-signal-sent", null, null, "default-signal");
      this.#child.kill();
      await this.#waitForExit(2_000);
    }
    if (this.#isAlive() && process.platform === "win32") {
      this.#recordTrace("app-server-tree-kill-sent", null, null, "taskkill-tree-force");
      spawnSync("taskkill.exe", ["/PID", String(this.processId), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5_000,
      });
      await this.#waitForExit(2_000);
    }
    this.#lineReader.close();
    if (this.#isAlive()) {
      throw new Error("APP_SERVER_CLEANUP_FAILED");
    }
    this.#recordTrace("app-server-close-completed", null, null, null);
    this.#failAll(new Error("APP_SERVER_CLOSED"));
  }

  #isAlive(): boolean {
    return this.#child.exitCode === null && this.#child.signalCode === null;
  }

  async #waitForExit(timeoutMs: number): Promise<void> {
    if (!this.#isAlive()) {
      return;
    }
    await Promise.race([
      once(this.#child, "exit"),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

export function jsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}
