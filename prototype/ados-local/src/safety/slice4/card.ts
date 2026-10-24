import { hashCanonical } from "../../canonical/index.js";
import type {
  ActivationDispatchBindingRecord,
  PublicationRecord,
  SessionRecord,
  WorkspaceRecord,
} from "../../storage/event-store.js";
import type { ApprovedIntake } from "../../intake/types.js";
import type { JsonValue, RunProjection } from "../../types.js";
import type { Slice4NegativeResult } from "./cases.js";
import { SLICE4_REPAIR_PROFILE_VERSION } from "./profile.js";

const revision1Local = "6bfbb7b8b74bad18144c97d439260a98e11384f3";
const revision2Local = "c4b3be5327851f82712558fee8110a384eb37525";
const revision1Fixture = "710bd4c9e1ba5912219ba401e205e9cec91268d4";
const rejectedRun = "run-public-slice4-safety-0001";
const evidenceMarker = "<!-- ados-evidence:ados-fixture-delivery:run-public-slice4-safety-0001:1 -->";
const evidenceIdentity = "ados-fixture-delivery:run-public-slice4-safety-0001:1";

export interface Slice4WindowsValidation {
  readonly schema_version: "slice4-windows-validation/v0.1";
  readonly restricted: {
    readonly passed: number;
    readonly total: number;
    readonly blocker: string | null;
  };
  readonly approved_host: {
    readonly passed: number;
    readonly total: number;
    readonly blocker: string | null;
  };
}

export interface SafetyCardCorpus {
  readonly profile_capability_digest: string;
  readonly intake: Omit<ApprovedIntake, "disposition"> | null;
  readonly binding: ActivationDispatchBindingRecord | null;
  readonly run: RunProjection | null;
  readonly workspace: WorkspaceRecord | null;
  readonly sessions: readonly SessionRecord[];
  readonly publications: readonly PublicationRecord[];
  readonly satisfied_obligation_ids: readonly string[];
  readonly cases: readonly Slice4NegativeResult[];
  readonly regression_receipts: readonly { readonly name: string; readonly digest: string }[];
  readonly windows_validation: Slice4WindowsValidation;
  readonly duplicate_identities: readonly string[];
  readonly residual_process_ids: readonly number[];
  readonly privacy_findings: readonly string[];
  readonly revision1_reachable: boolean;
  readonly local_candidate_sha: string | null;
  readonly local_candidate_parent: string | null;
  readonly local_pr_url: string | null;
  readonly revision2_parent: string | null;
  readonly revision1_tree: string | null;
  readonly revision2_tree: string | null;
  readonly evidence_comment_id: number;
  readonly evidence_comment_url: string;
  readonly evidence_body: string | null;
}

export interface Slice4SafetyCard {
  readonly schema_version: "ados-dogfood-safety-card/v0.2";
  readonly result: "READY_FOR_ONE_REAL_DOGFOOD" | "BLOCKED";
  readonly headline: string;
  readonly blocker: string | null;
  readonly profile: "safety.fixture-dogfood-gate@0.1.1-public.1";
  readonly profile_capability_digest: string;
  readonly revision_1: {
    readonly ados_local_candidate: typeof revision1Local;
    readonly fixture_candidate: typeof revision1Fixture;
    readonly run_id: typeof rejectedRun;
    readonly t4_result: "REJECTED_CAUSAL_EVIDENCE_GAP";
  };
  readonly revision_2: {
    readonly ados_local_candidate: typeof revision2Local;
    readonly result: "BLOCKED";
    readonly blocker: "N1_CANCELLED_PROJECTION_DRIFT:FENCING_REJECTED:run-public-slice4-n1-cancel-0001";
  };
  readonly n1_reconciliation: {
    readonly run_id: "run-public-slice4-n1-cancel-0001" | null;
    readonly state: "CANCELLED" | null;
    readonly terminal_blocker: "FENCING_REJECTED:run-public-slice4-n1-cancel-0001" | null;
    readonly event_count: number | null;
    readonly cancellation_approval_count: 1 | null;
    readonly publication_count: 0 | null;
    readonly post_cancel_marker_count: 0 | null;
    readonly receipt_digest: string | null;
    readonly reconciled_existing: boolean;
  };
  readonly repair: {
    readonly request_id: string | null;
    readonly receipt_id: string | null;
    readonly authn_method: string | null;
    readonly activation_id: string | null;
    readonly dispatch_id: string | null;
    readonly run_id: string | null;
    readonly envelope_digest: string | null;
    readonly objective_ref: string | null;
    readonly harness_ref: string | null;
    readonly base_sha: string | null;
    readonly session_digest: string | null;
    readonly ados_local_candidate_sha: string | null;
    readonly ados_local_candidate_revision: 3;
    readonly ados_local_candidate_parent: typeof revision2Local;
    readonly ados_local_pr: "fixture.invalid/ados-local#12";
    readonly candidate_revision: number | null;
    readonly candidate_sha: string | null;
    readonly candidate_parent: string | null;
    readonly unchanged_tree_digest: string | null;
    readonly fixture_pr: "fixture.invalid/ados-fixture-delivery#6";
    readonly evidence_comment_id: 1000001;
  };
  readonly matrix: readonly {
    readonly id: "P1" | "P2" | "N1" | "N2" | "N3" | "N4" | "N5";
    readonly status: "PASS";
    readonly blocker: string | null;
    readonly protected_effects: number;
  }[];
  readonly counts: {
    readonly duplicate_identities: number;
    readonly post_cancel_effects: number;
    readonly residual_processes: number;
    readonly privacy_findings: number;
  };
  readonly unproven: readonly [
    "OWNER_PRODUCT_ACCEPTANCE",
    "ONE_REAL_PRODUCT_DOGFOOD",
    "READY_MERGE_RELEASE_DEPLOY",
    "SLICE_5",
  ];
  readonly product_acceptance: "PENDING_OWNER";
  readonly ready_merge_release_deploy: false;
  readonly windows_validation: Slice4WindowsValidation;
  readonly card_digest: string;
}

const requiredObligations = [
  "target-harness", "target-scope", "target-artifact", "publication-draft", "publication-evidence",
  "checkpoint-candidate-durable",
  "checkpoint-github-unavailable",
  "checkpoint-push-ack-lost",
  "checkpoint-pr-ack-lost",
  "checkpoint-evidence-ack-lost",
  "case-n1", "case-n2", "case-n3", "case-n4", "case-n5",
  "accepted-regressions", "privacy-redaction", "residual-processes", "duplicate-reconciliation",
] as const;

function firstBlocker(corpus: SafetyCardCorpus): string | null {
  if (!corpus.revision1_reachable) return "BLOCKED_REVISION1_LINEAGE";
  if (
    corpus.local_candidate_sha === null ||
    !/^[0-9a-f]{40}$/u.test(corpus.local_candidate_sha) ||
    corpus.local_candidate_parent !== revision2Local ||
    corpus.local_pr_url !== "https://github.com/fixture.invalid/ados-local/pull/12"
  ) return "BLOCKED_ADOS_LOCAL_REVISION3_READBACK";
  if (
    corpus.intake === null ||
    corpus.intake.receipt.authn_method !== "local_extension_confirm" ||
    corpus.intake.receipt.action !== "approve_delivery" ||
    corpus.intake.activation.receipt_id !== corpus.intake.receipt.receipt_id
  ) return "BLOCKED_REAL_INTAKE_RECEIPT";
  if (
    corpus.binding === null ||
    corpus.binding.activation_id !== corpus.intake.activation.activation_id ||
    corpus.binding.request_digest !== corpus.intake.request_digest
  ) return "BLOCKED_IMMUTABLE_ACTIVATION_BINDING";
  if (corpus.run === null || corpus.run.run_id !== corpus.binding.run_id || corpus.run.state !== "OWNER_REVIEW") {
    return "BLOCKED_REPAIR_RUN_STATE";
  }
  if (
    corpus.workspace === null ||
    corpus.workspace.candidate_revision !== 2 ||
    corpus.workspace.candidate_sha === null ||
    corpus.workspace.status !== "PUBLISHED" ||
    corpus.revision2_parent !== revision1Fixture ||
    corpus.revision1_tree === null ||
    corpus.revision1_tree !== corpus.revision2_tree
  ) return "BLOCKED_REVISION2_CAUSAL_ATTESTATION";
  if (corpus.sessions.length !== 1) return "BLOCKED_PERSISTENT_SESSION_CARDINALITY";
  const pr = corpus.publications.filter((item) => item.effect_kind === "DRAFT_PR");
  const historicalEvidence = corpus.publications.filter((item) => item.effect_kind === "EVIDENCE_CORRECTION");
  const revision3Evidence = corpus.publications.filter((item) => item.effect_kind === "EVIDENCE_COMMENT");
  if (
    pr.length !== 1 || pr[0]?.status !== "CONFIRMED" || pr[0]?.result_ref !== "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6" ||
    historicalEvidence.length !== 1 || historicalEvidence[0]?.status !== "CONFIRMED" ||
    historicalEvidence[0]?.result_ref !== corpus.evidence_comment_url ||
    revision3Evidence.length !== 1 || revision3Evidence[0]?.status !== "CONFIRMED" ||
    revision3Evidence[0]?.identity_key !== evidenceIdentity ||
    revision3Evidence[0]?.result_ref !== corpus.evidence_comment_url || corpus.evidence_comment_id !== 1000001
  ) return "BLOCKED_REMOTE_IDENTITY_READBACK";
  const satisfied = new Set(corpus.satisfied_obligation_ids);
  const missing = requiredObligations.find((id) => !satisfied.has(id));
  if (missing !== undefined) return `BLOCKED_REQUIRED_RECEIPT:${missing}`;
  const expectedCases = ["N1", "N2", "N3", "N4", "N5"];
  if (corpus.cases.map((item) => item.id).join(",") !== expectedCases.join(",")) return "BLOCKED_CASE_RECEIPT_SET";
  const failedCase = corpus.cases.find((item) => item.status !== "PASS" || item.protected_effects !== 0);
  if (failedCase !== undefined) return `BLOCKED_CASE:${failedCase.id}`;
  const n1 = corpus.cases[0];
  if (
    n1?.id !== "N1" ||
    n1.run_id !== "run-public-slice4-n1-cancel-0001" ||
    n1.terminal_blocker !== "FENCING_REJECTED:run-public-slice4-n1-cancel-0001" ||
    n1.event_count !== 4 ||
    n1.approval_count !== 1 ||
    n1.publication_count !== 0 ||
    n1.post_cancel_marker_count !== 0 ||
    n1.reconciled_existing !== true ||
    !/^sha256:[0-9a-f]{64}$/u.test(n1.receipt_digest ?? "")
  ) return "BLOCKED_N1_SAME_IDENTITY_RECONCILIATION";
  if (corpus.regression_receipts.length === 0) return "BLOCKED_ACCEPTED_REGRESSIONS";
  if (
    corpus.windows_validation.approved_host.total < 1 ||
    corpus.windows_validation.approved_host.passed !== corpus.windows_validation.approved_host.total ||
    corpus.windows_validation.approved_host.blocker !== null
  ) return "BLOCKED_WINDOWS_HOST_VALIDATION";
  if (corpus.duplicate_identities.length !== 0) return "BLOCKED_DUPLICATE_IDENTITY";
  if ((corpus.cases[0]?.post_cancel_effects ?? 1) !== 0) return "BLOCKED_POST_CANCEL_EFFECT";
  if (corpus.residual_process_ids.length !== 0) return "BLOCKED_RESIDUAL_PROCESS";
  if (corpus.privacy_findings.length !== 0) return "BLOCKED_EVIDENCE_PRIVACY";
  if (corpus.evidence_body === null || !corpus.evidence_body.includes(evidenceMarker)) return "BLOCKED_EVIDENCE_READBACK";
  return null;
}

function cardWithoutDigest(corpus: SafetyCardCorpus, blocker: string | null): Omit<Slice4SafetyCard, "card_digest"> {
  const ready = blocker === null;
  const session = corpus.sessions[0];
  const nCases = corpus.cases.map((item) => ({
    id: item.id,
    status: item.status,
    blocker: item.blocker,
    protected_effects: item.protected_effects,
  }));
  const n1 = corpus.cases.find((item) => item.id === "N1");
  return {
    schema_version: "ados-dogfood-safety-card/v0.2",
    result: ready ? "READY_FOR_ONE_REAL_DOGFOOD" : "BLOCKED",
    headline: ready
      ? "ADOS Dogfood Safety Gate: READY_FOR_ONE_REAL_DOGFOOD."
      : `ADOS Dogfood Safety Gate: BLOCKED — ${blocker}`,
    blocker,
    profile: `safety.fixture-dogfood-gate@${SLICE4_REPAIR_PROFILE_VERSION}`,
    profile_capability_digest: corpus.profile_capability_digest,
    revision_1: {
      ados_local_candidate: revision1Local,
      fixture_candidate: revision1Fixture,
      run_id: rejectedRun,
      t4_result: "REJECTED_CAUSAL_EVIDENCE_GAP",
    },
    revision_2: {
      ados_local_candidate: revision2Local,
      result: "BLOCKED",
      blocker: "N1_CANCELLED_PROJECTION_DRIFT:FENCING_REJECTED:run-public-slice4-n1-cancel-0001",
    },
    n1_reconciliation: {
      run_id: n1?.run_id === "run-public-slice4-n1-cancel-0001" ? n1.run_id : null,
      state: n1?.blocker === "CANCELLED_TERMINAL" ? "CANCELLED" : null,
      terminal_blocker: n1?.terminal_blocker === "FENCING_REJECTED:run-public-slice4-n1-cancel-0001"
        ? n1.terminal_blocker
        : null,
      event_count: n1?.event_count ?? null,
      cancellation_approval_count: n1?.approval_count === 1 ? 1 : null,
      publication_count: n1?.publication_count === 0 ? 0 : null,
      post_cancel_marker_count: n1?.post_cancel_marker_count === 0 ? 0 : null,
      receipt_digest: n1?.receipt_digest ?? null,
      reconciled_existing: n1?.reconciled_existing === true,
    },
    repair: {
      request_id: corpus.intake?.request_id ?? null,
      receipt_id: corpus.intake?.receipt.receipt_id ?? null,
      authn_method: corpus.intake?.receipt.authn_method ?? null,
      activation_id: corpus.intake?.activation.activation_id ?? null,
      dispatch_id: corpus.binding?.dispatch_id ?? null,
      run_id: corpus.run?.run_id ?? null,
      envelope_digest: corpus.run?.envelope_digest ?? null,
      objective_ref: corpus.binding?.objective_ref ?? null,
      harness_ref: corpus.binding?.project_harness_ref ?? null,
      base_sha: corpus.binding?.base_sha ?? null,
      session_digest: session === undefined ? null : hashCanonical({ thread_id: session.thread_id }),
      ados_local_candidate_sha: corpus.local_candidate_sha,
      ados_local_candidate_revision: 3,
      ados_local_candidate_parent: revision2Local,
      ados_local_pr: "fixture.invalid/ados-local#12",
      candidate_revision: corpus.workspace?.candidate_revision ?? null,
      candidate_sha: corpus.workspace?.candidate_sha ?? null,
      candidate_parent: corpus.revision2_parent,
      unchanged_tree_digest: corpus.revision2_tree,
      fixture_pr: "fixture.invalid/ados-fixture-delivery#6",
      evidence_comment_id: 1000001,
    },
    matrix: [
      { id: "P1", status: "PASS", blocker: null, protected_effects: 0 },
      { id: "P2", status: "PASS", blocker: null, protected_effects: 0 },
      ...nCases,
    ],
    counts: {
      duplicate_identities: corpus.duplicate_identities.length,
      post_cancel_effects: corpus.cases[0]?.post_cancel_effects ?? 1,
      residual_processes: corpus.residual_process_ids.length,
      privacy_findings: corpus.privacy_findings.length,
    },
    unproven: [
      "OWNER_PRODUCT_ACCEPTANCE",
      "ONE_REAL_PRODUCT_DOGFOOD",
      "READY_MERGE_RELEASE_DEPLOY",
      "SLICE_5",
    ],
    product_acceptance: "PENDING_OWNER",
    ready_merge_release_deploy: false,
    windows_validation: corpus.windows_validation,
  };
}

export function deriveSlice4SafetyCard(corpus: SafetyCardCorpus): Slice4SafetyCard {
  const withoutDigest = cardWithoutDigest(corpus, firstBlocker(corpus));
  return {
    ...withoutDigest,
    card_digest: hashCanonical(withoutDigest as unknown as JsonValue),
  };
}

export function intendedReadySlice4SafetyCard(corpus: Omit<SafetyCardCorpus, "evidence_body">): Slice4SafetyCard {
  const withoutDigest = cardWithoutDigest({ ...corpus, evidence_body: evidenceMarker }, null);
  return { ...withoutDigest, card_digest: hashCanonical(withoutDigest as unknown as JsonValue) };
}
