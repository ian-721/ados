import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, hashCanonical } from "../canonical/index.js";
import { IntakeStore } from "../intake/store.js";
import { fixtureExecutorCapabilityDigest } from "../profiles/codex-fixture-executor.js";
import { slice3bFixtureTask } from "../profiles/fixture-task.js";
import { readRunningObjective } from "../profiles/forge-profile.js";
import {
  FIXTURE_BASE_SHA,
  FIXTURE_HARNESS_REF,
  FIXTURE_OBJECTIVE_REF,
  FIXTURE_REPOSITORY,
  resolveSoleRunningFixtureObjective,
} from "../resolver/fixture-single-running-objective.js";
import { EventStore } from "../storage/event-store.js";
import type { JsonValue } from "../types.js";
import {
  buildFixtureRunEnvelope,
  fixtureRunSeed,
  fulfillTypedFixtureRun,
  type TypedFixtureFulfillmentConfiguration,
  type TypedFixtureFulfillmentResult,
} from "./slice2.js";

const localObjectiveRef = "fixture.invalid/ados-local#9";
const localBaseSha = "eb908c7ad58846f0d35d5a9989555203435ffbc9";

export interface Slice3BDispatchOptions {
  readonly force_interruption_after_session?: boolean;
  readonly binding_fault?: "before_commit" | "after_commit";
}

export interface Slice3BFulfillmentResult extends TypedFixtureFulfillmentResult {
  readonly activation_id: string;
  readonly dispatch_id: string;
  readonly resolution_digest: string;
  readonly binding_disposition: "CREATED" | "DUPLICATE_RECONCILED";
}

export interface Slice3BStatus {
  readonly schema_version: "slice3b-status/v0.1";
  readonly activation_id: string;
  readonly state: "APPROVED" | "RUNNING" | "RECOVERING" | "VERIFYING" | "PUBLISHING" | "OWNER_REVIEW" | "BLOCKED";
  readonly run_id: string | null;
  readonly objective_ref: typeof FIXTURE_OBJECTIVE_REF | null;
  readonly target_branch: typeof slice3bFixtureTask.target_branch | null;
  readonly target_pr_url: string | null;
  readonly evidence_url: string | null;
  readonly candidate_sha: string | null;
  readonly worktree_path_digest: string | null;
  readonly session_digest: string | null;
  readonly blocker: string | null;
}

function intakeDatabasePath(): string {
  return resolve(".ados-local", "slice3a", "state.sqlite");
}

function slice3bRoot(): string {
  return resolve(".ados-local", "slice3b");
}

function fixtureRepositoryPath(): string {
  const configured = process.env.ADOS_SLICE3B_FIXTURE_REPO;
  return configured === undefined || configured.length === 0
    ? resolve(process.cwd(), "..", "ados-fixture-delivery")
    : resolve(configured);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJson(value as JsonValue)}\n`, "utf8");
}

function processIsAlive(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function withExecutionLock<T>(
  root: string,
  runId: string,
  operation: () => Promise<T>,
): Promise<T> {
  mkdirSync(root, { recursive: true });
  const lockPath = join(root, "execution.lock");
  const token = `${process.pid}:${runId}`;
  const deadline = Date.now() + 360_000;
  let descriptor: number | null = null;
  while (descriptor === null) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${canonicalJson({ process_id: process.pid, run_id: runId, token })}\n`, "utf8");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      let lock: Record<string, unknown>;
      try {
        lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
      } catch {
        throw new Error("BLOCKED_DISPATCH_EXECUTION_LOCK_INVALID");
      }
      if (lock.run_id !== runId || typeof lock.process_id !== "number") {
        throw new Error("BLOCKED_DISPATCH_EXECUTION_LOCK_CONFLICT");
      }
      if (!processIsAlive(lock.process_id)) {
        unlinkSync(lockPath);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("BLOCKED_DISPATCH_EXECUTION_ACTIVE");
      }
      await wait(250);
    }
  }
  try {
    return await operation();
  } finally {
    closeSync(descriptor);
    let currentToken = "";
    try {
      currentToken = String((JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>).token ?? "");
    } catch {
      currentToken = "";
    }
    if (currentToken === token) unlinkSync(lockPath);
  }
}

function deterministicIdentities(
  activationId: string,
  requestDigest: string,
  resolutionDigest: string,
): { readonly dispatch_id: string; readonly run_id: string; readonly holder_id: string } {
  const digest = hashCanonical({
    activation_id: activationId,
    request_digest: requestDigest,
    resolution_digest: resolutionDigest,
    objective_ref: FIXTURE_OBJECTIVE_REF,
    base_sha: FIXTURE_BASE_SHA,
  }).slice("sha256:".length);
  return {
    dispatch_id: `dispatch-slice3b-${digest.slice(0, 24)}`,
    run_id: `run-slice3b-${digest.slice(0, 24)}`,
    holder_id: `coordinator-slice3b-${digest.slice(0, 16)}`,
  };
}

function assertLocalObjective(): void {
  const local = readRunningObjective(process.cwd(), "fixture.invalid/ados-local", 9);
  if (
    local.issue_ref !== localObjectiveRef ||
    local.objective.objective_id !== "ados-public-slice3b-activation-v0.1" ||
    local.objective.project_harness_ref !== `fixture.invalid/ados-local@${localBaseSha}#docs/HARNESS.md` ||
    local.objective.authorization !== "IMPLEMENT" ||
    local.objective.status !== "RUNNING"
  ) {
    throw new Error("BLOCKED_LOCAL_OBJECTIVE_DRIFT");
  }
}

async function configurationForActivation(
  activationId: string,
): Promise<{
  readonly configuration: TypedFixtureFulfillmentConfiguration;
  readonly resolution: ReturnType<typeof resolveSoleRunningFixtureObjective>;
  readonly dispatch_id: string;
}> {
  const databasePath = intakeDatabasePath();
  const intake = await IntakeStore.open(databasePath);
  let approved: NonNullable<ReturnType<IntakeStore["statusByActivation"]>>;
  try {
    const found = intake.statusByActivation(activationId);
    if (found === null) {
      throw new Error(`BLOCKED_DISPATCH_ACTIVATION_NOT_FOUND:${activationId}`);
    }
    approved = found;
  } finally {
    intake.close();
  }
  if (
    approved.request.requested_authorization !== "IMPLEMENT" ||
    approved.receipt.authorization !== "IMPLEMENT" ||
    approved.receipt.authn_method !== "local_extension_confirm" ||
    approved.receipt.request_digest !== approved.request_digest ||
    approved.activation.request_digest !== approved.request_digest ||
    approved.activation.receipt_id !== approved.receipt.receipt_id
  ) {
    throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
  }
  assertLocalObjective();
  const resolution = resolveSoleRunningFixtureObjective(approved.request as Record<string, JsonValue>);
  const identities = deterministicIdentities(
    activationId,
    approved.request_digest,
    resolution.resolution_digest,
  );
  const requestRef = `local-evidence://slice3b/activation/${activationId}`;
  const worktreeRef = "workspace://slice3b/fixture-worktree";
  const envelope = buildFixtureRunEnvelope(
    approved.request as Record<string, JsonValue>,
    resolution.objective,
    resolution.repository_id,
    resolution.harness_text,
    {
      task: slice3bFixtureTask,
      run_id: identities.run_id,
      request_id: approved.request_id,
      request_ref: requestRef,
      worktree_ref: worktreeRef,
      created_at: approved.activation.created_at,
    },
  );
  const configuration: TypedFixtureFulfillmentConfiguration = {
    task: slice3bFixtureTask,
    root: slice3bRoot(),
    database_path: databasePath,
    fixture_repository_path: fixtureRepositoryPath(),
    worktree_ref: worktreeRef,
    request_ref: requestRef,
    request: approved.request as Record<string, JsonValue>,
    objective: {
      issue_ref: resolution.objective_ref,
      issue_url: resolution.objective_url,
      objective: resolution.objective,
    },
    repository: {
      id: resolution.repository_id,
      full_name: FIXTURE_REPOSITORY,
      default_branch: "main",
      private: true,
    },
    fixture_harness: resolution.harness_text,
    envelope,
    run_id: identities.run_id,
    holder_id: identities.holder_id,
    approval_ref: approved.receipt.approval_ref,
    evidence_prefix: "slice3b",
    allow_external_owner_receipt: false,
    force_interruption_after_session: true,
    gate0a: "PASS_REAL_COMPILER",
  };
  return { configuration, resolution, dispatch_id: identities.dispatch_id };
}

export async function dispatchSlice3BActivation(
  activationId: string,
  options: Slice3BDispatchOptions = {},
): Promise<Slice3BFulfillmentResult> {
  const prepared = await configurationForActivation(activationId);
  const { configuration, resolution, dispatch_id: dispatchId } = prepared;
  const seed = fixtureRunSeed(configuration);
  const store = new EventStore(configuration.database_path);
  let bindingDisposition: "CREATED" | "DUPLICATE_RECONCILED";
  try {
    const bound = store.bindActivationToRun({
      dispatch_id: dispatchId,
      activation_id: activationId,
      resolver_profile_id: resolution.resolver_profile_id,
      resolver_profile_version: resolution.resolver_profile_version,
      resolver_capability_digest: resolution.resolver_capability_digest,
      resolution_digest: resolution.resolution_digest,
      repository_full_name: resolution.repository_full_name,
      repository_id: resolution.repository_id,
      objective_ref: resolution.objective_ref,
      objective_digest: resolution.objective_digest,
      project_harness_ref: FIXTURE_HARNESS_REF,
      harness_digest: resolution.harness_digest,
      base_sha: FIXTURE_BASE_SHA,
      execution_profile_id: "executor.codex-app-server.fixture-v0.1",
      execution_profile_version: "0.1.0-public.1",
      execution_capability_digest: fixtureExecutorCapabilityDigest(),
      seed,
      ...(options.binding_fault === undefined ? {} : { fault: options.binding_fault }),
    });
    bindingDisposition = bound.disposition;
    store.verifyEventChain();
    store.verifyProjectionConsistency();
  } finally {
    store.close();
  }
  mkdirSync(configuration.root, { recursive: true });
  writeJson(join(configuration.root, "delivery-request.json"), configuration.request);
  writeJson(join(configuration.root, "resolved-objective.json"), resolution.objective);
  writeJson(join(configuration.root, "resolution.json"), {
    resolver_profile_id: resolution.resolver_profile_id,
    resolver_profile_version: resolution.resolver_profile_version,
    resolver_capability_digest: resolution.resolver_capability_digest,
    resolution_digest: resolution.resolution_digest,
    repository_full_name: resolution.repository_full_name,
    repository_id: resolution.repository_id,
    objective_ref: resolution.objective_ref,
    objective_digest: resolution.objective_digest,
    project_harness_ref: resolution.project_harness_ref,
    harness_digest: resolution.harness_digest,
    base_sha: resolution.base_sha,
  });
  writeJson(join(configuration.root, "run-envelope.json"), configuration.envelope);
  const result = await withExecutionLock(configuration.root, configuration.run_id, async () =>
    fulfillTypedFixtureRun({
      ...configuration,
      force_interruption_after_session: options.force_interruption_after_session ?? true,
    }));
  const delivered: Slice3BFulfillmentResult = {
    ...result,
    activation_id: activationId,
    dispatch_id: dispatchId,
    resolution_digest: resolution.resolution_digest,
    binding_disposition: bindingDisposition,
  };
  writeJson(join(configuration.root, "slice3b-result.json"), delivered);
  return delivered;
}

export async function readSlice3BStatus(activationId: string): Promise<Slice3BStatus> {
  const databasePath = intakeDatabasePath();
  const intake = await IntakeStore.open(databasePath);
  try {
    if (intake.statusByActivation(activationId) === null) {
      throw new Error(`BLOCKED_DISPATCH_ACTIVATION_NOT_FOUND:${activationId}`);
    }
  } finally {
    intake.close();
  }
  const store = new EventStore(databasePath);
  try {
    const binding = store.dispatchBinding(activationId);
    if (binding === null) {
      return {
        schema_version: "slice3b-status/v0.1",
        activation_id: activationId,
        state: "APPROVED",
        run_id: null,
        objective_ref: null,
        target_branch: null,
        target_pr_url: null,
        evidence_url: null,
        candidate_sha: null,
        worktree_path_digest: null,
        session_digest: null,
        blocker: null,
      };
    }
    const summary = store.summary(binding.run_id);
    const workspace = store.workspace(binding.run_id);
    const session = store.sessions(binding.run_id)[0];
    const publications = store.publications(binding.run_id);
    const pullRequest = publications.find((item) => item.effect_kind === "DRAFT_PR");
    const evidence = publications.find((item) => item.effect_kind === "EVIDENCE_COMMENT");
    const state = summary.run.state === "OWNER_REVIEW"
      ? "OWNER_REVIEW"
      : summary.run.state === "PUBLISHING"
        ? "PUBLISHING"
        : summary.run.state === "VERIFYING"
          ? "VERIFYING"
          : session === undefined
            ? "RUNNING"
            : "RECOVERING";
    return {
      schema_version: "slice3b-status/v0.1",
      activation_id: activationId,
      state,
      run_id: binding.run_id,
      objective_ref: FIXTURE_OBJECTIVE_REF,
      target_branch: slice3bFixtureTask.target_branch,
      target_pr_url: pullRequest?.result_ref ?? null,
      evidence_url: evidence?.result_ref ?? null,
      candidate_sha: workspace?.candidate_sha ?? null,
      worktree_path_digest: workspace?.worktree_path_digest ?? null,
      session_digest: session === undefined ? null : hashCanonical({ thread_id: session.thread_id }),
      blocker: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_BLOCKER";
    return {
      schema_version: "slice3b-status/v0.1",
      activation_id: activationId,
      state: "BLOCKED",
      run_id: null,
      objective_ref: null,
      target_branch: null,
      target_pr_url: null,
      evidence_url: null,
      candidate_sha: null,
      worktree_path_digest: null,
      session_digest: null,
      blocker: message.slice(0, 240),
    };
  } finally {
    store.close();
  }
}
