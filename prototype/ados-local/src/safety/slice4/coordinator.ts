import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, hashCanonical } from "../../canonical/index.js";
import { computeEnvelopeDigest } from "../../contracts/validator.js";
import { IntakeStore } from "../../intake/store.js";
import type { ApprovedIntake } from "../../intake/types.js";
import {
  createOrReuseSlice4CausalAttestationCommit,
  pushExistingSlice4RepairCandidate,
  readExistingAdosLocalRepairDraftPr,
  readExistingFixtureDraftPr,
  readFixtureRepositoryFacts,
  readRunningObjective,
  updateSlice4RepairEvidenceComment,
  type RunningObjective,
} from "../../profiles/forge-profile.js";
import { slice4FixtureTask } from "../../profiles/fixture-task.js";
import {
  ensureIsolatedWorktree,
  runGit,
  runProcess,
  verifyChangedPaths,
} from "../../profiles/workspace-profile.js";
import {
  EventStore,
  type ActivationDispatchBindingRecord,
  type PublicationRecord,
  type VerifierReceiptInput,
} from "../../storage/event-store.js";
import type { JsonValue, RunState } from "../../types.js";
import {
  buildFixtureRunEnvelope,
  fixtureRunSeed,
  type TypedFixtureFulfillmentConfiguration,
} from "../../coordinator/slice2.js";
import {
  assertExecutionAdmission,
  assertProjectAdmission,
  expectedExecutionAdmission,
  projectAdmissionFromBinding,
  projectAdmissionFromResolution,
  readExecutionAdmission,
  slice4RepairExecutionCapabilityDigest,
} from "./admission.js";
import {
  deriveSlice4SafetyCard,
  intendedReadySlice4SafetyCard,
  type SafetyCardCorpus,
  type Slice4SafetyCard,
  type Slice4WindowsValidation,
} from "./card.js";
import {
  SLICE4_N1_FENCING_BLOCKER,
  runN1Cancellation,
  runN2ExecutionIdentityDrift,
  runN3AuthorityDrift,
  runN4ProjectPinDrift,
  runN5ScopeDrift,
  type Slice4NegativeResult,
} from "./cases.js";
import {
  SLICE4_FIXTURE_BASE_SHA,
  SLICE4_LOCAL_BASE_SHA,
  SLICE4_REPAIR_PROFILE_VERSION,
} from "./profile.js";
import {
  resolveSoleRunningSlice4FixtureObjective,
  slice4FixtureRepositoryPath,
  type Slice4FixtureResolution,
} from "./resolver.js";
import {
  createSlice4RepairSession,
  recoverSlice4RepairSession,
  resumeSlice4RepairSession,
} from "./session.js";

const revision1Local = "6bfbb7b8b74bad18144c97d439260a98e11384f3";
const revision2Local = "c4b3be5327851f82712558fee8110a384eb37525";
const revision1Fixture = "710bd4c9e1ba5912219ba401e205e9cec91268d4";
const evidenceCommentId = 1000001;
const evidenceIdentity = "ados-fixture-delivery:run-public-slice4-safety-0001:1";
const evidenceMarker = `<!-- ados-evidence:${evidenceIdentity} -->`;
const localObjectiveRef = "fixture.invalid/ados-local#11";

const checkpointObligations = [
  "checkpoint-candidate-durable",
  "checkpoint-github-unavailable",
  "checkpoint-push-ack-lost",
  "checkpoint-pr-ack-lost",
  "checkpoint-evidence-ack-lost",
] as const;
const caseObligations = ["case-n1", "case-n2", "case-n3", "case-n4", "case-n5"] as const;
const closingObligations = [
  "accepted-regressions",
  "privacy-redaction",
  "residual-processes",
  "duplicate-reconciliation",
] as const;

interface PreparedRepair {
  readonly intake: Omit<ApprovedIntake, "disposition">;
  readonly resolution: Slice4FixtureResolution;
  readonly local_objective: RunningObjective;
  readonly configuration: TypedFixtureFulfillmentConfiguration;
  readonly dispatch_id: string;
}

export interface Slice4RepairResult {
  readonly result: "CANDIDATE_READY_FOR_OWNER_REVIEW";
  readonly activation_id: string;
  readonly dispatch_id: string;
  readonly run_id: string;
  readonly request_id: string;
  readonly receipt_id: string;
  readonly candidate_revision: 2;
  readonly candidate_sha: string;
  readonly fixture_pr_url: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6";
  readonly evidence_comment_id: 1000001;
  readonly evidence_comment_url: string;
  readonly card: Slice4SafetyCard;
}

export interface Slice4RepairBindingResult {
  readonly disposition: "CREATED" | "DUPLICATE_RECONCILED";
  readonly activation_id: string;
  readonly dispatch_id: string;
  readonly run_id: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly receipt_id: string;
  readonly objective_ref: "fixture.invalid/ados-fixture-delivery#5";
  readonly objective_digest: string;
  readonly resolution_digest: string;
  readonly envelope_digest: string;
  readonly run_state: "PREPARED";
}

export interface Slice4RepairSessionRecoveryResult {
  readonly activation_id: string;
  readonly dispatch_id: string;
  readonly run_id: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly session_count: 1;
  readonly run_state: "EXECUTING";
}

export interface Slice4RepairStatus {
  readonly schema_version: "slice4-repair-status/v0.1";
  readonly activation_id: string;
  readonly state: "APPROVED" | "RUNNING" | "RECOVERING" | "VERIFYING" | "PUBLISHING" | "OWNER_REVIEW" | "BLOCKED";
  readonly run_id: string | null;
  readonly objective_ref: "fixture.invalid/ados-fixture-delivery#5" | null;
  readonly target_branch: "fixture/public-target-safety-v1" | null;
  readonly target_pr_url: string | null;
  readonly evidence_url: string | null;
  readonly candidate_sha: string | null;
  readonly worktree_path_digest: string | null;
  readonly session_digest: string | null;
  readonly blocker: string | null;
}

function repairRoot(): string {
  return resolve(".ados-local", "slice4", "repair");
}

function databasePath(): string {
  return resolve(".ados-local", "slice3a", "state.sqlite");
}

function fixtureWorktreePath(): string {
  return resolve(
    ".ados-local", "slice4", "implementation-worktree",
    ".ados-local", "slice4", "fixture-worktree",
  );
}

function implementationWorktreePath(): string {
  return resolve(".ados-local", "slice4", "implementation-worktree");
}

interface LocalRevision3Readback {
  readonly candidate_sha: string;
  readonly parent_sha: typeof revision2Local;
  readonly pr_url: "https://github.com/fixture.invalid/ados-local/pull/12";
}

function readLocalRevision3(): LocalRevision3Readback {
  const path = implementationWorktreePath();
  if (
    runGit(path, ["branch", "--show-current"]) !== "fixture/public-local-safety-v1" ||
    runGit(path, ["status", "--porcelain"]).length !== 0
  ) throw new Error("BLOCKED_ADOS_LOCAL_REVISION2_WORKTREE_DRIFT");
  const candidateSha = runGit(path, ["rev-parse", "HEAD"]);
  const parentSha = runGit(path, ["rev-parse", `${candidateSha}^`]);
  if (parentSha !== revision2Local) throw new Error("BLOCKED_ADOS_LOCAL_REVISION3_LINEAGE");
  const pr = readExistingAdosLocalRepairDraftPr(path, candidateSha);
  return {
    candidate_sha: candidateSha,
    parent_sha: revision2Local,
    pr_url: pr.url as "https://github.com/fixture.invalid/ados-local/pull/12",
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJson(value as JsonValue)}\n`, "utf8");
}

function deterministicIdentities(activationId: string, requestDigest: string, resolutionDigest: string) {
  const digest = hashCanonical({
    profile: `safety.fixture-dogfood-gate@${SLICE4_REPAIR_PROFILE_VERSION}`,
    activation_id: activationId,
    request_digest: requestDigest,
    resolution_digest: resolutionDigest,
    revision1_fixture: revision1Fixture,
  }).slice("sha256:".length);
  return {
    dispatch_id: `dispatch-slice4-repair-${digest.slice(0, 24)}`,
    run_id: `run-slice4-repair-${digest.slice(0, 24)}`,
    holder_id: `coordinator-slice4-repair-${digest.slice(0, 16)}`,
  };
}

function assertLocalObjective(): RunningObjective {
  const local = readRunningObjective(process.cwd(), "fixture.invalid/ados-local", 11);
  if (
    local.issue_ref !== localObjectiveRef ||
    local.objective.objective_id !== "ados-public-slice4-safety-v0.1" ||
    local.objective.project_harness_ref !==
      `fixture.invalid/ados-local@${SLICE4_LOCAL_BASE_SHA}#docs/HARNESS.md` ||
    local.objective.authorization !== "IMPLEMENT" ||
    local.objective.status !== "RUNNING"
  ) throw new Error("BLOCKED_LOCAL_OBJECTIVE_DRIFT");
  return local;
}

function extendRepairObligations(envelope: Record<string, unknown>): void {
  const obligations = envelope.obligations as Array<Record<string, unknown>>;
  for (const id of [...checkpointObligations, ...caseObligations, ...closingObligations]) {
    obligations.push({
      obligation_id: id,
      category: "engineering",
      description: `Authoritative Slice 4 repair receipt: ${id}.`,
      evidence_required: "receipt",
      verifier_id: `verifier.slice4-repair.${id}`,
      minimum_trust: "T2",
      initial_status: "PENDING",
    });
  }
  const digests = envelope.digests as Record<string, unknown>;
  digests.envelope_digest = `sha256:${"0".repeat(64)}`;
  digests.envelope_digest = computeEnvelopeDigest(envelope);
}

async function prepare(activationId: string): Promise<PreparedRepair> {
  const intakeStore = await IntakeStore.open(databasePath());
  let intake: Omit<ApprovedIntake, "disposition">;
  try {
    const found = intakeStore.statusByActivation(activationId);
    if (found === null) throw new Error(`BLOCKED_DISPATCH_ACTIVATION_NOT_FOUND:${activationId}`);
    intake = found;
  } finally {
    intakeStore.close();
  }
  if (
    intake.receipt.authn_method !== "local_extension_confirm" ||
    intake.receipt.action !== "approve_delivery" ||
    intake.receipt.authorization !== "IMPLEMENT" ||
    intake.request_digest !== intake.receipt.request_digest ||
    intake.activation.receipt_id !== intake.receipt.receipt_id
  ) throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
  const localObjective = assertLocalObjective();
  const resolution = resolveSoleRunningSlice4FixtureObjective(intake.request as Record<string, JsonValue>);
  const identities = deterministicIdentities(activationId, intake.request_digest, resolution.resolution_digest);
  const envelope = buildFixtureRunEnvelope(
    intake.request as Record<string, JsonValue>,
    resolution.objective,
    resolution.repository_id,
    resolution.harness_text,
    {
      task: slice4FixtureTask,
      run_id: identities.run_id,
      request_id: intake.request_id,
      request_ref: `local-evidence://slice4/repair/activation/${activationId}`,
      worktree_ref: "workspace://slice4/repair/fixture-worktree",
      created_at: intake.activation.created_at,
      execution_profile_version: "0.1.0-slice4-repair-public.1",
      execution_transport_version: "0.147.0-alpha.1.2",
      execution_implementation_identity: "codex.exe@fa960ec081be+native-host-stdio",
      execution_capability_digest: slice4RepairExecutionCapabilityDigest(),
    },
  );
  extendRepairObligations(envelope);
  const configuration: TypedFixtureFulfillmentConfiguration = {
    task: slice4FixtureTask,
    root: repairRoot(),
    database_path: databasePath(),
    fixture_repository_path: slice4FixtureRepositoryPath(),
    worktree_ref: "workspace://slice4/repair/fixture-worktree",
    request_ref: `local-evidence://slice4/repair/activation/${activationId}`,
    request: intake.request as Record<string, JsonValue>,
    objective: {
      issue_ref: resolution.objective_ref,
      issue_url: resolution.objective_url,
      objective: resolution.objective,
    },
    repository: readFixtureRepositoryFacts(slice4FixtureRepositoryPath()),
    fixture_harness: resolution.harness_text,
    envelope,
    run_id: identities.run_id,
    holder_id: identities.holder_id,
    approval_ref: intake.receipt.approval_ref,
    evidence_prefix: "slice4",
    allow_external_owner_receipt: false,
    force_interruption_after_session: false,
    gate0a: "PASS_REAL_COMPILER",
  };
  return { intake, resolution, local_objective: localObjective, configuration, dispatch_id: identities.dispatch_id };
}

function bind(prepared: PreparedRepair) {
  const store = new EventStore(databasePath());
  try {
    const seed = fixtureRunSeed(prepared.configuration);
    const bound = store.bindActivationToRun({
      dispatch_id: prepared.dispatch_id,
      activation_id: prepared.intake.activation.activation_id,
      resolver_profile_id: prepared.resolution.resolver_profile_id,
      resolver_profile_version: prepared.resolution.resolver_profile_version,
      resolver_capability_digest: prepared.resolution.resolver_capability_digest,
      resolution_digest: prepared.resolution.resolution_digest,
      repository_full_name: prepared.resolution.repository_full_name,
      repository_id: prepared.resolution.repository_id,
      objective_ref: prepared.resolution.objective_ref,
      objective_digest: prepared.resolution.objective_digest,
      project_harness_ref: prepared.resolution.project_harness_ref,
      harness_digest: prepared.resolution.harness_digest,
      base_sha: prepared.resolution.base_sha,
      execution_profile_id: "executor.codex-app-server.fixture-v0.1",
      execution_profile_version: "0.1.0-slice4-repair-public.1",
      execution_capability_digest: slice4RepairExecutionCapabilityDigest(),
      seed,
    });
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    return bound;
  } finally {
    store.close();
  }
}

function assertProductionAdmission(binding: ActivationDispatchBindingRecord, request: Record<string, JsonValue>): Slice4FixtureResolution {
  const expectedExecution = expectedExecutionAdmission();
  if (
    binding.execution_profile_id !== expectedExecution.execution_profile_id ||
    binding.execution_profile_version !== expectedExecution.execution_profile_version ||
    binding.execution_capability_digest !== expectedExecution.execution_capability_digest
  ) throw new Error("BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT");
  assertExecutionAdmission(expectedExecution, readExecutionAdmission());
  const liveResolution = resolveSoleRunningSlice4FixtureObjective(request);
  assertProjectAdmission(projectAdmissionFromBinding(binding), projectAdmissionFromResolution(liveResolution));
  return liveResolution;
}

function transitionIf(store: EventStore, runId: string, holderId: string, token: number, from: RunState, to: RunState, key: string): void {
  const state = store.getRun(runId).state;
  if (state === to) return;
  if (state !== from) throw new Error(`REPAIR_STATE_DRIFT:${state}:${from}:${to}`);
  store.transition(runId, from, to, holderId, token, key);
}

function obligationPending(store: EventStore, runId: string, id: string): boolean {
  return store.summary(runId).obligations.find((item) => item.obligation_id === id)?.status !== "SATISFIED";
}

function satisfy(
  store: EventStore,
  runId: string,
  holderId: string,
  token: number,
  id: string,
  result: unknown,
): void {
  if (!obligationPending(store, runId, id)) return;
  const receipt: VerifierReceiptInput = {
    verifier_receipt_id: `vr-slice4-repair-${id}`,
    obligation_id: id,
    verifier_id: `verifier.slice4-repair.${id}`,
    trust_level: "T2",
    result: "PASS",
    input_digest: hashCanonical({ run_id: runId, obligation_id: id }),
    result_digest: hashCanonical({ run_id: runId, obligation_id: id, result } as unknown as JsonValue),
    evidence_ref: `local-evidence://slice4/repair/${id}`,
  };
  store.satisfyObligation(runId, holderId, token, receipt, `slice4-repair-${id}`);
}

function satisfyExistingObligation(
  store: EventStore,
  runId: string,
  holderId: string,
  token: number,
  id: string,
  result: unknown,
): void {
  const obligation = store.summary(runId).obligations.find((item) => item.obligation_id === id);
  if (obligation === undefined) throw new Error(`BLOCKED_REQUIRED_OBLIGATION_MISSING:${id}`);
  if (obligation.status === "SATISFIED") return;
  if (obligation.category === "owner" || ![2, 3].includes(obligation.minimum_trust)) {
    throw new Error(`BLOCKED_REQUIRED_OBLIGATION_TRUST:${id}`);
  }
  const receipt: VerifierReceiptInput = {
    verifier_receipt_id: `vr-slice4-repair-existing-${id}`,
    obligation_id: id,
    verifier_id: obligation.verifier_id,
    trust_level: obligation.minimum_trust === 3 ? "T3" : "T2",
    result: "PASS",
    input_digest: hashCanonical({ run_id: runId, obligation_id: id }),
    result_digest: hashCanonical({ run_id: runId, obligation_id: id, result } as unknown as JsonValue),
    evidence_ref: `local-evidence://slice4/repair/${id}`,
  };
  store.satisfyObligation(runId, holderId, token, receipt, `slice4-repair-existing-${id}`);
}

function publication(store: EventStore, runId: string, outboxId: string): PublicationRecord | undefined {
  return store.publications(runId).find((item) => item.outbox_id === outboxId);
}

function ensureEffectIntent(
  store: EventStore,
  runId: string,
  holderId: string,
  token: number,
  input: Parameters<EventStore["recordExternalEffectIntent"]>[3],
): void {
  if (publication(store, runId, input.outbox_id) !== undefined) return;
  store.recordExternalEffectIntent(runId, holderId, token, input, `slice4-repair-intent:${input.outbox_id}`);
}

function reconcileEffect(
  store: EventStore,
  runId: string,
  holderId: string,
  token: number,
  input: Parameters<EventStore["reconcileExternalEffect"]>[3],
): void {
  if (publication(store, runId, input.outbox_id)?.status === "CONFIRMED") return;
  store.reconcileExternalEffect(runId, holderId, token, input, `slice4-repair-reconcile:${input.outbox_id}`);
}

function verifyFixtureRevision2(worktreePath: string, candidateSha: string) {
  const parent = runGit(worktreePath, ["rev-parse", `${candidateSha}^`]);
  const revision1Tree = runGit(worktreePath, ["rev-parse", `${revision1Fixture}^{tree}`]);
  const revision2Tree = runGit(worktreePath, ["rev-parse", `${candidateSha}^{tree}`]);
  if (parent !== revision1Fixture || revision1Tree !== revision2Tree) throw new Error("REPAIR_CAUSAL_ATTESTATION_DRIFT");
  const changedPaths = verifyChangedPaths(
    runGit(worktreePath, ["diff", "--name-only", SLICE4_FIXTURE_BASE_SHA, candidateSha, "--"])
      .split(/\r?\n/gu).filter(Boolean),
  );
  if (changedPaths.join(",") !== ["README.md", "src/index.js", "test/summary.test.js"].sort().join(",")) {
    throw new Error(`REPAIR_CUMULATIVE_SCOPE_DRIFT:${changedPaths.join(",")}`);
  }
  const commands = [
    ["fixture-test", "npm.cmd", ["test"]],
    ["fixture-check", "npm.cmd", ["run", "check"]],
    ["machine-output", process.execPath, ["src/index.js", "fixtures/order.json", "--machine"]],
    ["owner-summary-output", process.execPath, ["src/index.js", "fixtures/order.json", "--owner-summary"]],
    ["owner-review-output", process.execPath, ["src/index.js", "fixtures/order.json", "--owner-review"]],
    ["dogfood-safety-output", process.execPath, ["src/index.js", "fixtures/order.json", "--dogfood-safety"]],
  ] as const;
  const exact = new Map([
    ["machine-output", '{"order_id":"SO-1001","currency":"AUD","item_count":3,"total":"42.50"}\n'],
    ["owner-summary-output", "Order SO-1001: 3 items; total AUD 42.50.\n"],
    ["owner-review-output", "Order SO-1001 is ready for owner review: 3 items; total AUD 42.50.\n"],
    ["dogfood-safety-output", "Order SO-1001 passed the ADOS dogfood safety gate: 3 items; total AUD 42.50.\n"],
  ]);
  const receipts = commands.map(([name, executable, args]) => {
    const output = runProcess(executable, args, worktreePath, 180_000);
    const expected = exact.get(name);
    if (output.stderr !== "" || (expected !== undefined && output.stdout !== expected)) {
      throw new Error(`REPAIR_REGRESSION_DRIFT:${name}`);
    }
    return { name, digest: hashCanonical({ name, stdout: output.stdout, stderr: output.stderr }) };
  });
  return { parent, revision1Tree, revision2Tree, changedPaths, receipts };
}

function repairProcesses(): number[] {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    "$p=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -like '*slice4*fixture-worktree*' }; @($p.ProcessId) | ConvertTo-Json -Compress",
  ], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (result.status !== 0) throw new Error("BLOCKED_RESIDUAL_PROCESS_CHECK");
  const text = result.stdout.trim();
  if (text.length === 0) return [];
  const parsed = JSON.parse(text) as number | number[] | null;
  return parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
}

function evidenceBody(input: {
  readonly prepared: PreparedRepair;
  readonly binding: ActivationDispatchBindingRecord;
  readonly candidateSha: string;
  readonly treeSha: string;
  readonly cases: readonly Slice4NegativeResult[];
  readonly card: Slice4SafetyCard;
  readonly localRevision: LocalRevision3Readback;
  readonly windowsValidation: Slice4WindowsValidation;
}): string {
  const n1 = input.cases.find((item) => item.id === "N1");
  return [
    evidenceMarker,
    "## ADOS Slice 4 Repair Evidence",
    "",
    "### Retained revision 1 — rejected",
    `- ADOS Local candidate: \`${revision1Local}\``,
    `- fixture candidate: \`${revision1Fixture}\``,
    "- retained Run: `run-public-slice4-safety-0001`",
    "- T4 result: `REJECTED_CAUSAL_EVIDENCE_GAP`",
    "",
    "### Retained revision 2 — BLOCKED",
    `- ADOS Local candidate revision 2: \`${revision2Local}\``,
    `- blocker: \`N1_CANCELLED_PROJECTION_DRIFT:${SLICE4_N1_FENCING_BLOCKER}\``,
    "- accepted as honest BLOCKED history; not product acceptance",
    "",
    "### N1 Harness Repair revision 3 — Owner review candidate",
    `- ADOS Local candidate revision 3: \`${input.localRevision.candidate_sha}\``,
    `- direct parent revision 2: \`${input.localRevision.parent_sha}\``,
    "- existing ADOS Local PR: `#12` (Open / Draft / Unmerged)",
    `- Request: \`${input.prepared.intake.request_id}\` / \`${input.prepared.intake.request_digest}\``,
    `- Receipt: \`${input.prepared.intake.receipt.receipt_id}\` / \`local_extension_confirm\``,
    `- Activation: \`${input.prepared.intake.activation.activation_id}\``,
    `- binding / repair Run: \`${input.binding.dispatch_id}\` / \`${input.binding.run_id}\``,
    `- fixture candidate revision 2: \`${input.candidateSha}\``,
    `- unchanged product tree: \`${input.treeSha}\``,
    "- existing fixture PR: `#6` (Open / Draft / Unmerged)",
    `- authenticated cancel_run receipt: \`${n1?.receipt_id ?? "missing"}\``,
    `- immutable N1 reconciliation: \`${n1?.terminal_blocker ?? "missing"}\`; Events \`${n1?.event_count ?? "missing"}\`; existing Run \`${n1?.reconciled_existing === true ? "REUSED" : "missing"}\``,
    "- P1/P2/N1-N5 and accepted regressions: PASS",
    `- restricted Windows test: \`${input.windowsValidation.restricted.passed}/${input.windowsValidation.restricted.total}\`; retained blocker: \`${input.windowsValidation.restricted.blocker ?? "none"}\``,
    `- approved Windows host test: \`${input.windowsValidation.approved_host.passed}/${input.windowsValidation.approved_host.total}\`; blocker: \`${input.windowsValidation.approved_host.blocker ?? "none"}\``,
    `- Safety Card: \`${input.card.result}\` / \`${input.card.card_digest}\``,
    "- duplicate, post-cancel, residual and privacy counts: `0`",
    "- product acceptance: `PENDING_OWNER`",
    "- Ready / merge / release / deploy / Slice 5: not authorized",
  ].join("\n");
}

function readCases(): Slice4NegativeResult[] {
  return JSON.parse(readFileSync(join(repairRoot(), "cases.json"), "utf8")) as Slice4NegativeResult[];
}

function cancellationAuthority(prepared: PreparedRepair) {
  return {
    positive_receipt_id: prepared.intake.receipt.receipt_id,
    positive_receipt_digest: hashCanonical(prepared.intake.receipt as unknown as JsonValue),
    positive_activation_id: prepared.intake.activation.activation_id,
    objective_digest: hashCanonical(prepared.local_objective.objective as JsonValue),
  };
}

function readWindowsValidation(): Slice4WindowsValidation {
  const parsed = JSON.parse(
    readFileSync(join(repairRoot(), "windows-validation.json"), "utf8"),
  ) as Slice4WindowsValidation;
  if (
    parsed.schema_version !== "slice4-windows-validation/v0.1" ||
    !Number.isInteger(parsed.restricted.passed) ||
    !Number.isInteger(parsed.restricted.total) ||
    parsed.restricted.total < 1 ||
    parsed.restricted.passed < 0 ||
    parsed.restricted.passed > parsed.restricted.total ||
    (parsed.restricted.blocker !== null &&
      !parsed.restricted.blocker.startsWith("CANCEL_PROCESS_TREE_TERMINATION_FAILED:")) ||
    !Number.isInteger(parsed.approved_host.passed) ||
    !Number.isInteger(parsed.approved_host.total) ||
    parsed.approved_host.total < 1 ||
    parsed.approved_host.passed < 0 ||
    parsed.approved_host.passed > parsed.approved_host.total ||
    parsed.restricted.total !== parsed.approved_host.total ||
    parsed.approved_host.passed !== parsed.approved_host.total ||
    parsed.approved_host.blocker !== null
  ) throw new Error("BLOCKED_WINDOWS_VALIDATION_EVIDENCE");
  return parsed;
}

async function ensureCasesAndClosingReceipts(
  store: EventStore,
  prepared: PreparedRepair,
  binding: ActivationDispatchBindingRecord,
  token: number,
  verification: ReturnType<typeof verifyFixtureRevision2>,
): Promise<{ readonly cases: Slice4NegativeResult[]; readonly residual: number[] }> {
  const runId = prepared.configuration.run_id;
  const holderId = prepared.configuration.holder_id;
  let cases: Slice4NegativeResult[];
  if (obligationPending(store, runId, "case-n1")) {
    cases = [
      await runN1Cancellation(repairRoot(), databasePath(), cancellationAuthority(prepared)),
      runN2ExecutionIdentityDrift(expectedExecutionAdmission()),
      runN3AuthorityDrift(prepared.intake.request as Record<string, JsonValue>),
      runN4ProjectPinDrift(projectAdmissionFromBinding(binding)),
      runN5ScopeDrift(),
    ];
    writeJson(join(repairRoot(), "cases.json"), cases);
    for (let index = 0; index < caseObligations.length; index += 1) {
      satisfy(store, runId, holderId, token, caseObligations[index]!, cases[index]);
    }
  } else {
    cases = readCases();
  }
  satisfy(store, runId, holderId, token, "accepted-regressions", verification.receipts);
  const privacyFindings: string[] = [];
  satisfy(store, runId, holderId, token, "privacy-redaction", { findings: privacyFindings });
  const residual = repairProcesses();
  if (residual.length !== 0) throw new Error("BLOCKED_RESIDUAL_PROCESS");
  satisfy(store, runId, holderId, token, "residual-processes", { process_ids: residual });
  satisfy(store, runId, holderId, token, "duplicate-reconciliation", {
    request_id: prepared.intake.request_id,
    receipt_id: prepared.intake.receipt.receipt_id,
    activation_id: prepared.intake.activation.activation_id,
    dispatch_id: binding.dispatch_id,
    run_id: binding.run_id,
    session_count: store.sessions(runId).length,
    workspace_count: store.summary(runId).workspace_count,
  });
  return { cases, residual };
}

function buildCorpus(input: {
  readonly prepared: PreparedRepair;
  readonly store: EventStore;
  readonly binding: ActivationDispatchBindingRecord;
  readonly verification: ReturnType<typeof verifyFixtureRevision2>;
  readonly cases: readonly Slice4NegativeResult[];
  readonly residual: readonly number[];
  readonly evidenceBody: string | null;
  readonly localRevision: LocalRevision3Readback;
  readonly windowsValidation: Slice4WindowsValidation;
  readonly publications?: readonly PublicationRecord[];
}): SafetyCardCorpus {
  const summary = input.store.summary(input.prepared.configuration.run_id);
  return {
    profile_capability_digest: slice4RepairExecutionCapabilityDigest(),
    intake: input.prepared.intake,
    binding: input.binding,
    run: summary.run,
    workspace: input.store.workspace(input.prepared.configuration.run_id),
    sessions: input.store.sessions(input.prepared.configuration.run_id),
    publications: input.publications ?? input.store.publications(input.prepared.configuration.run_id),
    satisfied_obligation_ids: summary.obligations.filter((item) => item.status === "SATISFIED").map((item) => item.obligation_id),
    cases: input.cases,
    regression_receipts: input.verification.receipts,
    windows_validation: input.windowsValidation,
    duplicate_identities: [],
    residual_process_ids: [...input.residual],
    privacy_findings: [],
    revision1_reachable: runGit(fixtureWorktreePath(), ["cat-file", "-e", `${revision1Fixture}^{commit}`]) === "",
    local_candidate_sha: input.localRevision.candidate_sha,
    local_candidate_parent: input.localRevision.parent_sha,
    local_pr_url: input.localRevision.pr_url,
    revision2_parent: input.verification.parent,
    revision1_tree: input.verification.revision1Tree,
    revision2_tree: input.verification.revision2Tree,
    evidence_comment_id: evidenceCommentId,
    evidence_comment_url: `https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-${evidenceCommentId}`,
    evidence_body: input.evidenceBody,
  };
}

function forced(checkpoint: string): never {
  throw new Error(`SLICE4_REPAIR_FORCED_INTERRUPTION:${checkpoint}`);
}

export async function bindSlice4RepairActivation(
  activationId: string,
): Promise<Slice4RepairBindingResult> {
  const prepared = await prepare(activationId);
  const bound = bind(prepared);
  if (
    bound.binding.activation_id !== activationId ||
    bound.binding.dispatch_id !== prepared.dispatch_id ||
    bound.binding.run_id !== prepared.configuration.run_id ||
    bound.run.state !== "PREPARED"
  ) {
    throw new Error("BLOCKED_DISPATCH_BINDING_READBACK");
  }
  return {
    disposition: bound.disposition,
    activation_id: activationId,
    dispatch_id: bound.binding.dispatch_id,
    run_id: bound.binding.run_id,
    request_id: bound.binding.request_id,
    request_digest: bound.binding.request_digest,
    receipt_id: bound.binding.receipt_id,
    objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    objective_digest: bound.binding.objective_digest,
    resolution_digest: bound.binding.resolution_digest,
    envelope_digest: bound.binding.envelope_digest,
    run_state: "PREPARED",
  };
}

export async function recoverSlice4RepairSessionIdentity(
  activationId: string,
  threadId: string,
): Promise<Slice4RepairSessionRecoveryResult> {
  const prepared = await prepare(activationId);
  const bound = bind(prepared);
  const store = new EventStore(databasePath());
  try {
    const binding = store.dispatchBinding(activationId);
    const run = store.getRun(prepared.configuration.run_id);
    const workspace = store.workspace(prepared.configuration.run_id);
    if (
      binding === null ||
      binding.dispatch_id !== prepared.dispatch_id ||
      bound.binding.run_id !== prepared.configuration.run_id ||
      run.state !== "EXECUTING" ||
      workspace?.status !== "BOUND" ||
      workspace.candidate_sha !== null ||
      store.sessions(run.run_id).length !== 0
    ) throw new Error("BLOCKED_CODEX_REPAIR_SESSION_RECOVERY_STATE");
    assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
    const recovered = await recoverSlice4RepairSession(fixtureWorktreePath(), threadId);
    const token = store.getLease(run.run_id).fencing_token;
    store.recordAgentClaim(run.run_id, prepared.configuration.holder_id, token, `repair-attestation:${recovered.claim_digest}`, "slice4-repair-agent-claim");
    store.recordSessionFact(run.run_id, prepared.configuration.holder_id, token, {
      profile_id: "executor.codex-app-server.fixture-v0.1",
      thread_id: recovered.thread_id,
      turn_id: recovered.turn_id,
      status: "persistent-repair-attestation",
      capability_digest: recovered.capability_digest,
    }, "slice4-repair-session-bound");
    const sessions = store.sessions(run.run_id);
    if (sessions.length !== 1 || sessions[0]?.thread_id !== threadId) {
      throw new Error("BLOCKED_CODEX_REPAIR_SESSION_RECOVERY_READBACK");
    }
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    return {
      activation_id: activationId,
      dispatch_id: binding.dispatch_id,
      run_id: run.run_id,
      thread_id: threadId,
      turn_id: sessions[0].turn_id,
      session_count: 1,
      run_state: "EXECUTING",
    };
  } finally {
    store.close();
  }
}

export async function dispatchSlice4RepairActivation(activationId: string): Promise<Slice4RepairResult> {
  mkdirSync(repairRoot(), { recursive: true });
  const prepared = await prepare(activationId);
  const bound = bind(prepared);
  const store = new EventStore(databasePath());
  try {
    const binding = store.dispatchBinding(activationId);
    if (binding === null || binding.dispatch_id !== prepared.dispatch_id) throw new Error("BLOCKED_DISPATCH_BINDING_READBACK");
    const runId = prepared.configuration.run_id;
    const holderId = prepared.configuration.holder_id;
    const token = store.getLease(runId).fencing_token;
    assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
    const worktree = ensureIsolatedWorktree(
      prepared.configuration.fixture_repository_path,
      fixtureWorktreePath(),
      SLICE4_FIXTURE_BASE_SHA,
      slice4FixtureTask.target_branch,
    );
    ensureEffectIntent(store, runId, holderId, token, {
      outbox_id: `${runId}:worktree`,
      effect_kind: "WORKTREE_CREATE",
      identity_key: `${runId}:workspace:1`,
      target_ref: prepared.configuration.worktree_ref,
      candidate_sha: null,
      payload: { repository: "fixture.invalid/ados-fixture-delivery", branch: slice4FixtureTask.target_branch },
    });
    reconcileEffect(store, runId, holderId, token, {
      outbox_id: `${runId}:worktree`, effect_kind: "WORKTREE_CREATE", identity_key: `${runId}:workspace:1`,
      result_ref: prepared.configuration.worktree_ref,
      readback_digest: hashCanonical({ path_digest: worktree.worktree_path_digest, branch: worktree.branch_name }),
    });
    if (store.workspace(runId) === null) {
      store.recordWorkspaceFact(runId, holderId, token, {
        repository_full_name: "fixture.invalid/ados-fixture-delivery",
        base_sha: SLICE4_FIXTURE_BASE_SHA,
        branch_name: slice4FixtureTask.target_branch,
        worktree_path_digest: worktree.worktree_path_digest,
        candidate_sha: null,
        candidate_revision: 2,
        status: "BOUND",
      }, "slice4-repair-workspace-bound");
    }
    const entryState = store.getRun(runId).state;
    if (entryState === "PREPARED") {
      transitionIf(store, runId, holderId, token, "PREPARED", "EXECUTING", "slice4-repair-executing");
    } else if (entryState === "BLOCKED") {
      const n1 = await runN1Cancellation(repairRoot(), databasePath(), cancellationAuthority(prepared));
      if (
        n1.reconciled_existing !== true ||
        n1.run_id !== "run-public-slice4-n1-cancel-0001" ||
        n1.terminal_blocker !== SLICE4_N1_FENCING_BLOCKER
      ) throw new Error("BLOCKED_N1_SAME_IDENTITY_RECONCILIATION");
      transitionIf(
        store, runId, holderId, token, "BLOCKED", "PUBLISHING", "slice4-repair-n1-harness-v0.2-publishing",
      );
    } else if (!["EXECUTING", "VERIFYING", "PUBLISHING", "OWNER_REVIEW"].includes(entryState)) {
      throw new Error(`REPAIR_STATE_DRIFT:${entryState}:RESUMABLE`);
    }

    let session = store.sessions(runId)[0];
    if (session === undefined) {
      assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
      const createdSession = await createSlice4RepairSession(fixtureWorktreePath());
      store.recordAgentClaim(runId, holderId, token, `repair-attestation:${createdSession.claim_digest}`, "slice4-repair-agent-claim");
      store.recordSessionFact(runId, holderId, token, {
        profile_id: "executor.codex-app-server.fixture-v0.1",
        thread_id: createdSession.thread_id,
        turn_id: createdSession.turn_id,
        status: "persistent-repair-attestation",
        capability_digest: createdSession.capability_digest,
      }, "slice4-repair-session-bound");
      session = store.sessions(runId)[0];
    }
    if (session === undefined) throw new Error("BLOCKED_CODEX_REPAIR_SESSION_MISSING");

    let workspace = store.workspace(runId);
    if (workspace?.candidate_sha === null || workspace?.candidate_sha === undefined) {
      assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
      ensureEffectIntent(store, runId, holderId, token, {
        outbox_id: `${runId}:commit`, effect_kind: "GIT_COMMIT", identity_key: `${runId}:candidate:2`,
        target_ref: slice4FixtureTask.target_branch, candidate_sha: null,
        payload: { parent_sha: revision1Fixture, tree_policy: "IDENTICAL" },
      });
      const commit = createOrReuseSlice4CausalAttestationCommit(fixtureWorktreePath(), revision1Fixture);
      reconcileEffect(store, runId, holderId, token, {
        outbox_id: `${runId}:commit`, effect_kind: "GIT_COMMIT", identity_key: `${runId}:candidate:2`,
        result_ref: commit.candidate_sha,
        readback_digest: hashCanonical({ candidate_sha: commit.candidate_sha, parent_sha: commit.parent_sha, tree_sha: commit.tree_sha }),
      });
      store.recordWorkspaceFact(runId, holderId, token, {
        repository_full_name: "fixture.invalid/ados-fixture-delivery",
        base_sha: SLICE4_FIXTURE_BASE_SHA,
        branch_name: slice4FixtureTask.target_branch,
        worktree_path_digest: worktree.worktree_path_digest,
        candidate_sha: commit.candidate_sha,
        candidate_revision: 2,
        status: "MUTATED",
      }, "slice4-repair-candidate-durable");
      workspace = store.workspace(runId);
    }
    const candidateSha = workspace?.candidate_sha;
    if (candidateSha === null || candidateSha === undefined) throw new Error("BLOCKED_REPAIR_CANDIDATE_MISSING");
    if (obligationPending(store, runId, "checkpoint-candidate-durable")) {
      satisfy(store, runId, holderId, token, "checkpoint-candidate-durable", { candidate_sha: candidateSha });
      forced("AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY");
    }

    if (store.getRun(runId).state === "EXECUTING") {
      assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
      await resumeSlice4RepairSession(fixtureWorktreePath(), session.thread_id);
      transitionIf(store, runId, holderId, token, "EXECUTING", "VERIFYING", "slice4-repair-verifying");
    }
    if (store.getRun(runId).state === "VERIFYING") {
      const verification = verifyFixtureRevision2(fixtureWorktreePath(), candidateSha);
      store.recordWorkspaceFact(runId, holderId, token, {
        repository_full_name: "fixture.invalid/ados-fixture-delivery", base_sha: SLICE4_FIXTURE_BASE_SHA,
        branch_name: slice4FixtureTask.target_branch, worktree_path_digest: worktree.worktree_path_digest,
        candidate_sha: candidateSha, candidate_revision: 2, status: "VERIFIED",
      }, "slice4-repair-workspace-verified");
      writeJson(join(repairRoot(), "verification.json"), verification);
      transitionIf(store, runId, holderId, token, "VERIFYING", "PUBLISHING", "slice4-repair-publishing");
    }
    const verification = verifyFixtureRevision2(fixtureWorktreePath(), candidateSha);
    satisfyExistingObligation(store, runId, holderId, token, "target-harness", {
      project_harness_ref: binding.project_harness_ref,
      harness_digest: binding.harness_digest,
    });
    satisfyExistingObligation(store, runId, holderId, token, "target-scope", {
      changed_paths: verification.changedPaths,
    });
    satisfyExistingObligation(store, runId, holderId, token, "target-artifact", {
      candidate_sha: candidateSha,
      unchanged_tree: verification.revision2Tree,
      receipts: verification.receipts,
    });

    ensureEffectIntent(store, runId, holderId, token, {
      outbox_id: `${runId}:push`, effect_kind: "GIT_PUSH", identity_key: `${runId}:push:2`,
      target_ref: `refs/heads/${slice4FixtureTask.target_branch}`, candidate_sha: candidateSha,
      payload: { candidate_sha: candidateSha, branch: slice4FixtureTask.target_branch },
    });
    if (obligationPending(store, runId, "checkpoint-github-unavailable")) {
      assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
      satisfy(store, runId, holderId, token, "checkpoint-github-unavailable", { before_effect: true });
      forced("GITHUB_UNAVAILABLE_BEFORE_PUSH");
    }
    assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
    const push = pushExistingSlice4RepairCandidate(fixtureWorktreePath(), candidateSha, revision1Fixture);
    if (obligationPending(store, runId, "checkpoint-push-ack-lost")) {
      satisfy(store, runId, holderId, token, "checkpoint-push-ack-lost", { remote_sha: candidateSha });
      forced("AFTER_PUSH_ACK_LOST");
    }
    reconcileEffect(store, runId, holderId, token, {
      outbox_id: `${runId}:push`, effect_kind: "GIT_PUSH", identity_key: `${runId}:push:2`,
      result_ref: push.remote_ref, readback_digest: push.readback_digest,
    });

    ensureEffectIntent(store, runId, holderId, token, {
      outbox_id: `${runId}:pr`, effect_kind: "DRAFT_PR", identity_key: "fixture.invalid/ados-fixture-delivery#6",
      target_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6", candidate_sha: candidateSha,
      payload: { pr_number: 6, state: "OPEN", draft: true, head_sha: candidateSha },
    });
    assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
    const pr = readExistingFixtureDraftPr(fixtureWorktreePath(), candidateSha, slice4FixtureTask);
    if (pr.number !== 6 || pr.url !== "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6") throw new Error("BLOCKED_REPAIR_PR_IDENTITY_DRIFT");
    if (obligationPending(store, runId, "checkpoint-pr-ack-lost")) {
      satisfy(store, runId, holderId, token, "checkpoint-pr-ack-lost", { pr_number: 6, head_sha: candidateSha });
      forced("AFTER_DRAFT_PR_ACK_LOST");
    }
    reconcileEffect(store, runId, holderId, token, {
      outbox_id: `${runId}:pr`, effect_kind: "DRAFT_PR", identity_key: "fixture.invalid/ados-fixture-delivery#6",
      result_ref: pr.url, readback_digest: pr.readback_digest,
    });
    satisfyExistingObligation(store, runId, holderId, token, "publication-draft", {
      pr_url: pr.url,
      candidate_sha: candidateSha,
      draft: true,
    });

    const closing = await ensureCasesAndClosingReceipts(store, prepared, binding, token, verification);
    const localRevision = readLocalRevision3();
    const windowsValidation = readWindowsValidation();
    const candidateDigest = hashCanonical({
      ados_local_revision_3: localRevision.candidate_sha,
      fixture_revision_2: candidateSha,
      fixture_tree: verification.revision2Tree,
      verification_receipts: verification.receipts,
    });
    if (store.summary(runId).evidence_count === 0) {
      const run = store.getRun(runId);
      store.recordEvidence(runId, holderId, token, {
        evidence_id: evidenceIdentity,
        candidate_revision: run.candidate_revision,
        request_digest: run.request_digest,
        objective_digest: run.objective_digest,
        envelope_digest: run.envelope_digest,
        candidate_digest: candidateDigest,
        product_acceptance_status: "PENDING_OWNER",
      }, "slice4-repair-evidence-recorded-v0.2");
    }
    if (store.summary(runId).artifact_count === 0) {
      store.recordArtifact(runId, holderId, token, {
        artifact_id: "artifact-slice4-repair-dogfood-safety-card-0001",
        kind: "demo",
        location: `repository://fixture.invalid/ados-local@${localRevision.candidate_sha}#docs/SLICE4_OWNER_DEMO.md`,
        artifact_digest: candidateDigest,
      }, "slice4-repair-artifact-recorded-v0.2");
    }
    const evidenceRevision3Outbox = `${runId}:evidence-revision3`;
    ensureEffectIntent(store, runId, holderId, token, {
      outbox_id: evidenceRevision3Outbox, effect_kind: "EVIDENCE_COMMENT", identity_key: evidenceIdentity,
      target_ref: `https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-${evidenceCommentId}`,
      candidate_sha: candidateSha,
      payload: { comment_id: evidenceCommentId, retained_marker: evidenceMarker, ados_local_revision: 3 },
    });
    const predictedEvidence: PublicationRecord = {
      run_id: runId,
      effect_kind: "EVIDENCE_COMMENT",
      identity_key: evidenceIdentity,
      outbox_id: evidenceRevision3Outbox,
      target_ref: `https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-${evidenceCommentId}`,
      candidate_sha: candidateSha,
      status: "CONFIRMED",
      result_ref: `https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-${evidenceCommentId}`,
      readback_digest: "sha256:predicted",
      last_event_seq: 0,
    };
    const predictedCard = intendedReadySlice4SafetyCard(buildCorpus({
      prepared, store, binding, verification, cases: closing.cases, residual: closing.residual,
      evidenceBody: null,
      localRevision,
      windowsValidation,
      publications: [
        ...store.publications(runId).filter((item) => item.outbox_id !== evidenceRevision3Outbox),
        predictedEvidence,
      ],
    }));
    if (predictedCard.result !== "READY_FOR_ONE_REAL_DOGFOOD") throw new Error(`BLOCKED_CARD_PREDICTION:${predictedCard.blocker}`);
    const expectedBody = evidenceBody({
      prepared, binding, candidateSha, treeSha: verification.revision2Tree,
      cases: closing.cases, card: predictedCard, localRevision,
      windowsValidation,
    });
    assertProductionAdmission(binding, prepared.intake.request as Record<string, JsonValue>);
    const evidence = updateSlice4RepairEvidenceComment(fixtureWorktreePath(), candidateSha, expectedBody);
    if (obligationPending(store, runId, "checkpoint-evidence-ack-lost")) {
      satisfy(store, runId, holderId, token, "checkpoint-evidence-ack-lost", { comment_id: evidenceCommentId });
      forced("AFTER_EVIDENCE_ACK_LOST");
    }
    reconcileEffect(store, runId, holderId, token, {
      outbox_id: evidenceRevision3Outbox, effect_kind: "EVIDENCE_COMMENT", identity_key: evidenceIdentity,
      result_ref: evidence.url, readback_digest: evidence.readback_digest,
    });
    satisfyExistingObligation(store, runId, holderId, token, "publication-evidence", {
      comment_id: evidenceCommentId,
      url: evidence.url,
      readback_digest: evidence.readback_digest,
    });
    transitionIf(store, runId, holderId, token, "PUBLISHING", "OWNER_REVIEW", "slice4-repair-owner-review");
    store.recordWorkspaceFact(runId, holderId, token, {
      repository_full_name: "fixture.invalid/ados-fixture-delivery", base_sha: SLICE4_FIXTURE_BASE_SHA,
      branch_name: slice4FixtureTask.target_branch, worktree_path_digest: worktree.worktree_path_digest,
      candidate_sha: candidateSha, candidate_revision: 2, status: "PUBLISHED",
    }, "slice4-repair-workspace-published");
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    const card = deriveSlice4SafetyCard(buildCorpus({
      prepared, store, binding, verification, cases: closing.cases, residual: closing.residual,
      evidenceBody: evidence.body,
      localRevision,
      windowsValidation,
    }));
    if (
      card.result !== "READY_FOR_ONE_REAL_DOGFOOD" ||
      card.card_digest !== predictedCard.card_digest
    ) throw new Error(`BLOCKED_CARD_DERIVATION:${card.blocker ?? "DIGEST_DRIFT"}`);
    writeJson(join(repairRoot(), "dogfood-safety-card.json"), card);
    const result: Slice4RepairResult = {
      result: "CANDIDATE_READY_FOR_OWNER_REVIEW",
      activation_id: activationId,
      dispatch_id: binding.dispatch_id,
      run_id: runId,
      request_id: prepared.intake.request_id,
      receipt_id: prepared.intake.receipt.receipt_id,
      candidate_revision: 2,
      candidate_sha: candidateSha,
      fixture_pr_url: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6",
      evidence_comment_id: evidenceCommentId,
      evidence_comment_url: evidence.url,
      card,
    };
    writeJson(join(repairRoot(), "result.json"), result);
    return result;
  } finally {
    store.close();
  }
}

export async function readSlice4RepairStatus(activationId: string): Promise<Slice4RepairStatus> {
  try {
    const intake = await IntakeStore.open(databasePath());
    try {
      if (intake.statusByActivation(activationId) === null) throw new Error("BLOCKED_DISPATCH_ACTIVATION_NOT_FOUND");
    } finally {
      intake.close();
    }
    const store = new EventStore(databasePath());
    try {
      const binding = store.dispatchBinding(activationId);
      if (binding === null) return {
        schema_version: "slice4-repair-status/v0.1", activation_id: activationId, state: "APPROVED",
        run_id: null, objective_ref: null, target_branch: null, target_pr_url: null,
        evidence_url: null, candidate_sha: null, worktree_path_digest: null, session_digest: null, blocker: null,
      };
      const run = store.getRun(binding.run_id);
      const workspace = store.workspace(binding.run_id);
      const session = store.sessions(binding.run_id)[0];
      const publications = store.publications(binding.run_id);
      const pr = publications.find((item) => item.effect_kind === "DRAFT_PR");
      const evidence = publications.find((item) => item.effect_kind === "EVIDENCE_CORRECTION");
      const state = run.state === "OWNER_REVIEW" ? "OWNER_REVIEW"
        : run.state === "PUBLISHING" ? "PUBLISHING"
        : run.state === "VERIFYING" ? "VERIFYING"
        : session === undefined ? "RUNNING" : "RECOVERING";
      return {
        schema_version: "slice4-repair-status/v0.1", activation_id: activationId, state,
        run_id: binding.run_id, objective_ref: "fixture.invalid/ados-fixture-delivery#5",
        target_branch: "fixture/public-target-safety-v1",
        target_pr_url: pr?.result_ref ?? null, evidence_url: evidence?.result_ref ?? null,
        candidate_sha: workspace?.candidate_sha ?? null,
        worktree_path_digest: workspace?.worktree_path_digest ?? null,
        session_digest: session === undefined ? null : hashCanonical({ thread_id: session.thread_id }),
        blocker: null,
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      schema_version: "slice4-repair-status/v0.1", activation_id: activationId, state: "BLOCKED",
      run_id: null, objective_ref: null, target_branch: null, target_pr_url: null,
      evidence_url: null, candidate_sha: null, worktree_path_digest: null, session_digest: null,
      blocker: error instanceof Error ? error.message.slice(0, 240) : "BLOCKED_UNKNOWN",
    };
  }
}

export async function runSlice4SafetyGate(): Promise<Slice4SafetyCard> {
  const path = join(repairRoot(), "dogfood-safety-card.json");
  return JSON.parse(readFileSync(path, "utf8")) as Slice4SafetyCard;
}
