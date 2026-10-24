import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical/index.js";
import type { AcceptedCompilerCandidate, ConversationEvidencePack } from "../src/compiler/types.js";
import { validDeliveryRequest } from "../src/contracts/fixture-data.js";
import type { DeliveryRequestDraft } from "../src/intake/types.js";
import { slice4FixtureTask } from "../src/profiles/fixture-task.js";
import { runProcess } from "../src/profiles/workspace-profile.js";
import {
  expectedExecutionAdmission,
  slice4RepairExecutionCapabilityDigest,
  type ProjectAdmissionFacts,
} from "../src/safety/slice4/admission.js";
import { deriveSlice4SafetyCard, type SafetyCardCorpus } from "../src/safety/slice4/card.js";
import {
  assertSlice4N1Reconciliation,
  runN2ExecutionIdentityDrift,
  runN3AuthorityDrift,
  runN4ProjectPinDrift,
  runN5ScopeDrift,
} from "../src/safety/slice4/cases.js";
import {
  SLICE4_REPAIR_OWNER_DECISION,
  SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE,
  bindSlice4RepairDelivery,
} from "../src/safety/slice4/intake.js";
import {
  SLICE4_REPAIR_PROFILE_VERSION,
  assertFrozenSlice4Profile,
  slice4Cases,
  slice4P1Sequence,
  slice4Profile,
} from "../src/safety/slice4/profile.js";
import { slice4RepairOutputSchema } from "../src/safety/slice4/session.js";

const digest = `sha256:${"1".repeat(64)}`;
const candidate = "a".repeat(40);
const tree = "b".repeat(40);
const required = [
  "target-harness", "target-scope", "target-artifact", "publication-draft", "publication-evidence",
  "checkpoint-candidate-durable", "checkpoint-github-unavailable", "checkpoint-push-ack-lost",
  "checkpoint-pr-ack-lost", "checkpoint-evidence-ack-lost",
  "case-n1", "case-n2", "case-n3", "case-n4", "case-n5",
  "accepted-regressions", "privacy-redaction", "residual-processes", "duplicate-reconciliation",
];

// Synthetic card inputs, never evidence that a Windows validation was run.
function readyCorpus(): SafetyCardCorpus {
  return {
    profile_capability_digest: slice4RepairExecutionCapabilityDigest(),
    intake: {
      request: validDeliveryRequest(), request_id: "request-repair", request_digest: digest,
      receipt: {
        receipt_id: "receipt-repair", actor_id: "owner", authn_method: "local_extension_confirm",
        action: "approve_delivery", authorization: "IMPLEMENT", approval_ref: "local-extension://challenge/repair",
        owner_turn_digest: digest, request_digest: digest, approved_at: "2026-08-06T00:00:00.000Z",
      },
      activation: {
        activation_id: "activation-repair", request_id: "request-repair", request_digest: digest,
        receipt_id: "receipt-repair", status: "APPROVED_NOT_DISPATCHED",
        created_at: "2026-08-06T00:00:01.000Z", last_intake_event: "event-repair",
      },
    },
    binding: {
      dispatch_id: "dispatch-repair", activation_id: "activation-repair", request_id: "request-repair",
      request_digest: digest, receipt_id: "receipt-repair",
      resolver_profile_id: "resolver.fixture-single-running-objective", resolver_profile_version: "0.1.1-public.1",
      resolver_capability_digest: digest, resolution_digest: digest,
      repository_full_name: "fixture.invalid/ados-fixture-delivery", repository_id: "repo-id",
      objective_ref: "fixture.invalid/ados-fixture-delivery#5", objective_digest: digest,
      project_harness_ref: "fixture.invalid/ados-fixture-delivery@4e772e775cbc843420c8580fcff8a85c92754bdd#docs/HARNESS.md",
      harness_digest: digest, base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
      execution_profile_id: "executor.codex-app-server.fixture-v0.1",
      execution_profile_version: "0.1.0-slice4-repair-public.1", execution_capability_digest: digest,
      run_id: "run-repair", envelope_digest: digest, bound_at: "2026-08-06T00:00:02.000Z", last_event_seq: 2,
    },
    run: {
      run_id: "run-repair", request_id: "request-repair", objective_id: "fixture-dogfood-safety-v0.1",
      objective_ref: "fixture.invalid/ados-fixture-delivery#5", request_digest: digest, objective_digest: digest,
      envelope_digest: digest, generation: 1, state: "OWNER_REVIEW", candidate_revision: 1,
      fencing_token: 1, updated_at: "2026-08-06T00:00:03.000Z", last_event_seq: 3, last_event_hash: digest,
    },
    workspace: {
      run_id: "run-repair", repository_full_name: "fixture.invalid/ados-fixture-delivery",
      base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd", branch_name: "fixture/public-target-safety-v1",
      worktree_path_digest: digest, candidate_sha: candidate, candidate_revision: 2,
      status: "PUBLISHED", last_event_seq: 4,
    },
    sessions: [{
      run_id: "run-repair", profile_id: "executor.codex-app-server.fixture-v0.1", thread_id: "thread-repair",
      turn_id: "turn-repair", status: "persistent-repair-attestation", capability_digest: digest, last_event_seq: 5,
    }],
    publications: [
      { run_id: "run-repair", effect_kind: "DRAFT_PR", identity_key: "fixture.invalid/ados-fixture-delivery#6", outbox_id: "pr",
        target_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6", candidate_sha: candidate,
        status: "CONFIRMED", result_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6", readback_digest: digest, last_event_seq: 6 },
      { run_id: "run-repair", effect_kind: "EVIDENCE_CORRECTION", identity_key: "ados-fixture-delivery:run-public-slice4-safety-0001:1", outbox_id: "evidence",
        target_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001", candidate_sha: candidate,
        status: "CONFIRMED", result_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001", readback_digest: digest, last_event_seq: 7 },
      { run_id: "run-repair", effect_kind: "EVIDENCE_COMMENT", identity_key: "ados-fixture-delivery:run-public-slice4-safety-0001:1", outbox_id: "evidence-revision3",
        target_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001", candidate_sha: candidate,
        status: "CONFIRMED", result_ref: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001", readback_digest: digest, last_event_seq: 8 },
    ],
    satisfied_obligation_ids: required,
    cases: [
      { id: "N1", status: "PASS", blocker: "CANCELLED_TERMINAL", protected_effects: 0, post_cancel_effects: 0,
        receipt_digest: digest, run_id: "run-public-slice4-n1-cancel-0001",
        terminal_blocker: "FENCING_REJECTED:run-public-slice4-n1-cancel-0001", event_count: 4,
        approval_count: 1, publication_count: 0, post_cancel_marker_count: 0, reconciled_existing: true },
      { id: "N2", status: "PASS", blocker: "BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT", protected_effects: 0 },
      { id: "N3", status: "PASS", blocker: "BLOCKED_IMMUTABLE_DELIVERY_IDENTITY_DRIFT", protected_effects: 0 },
      { id: "N4", status: "PASS", blocker: "BLOCKED_OBJECTIVE_HARNESS_BASE_DRIFT", protected_effects: 0 },
      { id: "N5", status: "PASS", blocker: "BLOCKED_SCOPE_OR_DEPENDENCY_DRIFT", protected_effects: 0 },
    ],
    regression_receipts: [{ name: "fixture-test", digest }],
    windows_validation: {
      schema_version: "slice4-windows-validation/v0.1",
      restricted: { passed: 1, total: 2, blocker: "CANCEL_PROCESS_TREE_TERMINATION_FAILED:42420" },
      approved_host: { passed: 2, total: 2, blocker: null },
    },
    duplicate_identities: [], residual_process_ids: [], privacy_findings: [],
    local_candidate_sha: "c".repeat(40), local_candidate_parent: "c4b3be5327851f82712558fee8110a384eb37525",
    local_pr_url: "https://github.com/fixture.invalid/ados-local/pull/12",
    revision1_reachable: true, revision2_parent: "710bd4c9e1ba5912219ba401e205e9cec91268d4",
    revision1_tree: tree, revision2_tree: tree, evidence_comment_id: 1000001,
    evidence_comment_url: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001",
    evidence_body: "<!-- ados-evidence:ados-fixture-delivery:run-public-slice4-safety-0001:1 -->",
  } as SafetyCardCorpus;
}

test("repair profile preserves revision 1 and freezes 0.1.1 scope", () => {
  assert.doesNotThrow(() => assertFrozenSlice4Profile());
  assert.equal(slice4Profile.profile_version, "0.1.0-public.1");
  assert.equal(SLICE4_REPAIR_PROFILE_VERSION, "0.1.1-public.1");
  assert.deepEqual(slice4Cases.map((row) => row.id), ["P1", "P2", "N1", "N2", "N3", "N4", "N5"]);
  assert.deepEqual(slice4P1Sequence, [
    "AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY", "GITHUB_UNAVAILABLE_BEFORE_PUSH", "AFTER_PUSH_ACK_LOST",
    "AFTER_DRAFT_PR_ACK_LOST", "AFTER_EVIDENCE_ACK_LOST",
  ]);
  assert.equal(slice4FixtureTask.target_branch, "fixture/public-target-safety-v1");
  assert.match(slice4RepairExecutionCapabilityDigest(), /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    ((slice4RepairOutputSchema().properties as Record<string, unknown>).changed_paths as Record<string, unknown>).items,
    { type: "string" },
  );
});

test("bounded process launcher executes Windows npm.cmd verification", { skip: process.platform !== "win32" ? "Requires the Windows Native Host / npm.cmd profile" : false }, () => {
  const result = runProcess("npm.cmd", ["--version"], process.cwd(), 30_000);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/u);
  assert.equal(result.stderr, "");
});

test("N2 and N4 exercise the production admission guards", () => {
  const project: ProjectAdmissionFacts = {
    resolver_profile_id: "resolver.fixture-single-running-objective", resolver_profile_version: "0.1.1-public.1",
    resolver_capability_digest: digest, resolution_digest: digest, repository_full_name: "fixture.invalid/ados-fixture-delivery",
    repository_id: "repo-id", objective_ref: "fixture.invalid/ados-fixture-delivery#5", objective_digest: digest,
    project_harness_ref: "harness", harness_digest: digest, base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
  };
  const results = [
    runN2ExecutionIdentityDrift(expectedExecutionAdmission()),
    runN3AuthorityDrift(validDeliveryRequest()),
    runN4ProjectPinDrift(project),
    runN5ScopeDrift(),
  ];
  assert.deepEqual(results.map((item) => item.id), ["N2", "N3", "N4", "N5"]);
  assert.ok(results.every((item) => item.status === "PASS" && item.protected_effects === 0));
});

test("N1 accepts only the exact immutable CANCELLED reconciliation and exact fencing blocker", () => {
  const exact = {
    run_id: "run-public-slice4-n1-cancel-0001",
    state: "CANCELLED",
    event_count_before: 4,
    event_count_after: 4,
    approval_count: 1,
    publication_count: 0,
    post_cancel_marker_present: false,
    receipt_digest_before: digest,
    receipt_digest_after: digest,
    terminal_blocker: "FENCING_REJECTED:run-public-slice4-n1-cancel-0001",
  } as const;
  assert.doesNotThrow(() => assertSlice4N1Reconciliation(exact));
  assert.throws(
    () => assertSlice4N1Reconciliation({
      ...exact,
      terminal_blocker: "FENCING_REJECTED:run-slice4-repair-n1-cancel-0002",
    }),
    /N1_CANCELLED_PROJECTION_DRIFT:FENCING_REJECTED:run-slice4-repair-n1-cancel-0002/u,
  );
  assert.throws(
    () => assertSlice4N1Reconciliation({ ...exact, event_count_after: 5 }),
    /N1_CANCELLED_PROJECTION_DRIFT/u,
  );
});

test("Safety Card derives READY and fails closed for every missing receipt", () => {
  const corpus = readyCorpus();
  const ready = deriveSlice4SafetyCard(corpus);
  assert.equal(ready.result, "READY_FOR_ONE_REAL_DOGFOOD");
  assert.equal(ready.repair.ados_local_candidate_sha, "c".repeat(40));
  assert.equal(ready.repair.ados_local_pr, "fixture.invalid/ados-local#12");
  assert.match(ready.card_digest, /^sha256:[0-9a-f]{64}$/u);
  const missingLocalRevision = deriveSlice4SafetyCard({ ...corpus, local_candidate_sha: null });
  assert.equal(missingLocalRevision.result, "BLOCKED");
  assert.equal(missingLocalRevision.blocker, "BLOCKED_ADOS_LOCAL_REVISION3_READBACK");
  const missingRevision3Evidence = deriveSlice4SafetyCard({
    ...corpus,
    publications: corpus.publications.filter((item) => item.outbox_id !== "evidence-revision3"),
  });
  assert.equal(missingRevision3Evidence.result, "BLOCKED");
  assert.equal(missingRevision3Evidence.blocker, "BLOCKED_REMOTE_IDENTITY_READBACK");
  const wrongN1Identity = deriveSlice4SafetyCard({
    ...corpus,
    cases: corpus.cases.map((item) => item.id === "N1" ? { ...item, run_id: "run-slice4-repair-n1-cancel-0002" } : item),
  });
  assert.equal(wrongN1Identity.result, "BLOCKED");
  assert.equal(wrongN1Identity.blocker, "BLOCKED_N1_SAME_IDENTITY_RECONCILIATION");
  const failedWindowsHost = deriveSlice4SafetyCard({
    ...corpus,
    windows_validation: {
      ...corpus.windows_validation,
      approved_host: { passed: 1, total: 2, blocker: "CANCEL_PROCESS_TREE_TERMINATION_FAILED:1234" },
    },
  });
  assert.equal(failedWindowsHost.result, "BLOCKED");
  assert.equal(failedWindowsHost.blocker, "BLOCKED_WINDOWS_HOST_VALIDATION");
  for (const missing of required) {
    const blocked = deriveSlice4SafetyCard({
      ...corpus,
      satisfied_obligation_ids: corpus.satisfied_obligation_ids.filter((item) => item !== missing),
    });
    assert.equal(blocked.result, "BLOCKED", missing);
    assert.equal(blocked.blocker, `BLOCKED_REQUIRED_RECEIPT:${missing}`);
  }
  const duplicate = deriveSlice4SafetyCard({ ...corpus, duplicate_identities: [hashCanonical({ duplicate: true })] });
  assert.equal(duplicate.result, "BLOCKED");
  assert.equal(duplicate.blocker, "BLOCKED_DUPLICATE_IDENTITY");
});

test("pre-confirm Card binding grounds selected Repair context and exact existing identities", () => {
  const assistantTurn = "turn-assistant-repair";
  const ownerTurn = "turn-owner-repair";
  const pack: ConversationEvidencePack = {
    schema_version: "conversation-evidence-pack/v0.1",
    case_id: "clear-ready",
    capture_profile_id: "capture.chatgpt.visible-selection",
    conversation_ref: "chatgpt://conversation/scoped/test",
    selected_turn_ids: [assistantTurn, ownerTurn],
    turns: [
      {
        turn_id: assistantTurn,
        role: "assistant",
        origin: "chatgpt-visible-selection",
        text: [
          "Squash merge / 当前中央 main : 3f5801451f991226704f7b141ddbd6fbcb7e31ac",
          "ADOS Local Objective #11 Fixture Objective #5 ADOS Local PR #12 Fixture PR #6",
          "6bfbb7b8b74bad18144c97d439260a98e11384f3",
          "710bd4c9e1ba5912219ba401e205e9cec91268d4",
          SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE,
        ].join(" "),
      },
      {
        turn_id: ownerTurn,
        role: "owner",
        origin: "chatgpt-visible-selection",
        text: SLICE4_REPAIR_OWNER_DECISION,
      },
    ],
    retention: "local-only",
  };
  const candidateValue: AcceptedCompilerCandidate = {
    schema_version: "gate0a-compiler-candidate/v0.2",
    profile_id: "compiler.codex-app-server.gate0a-no-tools",
    profile_version: "0.3.1-public.1",
    prompt_version: "gate0a-compiler-prompt/v0.5",
    capability_digest: digest,
    case_id: "clear-ready",
    selected_turn_digest: digest,
    owner_turn_digest: digest,
    disposition: "PROPOSE",
    outcome: "Execute the approved Slice 4 Repair contract.",
    owner_decisions: [{
      decision: SLICE4_REPAIR_OWNER_DECISION,
      source_turn_id: ownerTurn,
      source_quote: SLICE4_REPAIR_OWNER_DECISION,
      source_span: {
        normalization: "unicode-nfkc-whitespace-v0.1",
        start: 0,
        end: SLICE4_REPAIR_OWNER_DECISION.length,
      },
    }],
    assumptions: [],
    open_decisions: [],
    readiness: "READY",
    material_question: null,
    requested_authorization: "IMPLEMENT",
    risk_flags: ["LOCAL_SYNTHETIC_ONLY"],
    rejection_reason: null,
    candidate_digest: digest,
  };
  const request = structuredClone(validDeliveryRequest());
  delete request.owner_authorization_receipt;
  const draft: DeliveryRequestDraft = {
    request,
    request_id: String(request.request_id),
    request_digest: String(request.request_digest),
  };
  const bound = bindSlice4RepairDelivery(pack, candidateValue, draft, () => ({
    schema_version: "slice3b-confirmation-revalidation/v0.1",
    local_objective_ref: "fixture.invalid/ados-local#11",
    local_objective_digest: digest,
    target_objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    target_objective_digest: digest,
    target_resolution_digest: digest,
    target_harness_digest: digest,
    target_base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
    compiler_profile_digest: digest,
    compiler_capability_digest: digest,
  }));
  const hint = bound.draft.request.target_hint as Record<string, unknown>;
  assert.equal(hint.repository, "fixture.invalid/ados-fixture-delivery");
  assert.equal(bound.draft.request.why_now, SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE);
  assert.deepEqual(bound.draft.request.owner_decisions, [SLICE4_REPAIR_OWNER_DECISION]);
  assert.equal(bound.card_binding.local.objective_ref, "fixture.invalid/ados-local#11");
  assert.equal(bound.card_binding.local.draft_pr, "fixture.invalid/ados-local#12");
  assert.equal(bound.card_binding.fixture.objective_ref, "fixture.invalid/ados-fixture-delivery#5");
  assert.equal(bound.card_binding.fixture.draft_pr, "fixture.invalid/ados-fixture-delivery#6");
  assert.equal(bound.card_binding.retained_lineage, "REJECTED_CAUSAL_EVIDENCE_GAP");
  assert.equal(bound.card_binding.execution_profile, "safety.fixture-dogfood-gate@0.1.1-public.1");
  assert.ok((bound.draft.request.allowed_scope_hints as unknown[]).length >= 8);
  assert.doesNotMatch(JSON.stringify(bound.draft.request.forbidden_scope_hints), /No Objective, Run, dispatch/u);
  assert.match(String(bound.draft.request.request_digest), /^sha256:[0-9a-f]{64}$/u);

  const driftedPack: ConversationEvidencePack = {
    ...pack,
    turns: pack.turns.map((turn, index) => index === 0 ? {
      ...turn,
      text: turn.text.replace(
        "3f5801451f991226704f7b141ddbd6fbcb7e31ac",
        "316a71840141df22846599643cd72330fa6fbcc6",
      ),
    } : turn),
  };
  assert.throws(
    () => bindSlice4RepairDelivery(driftedPack, candidateValue, draft, () => {
      throw new Error("readback must not run after central main drift");
    }),
    /BLOCKED_INTAKE:SLICE4_REPAIR_AUTHORITY_GROUNDING/u,
  );
});
