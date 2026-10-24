import { hashCanonical } from "../canonical/index.js";
import { computeDeliveryRequestDigest, computeEnvelopeDigest } from "./validator.js";
import type { JsonValue } from "../types.js";

const zeroDigest = `sha256:${"0".repeat(64)}`;
const oneDigest = `sha256:${"1".repeat(64)}`;
const contractSha = "165155ae729d0c3d22d718bdc780351418362583";
const bootstrapSha = "b85a8139cc6d98d7132c84e41a407bde94c813c9";

export function validDeliveryRequest(): Record<string, JsonValue> {
  const ownerTurnDigest = hashCanonical({
    role: "owner",
    text: "Implement only the synthetic walking skeleton fixture.",
  });
  const request: Record<string, JsonValue> = {
    schema_version: "ados-delivery-request/v0.2",
    request_id: "dr-walking-skeleton-0001",
    captured_at: "2026-08-02T00:00:00.000Z",
    capture: {
      adapter_id: "fixture.capture",
      adapter_version: "0.1.0-public.1",
      platform: "synthetic",
      conversation_ref: null,
      selected_turn_digest: oneDigest,
      owner_turn_digest: ownerTurnDigest,
      role_summary: [{ role: "owner", count: 1 }],
      retention: "minimized_only",
    },
    compiler: {
      compiler_version: "0.1.0-public.1",
      rules_version: "delivery-request/v0.2",
      profile_id: "compiler.synthetic.gate0a",
      profile_version: "0.1.0-public.1",
      capability_digest: zeroDigest,
      model_ref: null,
    },
    outcome: "Produce a synthetic, locally verified contract walking skeleton candidate.",
    why_now: "The storage and contract boundaries require deterministic proof before integration.",
    owner_decisions: ["Use only synthetic data and the fake executor."],
    assumptions: [],
    open_decisions: [],
    requested_authorization: "IMPLEMENT",
    target_hint: {
      delivery_class: "software_delivery",
      project_id: "ados-local",
      repository: "fixture.invalid/ados-local",
    },
    allowed_scope_hints: ["src/**", "test/**", "fixtures/**", "migrations/**"],
    forbidden_scope_hints: ["real repositories", "deployment", "release"],
    quality_bar: ["Use deterministic local validation and append-only storage."],
    acceptance: {
      engineering: ["Independent T2 verifier receipts close engineering obligations."],
      product: ["Owner can run the sanitized walking skeleton."],
      owner_artifact: {
        kind: "demo",
        description: "Compiled synthetic walking skeleton demo and structured report.",
      },
    },
    risk_flags: ["new_dependency"],
    readiness: "READY",
    request_digest: zeroDigest,
  };
  const requestDigest = computeDeliveryRequestDigest(request);
  request.request_digest = requestDigest;
  request.owner_authorization_receipt = {
    receipt_id: "oar-walking-skeleton-0001",
    actor_id: "owner-fixture",
    authn_method: "external_owner_record",
    action: "approve_delivery",
    authorization: "IMPLEMENT",
    approval_ref: "fixture://owner/approval/0001",
    owner_turn_digest: ownerTurnDigest,
    request_digest: requestDigest,
    approved_at: "2026-08-02T00:01:00.000Z",
  };
  return request;
}

export function validObjective(): Record<string, JsonValue> {
  return {
    schema_version: "objective-record/v0.2",
    objective_id: "ados-local-fixture-walking-skeleton-v0.1",
    project_id: "ados-local",
    contract_version: "0.2.0",
    contract_ref: `ian-721/agentic-delivery-os@${contractSha}#contracts/OBJECTIVE_CONTRACT.md`,
    project_harness_ref: `fixture.invalid/ados-local@${bootstrapSha}#docs/HARNESS.md`,
    authorization: "IMPLEMENT",
    status: "RUNNING",
    outcome: "Execute a synthetic contract walking skeleton.",
    why_now: "Gate zero requires local proof.",
    sources: [{ kind: "commit", ref: `fixture.invalid/ados-local@${bootstrapSha}`, description: "Frozen bootstrap." }],
    allowed_scope: ["src/**"],
    forbidden_scope: ["deployment"],
    quality_bar: ["Fail closed."],
    engineering_acceptance: ["All deterministic checks pass."],
    product_acceptance: ["Owner can run the demo."],
    owner_artifact: {
      kind: "demo",
      location: "repository://fixture.invalid/ados-local#docs/OWNER_DEMO.md",
      description: "Sanitized compiled command-line demo.",
    },
    dependencies: ["Node 22.23.x"],
    stop_conditions: ["Stop on contract drift."],
    owner_approval_ref: "fixture://owner/approval/0001",
  };
}

export function validRunEnvelope(): Record<string, unknown> {
  const request = validDeliveryRequest();
  const objective = validObjective();
  const objectiveDigest = hashCanonical(objective);
  const envelope: Record<string, unknown> = {
    schema_version: "run-envelope/v0.2",
    run_id: "run-walking-skeleton-0001",
    generation: 1,
    request: {
      request_id: request.request_id,
      request_ref: "fixture://delivery-request/0001",
      request_digest: request.request_digest,
    },
    objective: {
      objective_id: objective.objective_id,
      project_id: objective.project_id,
      objective_ref: "fixture.invalid/ados-local#1",
      objective_digest: objectiveDigest,
      status: "RUNNING",
    },
    contract_ref: objective.contract_ref,
    project_harness_ref: objective.project_harness_ref,
    project: {
      repository_full_name: "fixture.invalid/ados-local",
      repository_id: "10001",
      base_sha: bootstrapSha,
      default_branch: "main",
      repository_path: "repository://fixture.invalid/ados-local",
      worktree_path: "workspace://synthetic",
      branch_name: "feat/gate0-contract-walking-skeleton-v0.1",
    },
    execution_profile: {
      profile_id: "executor.fake.local",
      profile_version: "0.1.0-public.1",
      adapter_class: "executor.local_agent",
      transport_protocol: "vendor_native",
      transport_version: "fixture/v0.1",
      implementation_identity: "fake-executor@0.1.0",
      capability_digest: zeroDigest,
    },
    agent_autonomy: {
      goal_ref: "fixture://goal/walking-skeleton",
      allowed_to_plan: false,
      allowed_to_iterate: false,
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
      key: "ados-local-fixture-walking-skeleton-v0.1",
      max_active: 1,
      ttl_seconds: 300,
      heartbeat_seconds: 30,
      stale_recovery_requires_reconcile: true,
    },
    scope: {
      allowed_paths: ["src/**", "test/**"],
      forbidden_paths: [".github/workflows/**"],
      limits: {
        max_files: 100,
        max_changed_lines: 10000,
        max_changed_bytes: 1000000,
        allow_binary: false,
        allow_symlink: false,
        allow_mode_change: false,
        allow_submodule: false,
      },
    },
    tool_permissions: [{ capability: "fake_executor", effect: "ALLOW", constraints: { synthetic_only: true } }],
    required_checks: [{
      check_id: "check-core",
      name: "Core deterministic check",
      command: "npm run check",
      timeout_seconds: 300,
      trusted_source_ref: "repository://package.json",
      minimum_trust: "T2",
    }],
    obligations: [
      {
        obligation_id: "engineering-core",
        category: "engineering",
        description: "Core checks pass.",
        evidence_required: "check",
        verifier_id: "verifier.core",
        minimum_trust: "T2",
        initial_status: "PENDING",
      },
      {
        obligation_id: "owner-acceptance",
        category: "owner",
        description: "Owner accepts the candidate.",
        evidence_required: "owner_decision",
        verifier_id: "verifier.owner",
        minimum_trust: "T4",
        initial_status: "PENDING",
      },
    ],
    verifiers: [
      {
        verifier_id: "verifier.core",
        kind: "command",
        trusted_source_ref: "repository://package.json#scripts/check",
        independence: "separate_process",
        trust_level: "T2",
      },
      {
        verifier_id: "verifier.owner",
        kind: "owner",
        trusted_source_ref: "owner://decision",
        independence: "owner",
        trust_level: "T4",
      },
    ],
    approval_gates: [{
      gate_id: "merge",
      trigger: "Any merge action",
      required_authorization: "MERGE",
      decision_owner: "owner",
    }],
    publication: {
      forge_profile_id: "forge.manual.github",
      mode: "draft_pull_request",
      branch_name: "feat/gate0-contract-walking-skeleton-v0.1",
      pull_request_state: "DRAFT",
      allow_merge: false,
      allow_release: false,
      evidence_identity_template: "ados-local:{run_id}:{candidate_revision}",
      max_open_pull_requests: 1,
      candidate_revision_policy: "same_pr_superseding_evidence",
    },
    stop_conditions: ["Stop on contract drift."],
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
      envelope_digest: zeroDigest,
      contract_digest: zeroDigest,
      harness_digest: zeroDigest,
      policy_digest: zeroDigest,
    },
    created_at: "2026-08-02T00:02:00.000Z",
    initial_state: "PREPARED",
  };
  (envelope.digests as Record<string, unknown>).envelope_digest = computeEnvelopeDigest(envelope);
  return envelope;
}

export function validEvidenceManifest(): Record<string, unknown> {
  const objective = validObjective();
  return {
    schema_version: "evidence-manifest/v0.1",
    objective_id: objective.objective_id,
    candidate_id: "candidate-walking-skeleton-0001",
    authorization: "IMPLEMENT",
    objective_status: "OWNER_REVIEW",
    contract_ref: objective.contract_ref,
    project_harness_ref: objective.project_harness_ref,
    inputs: [{ kind: "commit", ref: `fixture.invalid/ados-local@${bootstrapSha}`, description: "Bootstrap input." }],
    changes: [{ path: "src/fixture.ts", change_type: "added", summary: "Synthetic fixture.", bytes_changed: 100 }],
    change_accounting: { method: "git diff --numstat", total_changed_bytes: 100, limit_bytes: 1000000 },
    engineering_checks: [{ name: "check", command: "npm run check", status: "PASS", evidence_ref: "fixture://check/0001" }],
    owner_artifact: {
      kind: "demo",
      location: "repository://fixture.invalid/ados-local#docs/OWNER_DEMO.md",
      description: "Sanitized compiled walking skeleton.",
    },
    product_acceptance_status: "PENDING_OWNER",
    owner_acceptance_ref: null,
    blockers: [],
    stop_conditions: [],
    publication: {
      identity_key: "ados-local:run-walking-skeleton-0001:1",
      state: "DRAFT_OPEN",
      branch_refs: ["feat/gate0-contract-walking-skeleton-v0.1"],
      candidate_refs: ["candidate-walking-skeleton-0001"],
      pull_request_refs: ["fixture://draft-pr/1"],
      state_writeback_ref: "fixture://objective/1",
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
    generated_at: "2026-08-02T00:03:00.000Z",
    generator: { name: "ados-local-fixture", version: "0.1.0-public.1" },
  };
}
