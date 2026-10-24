import { hashCanonical } from "../canonical/index.js";
import type { FrozenCompilerProfile, AcceptedCompilerCandidate } from "../compiler/types.js";
import { computeDeliveryRequestDigest, ContractValidator } from "../contracts/validator.js";
import type { ValidatedCapturePack } from "../capture/types.js";
import type { JsonObject, JsonValue } from "../types.js";
import type { DeliveryRequestDraft, OwnerAuthorizationReceipt } from "./types.js";

function intakeId(prefix: string, value: JsonValue): string {
  return `${prefix}-${hashCanonical(value).slice("sha256:".length, "sha256:".length + 32)}`;
}

export function buildDeliveryRequestDraft(
  capture: ValidatedCapturePack,
  candidate: AcceptedCompilerCandidate,
  profile: FrozenCompilerProfile,
): DeliveryRequestDraft {
  if (
    candidate.readiness !== "READY" ||
    candidate.disposition !== "PROPOSE" ||
    candidate.outcome === null ||
    candidate.requested_authorization === null ||
    candidate.open_decisions.length !== 0
  ) {
    throw new Error("BLOCKED_INTAKE:COMPILER_CANDIDATE_NOT_READY");
  }
  const requestId = intakeId("dr", {
    capture_digest: capture.capture_digest,
    candidate_digest: candidate.candidate_digest,
    compiler_capability_digest: profile.capability_digest,
  });
  const request: JsonObject = {
    schema_version: "ados-delivery-request/v0.2",
    request_id: requestId,
    captured_at: capture.pack.captured_at,
    capture: {
      adapter_id: capture.pack.capture_profile_id,
      adapter_version: capture.pack.capture_profile_version,
      platform: "chatgpt-web",
      conversation_ref: capture.conversation_ref,
      selected_turn_digest: capture.selected_turn_digest,
      owner_turn_digest: capture.owner_turn_digest,
      role_summary: capture.role_summary as unknown as JsonValue,
      retention: "minimized_only",
    },
    compiler: {
      compiler_version: "gate0a-integration/v0.1",
      rules_version: "delivery-request/v0.2",
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      capability_digest: profile.capability_digest,
      model_ref: `${profile.model_provider}/${profile.model}`,
    },
    outcome: candidate.outcome,
    why_now: "The Owner selected this visible conversation window for local pre-dispatch intake and explicit confirmation.",
    owner_decisions: candidate.owner_decisions.map((item) => item.decision),
    assumptions: [...candidate.assumptions],
    open_decisions: [],
    requested_authorization: candidate.requested_authorization,
    target_hint: {
      delivery_class: "unknown",
      project_id: null,
      repository: null,
    },
    allowed_scope_hints: [],
    forbidden_scope_hints: [
      "No Objective, Run, dispatch, Codex execution, target repository mutation, Merge, Release or Deploy is authorized by this intake.",
    ],
    quality_bar: [
      "Preserve exact grounded Owner decisions, bind all identities locally, and stop at APPROVED_NOT_DISPATCHED.",
    ],
    acceptance: {
      engineering: [
        "Create one immutable request, one authenticated local_extension_confirm Receipt and one durable Activation atomically.",
      ],
      product: [
        "Restore the same Receipt and Activation after Browser or Native Host interruption without dispatch.",
      ],
      owner_artifact: {
        kind: "demo",
        description: "Trusted extension Side Panel showing the exact approved request and APPROVED_NOT_DISPATCHED identity.",
      },
    },
    risk_flags: ["sensitive_data"],
    readiness: candidate.assumptions.length === 0 ? "READY" : "READY_WITH_ASSUMPTIONS",
    request_digest: `sha256:${"0".repeat(64)}`,
  };
  const digest = computeDeliveryRequestDigest(request);
  request.request_digest = digest;
  return { request, request_id: requestId, request_digest: digest };
}

export function finalizeDeliveryRequest(
  draft: DeliveryRequestDraft,
  receipt: OwnerAuthorizationReceipt,
  validator = new ContractValidator(),
): JsonObject {
  if (receipt.request_digest !== draft.request_digest) {
    throw new Error("BLOCKED_RECEIPT:REQUEST_DIGEST_MISMATCH");
  }
  const capture = draft.request.capture as JsonObject;
  if (receipt.owner_turn_digest !== capture.owner_turn_digest) {
    throw new Error("BLOCKED_RECEIPT:OWNER_TURN_DIGEST_MISMATCH");
  }
  const request = structuredClone(draft.request);
  request.owner_authorization_receipt = receipt as unknown as JsonValue;
  const result = validator.validateDeliveryRequest(request, true);
  if (!result.valid) {
    throw new Error(`BLOCKED_RECEIPT:DELIVERY_REQUEST_INVALID:${result.errors.join("|")}`);
  }
  return request;
}
