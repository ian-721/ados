import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashCanonical } from "../canonical/index.js";
import { selectExistingDraftPr, classifyPushReadback } from "../profiles/forge-profile.js";
import { assertFrozenBase, verifyChangedPaths } from "../profiles/workspace-profile.js";
import { EventStore } from "../storage/event-store.js";

export interface RecoveryCase {
  readonly id: string;
  readonly behavior: string;
  readonly result: "PASS";
  readonly evidence: string;
}

export interface Slice2RecoveryResult {
  readonly result: "PASS_SLICE2_RECOVERY_MATRIX";
  readonly cases: readonly RecoveryCase[];
  readonly run_id: string;
  readonly candidate_revision: 1;
  readonly event_count: number;
  readonly pending_outbox: number;
  readonly event_chain_head: string;
}

export function boundedRepairAllowed(completedRepairs: number): boolean {
  if (!Number.isSafeInteger(completedRepairs) || completedRepairs < 0) {
    throw new Error("REPAIR_COUNT_INVALID");
  }
  return completedRepairs < 1;
}

function expectRejected(operation: () => unknown, pattern: RegExp): string {
  try {
    operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
    if (pattern.test(message)) {
      return message;
    }
    throw error;
  }
  throw new Error(`EXPECTED_REJECTION_MISSING:${pattern.source}`);
}

function gate0bCancellationPass(path: string): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const evidence = value.evidence as Record<string, unknown>;
  const checks = evidence.checks as Array<Record<string, unknown>>;
  const cancellation = checks.find((check) => check.id === "B-08");
  if (
    value.result !== "PASS_CODEX_APP_SERVER" ||
    cancellation?.status !== "PASS" ||
    !String(cancellation.evidence).includes("no post-cancel")
  ) {
    throw new Error("GATE0B_CANCELLATION_EVIDENCE_INVALID");
  }
}

export function runSlice2RecoveryMatrix(
  root: string,
  gate0bEvidencePath: string,
): Slice2RecoveryResult {
  const databasePath = join(root, "state.sqlite");
  let tick = 0;
  let id = 0;
  const options = {
    now: () => new Date(Date.UTC(2026, 7, 3, 2, 0, tick++)).toISOString(),
    idFactory: (prefix: string) => `${prefix}-slice2-recovery-${String(++id).padStart(4, "0")}`,
  };
  let store = new EventStore(databasePath, options);
  const runId = "run-slice2-recovery-0001";
  const seed = {
    run_id: runId,
    request_id: "dr-slice2-recovery-0001",
    objective_id: "fixture-owner-summary-v0.1",
    objective_ref: "fixture.invalid/ados-fixture-delivery#1",
    request_digest: `sha256:${"1".repeat(64)}`,
    objective_digest: `sha256:${"2".repeat(64)}`,
    envelope_digest: `sha256:${"3".repeat(64)}`,
    generation: 1,
    lease_key: "fixture-owner-summary-v0.1",
    holder_id: "coordinator-slice2-recovery",
    ttl_seconds: 300,
    obligations: [
      {
        obligation_id: "engineering",
        category: "engineering" as const,
        verifier_id: "verifier.slice2",
        minimum_trust: "T2" as const,
      },
      {
        obligation_id: "owner",
        category: "owner" as const,
        verifier_id: "verifier.owner",
        minimum_trust: "T4" as const,
      },
    ],
  };
  const created = store.createRun(seed);
  const duplicate = store.createRun(seed);
  const holder = created.lease.holder_id;
  const token = created.lease.fencing_token;
  const cases: RecoveryCase[] = [];
  if (duplicate.disposition !== "DUPLICATE_RECONCILED" || duplicate.run.run_id !== runId) {
    throw new Error("RECOVERY_DUPLICATE_RUN_FAILED");
  }
  cases.push({ id: "R01", behavior: "duplicate request reuses one run", result: "PASS", evidence: runId });

  gate0bCancellationPass(gate0bEvidencePath);
  cases.push({ id: "R02", behavior: "Codex interruption has no post-cancel mutation", result: "PASS", evidence: "Gate0B:B-08" });

  store.recordWorkspaceFact(
    runId,
    holder,
    token,
    {
      repository_full_name: "fixture.invalid/ados-fixture-delivery",
      base_sha: "3536f4810f9cfadc75443a838a26e969883fca44",
      branch_name: "ados/slice2-owner-summary-v0.1",
      worktree_path_digest: `sha256:${"4".repeat(64)}`,
      candidate_sha: "a".repeat(40),
      candidate_revision: 1,
      status: "VERIFIED",
    },
    "recovery-workspace-bound",
  );
  store.recordSessionFact(
    runId,
    holder,
    token,
    {
      profile_id: "executor.codex-app-server.fixture-v0.1",
      thread_id: "thread-slice2-recovery-0001",
      turn_id: "turn-slice2-recovery-0001",
      status: "completed",
      capability_digest: `sha256:${"5".repeat(64)}`,
    },
    "recovery-session-bound",
  );
  store.close();
  store = new EventStore(databasePath, options);
  if (
    store.workspace(runId)?.candidate_sha !== "a".repeat(40) ||
    store.summary(runId).session_count !== 1
  ) {
    throw new Error("RECOVERY_RESTART_IDENTITY_FAILED");
  }
  cases.push({ id: "R03", behavior: "restart reuses worktree session and candidate revision", result: "PASS", evidence: "workspace/session projections" });

  if (!boundedRepairAllowed(0) || boundedRepairAllowed(1)) {
    throw new Error("RECOVERY_REPAIR_BOUND_FAILED");
  }
  cases.push({ id: "R04", behavior: "failed checks allow one same-run repair only", result: "PASS", evidence: "repair_limit=1" });

  const scopeFailure = expectRejected(() => verifyChangedPaths(["package.json"]), /SCOPE_VIOLATION/);
  cases.push({ id: "R05", behavior: "scope violation blocks before publication", result: "PASS", evidence: scopeFailure });

  const live = store.getLease(runId);
  store.transition(runId, "PREPARED", "EXECUTING", holder, live.fencing_token, "recovery-executing");
  store.transition(runId, "EXECUTING", "VERIFYING", holder, live.fencing_token, "recovery-verifying");
  store.transition(runId, "VERIFYING", "PUBLISHING", holder, live.fencing_token, "recovery-publishing");
  const candidateSha = "a".repeat(40);
  const pushIntent = {
    outbox_id: `${runId}:push`,
    effect_kind: "GIT_PUSH",
    identity_key: "fixture:push:1",
    target_ref: "refs/heads/ados/slice2-owner-summary-v0.1",
    candidate_sha: candidateSha,
    payload: { candidate_sha: candidateSha },
  };
  store.recordExternalEffectIntent(runId, holder, live.fencing_token, pushIntent, "recovery-push-intent");
  if (classifyPushReadback(candidateSha, candidateSha) !== "REUSE") {
    throw new Error("RECOVERY_PUSH_READBACK_FAILED");
  }
  store.reconcileExternalEffect(
    runId,
    holder,
    live.fencing_token,
    {
      outbox_id: pushIntent.outbox_id,
      effect_kind: pushIntent.effect_kind,
      identity_key: pushIntent.identity_key,
      result_ref: pushIntent.target_ref,
      readback_digest: hashCanonical({ candidate_sha: candidateSha }),
    },
    "recovery-push-reconciled",
  );
  cases.push({ id: "R06", behavior: "lost push acknowledgement reuses exact commit", result: "PASS", evidence: candidateSha });

  const pullRequest = selectExistingDraftPr([{
    number: 1,
    isDraft: true,
    headRefOid: candidateSha,
    url: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/1",
    state: "OPEN",
  }], candidateSha);
  if (pullRequest?.number !== 1) {
    throw new Error("RECOVERY_PR_READBACK_FAILED");
  }
  cases.push({ id: "R07", behavior: "lost PR acknowledgement reuses one Draft PR", result: "PASS", evidence: "draft-pr-1" });

  const evidenceIntent = {
    outbox_id: `${runId}:evidence`,
    effect_kind: "EVIDENCE_COMMENT",
    identity_key: "fixture:evidence:1",
    target_ref: "draft-pr-1",
    candidate_sha: candidateSha,
    payload: { evidence_identity: "fixture:evidence:1" },
  };
  store.recordExternalEffectIntent(runId, holder, live.fencing_token, evidenceIntent, "recovery-evidence-intent");
  const retry = store.recordExternalEffectIntent(runId, holder, live.fencing_token, evidenceIntent, "recovery-evidence-intent");
  if (retry !== "REUSED" || store.getRun(runId).candidate_revision !== 1) {
    throw new Error("RECOVERY_EVIDENCE_RETRY_FAILED");
  }
  store.reconcileExternalEffect(
    runId,
    holder,
    live.fencing_token,
    {
      outbox_id: evidenceIntent.outbox_id,
      effect_kind: evidenceIntent.effect_kind,
      identity_key: evidenceIntent.identity_key,
      result_ref: "draft-pr-1#comment-1",
      readback_digest: hashCanonical({ comment: 1 }),
    },
    "recovery-evidence-reconciled",
  );
  cases.push({ id: "R08", behavior: "Evidence retry does not create a second candidate", result: "PASS", evidence: "candidate_revision=1" });

  const baseFailure = expectRejected(
    () => assertFrozenBase("b".repeat(40), "3536f4810f9cfadc75443a838a26e969883fca44"),
    /BASE_DRIFT_BLOCKED/,
  );
  cases.push({ id: "R09", behavior: "base drift blocks explicitly", result: "PASS", evidence: baseFailure });

  const outageIntent = {
    outbox_id: `${runId}:github-outage`,
    effect_kind: "DRAFT_PR",
    identity_key: "fixture:pr:outage",
    target_ref: "fixture.invalid/ados-fixture-delivery",
    candidate_sha: candidateSha,
    payload: { simulated_transport: "unavailable" },
  };
  store.recordExternalEffectIntent(runId, holder, live.fencing_token, outageIntent, "recovery-outage-intent");
  if (!store.pendingExternalEffects(runId).some((item) => item.outbox_id === outageIntent.outbox_id)) {
    throw new Error("RECOVERY_OUTAGE_INTENT_MISSING");
  }
  cases.push({ id: "R10", behavior: "GitHub outage preserves recoverable outbox intent", result: "PASS", evidence: outageIntent.outbox_id });

  const forged = expectRejected(
    () => store.recordOwnerApproval(
      runId,
      holder,
      live.fencing_token,
      {
        receipt_id: "oar-forged-slice2-0001",
        actor_id: "forged-agent",
        authn_method: "external_owner_record",
        action: "approve_delivery",
        authorization: "IMPLEMENT",
        approval_ref: "fixture://forged/approval",
        owner_turn_digest: `sha256:${"6".repeat(64)}`,
        request_digest: `sha256:${"9".repeat(64)}`,
        approved_at: "2026-08-03T02:10:00.000Z",
      },
      "recovery-forged-approval",
    ),
    /OWNER_RECEIPT_REJECTED/,
  );
  const mutated = expectRejected(
    () => store.createRun({ ...seed, request_digest: `sha256:${"8".repeat(64)}` }),
    /REQUEST_STATE_DRIFT/,
  );
  cases.push({ id: "R11", behavior: "forged approval and mutated request are rejected", result: "PASS", evidence: `${forged};${mutated}` });

  const falseCompletion = expectRejected(
    () => store.transition(runId, "PUBLISHING", "OWNER_REVIEW", holder, live.fencing_token, "recovery-false-review"),
    /FALSE_COMPLETION_REJECTED/,
  );
  const owner = store.summary(runId).obligations.find((item) => item.category === "owner");
  if (owner?.status !== "PENDING") {
    throw new Error("RECOVERY_OWNER_OBLIGATION_CLOSED");
  }
  cases.push({ id: "R12", behavior: "Agent tests and PR cannot close T4 Owner obligation", result: "PASS", evidence: falseCompletion });

  if (cases.length !== 12 || cases.some((item) => item.result !== "PASS")) {
    throw new Error("RECOVERY_MATRIX_INCOMPLETE");
  }
  store.verifyEventChain();
  store.rebuildProjections();
  const summary = store.summary(runId);
  const pending = store.pendingExternalEffects(runId);
  store.close();
  return {
    result: "PASS_SLICE2_RECOVERY_MATRIX",
    cases,
    run_id: runId,
    candidate_revision: 1,
    event_count: summary.event_count,
    pending_outbox: pending.length,
    event_chain_head: summary.chain_head,
  };
}
