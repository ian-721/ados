import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { hashCanonical } from "../../canonical/index.js";
import { AppServerClient } from "../../profiles/app-server-client.js";
import { runGit } from "../../profiles/workspace-profile.js";
import type { JsonObject } from "../../types.js";
import {
  expectedExecutionAdmission,
  slice4CodexExecutable,
} from "./admission.js";

const revision1 = "710bd4c9e1ba5912219ba401e205e9cec91268d4";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BLOCKED_CODEX_REPAIR_SESSION_PROTOCOL");
  }
  return value as Record<string, unknown>;
}

function executionEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA", "CODEX_HOME", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS", "OS", "PATH", "PATHEXT", "PROGRAMDATA", "PROGRAMFILES",
    "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (allowed.has(name.toUpperCase()) && value !== undefined && !/(?:TOKEN|KEY|SECRET|AUTH|COOKIE|PASSWORD)/u.test(name.toUpperCase())) {
      environment[name] = value;
    }
  }
  const originalPath = environment.Path ?? environment.PATH ?? "";
  const safePath = originalPath.split(delimiter)
    .filter((entry) => entry.length > 0 && !existsSync(join(entry, "gh.exe")))
    .join(delimiter);
  if (environment.Path !== undefined) environment.Path = safePath;
  else environment.PATH = safePath;
  return environment;
}

export function slice4RepairOutputSchema(): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "head", "tree_unchanged", "changed_paths"],
    properties: {
      status: { type: "string", const: "repair_attestation_ready" },
      head: { type: "string", const: revision1 },
      tree_unchanged: { type: "boolean", const: true },
      changed_paths: { type: "array", items: { type: "string" }, maxItems: 0 },
    },
  };
}

const attestationPrompt = [
  "Verify this worktree is clean at the exact retained Slice 4 revision 1.",
  `The required HEAD is ${revision1}.`,
  "Do not edit files and do not run any network or publication action.",
  "Return only the required structured attestation.",
].join("\n");

async function runAttestationTurn(
  client: AppServerClient,
  threadId: string,
): Promise<{ readonly turn_id: string; readonly claim_digest: string }> {
  const turn = await client.startTurnAndWait(
    threadId,
    attestationPrompt,
    slice4RepairOutputSchema(),
  );
  if (turn.status !== "completed" || turn.error !== null || turn.tool_items.some((item) => ["mcpToolCall", "dynamicToolCall", "webSearch"].includes(item))) {
    throw new Error("BLOCKED_CODEX_REPAIR_SESSION_TURN");
  }
  const claim = record(JSON.parse(turn.text) as unknown);
  if (
    claim.status !== "repair_attestation_ready" ||
    claim.head !== revision1 ||
    claim.tree_unchanged !== true ||
    !Array.isArray(claim.changed_paths) ||
    claim.changed_paths.length !== 0 ||
    client.serverRequests.length !== 0
  ) {
    throw new Error("BLOCKED_CODEX_REPAIR_SESSION_CLAIM");
  }
  return {
    turn_id: turn.turn_id,
    claim_digest: hashCanonical({ text: turn.text, status: turn.status }),
  };
}

export interface Slice4RepairSession {
  readonly thread_id: string;
  readonly turn_id: string;
  readonly capability_digest: string;
  readonly claim_digest: string;
}

function assertCleanRevision1(worktreePath: string): void {
  if (
    runGit(worktreePath, ["rev-parse", "HEAD"]) !== revision1 ||
    runGit(worktreePath, ["status", "--porcelain"]).length !== 0
  ) {
    throw new Error("BLOCKED_REPAIR_REVISION1_WORKTREE_DRIFT");
  }
}

export async function createSlice4RepairSession(worktreePath: string): Promise<Slice4RepairSession> {
  assertCleanRevision1(worktreePath);
  const admission = expectedExecutionAdmission();
  const client = new AppServerClient({
    executable: slice4CodexExecutable(),
    cwd: worktreePath,
    environment: executionEnvironment(),
    turnTimeoutMs: 300_000,
  });
  try {
    await client.initialize();
    const account = record(await client.request("account/read", { refreshToken: false }));
    if (account.requiresOpenaiAuth !== true || account.account === null) {
      throw new Error("BLOCKED_CODEX_REPAIR_SESSION_AUTH");
    }
    const started = await client.startThread({
      cwd: worktreePath,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ephemeral: false,
      baseInstructions: "Operate only in the supplied synthetic fixture worktree. No network, GitHub, gh, parent-directory access, SQLite, credentials, file edit, commit, push, merge, release, or deployment.",
      developerInstructions: "This is a causal-attestation turn. Verify the exact clean revision 1 tree and return the schema result without modifying any byte.",
    });
    const thread = record(started.thread);
    const threadId = String(thread.id ?? "");
    if (threadId.length < 8 || thread.ephemeral !== false) throw new Error("BLOCKED_CODEX_REPAIR_SESSION_IDENTITY");
    const attestation = await runAttestationTurn(client, threadId);
    assertCleanRevision1(worktreePath);
    return {
      thread_id: threadId,
      turn_id: attestation.turn_id,
      capability_digest: admission.execution_capability_digest,
      claim_digest: attestation.claim_digest,
    };
  } finally {
    await client.close();
  }
}

export async function recoverSlice4RepairSession(
  worktreePath: string,
  threadId: string,
): Promise<Slice4RepairSession> {
  if (threadId.length < 8) throw new Error("BLOCKED_CODEX_REPAIR_SESSION_IDENTITY");
  assertCleanRevision1(worktreePath);
  const admission = expectedExecutionAdmission();
  const client = new AppServerClient({
    executable: slice4CodexExecutable(),
    cwd: worktreePath,
    environment: executionEnvironment(),
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
    if (String(record(resumed.thread).id ?? "") !== threadId || client.serverRequests.length !== 0) {
      throw new Error("BLOCKED_CODEX_REPAIR_SESSION_RECONCILE");
    }
    const attestation = await runAttestationTurn(client, threadId);
    assertCleanRevision1(worktreePath);
    return {
      thread_id: threadId,
      turn_id: attestation.turn_id,
      capability_digest: admission.execution_capability_digest,
      claim_digest: attestation.claim_digest,
    };
  } finally {
    await client.close();
  }
}

export async function resumeSlice4RepairSession(worktreePath: string, threadId: string): Promise<void> {
  if (threadId.length < 8) throw new Error("BLOCKED_CODEX_REPAIR_SESSION_IDENTITY");
  const client = new AppServerClient({
    executable: slice4CodexExecutable(),
    cwd: worktreePath,
    environment: executionEnvironment(),
    turnTimeoutMs: 120_000,
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
    if (String(record(resumed.thread).id ?? "") !== threadId || client.serverRequests.length !== 0) {
      throw new Error("BLOCKED_CODEX_REPAIR_SESSION_RECONCILE");
    }
  } finally {
    await client.close();
  }
}
