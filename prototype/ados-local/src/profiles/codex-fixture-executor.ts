import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { hashCanonical } from "../canonical/index.js";
import type { JsonObject } from "../types.js";
import {
  AppServerClient,
  type TurnResult,
} from "./app-server-client.js";
import { slice2FixtureTask, type FixtureTaskSpecification } from "./fixture-task.js";

const expectedExecutableSha = "ecd7a3eaff5e42723dbba03b5c91514b3986b5db5cbca8f34619620b5356f31f";
const expectedVersion = "codex-cli 0.146.0-alpha.9.2";
const slice4ExecutableDirectory = "68de26ad08be95cd";
const slice4ExecutableSha = "fa960ec081bec3629f40c63ed610ebc49c7e5e077dfb42322b08cb6d460f0b8a";
const slice4Version = "codex-cli 0.147.0-alpha.1.2";

export function fixtureExecutorCapabilityDigest(): string {
  return hashCanonical({
    profile_id: "executor.codex-app-server.fixture-v0.1",
    profile_version: "0.1.0-public.1",
    executable_sha256: expectedExecutableSha,
    sandbox: "workspace-write",
    approval_policy: "never",
    mcp: "disabled",
    network: "sandbox-denied",
    gh_on_path: false,
    credential_environment_names: [],
    sqlite_handle: false,
  });
}

export function slice4FixtureExecutorCapabilityDigest(): string {
  return hashCanonical({
    profile_id: "executor.codex-app-server.fixture-v0.1",
    profile_version: "0.1.0-slice4-pin-public.1",
    executable_sha256: slice4ExecutableSha,
    sandbox: "workspace-write",
    approval_policy: "never",
    mcp: "disabled",
    network: "sandbox-denied",
    gh_on_path: false,
    credential_environment_names: [],
    sqlite_handle: false,
  });
}

export interface CodexFixtureExecution {
  readonly thread_id: string;
  readonly turn_id: string;
  readonly status: "completed";
  readonly capability_digest: string;
  readonly agent_claim_digest: string;
  readonly tool_items: readonly string[];
  readonly resumed_after_restart: true;
  readonly thread_disposition: "CREATED" | "REUSED";
  readonly gh_on_path: false;
  readonly credential_environment_names: readonly [];
}

export interface CodexFixtureRepair {
  readonly thread_id: string;
  readonly turn_id: string;
  readonly status: "completed";
  readonly agent_claim_digest: string;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CODEX_FIXTURE_PROTOCOL_INVALID");
  }
  return value as Record<string, unknown>;
}

function threadIdentity(result: Record<string, unknown>): string {
  const thread = record(result.thread);
  const id = String(thread.id ?? "");
  if (id.length < 8) {
    throw new Error("CODEX_FIXTURE_THREAD_ID_INVALID");
  }
  return id;
}

function executablePath(task: FixtureTaskSpecification): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) {
    throw new Error("BLOCKED_CODEX_TRANSPORT:LOCALAPPDATA_UNAVAILABLE");
  }
  const isSlice4 = task.task_id === "fixture-dogfood-safety-v0.1";
  const executable = join(
    localAppData,
    "OpenAI",
    "Codex",
    "bin",
    isSlice4 ? slice4ExecutableDirectory : "d7e8094cfb76a267",
    "codex.exe",
  );
  if (!existsSync(executable)) {
    throw new Error("BLOCKED_CODEX_TRANSPORT:EXACT_EXECUTABLE_UNAVAILABLE");
  }
  const digest = createHash("sha256").update(readFileSync(executable)).digest("hex");
  if (digest !== (isSlice4 ? slice4ExecutableSha : expectedExecutableSha)) {
    throw new Error("CODEX_EXECUTABLE_IDENTITY_DRIFT");
  }
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== (isSlice4 ? slice4Version : expectedVersion)) {
    throw new Error("CODEX_EXECUTABLE_VERSION_DRIFT");
  }
  return executable;
}

function executorEnvironment(): NodeJS.ProcessEnv {
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
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (
      allowed.has(upper) &&
      !/(?:TOKEN|KEY|SECRET|AUTH|COOKIE|PASSWORD)/.test(upper) &&
      value !== undefined
    ) {
      environment[name] = value;
    }
  }
  const originalPath = environment.Path ?? environment.PATH ?? "";
  const safePath = originalPath
    .split(delimiter)
    .filter((entry) => entry.length > 0 && !existsSync(join(entry, "gh.exe")))
    .join(delimiter);
  if (environment.Path !== undefined) {
    environment.Path = safePath;
  } else {
    environment.PATH = safePath;
  }
  return environment;
}

function assertCompleted(turn: TurnResult): void {
  if (turn.status !== "completed" || turn.error !== null) {
    throw new Error(`CODEX_FIXTURE_TURN_FAILED:${turn.status}:${turn.error ?? "none"}`);
  }
  if (turn.tool_items.some((type) => ["mcpToolCall", "dynamicToolCall", "webSearch"].includes(type))) {
    throw new Error("CODEX_FIXTURE_FORBIDDEN_TOOL_USED");
  }
}

function outputSchema(): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "changed_paths", "summary"],
    properties: {
      status: { type: "string", const: "candidate_ready" },
      changed_paths: {
        type: "array",
        items: {
          type: "string",
          enum: ["README.md", "src/index.js", "test/summary.test.js"],
        },
      },
      summary: { type: "string", minLength: 10, maxLength: 500 },
    },
  };
}

async function createOrResumeUniqueThread(
  client: AppServerClient,
  worktreePath: string,
): Promise<{ readonly thread_id: string; readonly disposition: "CREATED" | "REUSED" }> {
  const listed = record(await client.request("thread/list", {
    cwd: worktreePath,
    archived: false,
    limit: 10,
    sortKey: "created_at",
    sortDirection: "desc",
  }));
  const data = Array.isArray(listed.data) ? listed.data : [];
  const matches = data
    .map((value) => record(value))
    .filter((thread) =>
      String(thread.cwd).toLowerCase() === worktreePath.toLowerCase() &&
      thread.ephemeral === false);
  if (matches.length > 1) {
    throw new Error(`CODEX_FIXTURE_THREAD_COLLISION:${matches.length}`);
  }
  const existing = matches[0];
  if (existing !== undefined) {
    const threadId = String(existing.id);
    const resumed = record(await client.request("thread/resume", {
      threadId,
      cwd: worktreePath,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    }));
    if (record(resumed.thread).id !== threadId) {
      throw new Error("CODEX_FIXTURE_THREAD_RECONCILE_FAILED");
    }
    return { thread_id: threadId, disposition: "REUSED" };
  }
  const started = await client.startThread({
    cwd: worktreePath,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    ephemeral: false,
    baseInstructions: "Operate only in the supplied fixture worktree. No network, GitHub, gh, parent-directory access, SQLite, credentials, commit, push, merge, release, or deployment.",
    developerInstructions: "One bounded implementation turn. Respect the repository AGENTS.md and exact three-file allowlist. Tests and agent output do not grant Owner acceptance.",
  });
  return { thread_id: threadIdentity(started), disposition: "CREATED" };
}

function implementationPrompt(task: FixtureTaskSpecification): string {
  return [
    `Implement the currently RUNNING ${task.task_id} Objective in this worktree.`,
    "Read AGENTS.md and docs/HARNESS.md first.",
    "Modify only README.md, src/index.js, and test/summary.test.js.",
    `Add CLI option ${task.cli_option} whose exact stdout line is: ${task.exact_output}`,
    "Preserve node src/index.js fixtures/order.json --machine byte-for-byte apart from its existing trailing newline:",
    '{"order_id":"SO-1001","currency":"AUD","item_count":3,"total":"42.50"}',
    ...(task.accepted_modes.includes("--owner-summary")
      ? ["Preserve node src/index.js fixtures/order.json --owner-summary byte-for-byte: Order SO-1001: 3 items; total AUD 42.50."]
      : []),
    ...(task.accepted_modes.includes("--owner-review")
      ? ["Preserve node src/index.js fixtures/order.json --owner-review byte-for-byte: Order SO-1001 is ready for owner review: 3 items; total AUD 42.50."]
      : []),
    "Keep zero third-party dependencies. Do not edit package files, AGENTS.md, docs/HARNESS.md, or fixtures.",
    "Run the repository tests if useful. Do not commit, push, invoke gh, access GitHub, inspect parent directories, or access any SQLite database.",
    "Return only the requested structured result after the bounded edits are complete.",
  ].join("\n");
}

export async function executeFixtureWithCodex(
  worktreePath: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): Promise<CodexFixtureExecution> {
  const executable = executablePath(task);
  const environment = executorEnvironment();
  const credentialNames = Object.keys(environment).filter((name) =>
    /(?:TOKEN|KEY|SECRET|AUTH|COOKIE|PASSWORD)/.test(name.toUpperCase()),
  );
  if (credentialNames.length !== 0) {
    throw new Error("CODEX_FIXTURE_CREDENTIAL_ENVIRONMENT_DRIFT");
  }
  const pathValue = environment.Path ?? environment.PATH ?? "";
  const ghOnPath = pathValue.split(delimiter).some((entry) => existsSync(join(entry, "gh.exe")));
  if (ghOnPath) {
    throw new Error("CODEX_FIXTURE_GH_AUTHORITY_PRESENT");
  }
  const capabilityDigest = task.task_id === "fixture-dogfood-safety-v0.1"
    ? slice4FixtureExecutorCapabilityDigest()
    : fixtureExecutorCapabilityDigest();

  let client: AppServerClient | null = new AppServerClient({
    executable,
    cwd: worktreePath,
    environment,
    turnTimeoutMs: 300_000,
  });
  let threadId = "";
  let threadDisposition: "CREATED" | "REUSED" = "CREATED";
  let turn: TurnResult | null = null;
  try {
    await client.initialize();
    const account = record(await client.request("account/read", { refreshToken: false }));
    if (account.requiresOpenaiAuth !== true || account.account === null) {
      throw new Error("CODEX_AUTH_UNAVAILABLE");
    }
    const thread = await createOrResumeUniqueThread(client, worktreePath);
    threadId = thread.thread_id;
    threadDisposition = thread.disposition;
    turn = await client.startTurnAndWait(
      threadId,
      implementationPrompt(task),
      outputSchema(),
    );
    assertCompleted(turn);
    const claim = record(JSON.parse(turn.text) as unknown);
    if (
      claim.status !== "candidate_ready" ||
      !Array.isArray(claim.changed_paths) ||
      claim.changed_paths.some((path) =>
        !["README.md", "src/index.js", "test/summary.test.js"].includes(String(path)))
    ) {
      throw new Error("CODEX_FIXTURE_AGENT_CLAIM_INVALID");
    }
    if (client.serverRequests.length !== 0) {
      throw new Error("CODEX_FIXTURE_APPROVAL_REQUESTED");
    }
  } finally {
    await client.close();
    client = null;
  }
  if (turn === null || threadId.length === 0) {
    throw new Error("CODEX_FIXTURE_RESULT_MISSING");
  }

  const restartClient = new AppServerClient({
    executable,
    cwd: worktreePath,
    environment,
    turnTimeoutMs: 120_000,
  });
  try {
    await restartClient.initialize();
    const resumed = record(await restartClient.request("thread/resume", {
      threadId,
      cwd: worktreePath,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    }));
    if (record(resumed.thread).id !== threadId) {
      throw new Error("CODEX_FIXTURE_SESSION_REUSE_FAILED");
    }
  } finally {
    await restartClient.close();
  }

  return {
    thread_id: threadId,
    turn_id: turn.turn_id,
    status: "completed",
    capability_digest: capabilityDigest,
    agent_claim_digest: hashCanonical({ text: turn.text, status: turn.status }),
    tool_items: turn.tool_items,
    resumed_after_restart: true,
    thread_disposition: threadDisposition,
    gh_on_path: false,
    credential_environment_names: [],
  };
}

export async function repairFixtureWithCodex(
  worktreePath: string,
  threadId: string,
  failure: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): Promise<CodexFixtureRepair> {
  if (threadId.length < 8) {
    throw new Error("CODEX_FIXTURE_REPAIR_THREAD_INVALID");
  }
  const client = new AppServerClient({
    executable: executablePath(task),
    cwd: worktreePath,
    environment: executorEnvironment(),
    turnTimeoutMs: 300_000,
  });
  try {
    await client.initialize();
    const resumed = record(await client.request("thread/resume", {
      threadId,
      cwd: worktreePath,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    }));
    if (record(resumed.thread).id !== threadId) {
      throw new Error("CODEX_FIXTURE_REPAIR_SESSION_REUSE_FAILED");
    }
    const turn = await client.startTurnAndWait(
      threadId,
      [
        "The independent verifier rejected the current candidate.",
        `Sanitized failure: ${failure.slice(0, 500)}`,
        "Make one bounded repair in the same Run and same thread.",
        `The frozen task is ${task.cli_option} with exact output: ${task.exact_output}`,
        "Keep the exact three-file allowlist and all prior no-GitHub/no-commit/no-dependency boundaries.",
        "Return only the requested structured result.",
      ].join("\n"),
      outputSchema(),
    );
    assertCompleted(turn);
    if (client.serverRequests.length !== 0) {
      throw new Error("CODEX_FIXTURE_REPAIR_APPROVAL_REQUESTED");
    }
    return {
      thread_id: threadId,
      turn_id: turn.turn_id,
      status: "completed",
      agent_claim_digest: hashCanonical({ text: turn.text, status: turn.status }),
    };
  } finally {
    await client.close();
  }
}
