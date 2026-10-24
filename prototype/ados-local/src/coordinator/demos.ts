import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashCanonical } from "../canonical/index.js";
import { ContractValidator } from "../contracts/validator.js";
import {
  validDeliveryRequest,
  validEvidenceManifest,
  validObjective,
  validRunEnvelope,
} from "../contracts/fixture-data.js";
import { verifyVendoredSnapshots } from "../contracts/snapshots.js";
import { runGate0A } from "../gates/gate0a.js";
import { runGate0B } from "../gates/gate0b.js";
import { runGate0S } from "../gates/gate0s.js";
import { ScopePolicy } from "../policy/index.js";
import { BetterSqlite3Driver } from "../storage/better-sqlite3-driver.js";
import { runCrashMatrix } from "../storage/crash-probe.js";
import {
  EventStore,
  type OwnerReceiptInput,
  type StoreSummary,
} from "../storage/event-store.js";
import type { JsonObject, JsonValue, RunSeed } from "../types.js";
import {
  deterministicClock,
  deterministicIdFactory,
  runWalkingSkeleton,
} from "./walking-skeleton.js";

export interface DemoResult {
  readonly command: string;
  readonly status: "PASS" | "BLOCKED";
  readonly result: string;
  readonly summary: readonly string[];
  readonly evidence: JsonObject;
}

function asJson(value: unknown): JsonObject {
  return value as JsonObject;
}

function demoRoot(name: string): string {
  const root = resolve(".ados-local", "demos", name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

function createStore(name: string): { readonly root: string; readonly store: EventStore } {
  const root = demoRoot(name);
  return {
    root,
    store: new EventStore(join(root, "state.sqlite"), {
      now: deterministicClock(),
      idFactory: deterministicIdFactory(),
    }),
  };
}

function seed(suffix: string, leaseKey = `objective-demo-${suffix}`): RunSeed {
  return {
    run_id: `run-demo-${suffix}`,
    request_id: `dr-demo-${suffix}`,
    objective_id: `objective-demo-${suffix}`,
    objective_ref: `fixture://objective/demo/${suffix}`,
    request_digest: hashCanonical({ request: suffix }),
    objective_digest: hashCanonical({ objective: suffix }),
    envelope_digest: hashCanonical({ envelope: suffix }),
    generation: 1,
    lease_key: leaseKey,
    holder_id: `coordinator-demo-${suffix}`,
    ttl_seconds: 300,
    obligations: [
      {
        obligation_id: "engineering-core",
        category: "engineering",
        verifier_id: "verifier.core",
        minimum_trust: "T2",
      },
      {
        obligation_id: "owner-acceptance",
        category: "owner",
        verifier_id: "verifier.owner",
        minimum_trust: "T4",
      },
    ],
  };
}

function receiptFor(runSeed: RunSeed, receiptId: string): OwnerReceiptInput {
  return {
    receipt_id: receiptId,
    actor_id: "owner-fixture",
    authn_method: "external_owner_record",
    action: "approve_delivery",
    authorization: "IMPLEMENT",
    approval_ref: `fixture://owner/${receiptId}`,
    owner_turn_digest: hashCanonical({ owner_turn: receiptId }),
    request_digest: runSeed.request_digest,
    approved_at: "2026-08-02T00:00:00.000Z",
  };
}

function captureError(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN_REJECTION";
  }
  throw new Error("EXPECTED_REJECTION_NOT_OBSERVED");
}

function sameCanonicalState(before: StoreSummary, after: StoreSummary): boolean {
  return (
    before.run.state === after.run.state &&
    before.run.run_id === after.run.run_id &&
    before.chain_head === after.chain_head &&
    before.event_count === after.event_count &&
    JSON.stringify(before.obligations) === JSON.stringify(after.obligations)
  );
}

function codexExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) {
    throw new Error("BLOCKED_CODEX_TRANSPORT:LOCALAPPDATA_UNAVAILABLE");
  }
  const executable = join(
    localAppData,
    "OpenAI",
    "Codex",
    "bin",
    "d7e8094cfb76a267",
    "codex.exe",
  );
  if (!existsSync(executable)) {
    throw new Error("BLOCKED_CODEX_TRANSPORT:EXACT_EXECUTABLE_UNAVAILABLE");
  }
  return executable;
}

function verifyContractEvidence(): JsonObject {
  const snapshots = verifyVendoredSnapshots();
  const validator = new ContractValidator();
  const request = validDeliveryRequest();
  const objective = validObjective();
  const envelope = validRunEnvelope();
  const evidence = validEvidenceManifest();
  const results = {
    delivery_request: validator.validateDeliveryRequest(request),
    objective: validator.validateSchema("objective-record", objective),
    run_envelope: validator.validateRunEnvelope(envelope),
    evidence: validator.validateEvidenceBindings(evidence, objective, envelope),
  };
  if (Object.values(results).some((result) => !result.valid)) {
    throw new Error("BLOCKED_CORE_FOUNDATION:CONTRACT_VALIDATION");
  }
  return asJson({ snapshots, schema_identities: validator.schemaIdentities(), results });
}

function verifyContracts(): DemoResult {
  const evidence = verifyContractEvidence();
  return {
    command: "verify-contracts",
    status: "PASS",
    result: "PASS_CONTRACTS",
    summary: [
      "9 vendored contract/schema snapshots verified against the pinned manifest.",
      "Delivery Request, Objective, Run Envelope, and Evidence fixtures passed strict schema and semantic validation.",
    ],
    evidence,
  };
}

function walkingSkeleton(): DemoResult {
  const fixture = createStore("walking-skeleton");
  try {
    const evidence = runWalkingSkeleton(fixture.store, true);
    return {
      command: "walking-skeleton",
      status: "PASS",
      result: "PASS_CONTRACT_WALKING_SKELETON",
      summary: [
        `Run ${evidence.run_id} reached ${evidence.state_before_owner_acceptance}, then fixture-only simulated T4 reached ${evidence.final_state}.`,
        `Independent verifier receipts: ${evidence.verifier_receipts.length}; events: ${evidence.event_timeline.length}.`,
        "No real Objective is created or accepted; fixture T4 is not product acceptance.",
      ],
      evidence: asJson(evidence),
    };
  } finally {
    fixture.store.close();
  }
}

function duplicateDemo(): DemoResult {
  const fixture = createStore("duplicate");
  try {
    const runSeed = seed("duplicate");
    const created = fixture.store.createRun(runSeed);
    const duplicate = fixture.store.createRun(runSeed);
    fixture.store.transition(
      runSeed.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "duplicate-uncertain-ack",
    );
    const beforeRetry = fixture.store.summary(runSeed.run_id);
    const retried = fixture.store.transition(
      runSeed.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "duplicate-uncertain-ack",
    );
    const afterRetry = fixture.store.summary(runSeed.run_id);
    if (
      duplicate.disposition !== "DUPLICATE_RECONCILED" ||
      duplicate.run.run_id !== created.run.run_id ||
      retried.run_id !== created.run.run_id ||
      afterRetry.event_count !== beforeRetry.event_count
    ) {
      throw new Error("DUPLICATE_RECONCILIATION_FAILED");
    }
    fixture.store.verifyEventChain();
    return {
      command: "duplicate",
      status: "PASS",
      result: "PASS_DUPLICATE_RECONCILED",
      summary: ["Duplicate start and uncertain-ack transition retry reused one run identity and appended no duplicate Event."],
      evidence: asJson({
        run_id: created.run.run_id,
        start_disposition: duplicate.disposition,
        state: afterRetry.run.state,
        event_count_before_retry: beforeRetry.event_count,
        event_count_after_retry: afterRetry.event_count,
      }),
    };
  } finally {
    fixture.store.close();
  }
}

async function crashRecoveryDemo(): Promise<DemoResult> {
  const root = demoRoot("crash-recovery");
  const matrix = await runCrashMatrix(join(root, "matrix"));
  if (matrix.length !== 10 || matrix.some((item) => item.chain !== "PASS" || item.integrity !== "PASS")) {
    throw new Error("BLOCKED_SQLITE_TRANSACTION_MODEL");
  }
  return {
    command: "crash-recovery",
    status: "PASS",
    result: "PASS_CRASH_RECOVERY_S01_S10",
    summary: ["S01-S10 all produced the frozen rollback/commit/reopen/retry/fencing outcomes with intact chains."],
    evidence: asJson({ matrix }),
  };
}

function forgedApprovalDemo(): DemoResult {
  const fixture = createStore("forged-approval");
  try {
    const firstSeed = seed("receipt-a");
    const first = fixture.store.createRun(firstSeed);
    const holder = first.lease.holder_id;
    const token = first.lease.fencing_token;
    const before = fixture.store.summary(firstSeed.run_id).event_count;
    const forgedAuthorization = captureError(() => fixture.store.recordOwnerApproval(
      firstSeed.run_id,
      holder,
      token,
      { ...receiptFor(firstSeed, "receipt-forged-auth"), authorization: "MERGE" },
      "forged-auth",
    ));
    const mutatedRequest = captureError(() => fixture.store.recordOwnerApproval(
      firstSeed.run_id,
      holder,
      token,
      { ...receiptFor(firstSeed, "receipt-mutated-request"), request_digest: hashCanonical({ request: "mutated" }) },
      "mutated-request",
    ));
    fixture.store.recordOwnerApproval(
      firstSeed.run_id,
      holder,
      token,
      receiptFor(firstSeed, "receipt-replay"),
      "valid-receipt",
    );
    const secondSeed = seed("receipt-b");
    const second = fixture.store.createRun(secondSeed);
    const secondBefore = fixture.store.summary(secondSeed.run_id).event_count;
    const replayed = captureError(() => fixture.store.recordOwnerApproval(
      secondSeed.run_id,
      second.lease.holder_id,
      second.lease.fencing_token,
      receiptFor(secondSeed, "receipt-replay"),
      "replayed-receipt",
    ));
    const firstAfter = fixture.store.summary(firstSeed.run_id);
    const secondAfter = fixture.store.summary(secondSeed.run_id);
    if (
      forgedAuthorization !== "OWNER_RECEIPT_REJECTED:BINDING" ||
      mutatedRequest !== "OWNER_RECEIPT_REJECTED:BINDING" ||
      !/UNIQUE constraint failed: approvals\.receipt_id/.test(replayed) ||
      firstAfter.event_count !== before + 1 ||
      secondAfter.event_count !== secondBefore
    ) {
      throw new Error("FORGED_APPROVAL_REJECTION_FAILED");
    }
    return {
      command: "forged-approval",
      status: "PASS",
      result: "PASS_FORGED_MUTATED_REPLAYED_RECEIPTS_REJECTED",
      summary: ["Forged authorization, mutated request binding, and replayed receipt id were rejected atomically."],
      evidence: asJson({
        forged_authorization: forgedAuthorization,
        mutated_request: mutatedRequest,
        replayed_receipt: "UNIQUE_RECEIPT_REJECTED",
        first_run_approval_count: firstAfter.approval_count,
        second_run_event_count_unchanged: secondAfter.event_count === secondBefore,
      }),
    };
  } finally {
    fixture.store.close();
  }
}

function falseCompletionDemo(): DemoResult {
  const fixture = createStore("false-completion");
  try {
    const runSeed = seed("false-completion");
    const created = fixture.store.createRun(runSeed);
    const holder = created.lease.holder_id;
    const token = created.lease.fencing_token;
    fixture.store.transition(runSeed.run_id, "PREPARED", "EXECUTING", holder, token, "to-executing");
    fixture.store.recordAgentClaim(runSeed.run_id, holder, token, "Agent says done", "agent-t0-claim");
    const before = fixture.store.summary(runSeed.run_id).event_count;
    const t0Closure = captureError(() => fixture.store.satisfyObligation(
      runSeed.run_id,
      holder,
      token,
      {
        verifier_receipt_id: "vr-agent-t0",
        obligation_id: "engineering-core",
        verifier_id: "verifier.core",
        trust_level: "T0",
        result: "PASS",
        input_digest: hashCanonical({ claim: "done" }),
        result_digest: hashCanonical({ result: "agent-self-attested" }),
        evidence_ref: "fixture://agent/t0",
      },
      "agent-t0-close",
    ));
    const done = captureError(() => fixture.store.transition(
      runSeed.run_id,
      "EXECUTING",
      "DONE",
      holder,
      token,
      "false-done",
    ));
    const after = fixture.store.summary(runSeed.run_id);
    if (!t0Closure.startsWith("OBLIGATION_TRUST_REJECTED") || !done.startsWith("INVALID_TRANSITION") || after.event_count !== before) {
      throw new Error("FALSE_COMPLETION_CONTROL_FAILED");
    }
    return {
      command: "false-completion",
      status: "PASS",
      result: "PASS_FALSE_COMPLETION_REJECTED",
      summary: ["A T0 Agent claim closed neither the T2 engineering obligation nor DONE, and rejection appended no Event."],
      evidence: asJson({ t0_closure: t0Closure, done_transition: done, state: after.run.state, event_count: after.event_count }),
    };
  } finally {
    fixture.store.close();
  }
}

function cancelDemo(): DemoResult {
  const fixture = createStore("cancel");
  try {
    const runSeed = seed("cancel");
    const created = fixture.store.createRun(runSeed);
    fixture.store.transition(
      runSeed.run_id,
      "PREPARED",
      "CANCELLED",
      created.lease.holder_id,
      created.lease.fencing_token,
      "cancel-run",
    );
    const before = fixture.store.summary(runSeed.run_id);
    const rejected = captureError(() => fixture.store.recordAgentClaim(
      runSeed.run_id,
      created.lease.holder_id,
      created.lease.fencing_token,
      "post-cancel mutation",
      "post-cancel",
    ));
    const after = fixture.store.summary(runSeed.run_id);
    if (after.run.state !== "CANCELLED" || after.event_count !== before.event_count) {
      throw new Error("POST_CANCEL_MUTATION_CONTROL_FAILED");
    }
    return {
      command: "cancel",
      status: "PASS",
      result: "PASS_CANCEL_TERMINAL",
      summary: ["CANCELLED disabled the lease and rejected later Agent mutation without a new Event."],
      evidence: asJson({ rejection: rejected, state: after.run.state, lease_live: after.lease.live, event_count: after.event_count }),
    };
  } finally {
    fixture.store.close();
  }
}

function scopeViolationDemo(): DemoResult {
  const fixture = createStore("scope-violation");
  try {
    const created = fixture.store.createRun(seed("scope"));
    const before = fixture.store.summary(created.run.run_id).event_count;
    const policy = new ScopePolicy(["src/**", "docs/OWNER_DEMO.md"], ["src/secrets/**"]);
    const decisions = {
      allowed: policy.evaluate("src/coordinator/demos.ts"),
      forbidden: policy.evaluate("src/secrets/token.txt"),
      traversal: policy.evaluate("../outside.txt"),
      unlisted: policy.evaluate("README.md"),
    };
    const after = fixture.store.summary(created.run.run_id).event_count;
    if (
      decisions.allowed.effect !== "ALLOW" ||
      Object.values(decisions).slice(1).some((decision) => decision.effect !== "DENY") ||
      before !== after
    ) {
      throw new Error("SCOPE_DEFAULT_DENY_FAILED");
    }
    return {
      command: "scope-violation",
      status: "PASS",
      result: "PASS_SCOPE_VIOLATIONS_REJECTED",
      summary: ["Forbidden, traversal, and unlisted paths were default-denied before any protected mutation."],
      evidence: asJson({ decisions, event_count_unchanged: before === after }),
    };
  } finally {
    fixture.store.close();
  }
}

function invalidTransitionDemo(): DemoResult {
  const fixture = createStore("invalid-transition");
  try {
    const runSeed = seed("invalid-transition");
    const created = fixture.store.createRun(runSeed);
    const before = fixture.store.summary(runSeed.run_id).event_count;
    const rejection = captureError(() => fixture.store.transition(
      runSeed.run_id,
      "PREPARED",
      "OWNER_REVIEW",
      created.lease.holder_id,
      created.lease.fencing_token,
      "invalid-owner-review",
    ));
    const after = fixture.store.summary(runSeed.run_id);
    if (!rejection.startsWith("INVALID_TRANSITION") || after.event_count !== before || after.run.state !== "PREPARED") {
      throw new Error("INVALID_TRANSITION_CONTROL_FAILED");
    }
    return {
      command: "invalid-transition",
      status: "PASS",
      result: "PASS_INVALID_TRANSITION_REJECTED",
      summary: ["PREPARED → OWNER_REVIEW was rejected with unchanged Event and projection state."],
      evidence: asJson({ rejection, state: after.run.state, event_count: after.event_count }),
    };
  } finally {
    fixture.store.close();
  }
}

function storageIntegrityDemo(): DemoResult {
  const root = demoRoot("storage-integrity");
  const schemaPath = join(root, "schema-corrupt.sqlite");
  const schemaStore = new EventStore(schemaPath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  schemaStore.createRun(seed("integrity-schema"));
  schemaStore.close();
  const schemaDriver = new BetterSqlite3Driver(schemaPath, { fileMustExist: true });
  schemaDriver.exec("DROP TRIGGER events_no_delete");
  schemaDriver.close();
  const schemaRejection = captureError(() => new EventStore(schemaPath));

  const chainPath = join(root, "chain-corrupt.sqlite");
  const chainStore = new EventStore(chainPath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  chainStore.createRun(seed("integrity-chain"));
  chainStore.close();
  const chainDriver = new BetterSqlite3Driver(chainPath, { fileMustExist: true });
  chainDriver.exec(
    "DROP TRIGGER events_no_update; UPDATE events SET payload_jcs = '{}' WHERE seq = 1; CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;",
  );
  chainDriver.close();
  const reopened = new EventStore(chainPath);
  const chainRejection = captureError(() => reopened.verifyEventChain());
  reopened.close();
  if (!schemaRejection.startsWith("SCHEMA_TRIGGER_MISSING") || !chainRejection.startsWith("EVENT_CHAIN_HASH_MISMATCH")) {
    throw new Error("STORAGE_CORRUPTION_FAIL_CLOSED_FAILED");
  }
  return {
    command: "storage-integrity",
    status: "PASS",
    result: "PASS_STORAGE_CORRUPTION_BLOCKED",
    summary: ["Missing immutable schema protection and a broken Event hash chain both failed closed."],
    evidence: asJson({ schema_rejection: schemaRejection, chain_rejection: chainRejection }),
  };
}

function storageRebuildDemo(): DemoResult {
  const fixture = createStore("storage-rebuild");
  try {
    const before = runWalkingSkeleton(fixture.store, false).summary;
    fixture.store.rebuildProjections();
    const after = fixture.store.summary(before.run.run_id);
    if (!sameCanonicalState(before, after)) {
      throw new Error("BLOCKED_SQLITE_INTEGRITY:REBUILD_MISMATCH");
    }
    return {
      command: "storage-rebuild",
      status: "PASS",
      result: "PASS_STORAGE_REBUILD",
      summary: ["All mutable projections were deleted and rebuilt from immutable Events with canonical-state equality."],
      evidence: asJson({
        run_id: after.run.run_id,
        state: after.run.state,
        event_count: after.event_count,
        chain_head: after.chain_head,
        obligations: after.obligations,
      }),
    };
  } finally {
    fixture.store.close();
  }
}

async function storageBackupRestoreDemo(): Promise<DemoResult> {
  const fixture = createStore("storage-backup-restore");
  const databasePath = join(fixture.root, "state.sqlite");
  const backupPath = join(fixture.root, "backup.sqlite");
  const before = runWalkingSkeleton(fixture.store, false).summary;
  fixture.store.checkpoint("TRUNCATE");
  await fixture.store.backup(backupPath);
  fixture.store.close();
  const reopened = new EventStore(databasePath);
  const restored = new EventStore(backupPath);
  try {
    const live = reopened.summary(before.run.run_id);
    const backup = restored.summary(before.run.run_id);
    restored.verifyEventChain();
    const integrity = restored.integrity();
    if (!sameCanonicalState(before, live) || !sameCanonicalState(before, backup)) {
      throw new Error("BLOCKED_SQLITE_INTEGRITY:BACKUP_RESTORE_MISMATCH");
    }
    return {
      command: "storage-backup-restore",
      status: "PASS",
      result: "PASS_STORAGE_BACKUP_RESTORE",
      summary: ["Checkpoint/reopen and SQLite backup/restore preserved schema, run state, obligations, and Event chain head."],
      evidence: asJson({ run_id: before.run.run_id, state: backup.run.state, chain_head: backup.chain_head, integrity }),
    };
  } finally {
    reopened.close();
    restored.close();
  }
}

async function gate0s(command = "gate0s"): Promise<DemoResult> {
  const evidence = await runGate0S();
  return {
    command,
    status: "PASS",
    result: evidence.result,
    summary: [
      `${evidence.checks.length}/${evidence.checks.length} Gate 0S obligations passed.`,
      `${evidence.crash_matrix.length}/${evidence.crash_matrix.length} S01-S10 failure/recovery cases passed.`,
      `better-sqlite3 ${evidence.driver.version}; SQLite ${evidence.driver.sqlite}; ABI ${evidence.driver.abi}.`,
    ],
    evidence: asJson(evidence),
  };
}

async function gate0a(): Promise<DemoResult> {
  const evidence = await runGate0A(codexExecutable());
  return {
    command: "gate0a",
    status: evidence.status,
    result: evidence.result,
    summary: evidence.status === "PASS"
      ? ["Deterministic core and synthetic no-tools App Server semantic Compiler Profile passed."]
      : ["Deterministic core passed; the untrusted semantic candidate was rejected locally and remains an explicit Compiler blocker."],
    evidence: asJson(evidence),
  };
}

async function gate0b(): Promise<DemoResult> {
  const evidence = await runGate0B(codexExecutable());
  return {
    command: "gate0b",
    status: "PASS",
    result: evidence.result,
    summary: [
      "Exact Codex App Server passed schema, auth, thread/turn, outputSchema, approval, interrupt, restart, reconciliation, and cleanup probes.",
      `${evidence.host.schema_files} generated schema files; ${evidence.transport.session_projection_count} unique SQLite session projections.`,
    ],
    evidence: asJson(evidence),
  };
}

function coreCheck(): DemoResult {
  const contracts = verifyContractEvidence();
  const fixture = createStore("check");
  try {
    const walking = runWalkingSkeleton(fixture.store, false);
    fixture.store.verifyEventChain();
    fixture.store.verifyProjectionConsistency();
    const integrity = fixture.store.integrity();
    return {
      command: "check",
      status: "PASS",
      result: "PASS_CORE_CHECK",
      summary: [
        "Pinned snapshots and strict contracts passed.",
        "The real SQLite Golden Path reached OWNER_REVIEW with independent T2 receipts and pending real Owner acceptance.",
      ],
      evidence: asJson({ contracts, walking, integrity }),
    };
  } finally {
    fixture.store.close();
  }
}

export async function runDemoCommand(command: string): Promise<DemoResult> {
  switch (command) {
    case "check": return coreCheck();
    case "verify-contracts": return verifyContracts();
    case "verify-storage": return gate0s("verify-storage");
    case "walking-skeleton": return walkingSkeleton();
    case "gate0s": return gate0s();
    case "gate0a": return gate0a();
    case "gate0b": return gate0b();
    case "duplicate": return duplicateDemo();
    case "crash-recovery": return crashRecoveryDemo();
    case "forged-approval": return forgedApprovalDemo();
    case "false-completion": return falseCompletionDemo();
    case "cancel": return cancelDemo();
    case "scope-violation": return scopeViolationDemo();
    case "storage-integrity": return storageIntegrityDemo();
    case "storage-rebuild": return storageRebuildDemo();
    case "storage-backup-restore": return storageBackupRestoreDemo();
    case "invalid-transition": return invalidTransitionDemo();
    default: throw new Error(`UNKNOWN_COMMAND:${command}`);
  }
}
