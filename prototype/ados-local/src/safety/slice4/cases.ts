import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hashCanonical } from "../../canonical/index.js";
import { ContractValidator } from "../../contracts/validator.js";
import { terminateWindowsProcessTree } from "../../gates/gate0b.js";
import { verifyChangedPaths } from "../../profiles/workspace-profile.js";
import {
  EventStore,
  type OwnerCancellationReceiptInput,
} from "../../storage/event-store.js";
import type { JsonValue, RunSeed } from "../../types.js";
import {
  assertExecutionAdmission,
  assertProjectAdmission,
  type ExecutionAdmissionFacts,
  type ProjectAdmissionFacts,
} from "./admission.js";

export interface Slice4NegativeResult {
  readonly id: "N1" | "N2" | "N3" | "N4" | "N5";
  readonly status: "PASS";
  readonly blocker: string;
  readonly protected_effects: 0;
  readonly post_cancel_effects?: 0;
  readonly receipt_id?: string;
  readonly receipt_digest?: string;
  readonly run_id?: string;
  readonly envelope_digest?: string;
  readonly duplicate_receipts?: 0;
  readonly residual_processes?: 0;
  readonly terminal_blocker?: string;
  readonly event_count?: number;
  readonly approval_count?: number;
  readonly publication_count?: number;
  readonly post_cancel_marker_count?: number;
  readonly reconciled_existing?: boolean;
}

export interface CancellationAuthority {
  readonly positive_receipt_id: string;
  readonly positive_receipt_digest: string;
  readonly positive_activation_id: string;
  readonly objective_digest: string;
}

export const SLICE4_N1_RUN_ID = "run-public-slice4-n1-cancel-0001";
export const SLICE4_N1_FENCING_BLOCKER = `FENCING_REJECTED:${SLICE4_N1_RUN_ID}`;
const cancelRunId = SLICE4_N1_RUN_ID;
const cancelHolderId = "coordinator-slice4-repair-n1";

export interface Slice4N1ReconciliationFacts {
  readonly run_id: string;
  readonly state: string;
  readonly event_count_before: number;
  readonly event_count_after: number;
  readonly approval_count: number;
  readonly publication_count: number;
  readonly post_cancel_marker_present: boolean;
  readonly receipt_digest_before: string;
  readonly receipt_digest_after: string;
  readonly terminal_blocker: string;
}

export function assertSlice4N1Reconciliation(facts: Slice4N1ReconciliationFacts): void {
  if (
    facts.run_id !== SLICE4_N1_RUN_ID ||
    facts.state !== "CANCELLED" ||
    facts.event_count_before !== 4 ||
    facts.event_count_after !== facts.event_count_before ||
    facts.approval_count !== 1 ||
    facts.publication_count !== 0 ||
    facts.post_cancel_marker_present ||
    !/^sha256:[0-9a-f]{64}$/u.test(facts.receipt_digest_before) ||
    facts.receipt_digest_after !== facts.receipt_digest_before ||
    facts.terminal_blocker !== SLICE4_N1_FENCING_BLOCKER
  ) {
    throw new Error(`N1_CANCELLED_PROJECTION_DRIFT:${facts.terminal_blocker}`);
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

function cancellationSeed(authority: CancellationAuthority): RunSeed {
  const requestDigest = hashCanonical({
    action: "cancel_run",
    positive_receipt_id: authority.positive_receipt_id,
    positive_receipt_digest: authority.positive_receipt_digest,
  });
  const envelopeDigest = hashCanonical({
    schema_version: "slice4-cancellation-envelope/v0.1",
    run_id: cancelRunId,
    objective_ref: "fixture.invalid/ados-local#11",
    objective_digest: authority.objective_digest,
    request_digest: requestDigest,
    positive_activation_id: authority.positive_activation_id,
    action: "cancel_run",
  });
  return {
    run_id: cancelRunId,
    request_id: "request-public-slice4-n1-cancel-0001",
    objective_id: "ados-public-slice4-safety-v0.1",
    objective_ref: "fixture.invalid/ados-local#11",
    request_digest: requestDigest,
    objective_digest: authority.objective_digest,
    envelope_digest: envelopeDigest,
    generation: 1,
    lease_key: "slice4-repair-n1-cancel",
    holder_id: cancelHolderId,
    ttl_seconds: 3600,
    obligations: [{
      obligation_id: "cancel-authentication",
      category: "engineering",
      verifier_id: "verifier.owner-cancel",
      minimum_trust: "T3",
    }],
  };
}

function expectedCancellationReceipt(
  authority: CancellationAuthority,
  seed: RunSeed,
  decidedAt: string,
): OwnerCancellationReceiptInput {
  return {
    receipt_id: `cancel-receipt-${hashCanonical({ run_id: cancelRunId, envelope: seed.envelope_digest }).slice(7, 31)}`,
    actor_id: "owner",
    authn_method: "local_extension_confirm",
    action: "cancel_run",
    run_id: cancelRunId,
    envelope_digest: seed.envelope_digest,
    challenge_binding_digest: hashCanonical({
      positive_receipt_id: authority.positive_receipt_id,
      positive_receipt_digest: authority.positive_receipt_digest,
      positive_activation_id: authority.positive_activation_id,
      run_id: cancelRunId,
      envelope_digest: seed.envelope_digest,
    }),
    reason_digest: hashCanonical({ reason: "Slice 4 authenticated cancellation negative case" }),
    decided_at: decidedAt,
    idempotency_key: "slice4-repair-n1-owner-cancel",
  };
}

function reconcileCancelledN1(
  store: EventStore,
  marker: string,
  authority: CancellationAuthority,
  seed: RunSeed,
  token: number,
  before: ReturnType<EventStore["summary"]>,
  reconciledExisting: boolean,
): Slice4NegativeResult {
  const receiptBefore = store.ownerCancellationReceipt(cancelRunId);
  if (receiptBefore === null) throw new Error("N1_CANCELLATION_RECEIPT_NOT_DURABLE");
  const expected = expectedCancellationReceipt(authority, seed, receiptBefore.decided_at);
  for (const key of Object.keys(expected) as Array<keyof OwnerCancellationReceiptInput>) {
    if (receiptBefore[key] !== expected[key]) throw new Error(`N1_CANCELLATION_RECEIPT_DRIFT:${key}`);
  }
  let terminalBlocker = "";
  try {
    store.recordAgentClaim(cancelRunId, cancelHolderId, token, "forbidden", "slice4-repair-n1-post-cancel");
  } catch (error) {
    terminalBlocker = error instanceof Error ? error.message : "";
  }
  const after = store.summary(cancelRunId);
  const receiptAfter = store.ownerCancellationReceipt(cancelRunId);
  if (receiptAfter === null) throw new Error("N1_CANCELLATION_RECEIPT_NOT_DURABLE");
  assertSlice4N1Reconciliation({
    run_id: after.run.run_id,
    state: after.run.state,
    event_count_before: before.event_count,
    event_count_after: after.event_count,
    approval_count: after.approval_count,
    publication_count: after.publication_count,
    post_cancel_marker_present: existsSync(marker),
    receipt_digest_before: receiptBefore.receipt_digest,
    receipt_digest_after: receiptAfter.receipt_digest,
    terminal_blocker: terminalBlocker,
  });
  store.verifyEventChain();
  store.verifyProjectionConsistency();
  return {
    id: "N1",
    status: "PASS",
    blocker: "CANCELLED_TERMINAL",
    protected_effects: 0,
    post_cancel_effects: 0,
    receipt_id: receiptBefore.receipt_id,
    receipt_digest: receiptBefore.receipt_digest,
    run_id: cancelRunId,
    envelope_digest: seed.envelope_digest,
    duplicate_receipts: 0,
    residual_processes: 0,
    terminal_blocker: terminalBlocker,
    event_count: after.event_count,
    approval_count: after.approval_count,
    publication_count: after.publication_count,
    post_cancel_marker_count: existsSync(marker) ? 1 : 0,
    reconciled_existing: reconciledExisting,
  };
}

export async function runN1Cancellation(
  root: string,
  databasePath: string,
  authority: CancellationAuthority,
): Promise<Slice4NegativeResult> {
  const caseRoot = join(root, "cases", "n1");
  mkdirSync(caseRoot, { recursive: true });
  const marker = join(caseRoot, "post-cancel-marker.txt");
  if (existsSync(marker)) throw new Error("N1_PREEXISTING_MARKER");
  const store = new EventStore(databasePath);
  try {
    const seed = cancellationSeed(authority);
    let existingBefore: ReturnType<EventStore["summary"]> | null = null;
    try {
      existingBefore = store.summary(cancelRunId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== `RUN_NOT_FOUND:${cancelRunId}`) throw error;
    }
    const created = store.createRun(seed);
    if (created.disposition === "DUPLICATE_RECONCILED") {
      if (existingBefore === null) throw new Error("N1_DUPLICATE_CASE_IDENTITY");
      return reconcileCancelledN1(
        store, marker, authority, seed, created.lease.fencing_token, existingBefore, true,
      );
    }
    if (existingBefore !== null) throw new Error("N1_CASE_IDENTITY_RECREATED");
    const token = created.lease.fencing_token;
    store.transition(cancelRunId, "PREPARED", "EXECUTING", cancelHolderId, token, "slice4-repair-n1-executing");
    const child = spawn(process.execPath, [
      "-e",
      "setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'forbidden\\n'),2000)",
      marker,
    ], { cwd: caseRoot, stdio: "ignore", windowsHide: true });
    try {
      await wait(200);
      const receipt = expectedCancellationReceipt(authority, seed, new Date().toISOString());
      const recorded = store.recordOwnerCancellation(cancelRunId, cancelHolderId, token, receipt);
      if (recorded.disposition !== "CREATED" || store.ownerCancellationReceipt(cancelRunId)?.receipt_id !== receipt.receipt_id) {
        throw new Error("N1_CANCELLATION_RECEIPT_NOT_DURABLE");
      }
      store.transition(cancelRunId, "EXECUTING", "CANCELLED", cancelHolderId, token, "slice4-repair-n1-cancelled");
      terminateWindowsProcessTree(child.pid ?? 0);
      await wait(2_250);
      if (existsSync(marker)) throw new Error("N1_POST_CANCEL_WORKSPACE_EFFECT");
      const duplicate = store.recordOwnerCancellation(cancelRunId, cancelHolderId, token, receipt);
      if (duplicate.disposition !== "DUPLICATE_RECONCILED") throw new Error("N1_CANCEL_DUPLICATE_NOT_RECONCILED");
      return reconcileCancelledN1(store, marker, authority, seed, token, store.summary(cancelRunId), false);
    } finally {
      if (child.pid !== undefined) {
        try { terminateWindowsProcessTree(child.pid); } catch { /* already absent */ }
      }
    }
  } finally {
    store.close();
  }
}

export function runN2ExecutionIdentityDrift(expected: ExecutionAdmissionFacts): Slice4NegativeResult {
  const drifted: ExecutionAdmissionFacts = {
    ...expected,
    codex_executable_sha256: `0${expected.codex_executable_sha256.slice(1)}`,
  };
  let blocker = "";
  try { assertExecutionAdmission(expected, drifted); } catch (error) { blocker = error instanceof Error ? error.message : ""; }
  if (blocker !== "BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT") throw new Error("N2_PRODUCTION_GUARD_NOT_EXERCISED");
  return { id: "N2", status: "PASS", blocker, protected_effects: 0 };
}

export function runN3AuthorityDrift(request: Record<string, JsonValue>): Slice4NegativeResult {
  const forged = structuredClone(request);
  forged.outcome = `${String(request.outcome)} forged mutation`;
  const validation = new ContractValidator().validateDeliveryRequest(forged, true);
  if (validation.valid || !validation.errors.some((error) => error.includes("digest"))) {
    throw new Error(`N3_FORGED_REQUEST_NOT_BLOCKED:${validation.errors.join("|")}`);
  }
  return { id: "N3", status: "PASS", blocker: "BLOCKED_IMMUTABLE_DELIVERY_IDENTITY_DRIFT", protected_effects: 0 };
}

export function runN4ProjectPinDrift(expected: ProjectAdmissionFacts): Slice4NegativeResult {
  const drifted: ProjectAdmissionFacts = { ...expected, base_sha: `0${expected.base_sha.slice(1)}` };
  let blocker = "";
  try { assertProjectAdmission(expected, drifted); } catch (error) { blocker = error instanceof Error ? error.message : ""; }
  if (blocker !== "BLOCKED_OBJECTIVE_HARNESS_BASE_DRIFT") throw new Error("N4_PRODUCTION_GUARD_NOT_EXERCISED");
  return { id: "N4", status: "PASS", blocker, protected_effects: 0 };
}

export function runN5ScopeDrift(): Slice4NegativeResult {
  try {
    verifyChangedPaths(["README.md", "package.json"]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SCOPE_VIOLATION:package.json:")) {
      return { id: "N5", status: "PASS", blocker: "BLOCKED_SCOPE_OR_DEPENDENCY_DRIFT", protected_effects: 0 };
    }
    throw error;
  }
  throw new Error("N5_SCOPE_DRIFT_NOT_BLOCKED");
}
