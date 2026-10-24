import { hashCanonical } from "../canonical/index.js";
import { ContractValidator } from "../contracts/validator.js";
import {
  validDeliveryRequest,
  validEvidenceManifest,
  validObjective,
  validRunEnvelope,
} from "../contracts/fixture-data.js";
import {
  EventStore,
  type OwnerReceiptInput,
  type StoreSummary,
  type VerifierReceiptInput,
} from "../storage/event-store.js";
import type { JsonValue, RunSeed } from "../types.js";
import { runT2Verifier } from "../verifiers/process-verifier.js";

export interface ExecutorPort {
  emitT0Claim(claim: string): void;
}

export class FakeExecutor {
  public run(port: ExecutorPort): void {
    port.emitT0Claim("Synthetic implementation candidate produced; independent verification required.");
  }
}

export interface WalkingSkeletonResult {
  readonly request_digest: string;
  readonly receipt_digest: string;
  readonly receipt_binding: "PASS";
  readonly objective_ref: string;
  readonly envelope_digest: string;
  readonly run_id: string;
  readonly contracts: {
    readonly delivery_request: string;
    readonly objective: string;
    readonly envelope: string;
    readonly evidence: string;
  };
  readonly created_disposition: string;
  readonly state_before_owner_acceptance: "OWNER_REVIEW";
  readonly final_state: "OWNER_REVIEW" | "DONE";
  readonly fake_executor_trust: "T0";
  readonly independent_verifier_trust: "T2";
  readonly owner_acceptance_trust: "T4" | "NOT_RUN";
  readonly event_timeline: ReturnType<EventStore["eventTimeline"]>;
  readonly verifier_receipts: ReturnType<EventStore["verifierReceipts"]>;
  readonly evidence: {
    readonly evidence_id: string;
    readonly evidence_digest: string;
    readonly artifact_path: string;
  };
  readonly gate_results: {
    readonly gate0s: "NOT_RUN";
    readonly gate0a: "NOT_RUN";
    readonly gate0b: "NOT_RUN";
  };
  readonly fixture_t4_simulated: boolean;
  readonly real_objective: "AWAITS_OWNER_REVIEW";
  readonly summary: StoreSummary;
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("FIXTURE_FIELD_NOT_STRING");
  }
  return value;
}

function simulatedOwnerReceipt(
  obligationId: string,
  verifierId: string,
): VerifierReceiptInput {
  return {
    verifier_receipt_id: `vr-${obligationId}`,
    obligation_id: obligationId,
    verifier_id: verifierId,
    trust_level: "T4",
    result: "PASS",
    input_digest: hashCanonical({ obligation_id: obligationId, candidate: "synthetic-v1" }),
    result_digest: hashCanonical({ obligation_id: obligationId, result: "PASS", trust: "T4" }),
    evidence_ref: `fixture://verifier/${obligationId}`,
  };
}

export function deterministicClock(): () => string {
  let tick = 0;
  return () => {
    const result = new Date(Date.UTC(2026, 7, 2, 1, 0, tick)).toISOString();
    tick += 1;
    return result;
  };
}

export function deterministicIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix) => {
    const count = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, count);
    return `${prefix}-fixture-${String(count).padStart(4, "0")}`;
  };
}

export function runWalkingSkeleton(
  store: EventStore,
  includeSyntheticOwnerAcceptance = false,
): WalkingSkeletonResult {
  const validator = new ContractValidator();
  const request = validDeliveryRequest();
  const objective = validObjective();
  const envelope = validRunEnvelope();
  const evidenceManifest = validEvidenceManifest();

  const requestValidation = validator.validateDeliveryRequest(request);
  const objectiveValidation = validator.validateSchema("objective-record", objective);
  const envelopeValidation = validator.validateRunEnvelope(envelope);
  const evidenceValidation = validator.validateEvidenceBindings(
    evidenceManifest,
    objective,
    envelope,
  );
  for (const [name, result] of [
    ["delivery_request", requestValidation],
    ["objective", objectiveValidation],
    ["envelope", envelopeValidation],
    ["evidence", evidenceValidation],
  ] as const) {
    if (!result.valid) {
      throw new Error(`CONTRACT_FIXTURE_INVALID:${name}:${result.errors.join("|")}`);
    }
  }

  const envelopeObjective = envelope.objective as Record<string, unknown>;
  const envelopeDigests = envelope.digests as Record<string, unknown>;
  const seed: RunSeed = {
    run_id: asString(envelope.run_id),
    request_id: asString(request.request_id),
    objective_id: asString(objective.objective_id),
    objective_ref: asString(envelopeObjective.objective_ref),
    request_digest: asString(request.request_digest),
    objective_digest: asString(envelopeObjective.objective_digest),
    envelope_digest: asString(envelopeDigests.envelope_digest),
    generation: 1,
    lease_key: asString(objective.objective_id),
    holder_id: "coordinator-fixture",
    ttl_seconds: 300,
    obligations: [
      {
        obligation_id: "engineering-core",
        category: "engineering",
        verifier_id: "verifier.core",
        minimum_trust: "T2",
      },
      {
        obligation_id: "product-demo",
        category: "product_candidate",
        verifier_id: "verifier.product",
        minimum_trust: "T2",
      },
      {
        obligation_id: "publication-draft",
        category: "publication",
        verifier_id: "verifier.publication",
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
  const created = store.createRun(seed);
  const token = created.lease.fencing_token;
  const holder = created.lease.holder_id;

  const ownerReceipt = request.owner_authorization_receipt as unknown as OwnerReceiptInput;
  const receiptDigest = store.recordOwnerApproval(
    seed.run_id,
    holder,
    token,
    ownerReceipt,
    `${seed.run_id}:owner-approval`,
  );
  store.transition(
    seed.run_id,
    "PREPARED",
    "EXECUTING",
    holder,
    token,
    `${seed.run_id}:executing`,
  );

  const fakeExecutor = new FakeExecutor();
  fakeExecutor.run({
    emitT0Claim: (claim) => {
      store.recordAgentClaim(
        seed.run_id,
        holder,
        token,
        claim,
        `${seed.run_id}:agent-claim`,
      );
    },
  });

  store.transition(
    seed.run_id,
    "EXECUTING",
    "VERIFYING",
    holder,
    token,
    `${seed.run_id}:verifying`,
  );
  store.satisfyObligation(
    seed.run_id,
    holder,
    token,
    runT2Verifier({
      obligation_id: "engineering-core",
      verifier_id: "verifier.core",
      candidate_digest: hashCanonical({ candidate: "synthetic-v1", check: "engineering-core" }),
    }),
    `${seed.run_id}:verify-engineering`,
  );
  store.satisfyObligation(
    seed.run_id,
    holder,
    token,
    runT2Verifier({
      obligation_id: "product-demo",
      verifier_id: "verifier.product",
      candidate_digest: hashCanonical({ candidate: "synthetic-v1", check: "product-demo" }),
    }),
    `${seed.run_id}:verify-product`,
  );
  const candidateDigest = hashCanonical({
    run_id: seed.run_id,
    revision: 1,
    artifact: "walking-skeleton",
  });
  store.recordArtifact(
    seed.run_id,
    holder,
    token,
    {
      artifact_id: "artifact-walking-skeleton-0001",
      kind: "demo",
      location: "repository://fixture.invalid/ados-local#docs/OWNER_DEMO.md",
      artifact_digest: candidateDigest,
    },
    `${seed.run_id}:artifact`,
  );
  const evidenceDigest = store.recordEvidence(
    seed.run_id,
    holder,
    token,
    {
      evidence_id: "evidence-walking-skeleton-0001",
      candidate_revision: 1,
      request_digest: seed.request_digest,
      objective_digest: seed.objective_digest,
      envelope_digest: seed.envelope_digest,
      candidate_digest: candidateDigest,
      product_acceptance_status: "PENDING_OWNER",
    },
    `${seed.run_id}:evidence`,
  );
  store.transition(
    seed.run_id,
    "VERIFYING",
    "PUBLISHING",
    holder,
    token,
    `${seed.run_id}:publishing`,
  );
  store.satisfyObligation(
    seed.run_id,
    holder,
    token,
    runT2Verifier({
      obligation_id: "publication-draft",
      verifier_id: "verifier.publication",
      candidate_digest: hashCanonical({ candidate: "synthetic-v1", check: "publication-draft" }),
    }),
    `${seed.run_id}:verify-publication`,
  );
  store.transition(
    seed.run_id,
    "PUBLISHING",
    "OWNER_REVIEW",
    holder,
    token,
    `${seed.run_id}:owner-review`,
  );
  const stateBeforeOwnerAcceptance = store.getRun(seed.run_id).state;
  if (stateBeforeOwnerAcceptance !== "OWNER_REVIEW") {
    throw new Error(`OWNER_REVIEW_NOT_REACHED:${stateBeforeOwnerAcceptance}`);
  }

  if (includeSyntheticOwnerAcceptance) {
    store.satisfyObligation(
      seed.run_id,
      holder,
      token,
      simulatedOwnerReceipt("owner-acceptance", "verifier.owner"),
      `${seed.run_id}:synthetic-owner-acceptance`,
    );
    store.transition(
      seed.run_id,
      "OWNER_REVIEW",
      "DONE",
      holder,
      token,
      `${seed.run_id}:done`,
    );
  }

  store.verifyEventChain();
  store.verifyProjectionConsistency();
  store.integrity();
  const finalState = store.getRun(seed.run_id).state;
  if (finalState !== "OWNER_REVIEW" && finalState !== "DONE") {
    throw new Error(`UNEXPECTED_FINAL_STATE:${finalState}`);
  }
  return {
    request_digest: seed.request_digest,
    receipt_digest: receiptDigest,
    receipt_binding: "PASS",
    objective_ref: asString(envelopeObjective.objective_ref),
    envelope_digest: seed.envelope_digest,
    run_id: seed.run_id,
    contracts: {
      delivery_request: requestValidation.input_digest,
      objective: objectiveValidation.input_digest,
      envelope: envelopeValidation.input_digest,
      evidence: evidenceValidation.input_digest,
    },
    created_disposition: created.disposition,
    state_before_owner_acceptance: stateBeforeOwnerAcceptance,
    final_state: finalState,
    fake_executor_trust: "T0",
    independent_verifier_trust: "T2",
    owner_acceptance_trust: includeSyntheticOwnerAcceptance ? "T4" : "NOT_RUN",
    event_timeline: store.eventTimeline(seed.run_id),
    verifier_receipts: store.verifierReceipts(seed.run_id),
    evidence: {
      evidence_id: "evidence-walking-skeleton-0001",
      evidence_digest: evidenceDigest,
      artifact_path: "repository://fixture.invalid/ados-local#docs/OWNER_DEMO.md",
    },
    gate_results: { gate0s: "NOT_RUN", gate0a: "NOT_RUN", gate0b: "NOT_RUN" },
    fixture_t4_simulated: includeSyntheticOwnerAcceptance,
    real_objective: "AWAITS_OWNER_REVIEW",
    summary: store.summary(seed.run_id),
  };
}

export function fixtureDigests(): readonly string[] {
  return [
    hashCanonical(validDeliveryRequest()),
    hashCanonical(validObjective()),
    hashCanonical(validRunEnvelope() as JsonValue),
    hashCanonical(validEvidenceManifest() as JsonValue),
  ];
}
