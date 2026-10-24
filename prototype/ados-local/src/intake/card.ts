import { hashCanonical } from "../canonical/index.js";
import type { ValidatedCapturePack } from "../capture/types.js";
import type { AcceptedCompilerCandidate, FrozenCompilerProfile } from "../compiler/types.js";
import type { JsonObject } from "../types.js";
import type { DeliveryCard, DeliveryRequestDraft } from "./types.js";

function short(value: string): string {
  return value.startsWith("sha256:") ? value.slice(7, 19) : value.slice(0, 12);
}

export function buildDeliveryCard(
  draft: DeliveryRequestDraft,
  capture: ValidatedCapturePack,
  candidate: AcceptedCompilerCandidate,
  profile: FrozenCompilerProfile,
  repairBinding?: NonNullable<DeliveryCard["repair_binding"]>,
): DeliveryCard {
  const request = draft.request;
  const acceptance = request.acceptance as JsonObject;
  return {
    schema_version: "slice3a-delivery-card/v0.1",
    request_id: draft.request_id,
    outcome: String(request.outcome),
    owner_decisions: candidate.owner_decisions.map((item) => ({
      decision: item.decision,
      source_turn_id: item.source_turn_id,
      source_quote: item.source_quote,
    })),
    assumptions: candidate.assumptions,
    open_decisions: candidate.open_decisions,
    readiness: candidate.assumptions.length === 0 ? "READY" : "READY_WITH_ASSUMPTIONS",
    requested_authorization: candidate.requested_authorization!,
    target_hint: repairBinding === undefined
      ? "UNVERIFIED"
      : "EXACT_EXISTING_SLICE4_REPAIR_IDENTITIES",
    ...(repairBinding === undefined ? {} : { repair_binding: repairBinding }),
    allowed_scope_hints: request.allowed_scope_hints as string[],
    forbidden_scope_hints: request.forbidden_scope_hints as string[],
    quality_bar: request.quality_bar as string[],
    engineering_acceptance: (acceptance.engineering ?? []) as string[],
    product_acceptance: (acceptance.product ?? []) as string[],
    risk_flags: request.risk_flags as string[],
    capture_profile: `${capture.pack.capture_profile_id}@${capture.pack.capture_profile_version}`,
    compiler_profile: `${profile.profile_id}@${profile.profile_version}`,
    digest_short_codes: {
      selected_turn: short(capture.selected_turn_digest),
      owner_turn: short(capture.owner_turn_digest),
      candidate: short(candidate.candidate_digest),
      request: short(draft.request_digest),
    },
    consequence: "APPROVED_NOT_DISPATCHED",
    authority_notice: repairBinding === undefined
      ? "NO_OBJECTIVE_NO_RUN_NO_DISPATCH_NO_TARGET_MUTATION"
      : "CONFIRM_AUTHORIZES_EXACT_BOUND_REPAIR_AFTER_RECEIPT_ACTIVATION",
  };
}

export function deliveryCardDigest(card: DeliveryCard): string {
  return hashCanonical(card as unknown as JsonObject);
}
