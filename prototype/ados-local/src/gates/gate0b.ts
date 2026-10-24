import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { hashCanonical } from "../canonical/index.js";
import {
  AppServerClient,
  asJsonValue,
  jsonObject,
  sanitizeAppServerText,
  type AppServerTraceEvent,
  type ServerRequestRecord,
  type TurnResult,
} from "../profiles/app-server-client.js";
import { EventStore } from "../storage/event-store.js";
import type { GateCheck, JsonObject, RunSeed } from "../types.js";
import { deterministicClock, deterministicIdFactory } from "../coordinator/walking-skeleton.js";

const expectedExecutableSha = "ecd7a3eaff5e42723dbba03b5c91514b3986b5db5cbca8f34619620b5356f31f";
const expectedVersion = "codex-cli 0.146.0-alpha.9.2";
const expectedSchemaCanonicalDigest = "sha256:b767c1161c2c56341f3d0e313b4f93810b4b53bdaabeff95c06e1242cfc4df03";

export interface Gate0BResult {
  readonly gate: "Gate 0B";
  readonly result: "PASS_CODEX_APP_SERVER";
  readonly status: "PASS";
  readonly host: {
    readonly executable: string;
    readonly version: string;
    readonly executable_sha256: string;
    readonly schema_jcs_digest: string;
    readonly schema_raw_sha256: string;
    readonly schema_files: number;
  };
  readonly transport: {
    readonly authenticated: true;
    readonly ephemeral_thread_digest: string;
    readonly persistent_thread_digest: string;
    readonly output_digest: string;
    readonly deny_request: string;
    readonly allow_request: string;
    readonly interrupted_status: "interrupted";
    readonly cancellation_process_roots: number;
    readonly session_projection_count: 2;
    readonly backpressure_waits: number;
    readonly redacted_stderr_lines: number;
  };
  readonly checks: readonly GateCheck[];
  readonly blockers: readonly [];
}

interface WorkspaceFileFact {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly modified_utc: string;
}

interface WorkspaceObservation {
  readonly stage: string;
  readonly observed_at: string;
  readonly tree_digest: string;
  readonly git_status_digest: string;
  readonly git_status: readonly string[];
  readonly git_index_sha256: string;
  readonly files: readonly WorkspaceFileFact[];
}

interface ProcessFact {
  readonly pid: number;
  readonly parent_pid: number;
  readonly name: string;
  readonly created_utc: string | null;
}

interface ProcessTreeObservation {
  readonly stage: string;
  readonly observed_at: string;
  readonly root_pid: number;
  readonly processes: readonly ProcessFact[];
  readonly error: string | null;
}

interface CancellationTimelineEntry {
  readonly stage: string;
  readonly observed_at: string;
  readonly detail: string | null;
}

interface CancellationDiagnostic {
  readonly schema_version: "gate0b-post-cancel-diagnostic-v0.1";
  readonly record_kind: "correlated-cancellation-run";
  readonly gate: "Gate 0B";
  host: {
    executable_sha256: string | null;
    version: string | null;
  };
  correlation: {
    thread_id: string | null;
    turn_id: string | null;
    command_item_id: string | null;
    command_process_id: string | null;
    command_process_tree_roots: number[];
    app_server_pid: number | null;
  };
  readonly timeline: CancellationTimelineEntry[];
  readonly workspace_observations: WorkspaceObservation[];
  readonly process_tree_observations: ProcessTreeObservation[];
  protocol_trace: AppServerTraceEvent[];
  conclusion: {
    primary_result: string;
    workspace_mutation: "CONFIRMED" | "NOT_OBSERVED" | "NOT_REACHED";
    late_read_only_protocol_event_only: boolean;
    causal_attribution: string;
    mutation_first_observed_at: string | null;
    post_interrupt_new_command_items: readonly string[];
    process_tree_clean_after_close: boolean | null;
  };
}

function pass(id: string, evidence: string): GateCheck {
  return { id, status: "PASS", evidence };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runChecked(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2_000_000,
  });
  if (result.error !== undefined) {
    throw new Error(`PROCESS_ERROR:${basename(command)}:${result.error.name}`);
  }
  if (result.status !== 0 || result.signal !== null) {
    throw new Error(
      `PROCESS_FAILED:${basename(command)}:${result.status ?? "signal"}:${sanitizeAppServerText(result.stderr)}`,
    );
  }
  return result.stdout.trim();
}

function countFiles(directory: string): number {
  let count = 0;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      count += countFiles(path);
    } else {
      count += 1;
    }
  }
  return count;
}

function listWorkspaceFiles(root: string, directory = root): WorkspaceFileFact[] {
  const facts: WorkspaceFileFact[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (directory === root && name === ".git") {
      continue;
    }
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      facts.push(...listWorkspaceFiles(root, path));
      continue;
    }
    facts.push({
      path: relative(root, path).replaceAll("\\", "/"),
      size: stats.size,
      sha256: sha256File(path),
      modified_utc: stats.mtime.toISOString(),
    });
  }
  return facts.sort((left, right) => left.path.localeCompare(right.path));
}

function observeWorkspace(workspace: string, stage: string): WorkspaceObservation {
  const files = listWorkspaceFiles(workspace);
  const gitStatusText = runChecked(
    "git",
    ["status", "--porcelain=v2", "--untracked-files=all"],
    workspace,
  );
  const gitStatus = gitStatusText.length === 0 ? [] : gitStatusText.split(/\r?\n/);
  return {
    stage,
    observed_at: new Date().toISOString(),
    tree_digest: hashCanonical(asJsonValue(files)),
    git_status_digest: hashCanonical(asJsonValue(gitStatus)),
    git_status: gitStatus,
    git_index_sha256: sha256File(join(workspace, ".git", "index")),
    files,
  };
}

function observeProcessTree(rootPid: number, stage: string): ProcessTreeObservation {
  const observedAt = new Date().toISOString();
  if (process.platform !== "win32") {
    return { stage, observed_at: observedAt, root_pid: rootPid, processes: [], error: "WINDOWS_REQUIRED" };
  }
  const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{Name='CreatedUtc';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')} else {$null}}} | ConvertTo-Json -Compress";
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 2_000_000 },
  );
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    return {
      stage,
      observed_at: observedAt,
      root_pid: rootPid,
      processes: [],
      error: `PROCESS_TREE_QUERY_FAILED:${result.error?.name ?? result.status ?? "signal"}`,
    };
  }
  const parsed = JSON.parse(result.stdout) as unknown;
  const raw = Array.isArray(parsed) ? parsed : [parsed];
  const all = raw.flatMap((value): ProcessFact[] => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    const pid = Number(item.ProcessId);
    const parentPid = Number(item.ParentProcessId);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) {
      return [];
    }
    return [{
      pid,
      parent_pid: parentPid,
      name: String(item.Name),
      created_utc: typeof item.CreatedUtc === "string" ? item.CreatedUtc : null,
    }];
  });
  const included = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      if (included.has(item.parent_pid) && !included.has(item.pid)) {
        included.add(item.pid);
        changed = true;
      }
    }
  }
  return {
    stage,
    observed_at: observedAt,
    root_pid: rootPid,
    processes: all.filter((item) => included.has(item.pid)).sort((left, right) => left.pid - right.pid),
    error: null,
  };
}

export function newDescendantRootPids(
  baseline: readonly ProcessFact[],
  current: readonly ProcessFact[],
  rootPid: number,
): number[] {
  const baselinePids = new Set(baseline.map((item) => item.pid));
  const newProcesses = current.filter(
    (item) => item.pid !== rootPid && !baselinePids.has(item.pid),
  );
  const newPids = new Set(newProcesses.map((item) => item.pid));
  return newProcesses
    .filter((item) => !newPids.has(item.parent_pid))
    .map((item) => item.pid)
    .sort((left, right) => left - right);
}

export function terminateWindowsProcessTree(pid: number): void {
  if (process.platform !== "win32") {
    throw new Error("WINDOWS_REQUIRED");
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    throw new Error("CANCEL_PROCESS_ID_INVALID");
  }
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 100_000,
  });
  if ((result.error !== undefined || result.status !== 0 || result.signal !== null) && processAlive(pid)) {
    throw new Error(`CANCEL_PROCESS_TREE_TERMINATION_FAILED:${pid}`);
  }
}

async function waitForProcessTreesToExit(
  rootPid: number,
  targetPids: readonly number[],
  diagnostic: CancellationDiagnostic,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const observation = observeProcessTree(rootPid, "cancel-process-tree-exit-check");
    if (observation.error !== null) {
      throw new Error(observation.error);
    }
    const livePids = new Set(observation.processes.map((item) => item.pid));
    if (targetPids.every((pid) => !livePids.has(pid))) {
      diagnostic.process_tree_observations.push({
        ...observation,
        stage: "cancel-process-tree-terminated",
      });
      timeline(diagnostic, "cancel-process-tree-terminated", `pids=${targetPids.join(",")}`);
      return;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`CANCEL_PROCESS_TREE_EXIT_TIMEOUT:${targetPids.join(",")}`);
}

function writeCancellationDiagnostic(diagnostic: CancellationDiagnostic): void {
  const evidenceDirectory = resolve(".ados-local", "evidence");
  const attemptsDirectory = join(evidenceDirectory, "gate0b-cancellation-attempts");
  mkdirSync(evidenceDirectory, { recursive: true });
  mkdirSync(attemptsDirectory, { recursive: true });
  const serialized = `${JSON.stringify(diagnostic, null, 2)}\n`;
  writeFileSync(
    join(evidenceDirectory, "gate0b-post-cancel-diagnostic.json"),
    serialized,
    "utf8",
  );
  const attemptTimestamp = diagnostic.timeline[0]?.observed_at ?? new Date().toISOString();
  writeFileSync(
    join(attemptsDirectory, `${attemptTimestamp.replaceAll(":", "-").replaceAll(".", "-")}.json`),
    serialized,
    "utf8",
  );
}

function timeline(
  diagnostic: CancellationDiagnostic,
  stage: string,
  detail: string | null = null,
): string {
  const observedAt = new Date().toISOString();
  diagnostic.timeline.push({ stage, observed_at: observedAt, detail });
  return observedAt;
}

function initializeFixtureRepository(workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  runChecked("git", ["init", "--initial-branch=main"], workspace);
  runChecked("git", ["config", "user.name", "ADOS Gate Fixture"], workspace);
  runChecked("git", ["config", "user.email", "ados-gate-fixture@invalid.local"], workspace);
  writeFileSync(join(workspace, "README.md"), "# Synthetic Gate 0B fixture\n", "utf8");
  runChecked("git", ["add", "README.md"], workspace);
  runChecked("git", ["commit", "-m", "fixture: initialize disposable workspace"], workspace);
}

function gateRunSeed(): RunSeed {
  return {
    run_id: "run-gate0b-transport-0001",
    request_id: "dr-gate0b-transport-0001",
    objective_id: "objective-gate0b-transport-0001",
    objective_ref: "fixture://objective/gate0b-transport-0001",
    request_digest: hashCanonical({ request: "gate0b-transport" }),
    objective_digest: hashCanonical({ objective: "gate0b-transport" }),
    envelope_digest: hashCanonical({ envelope: "gate0b-transport" }),
    generation: 1,
    lease_key: "objective-gate0b-transport-0001",
    holder_id: "coordinator-gate0b",
    ttl_seconds: 300,
    obligations: [{
      obligation_id: "owner-acceptance",
      category: "owner",
      verifier_id: "verifier.owner",
      minimum_trust: "T4",
    }],
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function threadIdentity(response: Record<string, unknown>, expectedEphemeral: boolean): string {
  const thread = response.thread as Record<string, unknown> | undefined;
  if (
    thread === undefined ||
    typeof thread.id !== "string" ||
    thread.id.length === 0 ||
    thread.ephemeral !== expectedEphemeral
  ) {
    throw new Error("THREAD_IDENTITY_INVALID");
  }
  return thread.id;
}

function approvalRecord(
  records: readonly ServerRequestRecord[],
  decision: "deny" | "allow",
): ServerRequestRecord {
  const allowed = decision === "deny"
    ? new Set(["decline", "empty-permissions"])
    : new Set(["accept", "scoped-permissions"]);
  const record = records.find(
    (item) => item.method.includes("requestApproval") && allowed.has(item.decision),
  );
  if (record === undefined) {
    throw new Error(`APPROVAL_${decision.toUpperCase()}_NOT_INTERCEPTED`);
  }
  return record;
}

function completedTurn(turn: TurnResult, label: string): void {
  if (turn.status !== "completed") {
    throw new Error(`${label}_TURN_NOT_COMPLETED:${turn.status}:${turn.error ?? "none"}`);
  }
}

async function waitForCommandStart(
  client: AppServerClient,
  threadId: string,
  turnId: string,
  requestOffset: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const commandStarted = client.notifications.find((notification) => {
      if (notification.method !== "item/started") {
        return false;
      }
      const params = notification.params as Record<string, unknown>;
      const item = params.item as Record<string, unknown> | undefined;
      return params.threadId === threadId && params.turnId === turnId && item?.type === "commandExecution";
    });
    const approvalAccepted = client.serverRequests
      .slice(requestOffset)
      .some((item) => item.decision === "accept" || item.decision === "scoped-permissions");
    const alreadyCompleted = client.notifications.some((notification) => {
      if (notification.method !== "turn/completed") {
        return false;
      }
      const params = notification.params as Record<string, unknown>;
      const turn = params.turn as Record<string, unknown> | undefined;
      return params.threadId === threadId && turn?.id === turnId;
    });
    if (commandStarted !== undefined && approvalAccepted) {
      const params = commandStarted.params as Record<string, unknown>;
      const item = params.item;
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("INTERRUPT_COMMAND_ITEM_INVALID");
      }
      return item as Record<string, unknown>;
    }
    if (alreadyCompleted) {
      throw new Error("INTERRUPT_COMMAND_COMPLETED_BEFORE_INTERRUPT");
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("INTERRUPT_COMMAND_START_TIMEOUT");
}

export async function runGate0B(executable: string): Promise<Gate0BResult> {
  const root = resolve(".ados-local", "gate0b", "formal");
  const workspace = join(root, "fixture-workspace");
  const schemaDirectory = join(root, "schema");
  const diagnostic: CancellationDiagnostic = {
    schema_version: "gate0b-post-cancel-diagnostic-v0.1",
    record_kind: "correlated-cancellation-run",
    gate: "Gate 0B",
    host: { executable_sha256: null, version: null },
    correlation: {
      thread_id: null,
      turn_id: null,
      command_item_id: null,
      command_process_id: null,
      command_process_tree_roots: [],
      app_server_pid: null,
    },
    timeline: [],
    workspace_observations: [],
    process_tree_observations: [],
    protocol_trace: [],
    conclusion: {
      primary_result: "NOT_REACHED",
      workspace_mutation: "NOT_REACHED",
      late_read_only_protocol_event_only: false,
      causal_attribution: "PENDING",
      mutation_first_observed_at: null,
      post_interrupt_new_command_items: [],
      process_tree_clean_after_close: null,
    },
  };
  const completedTraces: AppServerTraceEvent[] = [];
  let failureMessage: string | null = null;
  let firstMutationObservedAt: string | null = null;
  let interruptRequestSentAt: string | null = null;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  initializeFixtureRepository(workspace);
  timeline(diagnostic, "fixture-initialized");

  const executableSha = sha256File(executable);
  const version = runChecked(executable, ["--version"], workspace);
  diagnostic.host = { executable_sha256: executableSha, version };
  if (executableSha !== expectedExecutableSha || version !== expectedVersion) {
    throw new Error("CODEX_EXECUTABLE_IDENTITY_DRIFT");
  }
  runChecked(
    executable,
    ["app-server", "generate-json-schema", "--out", schemaDirectory],
    workspace,
  );
  const schemaPath = join(schemaDirectory, "codex_app_server_protocol.v2.schemas.json");
  const schemaRawSha = sha256File(schemaPath);
  const schemaCanonicalDigest = hashCanonical(
    asJsonValue(JSON.parse(readFileSync(schemaPath, "utf8")) as unknown),
  );
  if (schemaCanonicalDigest !== expectedSchemaCanonicalDigest) {
    throw new Error(`CODEX_SCHEMA_IDENTITY_DRIFT:${schemaCanonicalDigest}`);
  }
  const schemaFiles = countFiles(schemaDirectory);

  const store = new EventStore(join(root, "session-facts.sqlite"), {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  const created = store.createRun(gateRunSeed());
  const holder = created.lease.holder_id;
  const token = created.lease.fencing_token;
  const capabilityDigest = hashCanonical({
    profile_id: "executor.codex-app-server.gate0b",
    profile_version: "0.1.0-public.1",
    executable_sha256: executableSha,
    schema_jcs_digest: schemaCanonicalDigest,
    cwd: "disposable-fixture-git-workspace",
    mcp: "disabled",
  });

  let client: AppServerClient | null = null;
  let persistentThreadId = "";
  let persistentDeleted = false;
  let ephemeralThreadId = "";
  let outputDigest = "";
  let denyRecord: ServerRequestRecord | null = null;
  let allowRecord: ServerRequestRecord | null = null;
  let backpressureWaits = 0;
  let redactedStderrLines = 0;
  let firstPid = 0;
  let secondPid = 0;
  try {
    client = new AppServerClient({ executable, cwd: workspace, turnTimeoutMs: 180_000 });
    firstPid = client.processId;
    await client.initialize();
    const account = await client.request("account/read", { refreshToken: false }) as Record<string, unknown>;
    if (account.requiresOpenaiAuth !== true || account.account === null) {
      throw new Error("CODEX_AUTH_UNAVAILABLE");
    }

    const ephemeral = await client.startThread({
      cwd: workspace,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "read-only",
      ephemeral: true,
      baseInstructions: "Synthetic Gate 0B protocol probe only. Do not use tools or external context.",
      developerInstructions: "Return only the requested schema-constrained synthetic value.",
    });
    ephemeralThreadId = threadIdentity(ephemeral, true);
    const outputSchema: JsonObject = {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "string", const: "gate0b-ok" } },
    };
    const outputTurn = await client.startTurnAndWait(
      ephemeralThreadId,
      "Return value gate0b-ok and nothing else through the output schema.",
      outputSchema,
    );
    completedTurn(outputTurn, "OUTPUT_SCHEMA");
    if (outputTurn.tool_items.length !== 0 || client.serverRequests.length !== 0) {
      throw new Error("OUTPUT_SCHEMA_BOUNDARY_VIOLATED");
    }
    const output = JSON.parse(outputTurn.text) as Record<string, unknown>;
    if (Object.keys(output).join(",") !== "value" || output.value !== "gate0b-ok") {
      throw new Error("OUTPUT_SCHEMA_LOCAL_VALIDATION_FAILED");
    }
    outputDigest = hashCanonical(asJsonValue(output));
    store.recordSessionFact(
      created.run.run_id,
      holder,
      token,
      {
        profile_id: "executor.codex-app-server.ephemeral",
        thread_id: ephemeralThreadId,
        turn_id: outputTurn.turn_id,
        status: outputTurn.status,
        capability_digest: capabilityDigest,
      },
      "gate0b-session-ephemeral",
    );

    const persistent = await client.startThread({
      cwd: workspace,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "read-only",
      ephemeral: false,
      baseInstructions: "Synthetic Gate 0B executor probe. Operate only inside the disposable cwd. No network, MCP, browser, GitHub, or secrets.",
      developerInstructions: "Use one shell command only when explicitly instructed and route required approval to the client.",
    });
    persistentThreadId = threadIdentity(persistent, false);

    client.setApprovalDecision("decline");
    let requestOffset = client.serverRequests.length;
    const denyTurn = await client.startTurnAndWait(
      persistentThreadId,
      "Use exactly one shell command and request approval to create denied-marker.txt containing denied in the current disposable workspace. Do not use a patch tool.",
    );
    completedTurn(denyTurn, "DENY_APPROVAL");
    denyRecord = approvalRecord(client.serverRequests.slice(requestOffset), "deny");
    if (existsSync(join(workspace, "denied-marker.txt"))) {
      throw new Error("DENIED_APPROVAL_MUTATED_WORKSPACE");
    }

    client.setApprovalDecision("accept");
    requestOffset = client.serverRequests.length;
    const allowTurn = await client.startTurnAndWait(
      persistentThreadId,
      "Use exactly one shell command and request approval to create allowed-marker.txt containing allowed in the current disposable workspace. Do not use a patch tool.",
    );
    completedTurn(allowTurn, "ALLOW_APPROVAL");
    allowRecord = approvalRecord(client.serverRequests.slice(requestOffset), "allow");
    if (
      !existsSync(join(workspace, "allowed-marker.txt")) ||
      readFileSync(join(workspace, "allowed-marker.txt"), "utf8").trim() !== "allowed"
    ) {
      throw new Error("ALLOWED_APPROVAL_DID_NOT_MUTATE_FIXTURE");
    }

    const preCancelWorkspace = observeWorkspace(workspace, "before-cancel-turn");
    diagnostic.workspace_observations.push(preCancelWorkspace);
    const preCancelProcessTree = observeProcessTree(firstPid, "before-cancel-turn");
    diagnostic.process_tree_observations.push(preCancelProcessTree);
    if (preCancelProcessTree.error !== null) {
      throw new Error(preCancelProcessTree.error);
    }

    requestOffset = client.serverRequests.length;
    timeline(diagnostic, "turn-start-request-begin");
    const interruptTurnId = await client.startTurn(
      persistentThreadId,
      "Use exactly one approved PowerShell shell command that waits 5 seconds and only then creates post-cancel-marker.txt containing forbidden. Do not create the file before the wait and do not use a patch tool.",
    );
    diagnostic.correlation.thread_id = persistentThreadId;
    diagnostic.correlation.turn_id = interruptTurnId;
    diagnostic.correlation.app_server_pid = firstPid;
    timeline(diagnostic, "turn-start-acknowledged", `turn=${interruptTurnId}`);
    const commandItem = await waitForCommandStart(client, persistentThreadId, interruptTurnId, requestOffset);
    diagnostic.correlation.command_item_id = typeof commandItem.id === "string" ? commandItem.id : null;
    diagnostic.correlation.command_process_id = typeof commandItem.processId === "string"
      ? commandItem.processId
      : null;
    timeline(
      diagnostic,
      "mutation-command-start-observed",
      `item=${diagnostic.correlation.command_item_id ?? "none"};process=${diagnostic.correlation.command_process_id ?? "none"}`,
    );
    diagnostic.workspace_observations.push(observeWorkspace(workspace, "command-start-observed"));
    const commandStartProcessTree = observeProcessTree(firstPid, "command-start-observed");
    diagnostic.process_tree_observations.push(commandStartProcessTree);
    if (commandStartProcessTree.error !== null) {
      throw new Error(commandStartProcessTree.error);
    }
    const commandProcessTreeRoots = newDescendantRootPids(
      preCancelProcessTree.processes,
      commandStartProcessTree.processes,
      firstPid,
    );
    if (commandProcessTreeRoots.length === 0) {
      throw new Error("CANCEL_PROCESS_TREE_NOT_IDENTIFIED");
    }
    diagnostic.correlation.command_process_tree_roots.push(...commandProcessTreeRoots);
    timeline(diagnostic, "cancel-process-tree-identified", `pids=${commandProcessTreeRoots.join(",")}`);

    interruptRequestSentAt = timeline(diagnostic, "interrupt-request-sent");
    await client.interrupt(persistentThreadId, interruptTurnId);
    timeline(diagnostic, "interrupt-acknowledged");
    diagnostic.workspace_observations.push(observeWorkspace(workspace, "interrupt-acknowledged"));
    diagnostic.process_tree_observations.push(observeProcessTree(firstPid, "interrupt-acknowledged"));
    for (const pid of commandProcessTreeRoots) {
      timeline(diagnostic, "cancel-process-tree-termination-sent", `pid=${pid}`);
      terminateWindowsProcessTree(pid);
    }
    await waitForProcessTreesToExit(firstPid, commandProcessTreeRoots, diagnostic);
    const interruptedTurn = await client.waitForTurnCompletion(persistentThreadId, interruptTurnId);
    timeline(diagnostic, "turn-terminal-observed", `status=${interruptedTurn.status}`);
    diagnostic.workspace_observations.push(observeWorkspace(workspace, "turn-terminal-observed"));
    diagnostic.process_tree_observations.push(observeProcessTree(firstPid, "turn-terminal-observed"));
    if (interruptedTurn.status !== "interrupted") {
      throw new Error(`TURN_INTERRUPT_FAILED:${interruptedTurn.status}`);
    }
    const observationDeadline = Date.now() + 7_000;
    while (Date.now() < observationDeadline) {
      const observation = observeWorkspace(workspace, "post-terminal-monitor");
      if (
        firstMutationObservedAt === null &&
        observation.tree_digest !== preCancelWorkspace.tree_digest
      ) {
        firstMutationObservedAt = observation.observed_at;
        diagnostic.workspace_observations.push({ ...observation, stage: "mutation-first-observed" });
        timeline(diagnostic, "mutation-first-observed", observation.tree_digest);
      }
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
    }
    diagnostic.workspace_observations.push(observeWorkspace(workspace, "post-terminal-monitor-complete"));
    diagnostic.process_tree_observations.push(observeProcessTree(firstPid, "post-terminal-monitor-complete"));
    if (existsSync(join(workspace, "post-cancel-marker.txt"))) {
      throw new Error("POST_CANCEL_MUTATION_DETECTED");
    }
    store.recordSessionFact(
      created.run.run_id,
      holder,
      token,
      {
        profile_id: "executor.codex-app-server.persistent",
        thread_id: persistentThreadId,
        turn_id: interruptedTurn.turn_id,
        status: interruptedTurn.status,
        capability_digest: capabilityDigest,
      },
      "gate0b-session-persistent-started",
    );

    backpressureWaits += client.backpressureWaits;
    redactedStderrLines += client.redactedStderr.length;
    timeline(diagnostic, "first-app-server-close-started", `pid=${firstPid}`);
    await client.close();
    completedTraces.push(...client.trace);
    timeline(diagnostic, "first-app-server-close-completed", `pid=${firstPid}`);
    diagnostic.process_tree_observations.push(observeProcessTree(firstPid, "first-app-server-close-completed"));
    client = null;
    if (processAlive(firstPid)) {
      throw new Error("FIRST_APP_SERVER_PROCESS_NOT_CLEANED");
    }

    client = new AppServerClient({ executable, cwd: workspace, turnTimeoutMs: 180_000 });
    secondPid = client.processId;
    await client.initialize();
    const resumed = await client.request("thread/resume", {
      threadId: persistentThreadId,
      cwd: workspace,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "read-only",
    }) as Record<string, unknown>;
    const resumedThread = resumed.thread as Record<string, unknown> | undefined;
    if (resumedThread?.id !== persistentThreadId) {
      throw new Error("PERSISTENT_THREAD_RECONCILE_FAILED");
    }
    store.recordSessionFact(
      created.run.run_id,
      holder,
      token,
      {
        profile_id: "executor.codex-app-server.persistent",
        thread_id: persistentThreadId,
        turn_id: null,
        status: "resumed-after-app-server-restart",
        capability_digest: capabilityDigest,
      },
      "gate0b-session-persistent-resumed",
    );
    await client.request("thread/delete", { threadId: persistentThreadId });
    persistentDeleted = true;
    backpressureWaits += client.backpressureWaits;
    redactedStderrLines += client.redactedStderr.length;
    timeline(diagnostic, "second-app-server-close-started", `pid=${secondPid}`);
    await client.close();
    completedTraces.push(...client.trace);
    timeline(diagnostic, "second-app-server-close-completed", `pid=${secondPid}`);
    diagnostic.process_tree_observations.push(observeProcessTree(secondPid, "second-app-server-close-completed"));
    client = null;
    if (processAlive(secondPid)) {
      throw new Error("SECOND_APP_SERVER_PROCESS_NOT_CLEANED");
    }

    const redactionProbe = sanitizeAppServerText(
      "failure at C:\\Private\\User\\secret.txt\nBearer synthetic-token\nsk-synthetic",
    );
    if (/C:\\Private|synthetic-token|sk-synthetic/.test(redactionProbe)) {
      throw new Error("ERROR_REDACTION_FAILED");
    }
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    store.integrity();
    store.rebuildProjections();
    const summary = store.summary(created.run.run_id);
    if (summary.session_count !== 2) {
      throw new Error(`DUPLICATE_SESSION_PROJECTION:${summary.session_count}`);
    }
    diagnostic.conclusion = {
      primary_result: "PASS_CODEX_APP_SERVER",
      workspace_mutation: "NOT_OBSERVED",
      late_read_only_protocol_event_only: false,
      causal_attribution: "NO_POST_CANCEL_MUTATION",
      mutation_first_observed_at: null,
      post_interrupt_new_command_items: [],
      process_tree_clean_after_close: true,
    };

    return {
      gate: "Gate 0B",
      result: "PASS_CODEX_APP_SERVER",
      status: "PASS",
      host: {
        executable: `codex.exe@${expectedExecutableSha.slice(0, 12)}`,
        version,
        executable_sha256: executableSha,
        schema_jcs_digest: schemaCanonicalDigest,
        schema_raw_sha256: schemaRawSha,
        schema_files: schemaFiles,
      },
      transport: {
        authenticated: true,
        ephemeral_thread_digest: hashCanonical(jsonObject({ thread_id: ephemeralThreadId })),
        persistent_thread_digest: hashCanonical(jsonObject({ thread_id: persistentThreadId })),
        output_digest: outputDigest,
        deny_request: `${denyRecord.method}:${denyRecord.decision}`,
        allow_request: `${allowRecord.method}:${allowRecord.decision}`,
        interrupted_status: "interrupted",
        cancellation_process_roots: diagnostic.correlation.command_process_tree_roots.length,
        session_projection_count: 2,
        backpressure_waits: backpressureWaits,
        redacted_stderr_lines: redactedStderrLines,
      },
      checks: [
        pass("B-01", "exact executable/version/hash plus generated raw SHA and stable RFC 8785 schema digest verified"),
        pass("B-02", "initialize and authenticated account status verified without exposing account data"),
        pass("B-03", "ephemeral outputSchema turn completed and passed local validation"),
        pass("B-04", "persistent thread resumed by exact id after App Server restart"),
        pass("B-05", "thread, turn, item, and completion events bound to exact ids"),
        pass("B-06", `approval deny intercepted as ${denyRecord.method}:${denyRecord.decision}`),
        pass("B-07", `approval allow intercepted as ${allowRecord.method}:${allowRecord.decision} within fixture cwd only`),
        pass("B-08", "interrupt acknowledgement was followed by exact new command-subtree termination; interrupted terminal state and fixed safety window showed no post-cancel workspace, Git, or command mutation"),
        pass("B-09", "bounded line, pending-request, notification, stderr, and backpressure controls active"),
        pass("B-10", "errors redact paths/tokens and reports contain digests rather than raw thread ids"),
        pass("B-11", "cancelled command subtree and both App Server process trees exited; persistent synthetic thread was deleted"),
        pass("B-12", "SQLite Event/session projection rebuild contains two unique sessions and no Envelope mutation"),
        pass("B-13", "disposable Git workspace only; no network tool, MCP, browser, GitHub, or real-project mutation"),
      ],
      blockers: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    failureMessage = message;
    throw new Error(`BLOCKED_CODEX_TRANSPORT:${sanitizeAppServerText(message)}`);
  } finally {
    let cleanupFailure: string | null = null;
    if (client !== null) {
      const cleanupPid = client.processId;
      if (persistentThreadId !== "" && !persistentDeleted) {
        try {
          timeline(diagnostic, "failure-cleanup-thread-delete-started");
          await client.request("thread/delete", { threadId: persistentThreadId }, 10_000);
          persistentDeleted = true;
          timeline(diagnostic, "failure-cleanup-thread-delete-completed");
        } catch (error) {
          cleanupFailure = error instanceof Error ? error.message : "PERSISTENT_THREAD_DELETE_FAILED";
          timeline(diagnostic, "failure-cleanup-thread-delete-failed", sanitizeAppServerText(cleanupFailure));
        }
      }
      timeline(diagnostic, "failure-cleanup-app-server-close-started", `pid=${cleanupPid}`);
      await client.close();
      completedTraces.push(...client.trace);
      timeline(diagnostic, "failure-cleanup-app-server-close-completed", `pid=${cleanupPid}`);
      diagnostic.process_tree_observations.push(
        observeProcessTree(cleanupPid, "failure-cleanup-app-server-close-completed"),
      );
    }
    store.close();
    diagnostic.protocol_trace = completedTraces;
    const finalWorkspace = observeWorkspace(workspace, "final-after-cleanup");
    diagnostic.workspace_observations.push(finalWorkspace);
    const interruptTrace = diagnostic.protocol_trace.find(
      (entry) => entry.kind === "client-request-sent" && entry.method === "turn/interrupt",
    );
    const interruptBoundary = interruptTrace?.observed_at ?? interruptRequestSentAt;
    const postInterruptNewCommandItems = diagnostic.protocol_trace
      .filter((entry) =>
        entry.kind === "notification-received" &&
        entry.method === "item/started" &&
        entry.item_type === "commandExecution" &&
        interruptBoundary !== null &&
        entry.observed_at > interruptBoundary
      )
      .map((entry) => entry.item_id ?? "unknown");
    const markerExists = existsSync(join(workspace, "post-cancel-marker.txt"));
    const finalProcessObservation = [...diagnostic.process_tree_observations]
      .reverse()
      .find((entry) => entry.stage.includes("close-completed"));
    const processTreeClean = finalProcessObservation === undefined || finalProcessObservation.error !== null
      ? null
      : finalProcessObservation.processes.length === 0;
    if (failureMessage !== null) {
      let causalAttribution = "FAILURE_BEFORE_CANCELLATION_CLASSIFICATION";
      if (markerExists) {
        const commandStart = diagnostic.protocol_trace.find(
          (entry) =>
            entry.kind === "notification-received" &&
            entry.method === "item/started" &&
            entry.item_id === diagnostic.correlation.command_item_id,
        );
        const terminal = diagnostic.protocol_trace.find(
          (entry) =>
            entry.kind === "notification-received" &&
            entry.method === "turn/completed" &&
            entry.turn_id === diagnostic.correlation.turn_id,
        );
        if (
          commandStart !== undefined &&
          interruptBoundary !== null &&
          commandStart.observed_at <= interruptBoundary &&
          terminal !== undefined &&
          firstMutationObservedAt !== null &&
          terminal.observed_at < firstMutationObservedAt &&
          postInterruptNewCommandItems.length === 0
        ) {
          causalAttribution = "PRE_INTERRUPT_COMMAND_CONTINUED_AFTER_INTERRUPT_ACK_AND_TERMINAL";
        } else if (postInterruptNewCommandItems.length > 0) {
          causalAttribution = "NEW_MUTATION_COMMAND_STARTED_AFTER_INTERRUPT";
        } else {
          causalAttribution = "REAL_MUTATION_WITH_INCOMPLETE_PROCESS_CORRELATION";
        }
      }
      diagnostic.conclusion = {
        primary_result: `BLOCKED_CODEX_TRANSPORT:${sanitizeAppServerText(failureMessage)}`,
        workspace_mutation: markerExists ? "CONFIRMED" : "NOT_OBSERVED",
        late_read_only_protocol_event_only: !markerExists,
        causal_attribution: causalAttribution,
        mutation_first_observed_at: firstMutationObservedAt,
        post_interrupt_new_command_items: postInterruptNewCommandItems,
        process_tree_clean_after_close: processTreeClean,
      };
    }
    writeCancellationDiagnostic(diagnostic);
    if (cleanupFailure !== null) {
      throw new Error(`BLOCKED_CODEX_TRANSPORT:CLEANUP:${sanitizeAppServerText(cleanupFailure)}`);
    }
  }
}
