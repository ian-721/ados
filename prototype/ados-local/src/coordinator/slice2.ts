import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { canonicalJson, hashCanonical, sha256Text } from "../canonical/index.js";
import {
  computeDeliveryRequestDigest,
  computeEnvelopeDigest,
  ContractValidator,
} from "../contracts/validator.js";
import { renderEvidenceSemanticErrors, validateEvidenceSemantics } from "../evidence/semantic-validator.js";
import { boundedRepairAllowed, runSlice2RecoveryMatrix, type Slice2RecoveryResult } from "./slice2-recovery.js";
import {
  executeFixtureWithCodex,
  fixtureExecutorCapabilityDigest,
  repairFixtureWithCodex,
  slice4FixtureExecutorCapabilityDigest,
} from "../profiles/codex-fixture-executor.js";
import {
  commitFixtureCandidate,
  createOrReuseFixtureDraftPr,
  publishOrReuseEvidenceComment,
  pushFixtureCandidate,
  readExistingFixtureDraftPr,
  readFixtureRepositoryFacts,
  readRunningObjective,
  updateExistingEvidenceComment,
  type RepositoryFacts,
  type RunningObjective,
} from "../profiles/forge-profile.js";
import { ensureIsolatedWorktree, inspectCandidate, measureStagedPatchBytes, runProcess } from "../profiles/workspace-profile.js";
import { EventStore, type VerifierReceiptInput } from "../storage/event-store.js";
import type { JsonObject, JsonValue, RunSeed, RunState } from "../types.js";
import { runSlice2Verifier, type Slice2VerifierResult } from "../verifiers/slice2-verifier.js";
import {
  slice2FixtureTask,
  type FixtureTaskSpecification,
} from "../profiles/fixture-task.js";

const centralSha = "7b5c48b4cdacc3357816be0a17d704e88e05440a";
const localBaseSha = "6cfbb20e86c151bcaea489fa8a6dd9a2d7706396";
const fixtureBaseSha = "3536f4810f9cfadc75443a838a26e969883fca44";
const targetBranch = "ados/slice2-owner-summary-v0.1";
const runId = "run-public-slice2-summary-0001";
const requestId = "dr-public-slice2-summary-0001";
const holderId = "coordinator-slice2-owner-summary";
const approvalRef = "synthetic://ados-public/v1/slice2-approval";
const initialEvidenceManifestDigest = "sha256:d7b0e5e1c8fa7d0ebc2fba6d130effeb390a036abf20797daa641ce79f886761";
const evidenceCommentId = 1000004;

export interface Slice2FulfillmentResult {
  readonly result: "CANDIDATE_READY_FOR_OWNER_REVIEW";
  readonly run_id: typeof runId;
  readonly request_digest: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly candidate_revision: 1;
  readonly target_candidate_sha: string;
  readonly target_branch: typeof targetBranch;
  readonly target_pr_number: number;
  readonly target_pr_url: string;
  readonly evidence_identity: string;
  readonly evidence_comment_url: string;
  readonly evidence_manifest_digest: string;
  readonly worktree_path_digest: string;
  readonly session_digest: string;
  readonly event_count: number;
  readonly event_chain_head: string;
  readonly owner_obligation: "PENDING_T4";
  readonly gate0a: "BLOCKED_COMPILER_PATH";
  readonly merged: false;
  readonly released: false;
  readonly deployed: false;
}

export interface Slice2EvidenceCorrectionResult {
  readonly result: "EVIDENCE_CORRECTION_RECONCILED";
  readonly run_id: typeof runId;
  readonly candidate_revision: 1;
  readonly target_candidate_sha: string;
  readonly target_pr_url: string;
  readonly prior_evidence_manifest_digest: typeof initialEvidenceManifestDigest;
  readonly corrected_evidence_manifest_digest: string;
  readonly evidence_identity: string;
  readonly evidence_comment_id: typeof evidenceCommentId;
  readonly evidence_comment_url: string;
  readonly comment_disposition: "UPDATED" | "REUSED";
  readonly staged_patch_bytes: ReadonlyArray<{ readonly path: string; readonly bytes_changed: number }>;
  readonly total_staged_patch_bytes: number;
  readonly local_semantic_validation: "PASS";
  readonly event_count: number;
  readonly event_chain_head: string;
  readonly publication_count: number;
  readonly pending_outbox: number;
  readonly owner_obligation: "PENDING_T4";
  readonly gate0a: "BLOCKED_COMPILER_PATH";
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function fixtureRepositoryPath(): string {
  const configured = process.env.ADOS_SLICE2_FIXTURE_REPO;
  return configured === undefined || configured.length === 0
    ? resolve(process.cwd(), "..", "ados-fixture-delivery")
    : resolve(configured);
}

function slice2Root(): string {
  return resolve(".ados-local", "slice2");
}

function buildSignedRequest(): Record<string, JsonValue> {
  const minimizedOwnerDecision = {
    source: approvalRef,
    outcome: "Add the exact deterministic --owner-summary fixture output and preserve --machine.",
    allowed_paths: ["README.md", "src/index.js", "test/summary.test.js"],
    authorization: "IMPLEMENT",
  };
  const ownerTurnDigest = hashCanonical(minimizedOwnerDecision);
  const request: Record<string, JsonValue> = {
    schema_version: "ados-delivery-request/v0.2",
    request_id: requestId,
    captured_at: "2026-08-02T15:25:00.000Z",
    capture: {
      adapter_id: "fixture-objective.signed-record",
      adapter_version: "0.1.0-public.1",
      platform: "owner_signed_record",
      conversation_ref: null,
      selected_turn_digest: ownerTurnDigest,
      owner_turn_digest: ownerTurnDigest,
      role_summary: [{ role: "owner", count: 1 }],
      retention: "minimized_only",
    },
    compiler: {
      compiler_version: "hand-authored/v0.1",
      rules_version: "delivery-request/v0.2",
      profile_id: "compiler.hand-authored.signed-request",
      profile_version: "0.1.0-public.1",
      capability_digest: hashCanonical({ route: "signed-request-only", gate0a: "BLOCKED_COMPILER_PATH" }),
      model_ref: null,
    },
    outcome: "Add one deterministic --owner-summary output to the private synthetic fixture while preserving the exact accepted machine output.",
    why_now: "The Owner-approved Slice 2 Objective requires one real bounded cross-repository fulfillment candidate.",
    owner_decisions: [
      "Use exactly one Run, one Codex thread, one isolated worktree, one target branch, one Draft PR and one Evidence identity.",
      "Stop at OWNER_REVIEW; do not Ready, merge, release, deploy or enter Slice 3.",
    ],
    assumptions: [],
    open_decisions: [],
    requested_authorization: "IMPLEMENT",
    target_hint: {
      delivery_class: "software_delivery",
      project_id: "ados-fixture-delivery",
      repository: "fixture.invalid/ados-fixture-delivery",
    },
    allowed_scope_hints: ["README.md", "src/index.js", "test/summary.test.js"],
    forbidden_scope_hints: ["package.json", "package-lock.json", "AGENTS.md", "docs/HARNESS.md", "fixtures/**"],
    quality_bar: [
      "Machine output remains exact and owner-summary output is deterministic.",
      "Codex receives no SQLite handle, GitHub credential or publication authority.",
      "Independent T2 checks and T3 readback bind the exact candidate.",
    ],
    acceptance: {
      engineering: [
        "Fixture tests and check pass in a separate verifier process.",
        "Only the exact three allowed paths change.",
        "The target branch, Draft PR and Evidence read back at the exact candidate SHA.",
      ],
      product: ["Owner can run the exact machine and owner-summary commands."],
      owner_artifact: {
        kind: "demo",
        description: "The real fixture CLI with deterministic owner-summary output.",
      },
    },
    risk_flags: ["credential_access", "multi_repository"],
    readiness: "READY",
    request_digest: `sha256:${"0".repeat(64)}`,
  };
  const requestDigest = computeDeliveryRequestDigest(request);
  request.request_digest = requestDigest;
  request.owner_authorization_receipt = {
    receipt_id: "oar-slice2-owner-summary-0001",
    actor_id: "owner",
    authn_method: "external_owner_record",
    action: "approve_delivery",
    authorization: "IMPLEMENT",
    approval_ref: approvalRef,
    owner_turn_digest: ownerTurnDigest,
    request_digest: requestDigest,
    approved_at: "2026-08-02T15:25:00.000Z",
  };
  return request;
}

export interface FixtureRunConfiguration {
  readonly task: FixtureTaskSpecification;
  readonly run_id: string;
  readonly request_id: string;
  readonly request_ref: string;
  readonly worktree_ref: string;
  readonly created_at: string;
  readonly execution_profile_version?: string;
  readonly execution_transport_version?: string;
  readonly execution_implementation_identity?: string;
  readonly execution_capability_digest?: string;
}

export interface TypedFixtureFulfillmentConfiguration {
  readonly task: FixtureTaskSpecification;
  readonly root: string;
  readonly database_path: string;
  readonly fixture_repository_path: string;
  readonly worktree_ref: string;
  readonly request_ref: string;
  readonly request: Record<string, JsonValue>;
  readonly objective: RunningObjective;
  readonly repository: RepositoryFacts;
  readonly fixture_harness: string;
  readonly envelope: Record<string, unknown>;
  readonly run_id: string;
  readonly holder_id: string;
  readonly approval_ref: string;
  readonly evidence_prefix: "slice2" | "slice3b" | "slice4";
  readonly allow_external_owner_receipt: boolean;
  readonly force_interruption_after_session: boolean;
  readonly failure_checkpoint?: Slice4FailureCheckpoint;
  readonly gate0a: "BLOCKED_COMPILER_PATH" | "PASS_REAL_COMPILER";
}

export type Slice4FailureCheckpoint =
  | "AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY"
  | "GITHUB_UNAVAILABLE_BEFORE_PUSH"
  | "AFTER_PUSH_ACK_LOST"
  | "AFTER_DRAFT_PR_ACK_LOST"
  | "AFTER_EVIDENCE_ACK_LOST";

export interface TypedFixtureFulfillmentResult {
  readonly result: "CANDIDATE_READY_FOR_OWNER_REVIEW";
  readonly run_id: string;
  readonly request_digest: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly candidate_revision: 1;
  readonly target_candidate_sha: string;
  readonly target_branch: FixtureTaskSpecification["target_branch"];
  readonly target_pr_number: number;
  readonly target_pr_url: string;
  readonly evidence_identity: string;
  readonly evidence_comment_url: string;
  readonly evidence_manifest_digest: string;
  readonly worktree_path_digest: string;
  readonly session_digest: string;
  readonly event_count: number;
  readonly event_chain_head: string;
  readonly owner_obligation: "PENDING_T4";
  readonly gate0a: "BLOCKED_COMPILER_PATH" | "PASS_REAL_COMPILER";
  readonly forced_interruption_checkpoint: "NOT_REQUESTED" | "AFTER_SESSION_PERSISTED" | Slice4FailureCheckpoint;
  readonly merged: false;
  readonly released: false;
  readonly deployed: false;
}

export function fixtureRunSeed(
  configuration: Pick<
    TypedFixtureFulfillmentConfiguration,
    "task" | "run_id" | "holder_id" | "request" | "objective" | "envelope"
  >,
): RunSeed {
  const objectiveDigest = hashCanonical(asJson(configuration.objective.objective));
  const envelopeDigest = String(
    (configuration.envelope.digests as Record<string, unknown>).envelope_digest,
  );
  return {
    run_id: configuration.run_id,
    request_id: String(configuration.request.request_id),
    objective_id: String(configuration.objective.objective.objective_id),
    objective_ref: configuration.objective.issue_ref,
    request_digest: String(configuration.request.request_digest),
    objective_digest: objectiveDigest,
    envelope_digest: envelopeDigest,
    generation: 1,
    lease_key: configuration.task.task_id,
    holder_id: configuration.holder_id,
    ttl_seconds: 3600,
    obligations: (configuration.envelope.obligations as Array<Record<string, unknown>>).map((obligation) => ({
      obligation_id: String(obligation.obligation_id),
      category: String(obligation.category) as "engineering" | "product_candidate" | "publication" | "owner",
      verifier_id: String(obligation.verifier_id),
      minimum_trust: String(obligation.minimum_trust) as "T1" | "T2" | "T3" | "T4",
    })),
  };
}

export function buildFixtureRunEnvelope(
  request: Record<string, JsonValue>,
  objective: Record<string, unknown>,
  repositoryId: string,
  fixtureHarness: string,
  configuration: FixtureRunConfiguration = {
    task: slice2FixtureTask,
    run_id: runId,
    request_id: requestId,
    request_ref: "local-evidence://slice2/delivery-request.json",
    worktree_ref: "workspace://slice2/fixture-worktree",
    created_at: "2026-08-02T15:56:00.000Z",
  },
): Record<string, unknown> {
  const task = configuration.task;
  const objectiveDigest = hashCanonical(asJson(objective));
  const policy = {
    allowed_paths: ["README.md", "src/index.js", "test/summary.test.js"],
    forbidden_paths: ["package.json", "package-lock.json", "AGENTS.md", "docs/HARNESS.md", "fixtures/**"],
    limits: {
      max_files: 3,
      max_changed_lines: 500,
      max_changed_bytes: 100000,
      allow_binary: false,
      allow_symlink: false,
      allow_mode_change: false,
      allow_submodule: false,
    },
  };
  const envelope: Record<string, unknown> = {
    schema_version: "run-envelope/v0.2",
    run_id: configuration.run_id,
    generation: 1,
    request: {
      request_id: configuration.request_id,
      request_ref: configuration.request_ref,
      request_digest: request.request_digest,
    },
    objective: {
      objective_id: objective.objective_id,
      project_id: objective.project_id,
      objective_ref: task.objective_ref,
      objective_digest: objectiveDigest,
      status: "RUNNING",
    },
    contract_ref: objective.contract_ref,
    project_harness_ref: objective.project_harness_ref,
    project: {
      repository_full_name: "fixture.invalid/ados-fixture-delivery",
      repository_id: repositoryId,
      base_sha: task.base_sha,
      default_branch: "main",
      repository_path: "repository://fixture.invalid/ados-fixture-delivery",
      worktree_path: configuration.worktree_ref,
      branch_name: task.target_branch,
    },
    execution_profile: {
      profile_id: "executor.codex-app-server.fixture-v0.1",
      profile_version: configuration.execution_profile_version ??
        (task.task_id === "fixture-dogfood-safety-v0.1" ? "0.1.0-slice4-pin-public.1" : "0.1.0-public.1"),
      adapter_class: "executor.local_agent",
      transport_protocol: "codex_app_server",
      transport_version: configuration.execution_transport_version ??
        (task.task_id === "fixture-dogfood-safety-v0.1" ? "0.147.0-alpha.1.2" : "0.146.0-alpha.9.2"),
      implementation_identity: configuration.execution_implementation_identity ?? (task.task_id === "fixture-dogfood-safety-v0.1"
        ? "codex.exe@fa960ec081be"
        : "codex.exe@ecd7a3eaff5e"),
      capability_digest: configuration.execution_capability_digest ?? (task.task_id === "fixture-dogfood-safety-v0.1"
        ? slice4FixtureExecutorCapabilityDigest()
        : task.task_id === "fixture-owner-review-v0.1"
        ? fixtureExecutorCapabilityDigest()
        : hashCanonical({
            executable_sha256: "ecd7a3eaff5e42723dbba03b5c91514b3986b5db5cbca8f34619620b5356f31f",
            sandbox: "workspace-write",
            approvals: "never",
            gh_on_path: false,
            sqlite_handle: false,
          })),
    },
    agent_autonomy: {
      goal_ref: task.objective_ref,
      allowed_to_plan: false,
      allowed_to_iterate: true,
      max_parallel_writers: 1,
      prohibited_self_authority: [
        "authorization",
        "objective",
        "envelope",
        "harness_pin",
        "base_sha",
        "obligation_status",
        "merge",
        "release",
        "done",
      ],
    },
    authorization: "IMPLEMENT",
    lease_policy: {
      key: task.task_id,
      max_active: 1,
      ttl_seconds: 3600,
      heartbeat_seconds: 60,
      stale_recovery_requires_reconcile: true,
    },
    scope: policy,
    tool_permissions: [
      { capability: "workspace_file_edit", effect: "ALLOW", constraints: { allowed_paths: policy.allowed_paths } },
      { capability: "local_test_process", effect: "ALLOW", constraints: { network: false } },
      { capability: "github", effect: "DENY", constraints: { executor: "codex" } },
      { capability: "sqlite", effect: "DENY", constraints: { executor: "codex" } },
    ],
    required_checks: [
      { check_id: "fixture-test", name: "Fixture tests", command: "npm.cmd test", timeout_seconds: 120, trusted_source_ref: `${task.objective_ref.split("#")[0]}@${task.base_sha}#docs/HARNESS.md`, minimum_trust: "T2" },
      { check_id: "fixture-check", name: "Fixture check", command: "npm.cmd run check", timeout_seconds: 120, trusted_source_ref: `${task.objective_ref.split("#")[0]}@${task.base_sha}#docs/HARNESS.md`, minimum_trust: "T2" },
      { check_id: "machine-output", name: "Machine output", command: "node src/index.js fixtures/order.json --machine", timeout_seconds: 30, trusted_source_ref: task.objective_ref, minimum_trust: "T2" },
      { check_id: "owner-summary-output", name: "Owner summary output", command: "node src/index.js fixtures/order.json --owner-summary", timeout_seconds: 30, trusted_source_ref: task.objective_ref, minimum_trust: "T2" },
      ...(task.cli_option === "--owner-review"
        ? [{ check_id: "owner-review-output", name: "Owner review output", command: "node src/index.js fixtures/order.json --owner-review", timeout_seconds: 30, trusted_source_ref: task.objective_ref, minimum_trust: "T2" }]
        : []),
      ...(task.cli_option === "--dogfood-safety"
        ? [
            { check_id: "owner-review-output", name: "Owner review output", command: "node src/index.js fixtures/order.json --owner-review", timeout_seconds: 30, trusted_source_ref: task.objective_ref, minimum_trust: "T2" },
            { check_id: "dogfood-safety-output", name: "Dogfood safety output", command: "node src/index.js fixtures/order.json --dogfood-safety", timeout_seconds: 30, trusted_source_ref: task.objective_ref, minimum_trust: "T2" },
          ]
        : []),
    ],
    obligations: [
      { obligation_id: "target-harness", category: "engineering", description: "Target Harness commands pass.", evidence_required: "check", verifier_id: "verifier.target-harness", minimum_trust: "T2", initial_status: "PENDING" },
      { obligation_id: "target-scope", category: "engineering", description: "Exact allowed scope and safe diff pass.", evidence_required: "check", verifier_id: "verifier.target-scope", minimum_trust: "T2", initial_status: "PENDING" },
      { obligation_id: "target-artifact", category: "product_candidate", description: task.artifact_description, evidence_required: "artifact", verifier_id: "verifier.target-artifact", minimum_trust: "T2", initial_status: "PENDING" },
      { obligation_id: "publication-draft", category: "publication", description: "One exact Draft PR reads back at the candidate SHA.", evidence_required: "forge_state", verifier_id: "verifier.forge-pr", minimum_trust: "T3", initial_status: "PENDING" },
      { obligation_id: "publication-evidence", category: "publication", description: "Candidate-bound Evidence comment reads back.", evidence_required: "forge_state", verifier_id: "verifier.forge-evidence", minimum_trust: "T3", initial_status: "PENDING" },
      { obligation_id: "owner-acceptance", category: "owner", description: "Owner accepts the candidate.", evidence_required: "owner_decision", verifier_id: "verifier.owner", minimum_trust: "T4", initial_status: "PENDING" },
    ],
    verifiers: [
      { verifier_id: "verifier.target-harness", kind: "command", trusted_source_ref: `${task.objective_ref.split("#")[0]}@${task.base_sha}#docs/HARNESS.md`, independence: "separate_process", trust_level: "T2" },
      { verifier_id: "verifier.target-scope", kind: "scope", trusted_source_ref: task.objective_ref, independence: "separate_process", trust_level: "T2" },
      { verifier_id: "verifier.target-artifact", kind: "artifact", trusted_source_ref: task.objective_ref, independence: "separate_process", trust_level: "T2" },
      { verifier_id: "verifier.forge-pr", kind: "forge", trusted_source_ref: "github://fixture.invalid/ados-fixture-delivery", independence: "external_system", trust_level: "T3" },
      { verifier_id: "verifier.forge-evidence", kind: "evidence", trusted_source_ref: "github://fixture.invalid/ados-fixture-delivery", independence: "external_system", trust_level: "T3" },
      { verifier_id: "verifier.owner", kind: "owner", trusted_source_ref: "owner://decision", independence: "owner", trust_level: "T4" },
    ],
    approval_gates: [
      { gate_id: "merge", trigger: "Any merge action", required_authorization: "MERGE", decision_owner: "owner" },
      { gate_id: "release", trigger: "Any release or deploy action", required_authorization: "RELEASE", decision_owner: "owner" },
    ],
    publication: {
      forge_profile_id: "forge.git-gh.bounded-v0.1",
      mode: "draft_pull_request",
      branch_name: task.target_branch,
      pull_request_state: "DRAFT",
      allow_merge: false,
      allow_release: false,
      evidence_identity_template: "ados-fixture-delivery:{run_id}:{candidate_revision}",
      max_open_pull_requests: 1,
      candidate_revision_policy: "same_pr_superseding_evidence",
    },
    stop_conditions: [
      "Stop on target base, Objective, Harness, scope, dependency, credential or Codex identity drift.",
      "Stop rather than create a second run, worktree, thread, branch, Draft PR, candidate or Evidence identity.",
      "Stop at OWNER_REVIEW without Ready, merge, release, deploy or Slice 3.",
    ],
    recovery: {
      resume_same_session: true,
      reuse_worktree: true,
      reuse_branch: true,
      reuse_pull_request: true,
      reconcile_same_evidence_for_same_candidate: true,
      candidate_revision_requires_recorded_reason: true,
      new_generator_without_owner: false,
    },
    digests: {
      envelope_digest: `sha256:${"0".repeat(64)}`,
      contract_digest: sha256Text(readFileSync(resolve("vendor", "ados", "contracts", "RUN_ENVELOPE_CONTRACT_V0.2.md"))),
      harness_digest: sha256Text(fixtureHarness),
      policy_digest: hashCanonical(policy),
    },
    created_at: configuration.created_at,
    initial_state: "PREPARED",
  };
  (envelope.digests as Record<string, unknown>).envelope_digest = computeEnvelopeDigest(envelope);
  return envelope;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJson(asJson(value))}\n`, "utf8");
}

function effectIntent(
  store: EventStore,
  token: number,
  input: Parameters<EventStore["recordExternalEffectIntent"]>[3],
  key: string,
): void {
  store.recordExternalEffectIntent(runId, holderId, token, input, key);
}

function effectResult(
  store: EventStore,
  token: number,
  input: Parameters<EventStore["reconcileExternalEffect"]>[3],
  key: string,
): void {
  store.reconcileExternalEffect(runId, holderId, token, input, key);
}

function transitionIf(store: EventStore, token: number, from: RunState, to: RunState, key: string): void {
  const state = store.getRun(runId).state;
  if (state === to) {
    return;
  }
  if (state !== from) {
    throw new Error(`SLICE2_STATE_DRIFT:${state}:${from}:${to}`);
  }
  store.transition(runId, from, to, holderId, token, key);
}

function recordWorkspaceIfChanged(
  store: EventStore,
  token: number,
  fact: Parameters<EventStore["recordWorkspaceFact"]>[3],
  key: string,
): void {
  const existing = store.workspace(runId);
  if (
    existing?.repository_full_name === fact.repository_full_name &&
    existing.base_sha === fact.base_sha &&
    existing.branch_name === fact.branch_name &&
    existing.worktree_path_digest === fact.worktree_path_digest &&
    existing.candidate_sha === fact.candidate_sha &&
    existing.candidate_revision === fact.candidate_revision &&
    existing.status === fact.status
  ) {
    return;
  }
  store.recordWorkspaceFact(runId, holderId, token, fact, key);
}

function verifierReceipt(
  verifier: Slice2VerifierResult,
  obligationId: string,
  verifierId: string,
): VerifierReceiptInput {
  return {
    verifier_receipt_id: `vr-${obligationId}-slice2-0001`,
    obligation_id: obligationId,
    verifier_id: verifierId,
    trust_level: "T2",
    result: "PASS",
    input_digest: hashCanonical({ candidate_digest: verifier.candidate_digest, obligation_id: obligationId }),
    result_digest: hashCanonical({ candidate_digest: verifier.candidate_digest, obligation_id: obligationId, result: "PASS", trust: "T2" }),
    evidence_ref: `local-evidence://slice2/verifier/${obligationId}`,
  };
}

function satisfyIfPending(
  store: EventStore,
  token: number,
  receipt: VerifierReceiptInput,
  key: string,
): void {
  const obligation = store.summary(runId).obligations.find((item) => item.obligation_id === receipt.obligation_id);
  if (obligation?.status === "SATISFIED") {
    return;
  }
  store.satisfyObligation(runId, holderId, token, receipt, key);
}

export interface FixtureEvidenceConfiguration {
  readonly task: FixtureTaskSpecification;
  readonly approval_ref: string;
  readonly request_ref: string;
  readonly evidence_prefix: "slice2" | "slice3b" | "slice4";
  readonly generated_at: string;
  readonly gate0a_blocker: boolean;
}

export function buildEvidenceManifest(
  objective: Record<string, unknown>,
  envelope: Record<string, unknown>,
  verifier: Slice2VerifierResult,
  candidateSha: string,
  pullRequestNumber: number,
  pullRequestUrl: string,
  worktreePath: string,
  configuration: FixtureEvidenceConfiguration = {
    task: slice2FixtureTask,
    approval_ref: approvalRef,
    request_ref: "local-evidence://slice2/delivery-request.json",
    evidence_prefix: "slice2",
    generated_at: "2026-08-02T16:30:00.000Z",
    gate0a_blocker: true,
  },
): Record<string, unknown> {
  const task = configuration.task;
  const patchAccounting = measureStagedPatchBytes(
    worktreePath,
    task.base_sha,
    candidateSha,
    verifier.changed_paths,
  );
  const bytesByPath = new Map(patchAccounting.changes.map((change) => [change.path, change.bytes_changed]));
  const candidateIdentity = `candidate-${candidateSha.slice(0, 20)}`;
  return {
    schema_version: "evidence-manifest/v0.1",
    objective_id: objective.objective_id,
    candidate_id: candidateIdentity,
    authorization: "IMPLEMENT",
    objective_status: "OWNER_REVIEW",
    contract_ref: objective.contract_ref,
    project_harness_ref: objective.project_harness_ref,
    inputs: [
      { kind: "issue", ref: task.objective_ref, description: "RUNNING target Objective." },
      { kind: "commit", ref: `fixture.invalid/ados-fixture-delivery@${task.base_sha}`, description: "Frozen fixture base." },
      { kind: "decision", ref: configuration.approval_ref, description: "Owner IMPLEMENT authorization." },
      { kind: "file", ref: configuration.request_ref, description: "Authenticated and validated Delivery Request." },
    ],
    changes: verifier.changed_paths.map((path) => ({
      path,
      change_type: "modified",
      summary: task.change_summary[path as keyof typeof task.change_summary],
      bytes_changed: bytesByPath.get(path) ?? 0,
    })),
    change_accounting: {
      method: patchAccounting.method,
      total_changed_bytes: patchAccounting.total_changed_bytes,
      limit_bytes: 100000,
    },
    engineering_checks: verifier.checks.map((check) => ({
      name: check.name,
      command: check.command,
      status: check.status,
      evidence_ref: `local-evidence://${configuration.evidence_prefix}/check/${check.name.replaceAll(" ", "-")}`,
    })),
    owner_artifact: {
      kind: "demo",
      location: `repository://fixture.invalid/ados-fixture-delivery@${candidateSha}#README.md`,
      description: task.artifact_description,
    },
    product_acceptance_status: "PENDING_OWNER",
    owner_acceptance_ref: null,
    blockers: configuration.gate0a_blocker
      ? ["Gate 0A remains BLOCKED_COMPILER_PATH and is not claimed by this signed-request Slice 2 candidate."]
      : [],
    stop_conditions: ["Stop at OWNER_REVIEW; no Ready, merge, release or deploy."],
    publication: {
      identity_key: candidateIdentity,
      state: "DRAFT_OPEN",
      branch_refs: [task.target_branch],
      candidate_refs: [candidateSha],
      pull_request_refs: [pullRequestUrl],
      state_writeback_ref: `https://github.com/fixture.invalid/ados-fixture-delivery/issues/${task.objective_issue_number}`,
      merged: false,
      released: false,
      merge_approval_ref: null,
      release_approval_ref: null,
      recovery_of: null,
    },
    execution_posture: {
      temporary_activation: false,
      post_run_state: "NOT_APPLICABLE",
      restoration_evidence_ref: null,
    },
    generated_at: configuration.generated_at,
    generator: { name: `ados-local-${configuration.evidence_prefix}`, version: "0.1.0-public.1" },
    _internal_pr_number: pullRequestNumber,
    _internal_envelope_digest: (envelope.digests as Record<string, unknown>).envelope_digest,
  };
}

export function withoutInternalEvidenceFields(manifest: Record<string, unknown>): Record<string, unknown> {
  const result = { ...manifest };
  delete result._internal_pr_number;
  delete result._internal_envelope_digest;
  return result;
}

function recoverCompletedResult(
  store: EventStore,
  resultPath: string,
  root: string,
  requestDigest: string,
  objectiveDigest: string,
  envelopeDigest: string,
): Slice2FulfillmentResult {
  const summary = store.summary(runId);
  const owner = summary.obligations.find((item) => item.category === "owner");
  const workspace = store.workspace(runId);
  const session = store.sessions(runId)[0];
  const publications = store.publications(runId);
  const pullRequest = publications.find((item) => item.effect_kind === "DRAFT_PR");
  const evidence = publications.find((item) => item.effect_kind === "EVIDENCE_COMMENT");
  const evidencePath = join(root, "evidence-manifest.json");
  if (
    summary.run.state !== "OWNER_REVIEW" ||
    owner?.status !== "PENDING" ||
    workspace?.status !== "PUBLISHED" ||
    workspace.candidate_sha === null ||
    session === undefined ||
    pullRequest?.status !== "CONFIRMED" ||
    pullRequest.result_ref === null ||
    evidence?.status !== "CONFIRMED" ||
    evidence.result_ref === null ||
    !existsSync(evidencePath)
  ) {
    throw new Error("SLICE2_COMPLETED_RESULT_RECOVERY_INVALID");
  }
  const pullRequestNumber = Number(new URL(pullRequest.result_ref).pathname.split("/").at(-1));
  if (!Number.isSafeInteger(pullRequestNumber)) {
    throw new Error("SLICE2_COMPLETED_PR_NUMBER_INVALID");
  }
  const evidenceManifest = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  const publication = evidenceManifest.publication as Record<string, unknown>;
  const candidateIdentity = String(evidenceManifest.candidate_id ?? "");
  const evidenceIdentity = evidence.identity_key;
  if (
    evidenceIdentity !== `ados-fixture-delivery:${runId}:1` ||
    candidateIdentity !== `candidate-${workspace.candidate_sha.slice(0, 20)}` ||
    publication.identity_key !== candidateIdentity
  ) {
    throw new Error("SLICE2_COMPLETED_EVIDENCE_IDENTITY_INVALID");
  }
  const result: Slice2FulfillmentResult = {
    result: "CANDIDATE_READY_FOR_OWNER_REVIEW",
    run_id: runId,
    request_digest: requestDigest,
    objective_digest: objectiveDigest,
    envelope_digest: envelopeDigest,
    candidate_revision: 1,
    target_candidate_sha: workspace.candidate_sha,
    target_branch: targetBranch,
    target_pr_number: pullRequestNumber,
    target_pr_url: pullRequest.result_ref,
    evidence_identity: evidenceIdentity,
    evidence_comment_url: evidence.result_ref,
    evidence_manifest_digest: hashCanonical(asJson(evidenceManifest)),
    worktree_path_digest: workspace.worktree_path_digest,
    session_digest: hashCanonical({ thread_id: session.thread_id }),
    event_count: summary.event_count,
    event_chain_head: summary.chain_head,
    owner_obligation: "PENDING_T4",
    gate0a: "BLOCKED_COMPILER_PATH",
    merged: false,
    released: false,
    deployed: false,
  };
  writeJson(resultPath, result);
  return result;
}

export async function fulfillTypedFixtureRun(
  supplied?: TypedFixtureFulfillmentConfiguration,
): Promise<TypedFixtureFulfillmentResult> {
  const defaultRoot = slice2Root();
  if (supplied === undefined && existsSync(join(defaultRoot, "result.json")) && existsSync(join(defaultRoot, "state.sqlite"))) {
    const existingStore = new EventStore(join(defaultRoot, "state.sqlite"));
    try {
      const summary = existingStore.summary(runId);
      existingStore.verifyEventChain();
      existingStore.verifyProjectionConsistency();
      const owner = summary.obligations.find((item) => item.category === "owner");
      if (summary.run.state !== "OWNER_REVIEW" || owner?.status !== "PENDING") {
        throw new Error("SLICE2_REUSE_STATE_INVALID");
      }
      return JSON.parse(readFileSync(join(defaultRoot, "result.json"), "utf8")) as TypedFixtureFulfillmentResult;
    } finally {
      existingStore.close();
    }
  }
  let configuration = supplied;
  if (configuration === undefined) {
    const fixturePath = fixtureRepositoryPath();
    const fixtureHarness = readFileSync(join(fixturePath, "docs", "HARNESS.md"), "utf8");
    const repositoryFacts = readFixtureRepositoryFacts(fixturePath);
    const fixtureObjective = readRunningObjective(fixturePath, "fixture.invalid/ados-fixture-delivery", 1);
    readRunningObjective(process.cwd(), "fixture.invalid/ados-local", 3);
    const request = buildSignedRequest();
    const envelope = buildFixtureRunEnvelope(request, fixtureObjective.objective, repositoryFacts.id, fixtureHarness);
    configuration = {
      task: slice2FixtureTask,
      root: defaultRoot,
      database_path: join(defaultRoot, "state.sqlite"),
      fixture_repository_path: fixturePath,
      worktree_ref: "workspace://slice2/fixture-worktree",
      request_ref: "local-evidence://slice2/delivery-request.json",
      request,
      objective: fixtureObjective,
      repository: repositoryFacts,
      fixture_harness: fixtureHarness,
      envelope,
      run_id: runId,
      holder_id: holderId,
      approval_ref: approvalRef,
      evidence_prefix: "slice2",
      allow_external_owner_receipt: true,
      force_interruption_after_session: false,
      gate0a: "BLOCKED_COMPILER_PATH",
    };
  }
  const {
    task,
    fixture_repository_path: fixturePath,
    fixture_harness: fixtureHarness,
    repository: repositoryFacts,
    objective: fixtureObjective,
    request,
    envelope,
    run_id: activeRunId,
    holder_id: activeHolderId,
  } = configuration;
  const root = configuration.root;
  mkdirSync(root, { recursive: true });
  const resultPath = join(root, "result.json");
  const databasePath = configuration.database_path;
  if (existsSync(resultPath) && existsSync(databasePath)) {
    const existingStore = new EventStore(databasePath);
    try {
      const summary = existingStore.summary(activeRunId);
      existingStore.verifyEventChain();
      existingStore.verifyProjectionConsistency();
      const owner = summary.obligations.find((item) => item.category === "owner");
      if (summary.run.state !== "OWNER_REVIEW" || owner?.status !== "PENDING") {
        throw new Error("SLICE2_REUSE_STATE_INVALID");
      }
      return JSON.parse(readFileSync(resultPath, "utf8")) as TypedFixtureFulfillmentResult;
    } finally {
      existingStore.close();
    }
  }
  const worktreePath = join(root, "fixture-worktree");
  const validator = new ContractValidator();
  const requestValidation = validator.validateDeliveryRequest(request, true);
  if (!requestValidation.valid) {
    throw new Error(`FIXTURE_REQUEST_INVALID:${requestValidation.errors.join("|")}`);
  }
  const objectiveValidation = validator.validateSchema("objective-record", fixtureObjective.objective);
  if (!objectiveValidation.valid) {
    throw new Error(`FIXTURE_OBJECTIVE_INVALID:${objectiveValidation.errors.join("|")}`);
  }
  const envelopeValidation = validator.validateRunEnvelope(envelope);
  if (!envelopeValidation.valid) {
    throw new Error(`FIXTURE_ENVELOPE_INVALID:${envelopeValidation.errors.join("|")}`);
  }
  writeJson(join(root, "delivery-request.json"), request);
  writeJson(join(root, "objective.json"), fixtureObjective.objective);
  writeJson(join(root, "run-envelope.json"), envelope);

  const objectiveDigest = hashCanonical(asJson(fixtureObjective.objective));
  const envelopeDigest = String((envelope.digests as Record<string, unknown>).envelope_digest);
  const store = new EventStore(databasePath);
  try {
    const created = store.createRun(fixtureRunSeed(configuration));
    if (created.disposition === "DUPLICATE_RECONCILED" && created.run.state === "OWNER_REVIEW") {
      if (existsSync(resultPath)) {
        return JSON.parse(readFileSync(resultPath, "utf8")) as TypedFixtureFulfillmentResult;
      }
      if (configuration.evidence_prefix === "slice2") {
        return recoverCompletedResult(
          store,
          resultPath,
          root,
          String(request.request_digest),
          objectiveDigest,
          envelopeDigest,
        ) as TypedFixtureFulfillmentResult;
      }
      throw new Error("FIXTURE_COMPLETED_RESULT_MISSING");
    }
    const token = created.lease.fencing_token;
    const approvalCount = store.summary(activeRunId).approval_count;
    if (approvalCount === 0 && configuration.allow_external_owner_receipt) {
      const receipt = request.owner_authorization_receipt as Record<string, string>;
      store.recordOwnerApproval(
        activeRunId,
        activeHolderId,
        token,
        {
          receipt_id: receipt.receipt_id ?? "",
          actor_id: receipt.actor_id ?? "",
          authn_method: "external_owner_record",
          action: "approve_delivery",
          authorization: "IMPLEMENT",
          approval_ref: receipt.approval_ref ?? "",
          owner_turn_digest: receipt.owner_turn_digest ?? "",
          request_digest: receipt.request_digest ?? "",
          approved_at: receipt.approved_at ?? "",
        },
        `${configuration.evidence_prefix}-owner-approval`,
      );
    } else if (!configuration.allow_external_owner_receipt && approvalCount !== 1) {
      throw new Error("BLOCKED_DISPATCH_APPROVAL_PROJECTION");
    }

    store.recordExternalEffectIntent(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:worktree`,
      effect_kind: "WORKTREE_CREATE",
      identity_key: `${activeRunId}:workspace:1`,
      target_ref: configuration.worktree_ref,
      candidate_sha: null,
      payload: { repository: repositoryFacts.full_name, base_sha: task.base_sha, branch: task.target_branch },
    }, `${configuration.evidence_prefix}-worktree-intent`);
    const binding = ensureIsolatedWorktree(fixturePath, worktreePath, task.base_sha, task.target_branch);
    store.reconcileExternalEffect(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:worktree`,
      effect_kind: "WORKTREE_CREATE",
      identity_key: `${activeRunId}:workspace:1`,
      result_ref: configuration.worktree_ref,
      readback_digest: hashCanonical({
        repository: binding.repository_full_name,
        base_sha: binding.base_sha,
        branch: binding.branch_name,
        worktree_path_digest: binding.worktree_path_digest,
      }),
    }, `${configuration.evidence_prefix}-worktree-reconciled`);
    if (store.workspace(activeRunId) === null) {
      store.recordWorkspaceFact(activeRunId, activeHolderId, token, {
        repository_full_name: binding.repository_full_name,
        base_sha: binding.base_sha,
        branch_name: binding.branch_name,
        worktree_path_digest: binding.worktree_path_digest,
        candidate_sha: null,
        candidate_revision: 1,
        status: "BOUND",
      }, `${configuration.evidence_prefix}-workspace-bound`);
    }
    const entryState = store.getRun(activeRunId).state;
    if (entryState === "PREPARED" || entryState === "EXECUTING") {
      if (entryState === "PREPARED") {
        store.transition(activeRunId, "PREPARED", "EXECUTING", activeHolderId, token, `${configuration.evidence_prefix}-executing`);
      }
    } else if (entryState !== "VERIFYING" && entryState !== "PUBLISHING") {
      throw new Error(`FIXTURE_ENTRY_STATE_UNRECOVERABLE:${entryState}`);
    }

    let session = store.sessions(activeRunId)[0] ?? null;
    if (session === null) {
      const execution = await executeFixtureWithCodex(worktreePath, task);
      store.recordAgentClaim(activeRunId, activeHolderId, token, `candidate:${execution.agent_claim_digest}`, `${configuration.evidence_prefix}-agent-claim`);
      store.recordSessionFact(activeRunId, activeHolderId, token, {
        profile_id: "executor.codex-app-server.fixture-v0.1",
        thread_id: execution.thread_id,
        turn_id: execution.turn_id,
        status: execution.resumed_after_restart ? "completed-and-resumed" : execution.status,
        capability_digest: execution.capability_digest,
      }, `${configuration.evidence_prefix}-session-bound`);
      store.recordWorkspaceFact(activeRunId, activeHolderId, token, {
        repository_full_name: binding.repository_full_name,
        base_sha: binding.base_sha,
        branch_name: binding.branch_name,
        worktree_path_digest: binding.worktree_path_digest,
        candidate_sha: null,
        candidate_revision: 1,
        status: "MUTATED",
      }, `${configuration.evidence_prefix}-workspace-mutated`);
      session = store.sessions(activeRunId)[0] ?? null;
      if (configuration.force_interruption_after_session) {
        throw new Error("SLICE3B_FORCED_INTERRUPTION:AFTER_SESSION_PERSISTED");
      }
      if (configuration.failure_checkpoint === "AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY") {
        throw new Error("SLICE4_FORCED_INTERRUPTION:AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY");
      }
    } else {
      inspectCandidate(worktreePath, task.base_sha);
    }
    if (session === null) {
      throw new Error("FIXTURE_SESSION_PROJECTION_MISSING");
    }
    const transitionActive = (from: RunState, to: RunState, key: string): void => {
      const state = store.getRun(activeRunId).state;
      if (state === to) return;
      if (state !== from) throw new Error(`FIXTURE_STATE_DRIFT:${state}:${from}:${to}`);
      store.transition(activeRunId, from, to, activeHolderId, token, key);
    };
    const recordWorkspaceActive = (
      fact: Parameters<EventStore["recordWorkspaceFact"]>[3],
      key: string,
    ): void => {
      const existing = store.workspace(activeRunId);
      if (
        existing?.repository_full_name === fact.repository_full_name &&
        existing.base_sha === fact.base_sha &&
        existing.branch_name === fact.branch_name &&
        existing.worktree_path_digest === fact.worktree_path_digest &&
        existing.candidate_sha === fact.candidate_sha &&
        existing.candidate_revision === fact.candidate_revision &&
        existing.status === fact.status
      ) return;
      store.recordWorkspaceFact(activeRunId, activeHolderId, token, fact, key);
    };
    const satisfyActive = (receipt: VerifierReceiptInput, key: string): void => {
      const obligation = store.summary(activeRunId).obligations.find((item) => item.obligation_id === receipt.obligation_id);
      if (obligation?.status === "SATISFIED") return;
      store.satisfyObligation(activeRunId, activeHolderId, token, receipt, key);
    };
    const activeVerifierReceipt = (
      verifierResult: Slice2VerifierResult,
      obligationId: string,
      verifierId: string,
    ): VerifierReceiptInput => ({
      ...verifierReceipt(verifierResult, obligationId, verifierId),
      verifier_receipt_id: `vr-${obligationId}-${configuration.evidence_prefix}-0001`,
      evidence_ref: `local-evidence://${configuration.evidence_prefix}/verifier/${obligationId}`,
    });
    let candidateSha: string;
    let verifier: Slice2VerifierResult;
    if (store.getRun(activeRunId).state !== "PUBLISHING") {
      transitionActive("EXECUTING", "VERIFYING", `${configuration.evidence_prefix}-verifying`);
      let preCommitVerifier: Slice2VerifierResult;
      let repairs = session.status === "bounded-repair-completed" ? 1 : 0;
      try {
        preCommitVerifier = runSlice2Verifier(worktreePath, task.base_sha, null);
      } catch (error) {
        if (task.task_id === "fixture-dogfood-safety-v0.1" || !boundedRepairAllowed(repairs)) {
          throw error;
        }
        repairs += 1;
        const message = error instanceof Error ? error.message : "UNKNOWN_VERIFIER_FAILURE";
        const repair = await repairFixtureWithCodex(worktreePath, session.thread_id, message, task);
        store.recordAgentClaim(activeRunId, activeHolderId, token, `repair:${repair.agent_claim_digest}`, `${configuration.evidence_prefix}-agent-repair-claim`);
        store.recordSessionFact(activeRunId, activeHolderId, token, {
          profile_id: session.profile_id,
          thread_id: session.thread_id,
          turn_id: repair.turn_id,
          status: "bounded-repair-completed",
          capability_digest: session.capability_digest,
        }, `${configuration.evidence_prefix}-session-repair`);
        preCommitVerifier = runSlice2Verifier(worktreePath, task.base_sha, null);
      }

      if (task.cli_option === "--owner-review") {
        const ownerReview = runProcess(
          process.execPath,
          ["src/index.js", "fixtures/order.json", task.cli_option],
          worktreePath,
          30_000,
        );
        if (ownerReview.stderr !== "" || ownerReview.stdout !== `${task.exact_output}\n`) {
          throw new Error(`OWNER_REVIEW_OUTPUT_DRIFT:${JSON.stringify(ownerReview.stdout)}`);
        }
      }
      if (task.cli_option === "--dogfood-safety") {
        const acceptedOutputs = [
          ["--machine", '{"order_id":"SO-1001","currency":"AUD","item_count":3,"total":"42.50"}'],
          ["--owner-summary", "Order SO-1001: 3 items; total AUD 42.50."],
          ["--owner-review", "Order SO-1001 is ready for owner review: 3 items; total AUD 42.50."],
          [task.cli_option, task.exact_output],
        ] as const;
        for (const [option, exact] of acceptedOutputs) {
          const output = runProcess(process.execPath, ["src/index.js", "fixtures/order.json", option], worktreePath, 30_000);
          if (output.stderr !== "" || output.stdout !== `${exact}\n`) {
            throw new Error(`DOGFOOD_OUTPUT_DRIFT:${option}:${JSON.stringify(output.stdout)}`);
          }
        }
      }

      store.recordExternalEffectIntent(activeRunId, activeHolderId, token, {
        outbox_id: `${activeRunId}:commit`,
        effect_kind: "GIT_COMMIT",
        identity_key: `${activeRunId}:candidate:1`,
        target_ref: task.target_branch,
        candidate_sha: null,
        payload: { diff_digest: preCommitVerifier.diff_digest, branch: task.target_branch },
      }, `${configuration.evidence_prefix}-commit-intent`);
      const commit = commitFixtureCandidate(worktreePath, task.base_sha, task);
      candidateSha = commit.candidate_sha;
      store.reconcileExternalEffect(activeRunId, activeHolderId, token, {
        outbox_id: `${activeRunId}:commit`,
        effect_kind: "GIT_COMMIT",
        identity_key: `${activeRunId}:candidate:1`,
        result_ref: candidateSha,
        readback_digest: hashCanonical({ candidate_sha: candidateSha, branch: task.target_branch }),
      }, `${configuration.evidence_prefix}-commit-reconciled`);
      verifier = runSlice2Verifier(worktreePath, task.base_sha, candidateSha);
      recordWorkspaceActive({
        repository_full_name: binding.repository_full_name,
        base_sha: binding.base_sha,
        branch_name: binding.branch_name,
        worktree_path_digest: binding.worktree_path_digest,
        candidate_sha: candidateSha,
        candidate_revision: 1,
        status: "VERIFIED",
      }, `${configuration.evidence_prefix}-workspace-verified`);
      satisfyActive(activeVerifierReceipt(verifier, "target-harness", "verifier.target-harness"), `${configuration.evidence_prefix}-obligation-harness`);
      satisfyActive(activeVerifierReceipt(verifier, "target-scope", "verifier.target-scope"), `${configuration.evidence_prefix}-obligation-scope`);
      satisfyActive(activeVerifierReceipt(verifier, "target-artifact", "verifier.target-artifact"), `${configuration.evidence_prefix}-obligation-artifact`);
      transitionActive("VERIFYING", "PUBLISHING", `${configuration.evidence_prefix}-publishing`);
    } else {
      const recoveredWorkspace = store.workspace(activeRunId);
      if (
        recoveredWorkspace === null ||
        recoveredWorkspace.candidate_sha === null ||
        !["VERIFIED", "PUBLISHED"].includes(recoveredWorkspace.status)
      ) {
        throw new Error("SLICE2_PUBLISHING_CANDIDATE_MISSING");
      }
      candidateSha = recoveredWorkspace.candidate_sha;
      verifier = runSlice2Verifier(worktreePath, task.base_sha, candidateSha);
    }

    store.recordExternalEffectIntent(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:push`,
      effect_kind: "GIT_PUSH",
      identity_key: `${activeRunId}:push:1`,
      target_ref: `refs/heads/${task.target_branch}`,
      candidate_sha: candidateSha,
      payload: { candidate_sha: candidateSha, branch: task.target_branch },
    }, `${configuration.evidence_prefix}-push-intent`);
    if (configuration.failure_checkpoint === "GITHUB_UNAVAILABLE_BEFORE_PUSH") {
      throw new Error("SLICE4_FORCED_INTERRUPTION:GITHUB_UNAVAILABLE_BEFORE_PUSH");
    }
    const push = pushFixtureCandidate(worktreePath, candidateSha, task);
    if (configuration.failure_checkpoint === "AFTER_PUSH_ACK_LOST") {
      throw new Error("SLICE4_FORCED_INTERRUPTION:AFTER_PUSH_ACK_LOST");
    }
    store.reconcileExternalEffect(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:push`,
      effect_kind: "GIT_PUSH",
      identity_key: `${activeRunId}:push:1`,
      result_ref: push.remote_ref,
      readback_digest: push.readback_digest,
    }, `${configuration.evidence_prefix}-push-reconciled`);

    store.recordExternalEffectIntent(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:pr`,
      effect_kind: "DRAFT_PR",
      identity_key: `${activeRunId}:pr:1`,
      target_ref: "fixture.invalid/ados-fixture-delivery",
      candidate_sha: candidateSha,
      payload: { candidate_sha: candidateSha, branch: task.target_branch, state: "DRAFT" },
    }, `${configuration.evidence_prefix}-pr-intent`);
    const pullRequest = createOrReuseFixtureDraftPr(worktreePath, candidateSha, task);
    if (configuration.failure_checkpoint === "AFTER_DRAFT_PR_ACK_LOST") {
      throw new Error("SLICE4_FORCED_INTERRUPTION:AFTER_DRAFT_PR_ACK_LOST");
    }
    store.reconcileExternalEffect(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:pr`,
      effect_kind: "DRAFT_PR",
      identity_key: `${activeRunId}:pr:1`,
      result_ref: pullRequest.url,
      readback_digest: pullRequest.readback_digest,
    }, `${configuration.evidence_prefix}-pr-reconciled`);
    satisfyActive({
      verifier_receipt_id: `vr-publication-draft-${configuration.evidence_prefix}-0001`,
      obligation_id: "publication-draft",
      verifier_id: "verifier.forge-pr",
      trust_level: "T3",
      result: "PASS",
      input_digest: hashCanonical({ candidate_sha: candidateSha, pr: pullRequest.number }),
      result_digest: pullRequest.readback_digest,
      evidence_ref: pullRequest.url,
    }, `${configuration.evidence_prefix}-obligation-pr`);

    const evidenceIdentity = `ados-fixture-delivery:${activeRunId}:1`;
    const manifestWithInternal = buildEvidenceManifest(
      fixtureObjective.objective,
      envelope,
      verifier,
      candidateSha,
      pullRequest.number,
      pullRequest.url,
      worktreePath,
      {
        task,
        approval_ref: configuration.approval_ref,
        request_ref: configuration.request_ref,
        evidence_prefix: configuration.evidence_prefix,
        generated_at: configuration.evidence_prefix === "slice2"
          ? "2026-08-02T16:30:00.000Z"
          : configuration.evidence_prefix === "slice3b"
            ? "2026-08-05T04:30:00.000Z"
            : "2026-08-06T06:30:00.000Z",
        gate0a_blocker: configuration.gate0a === "BLOCKED_COMPILER_PATH",
      },
    );
    const manifest = withoutInternalEvidenceFields(manifestWithInternal);
    const evidenceValidation = validator.validateEvidenceBindings(manifest, fixtureObjective.objective, envelope);
    if (!evidenceValidation.valid) {
      throw new Error(`FIXTURE_EVIDENCE_INVALID:${evidenceValidation.errors.join("|")}`);
    }
    const evidenceSemanticErrors = validateEvidenceSemantics(manifest);
    if (evidenceSemanticErrors.length !== 0) {
      throw new Error(
        `FIXTURE_EVIDENCE_SEMANTIC_INVALID:${renderEvidenceSemanticErrors(evidenceSemanticErrors)}`,
      );
    }
    const evidenceManifestDigest = hashCanonical(asJson(manifest));
    writeJson(join(root, "evidence-manifest.json"), manifest);
    if (store.summary(activeRunId).evidence_count === 0) {
      store.recordEvidence(activeRunId, activeHolderId, token, {
        evidence_id: `evidence-${configuration.evidence_prefix}-${task.task_id}-0001`,
        candidate_revision: 1,
        request_digest: String(request.request_digest),
        objective_digest: objectiveDigest,
        envelope_digest: envelopeDigest,
        candidate_digest: verifier.candidate_digest,
        product_acceptance_status: "PENDING_OWNER",
      }, `${configuration.evidence_prefix}-evidence-recorded`);
    }
    if (store.summary(activeRunId).artifact_count === 0) {
      const ownerReviewOutput = task.cli_option === "--owner-review"
        ? runProcess(process.execPath, ["src/index.js", "fixtures/order.json", task.cli_option], worktreePath, 30_000).stdout.trimEnd()
        : task.accepted_modes.includes("--owner-review")
          ? runProcess(process.execPath, ["src/index.js", "fixtures/order.json", "--owner-review"], worktreePath, 30_000).stdout.trimEnd()
          : null;
      const taskOutput = runProcess(
        process.execPath,
        ["src/index.js", "fixtures/order.json", task.cli_option],
        worktreePath,
        30_000,
      ).stdout.trimEnd();
      store.recordArtifact(activeRunId, activeHolderId, token, {
        artifact_id: `artifact-${configuration.evidence_prefix}-${task.task_id}-0001`,
        kind: "demo",
        location: `repository://fixture.invalid/ados-fixture-delivery@${candidateSha}#README.md`,
        artifact_digest: hashCanonical({
          machine: verifier.machine_output,
          owner_summary: verifier.owner_summary_output,
          owner_review: ownerReviewOutput,
          task_output: taskOutput,
        }),
      }, `${configuration.evidence_prefix}-artifact-recorded`);
    }

    store.recordExternalEffectIntent(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:evidence-comment`,
      effect_kind: "EVIDENCE_COMMENT",
      identity_key: evidenceIdentity,
      target_ref: pullRequest.url,
      candidate_sha: candidateSha,
      payload: { evidence_identity: evidenceIdentity, evidence_manifest_digest: evidenceManifestDigest },
    }, `${configuration.evidence_prefix}-evidence-comment-intent`);
    const evidencePublication = publishOrReuseEvidenceComment(
      worktreePath,
      pullRequest.number,
      candidateSha,
      evidenceManifestDigest,
      evidenceIdentity,
      task,
    );
    if (configuration.failure_checkpoint === "AFTER_EVIDENCE_ACK_LOST") {
      throw new Error("SLICE4_FORCED_INTERRUPTION:AFTER_EVIDENCE_ACK_LOST");
    }
    store.reconcileExternalEffect(activeRunId, activeHolderId, token, {
      outbox_id: `${activeRunId}:evidence-comment`,
      effect_kind: "EVIDENCE_COMMENT",
      identity_key: evidenceIdentity,
      result_ref: evidencePublication.url,
      readback_digest: evidencePublication.readback_digest,
    }, `${configuration.evidence_prefix}-evidence-comment-reconciled`);
    satisfyActive({
      verifier_receipt_id: `vr-publication-evidence-${configuration.evidence_prefix}-0001`,
      obligation_id: "publication-evidence",
      verifier_id: "verifier.forge-evidence",
      trust_level: "T3",
      result: "PASS",
      input_digest: hashCanonical({ candidate_sha: candidateSha, evidence_identity: evidenceIdentity }),
      result_digest: evidencePublication.readback_digest,
      evidence_ref: evidencePublication.url,
    }, `${configuration.evidence_prefix}-obligation-evidence`);
    transitionActive("PUBLISHING", "OWNER_REVIEW", `${configuration.evidence_prefix}-owner-review`);
    recordWorkspaceActive({
      repository_full_name: binding.repository_full_name,
      base_sha: binding.base_sha,
      branch_name: binding.branch_name,
      worktree_path_digest: binding.worktree_path_digest,
      candidate_sha: candidateSha,
      candidate_revision: 1,
      status: "PUBLISHED",
    }, `${configuration.evidence_prefix}-workspace-published`);
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    const summary = store.summary(activeRunId);
    const owner = summary.obligations.find((item) => item.category === "owner");
    if (owner?.status !== "PENDING" || summary.run.state !== "OWNER_REVIEW") {
      throw new Error("FIXTURE_OWNER_REVIEW_BOUNDARY_FAILED");
    }
    const result: TypedFixtureFulfillmentResult = {
      result: "CANDIDATE_READY_FOR_OWNER_REVIEW",
      run_id: activeRunId,
      request_digest: String(request.request_digest),
      objective_digest: objectiveDigest,
      envelope_digest: envelopeDigest,
      candidate_revision: 1,
      target_candidate_sha: candidateSha,
      target_branch: task.target_branch,
      target_pr_number: pullRequest.number,
      target_pr_url: pullRequest.url,
      evidence_identity: evidenceIdentity,
      evidence_comment_url: evidencePublication.url,
      evidence_manifest_digest: evidenceManifestDigest,
      worktree_path_digest: binding.worktree_path_digest,
      session_digest: hashCanonical({ thread_id: session.thread_id }),
      event_count: summary.event_count,
      event_chain_head: summary.chain_head,
      owner_obligation: "PENDING_T4",
      gate0a: configuration.gate0a,
      forced_interruption_checkpoint: configuration.force_interruption_after_session
        ? "AFTER_SESSION_PERSISTED"
        : configuration.failure_checkpoint ?? "NOT_REQUESTED",
      merged: false,
      released: false,
      deployed: false,
    };
    writeJson(resultPath, result);
    return result;
  } finally {
    store.close();
  }
}

export async function runSlice2Fulfillment(): Promise<Slice2FulfillmentResult> {
  const result = await fulfillTypedFixtureRun();
  const { forced_interruption_checkpoint: _checkpoint, ...accepted } = result;
  return accepted as Slice2FulfillmentResult;
}

export function runSlice2EvidenceCorrection(): Slice2EvidenceCorrectionResult {
  const root = slice2Root();
  const databasePath = join(root, "state.sqlite");
  const resultPath = join(root, "result.json");
  const manifestPath = join(root, "evidence-manifest.json");
  const correctionResultPath = join(root, "evidence-correction-result.json");
  for (const path of [databasePath, resultPath, manifestPath]) {
    if (!existsSync(path)) {
      throw new Error(`EVIDENCE_CORRECTION_INPUT_MISSING:${path.split(/[\\/]/).at(-1) ?? "unknown"}`);
    }
  }
  const existingResult = JSON.parse(readFileSync(resultPath, "utf8")) as Slice2FulfillmentResult;
  const priorCorrection = existsSync(correctionResultPath)
    ? JSON.parse(readFileSync(correctionResultPath, "utf8")) as Slice2EvidenceCorrectionResult
    : null;
  const worktreePath = join(root, "fixture-worktree");
  const evidenceIdentity = `ados-fixture-delivery:${runId}:1`;
  const expectedCommentUrl = `https://github.com/fixture.invalid/ados-fixture-delivery/pull/2#issuecomment-${evidenceCommentId}`;
  if (
    existingResult.run_id !== runId ||
    existingResult.candidate_revision !== 1 ||
    existingResult.target_candidate_sha !== "805c36359ae777b892e7e8ca1b2154fecbe0ad3e" ||
    existingResult.target_branch !== targetBranch ||
    existingResult.target_pr_number !== 2 ||
    existingResult.target_pr_url !== "https://github.com/fixture.invalid/ados-fixture-delivery/pull/2" ||
    existingResult.evidence_identity !== evidenceIdentity ||
    existingResult.evidence_comment_url !== expectedCommentUrl ||
    (
      existingResult.evidence_manifest_digest !== initialEvidenceManifestDigest &&
      existingResult.evidence_manifest_digest !== priorCorrection?.corrected_evidence_manifest_digest
    )
  ) {
    throw new Error("EVIDENCE_CORRECTION_FROZEN_IDENTITY_DRIFT");
  }

  const binding = ensureIsolatedWorktree(
    fixtureRepositoryPath(),
    worktreePath,
    fixtureBaseSha,
  );
  const verifier = runSlice2Verifier(
    worktreePath,
    fixtureBaseSha,
    existingResult.target_candidate_sha,
  );
  const pullRequest = readExistingFixtureDraftPr(worktreePath, existingResult.target_candidate_sha);
  if (pullRequest.number !== 2 || pullRequest.url !== existingResult.target_pr_url) {
    throw new Error("EVIDENCE_CORRECTION_PR_IDENTITY_DRIFT");
  }
  const objective = JSON.parse(readFileSync(join(root, "objective.json"), "utf8")) as Record<string, unknown>;
  const envelope = JSON.parse(readFileSync(join(root, "run-envelope.json"), "utf8")) as Record<string, unknown>;
  const manifest = withoutInternalEvidenceFields(buildEvidenceManifest(
    objective,
    envelope,
    verifier,
    existingResult.target_candidate_sha,
    pullRequest.number,
    pullRequest.url,
    worktreePath,
  ));
  const validator = new ContractValidator();
  const bindingValidation = validator.validateEvidenceBindings(manifest, objective, envelope);
  if (!bindingValidation.valid) {
    throw new Error(`EVIDENCE_CORRECTION_BINDING_INVALID:${bindingValidation.errors.join("|")}`);
  }
  const semanticErrors = validateEvidenceSemantics(manifest);
  if (semanticErrors.length !== 0) {
    throw new Error(`EVIDENCE_CORRECTION_SEMANTIC_INVALID:${renderEvidenceSemanticErrors(semanticErrors)}`);
  }
  const publication = manifest.publication as Record<string, unknown>;
  const candidateIdentity = `candidate-${existingResult.target_candidate_sha.slice(0, 20)}`;
  if (manifest.candidate_id !== candidateIdentity || publication.identity_key !== candidateIdentity) {
    throw new Error("EVIDENCE_CORRECTION_CANDIDATE_IDENTITY_DRIFT");
  }
  const correctedManifestDigest = hashCanonical(asJson(manifest));
  if (correctedManifestDigest === initialEvidenceManifestDigest) {
    throw new Error("EVIDENCE_CORRECTION_DIGEST_UNCHANGED");
  }
  if (
    priorCorrection !== null &&
    priorCorrection.corrected_evidence_manifest_digest !== correctedManifestDigest
  ) {
    throw new Error("EVIDENCE_CORRECTION_RETRY_DIGEST_DRIFT");
  }
  writeJson(manifestPath, manifest);

  const store = new EventStore(databasePath);
  try {
    const before = store.summary(runId);
    const owner = before.obligations.find((item) => item.category === "owner");
    const workspace = store.workspace(runId);
    const session = store.sessions(runId);
    const publications = store.publications(runId);
    const originalEvidence = publications.filter((item) => item.effect_kind === "EVIDENCE_COMMENT");
    const corrections = publications.filter((item) => item.effect_kind === "EVIDENCE_CORRECTION");
    const unexpectedPending = store.pendingExternalEffects(runId).filter(
      (item) => item.outbox_id !== `${runId}:evidence-correction:1`,
    );
    if (
      before.run.state !== "OWNER_REVIEW" ||
      owner?.status !== "PENDING" ||
      workspace?.candidate_sha !== existingResult.target_candidate_sha ||
      workspace.candidate_revision !== 1 ||
      workspace.worktree_path_digest !== binding.worktree_path_digest ||
      session.length !== 1 ||
      originalEvidence.length !== 1 ||
      originalEvidence[0]?.outbox_id !== `${runId}:evidence-comment` ||
      originalEvidence[0]?.identity_key !== evidenceIdentity ||
      originalEvidence[0]?.result_ref !== expectedCommentUrl ||
      corrections.length > 1 ||
      unexpectedPending.length !== 0
    ) {
      throw new Error("EVIDENCE_CORRECTION_RUNTIME_IDENTITY_DRIFT");
    }
    const token = store.getLease(runId).fencing_token;
    effectIntent(store, token, {
      outbox_id: `${runId}:evidence-correction:1`,
      effect_kind: "EVIDENCE_CORRECTION",
      identity_key: evidenceIdentity,
      target_ref: expectedCommentUrl,
      candidate_sha: existingResult.target_candidate_sha,
      payload: {
        comment_id: evidenceCommentId,
        prior_manifest_digest: initialEvidenceManifestDigest,
        corrected_manifest_digest: correctedManifestDigest,
      },
    }, "slice2-evidence-correction-intent");
    const comment = updateExistingEvidenceComment(
      worktreePath,
      pullRequest.number,
      evidenceCommentId,
      existingResult.target_candidate_sha,
      correctedManifestDigest,
      evidenceIdentity,
    );
    if (comment.disposition === "CREATED" || comment.url !== expectedCommentUrl) {
      throw new Error("EVIDENCE_CORRECTION_CREATED_NEW_COMMENT");
    }
    effectResult(store, token, {
      outbox_id: `${runId}:evidence-correction:1`,
      effect_kind: "EVIDENCE_CORRECTION",
      identity_key: evidenceIdentity,
      result_ref: comment.url,
      readback_digest: comment.readback_digest,
    }, "slice2-evidence-correction-effect-reconciled");
    store.reconcileEvidenceCorrection(runId, holderId, token, {
      evidence_outbox_id: `${runId}:evidence-comment`,
      correction_outbox_id: `${runId}:evidence-correction:1`,
      identity_key: evidenceIdentity,
      candidate_sha: existingResult.target_candidate_sha,
      comment_id: evidenceCommentId,
      comment_url: comment.url,
      prior_manifest_digest: initialEvidenceManifestDigest,
      corrected_manifest_digest: correctedManifestDigest,
      corrected_comment_readback_digest: comment.readback_digest,
    }, "slice2-evidence-correction-reconciled");
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    const summary = store.summary(runId);
    const pending = store.pendingExternalEffects(runId);
    if (
      summary.run.state !== "OWNER_REVIEW" ||
      summary.obligations.find((item) => item.category === "owner")?.status !== "PENDING" ||
      pending.length !== 0 ||
      store.sessions(runId).length !== 1 ||
      store.workspace(runId)?.candidate_revision !== 1
    ) {
      throw new Error("EVIDENCE_CORRECTION_OWNER_BOUNDARY_DRIFT");
    }
    const correctedResult: Slice2FulfillmentResult = {
      ...existingResult,
      evidence_manifest_digest: correctedManifestDigest,
      event_count: summary.event_count,
      event_chain_head: summary.chain_head,
    };
    writeJson(resultPath, correctedResult);
    const changes = manifest.changes as Array<Record<string, unknown>>;
    const accounting = manifest.change_accounting as Record<string, unknown>;
    const result: Slice2EvidenceCorrectionResult = {
      result: "EVIDENCE_CORRECTION_RECONCILED",
      run_id: runId,
      candidate_revision: 1,
      target_candidate_sha: existingResult.target_candidate_sha,
      target_pr_url: pullRequest.url,
      prior_evidence_manifest_digest: initialEvidenceManifestDigest,
      corrected_evidence_manifest_digest: correctedManifestDigest,
      evidence_identity: evidenceIdentity,
      evidence_comment_id: evidenceCommentId,
      evidence_comment_url: comment.url,
      comment_disposition: comment.disposition,
      staged_patch_bytes: changes.map((change) => ({
        path: String(change.path),
        bytes_changed: Number(change.bytes_changed),
      })),
      total_staged_patch_bytes: Number(accounting.total_changed_bytes),
      local_semantic_validation: "PASS",
      event_count: summary.event_count,
      event_chain_head: summary.chain_head,
      publication_count: summary.publication_count,
      pending_outbox: pending.length,
      owner_obligation: "PENDING_T4",
      gate0a: "BLOCKED_COMPILER_PATH",
    };
    writeJson(correctionResultPath, result);
    return result;
  } finally {
    store.close();
  }
}

export function runSlice2RecoveryDemo(): Slice2RecoveryResult {
  const root = resolve(".ados-local", "slice2-recovery");
  const resultPath = join(root, "result.json");
  if (existsSync(resultPath)) {
    return JSON.parse(readFileSync(resultPath, "utf8")) as Slice2RecoveryResult;
  }
  mkdirSync(root, { recursive: true });
  const result = runSlice2RecoveryMatrix(root, resolve(".ados-local", "evidence", "gate0b.json"));
  writeJson(resultPath, result);
  return result;
}
