import type { JsonObject } from "../types.js";

export interface DeliveryRequestDraft {
  readonly request: JsonObject;
  readonly request_id: string;
  readonly request_digest: string;
}

export interface OwnerAuthorizationReceipt {
  readonly receipt_id: string;
  readonly actor_id: string;
  readonly authn_method: "local_extension_confirm";
  readonly action: "approve_delivery";
  readonly authorization: "DISCOVERY" | "PLAN" | "IMPLEMENT" | "MERGE" | "RELEASE";
  readonly approval_ref: string;
  readonly owner_turn_digest: string;
  readonly request_digest: string;
  readonly approved_at: string;
}

export interface ChallengeBinding {
  readonly challenge_id: string;
  readonly nonce_digest: string;
  readonly extension_origin: string;
  readonly actor_id: string;
  readonly card_digest: string;
  readonly capture_digest: string;
  readonly selected_turn_digest: string;
  readonly compiler_candidate_digest: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly owner_turn_digest: string;
  readonly requested_authorization: OwnerAuthorizationReceipt["authorization"];
  readonly capture_profile_id: string;
  readonly capture_profile_version: string;
  readonly compiler_profile_id: string;
  readonly compiler_profile_version: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export interface ChallengeResponse {
  readonly challenge: ChallengeBinding;
  readonly challenge_token: string;
}

export interface ConfirmationRevalidation {
  readonly schema_version: "slice3b-confirmation-revalidation/v0.1";
  readonly local_objective_ref: "fixture.invalid/ados-local#9" | "fixture.invalid/ados-local#11";
  readonly local_objective_digest: string;
  readonly target_objective_ref: "fixture.invalid/ados-fixture-delivery#3" | "fixture.invalid/ados-fixture-delivery#5";
  readonly target_objective_digest: string;
  readonly target_resolution_digest: string;
  readonly target_harness_digest: string;
  readonly target_base_sha:
    | "e75d162750acf4775a7a1ba1d1955ca9d60bc73f"
    | "4e772e775cbc843420c8580fcff8a85c92754bdd";
  readonly compiler_profile_digest: string;
  readonly compiler_capability_digest: string;
}

export interface JitConfirmationBinding {
  readonly schema_version: "slice3b-jit-confirmation-binding/v0.1";
  readonly original_challenge_id: string;
  readonly original_challenge_digest: string;
  readonly original_challenge_token_digest: string;
  readonly extension_origin: string;
  readonly actor_id: string;
  readonly card_digest: string;
  readonly capture_digest: string;
  readonly compiler_candidate_digest: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly nonce_digest: string;
  readonly revalidation: ConfirmationRevalidation;
  readonly issued_at: string;
  readonly expires_at: string;
}

export interface JitConfirmationResponse {
  readonly status: "READY_TO_CONFIRM";
  readonly jit_binding: JitConfirmationBinding;
  readonly jit_token: string;
}

export interface DurableReadyCardIdentity {
  readonly challenge_id: string;
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly compiler_candidate_digest: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly card_digest: string;
  readonly capture_digest: string;
  readonly compiler_profile_id: "compiler.codex-app-server.gate0a-no-tools";
  readonly compiler_profile_version: "0.3.1-public.1";
  readonly compiler_profile_digest: string;
  readonly compiler_capability_digest: string;
  readonly local_objective_digest: string;
  readonly target_objective_digest: string;
  readonly target_resolution_digest: string;
  readonly target_harness_digest: string;
}

export interface DeliveryCard {
  readonly schema_version: "slice3a-delivery-card/v0.1";
  readonly request_id: string;
  readonly outcome: string;
  readonly owner_decisions: readonly {
    readonly decision: string;
    readonly source_turn_id: string;
    readonly source_quote: string;
  }[];
  readonly assumptions: readonly string[];
  readonly open_decisions: readonly string[];
  readonly readiness: "READY" | "READY_WITH_ASSUMPTIONS";
  readonly requested_authorization: OwnerAuthorizationReceipt["authorization"];
  readonly target_hint: "UNVERIFIED" | "EXACT_EXISTING_SLICE4_REPAIR_IDENTITIES";
  readonly repair_binding?: {
    readonly selected_context: {
      readonly authority: "NON_AUTHORITATIVE_SELECTED_ASSISTANT_CONTEXT";
      readonly source_turn_id: string;
      readonly source_quote: string;
    };
    readonly central_plan_ref: string;
    readonly local: {
      readonly objective_ref: "fixture.invalid/ados-local#11";
      readonly objective_digest: string;
      readonly draft_pr: "fixture.invalid/ados-local#12";
      readonly branch: "fixture/public-local-safety-v1";
      readonly revision_1_sha: "6bfbb7b8b74bad18144c97d439260a98e11384f3";
    };
    readonly fixture: {
      readonly objective_ref: "fixture.invalid/ados-fixture-delivery#5";
      readonly objective_digest: string;
      readonly resolution_digest: string;
      readonly draft_pr: "fixture.invalid/ados-fixture-delivery#6";
      readonly branch: "fixture/public-target-safety-v1";
      readonly revision_1_sha: "710bd4c9e1ba5912219ba401e205e9cec91268d4";
    };
    readonly evidence_comment: "fixture.invalid/ados-fixture-delivery#6:issuecomment-1000001";
    readonly retained_lineage: "REJECTED_CAUSAL_EVIDENCE_GAP";
    readonly execution_profile: "safety.fixture-dogfood-gate@0.1.1-public.1";
    readonly authorized_effects: readonly string[];
    readonly forbidden_effects: readonly string[];
  };
  readonly allowed_scope_hints: readonly string[];
  readonly forbidden_scope_hints: readonly string[];
  readonly quality_bar: readonly string[];
  readonly engineering_acceptance: readonly string[];
  readonly product_acceptance: readonly string[];
  readonly risk_flags: readonly string[];
  readonly capture_profile: string;
  readonly compiler_profile: string;
  readonly digest_short_codes: {
    readonly selected_turn: string;
    readonly owner_turn: string;
    readonly candidate: string;
    readonly request: string;
  };
  readonly consequence: "APPROVED_NOT_DISPATCHED";
  readonly authority_notice:
    | "NO_OBJECTIVE_NO_RUN_NO_DISPATCH_NO_TARGET_MUTATION"
    | "CONFIRM_AUTHORIZES_EXACT_BOUND_REPAIR_AFTER_RECEIPT_ACTIVATION";
}

export interface ReadyCardRehydrationResponse {
  readonly status: "READY_FOR_CONFIRMATION";
  readonly restoration: "DURABLE_READY_CARD_REHYDRATED";
  readonly request: JsonObject;
  readonly card: DeliveryCard;
  readonly card_digest: string;
  readonly challenge: ChallengeBinding;
  readonly challenge_token: string;
  readonly consequence: "APPROVED_NOT_DISPATCHED";
}

export interface ApprovedIntake {
  readonly request: JsonObject;
  readonly request_id: string;
  readonly request_digest: string;
  readonly receipt: OwnerAuthorizationReceipt;
  readonly activation: {
    readonly activation_id: string;
    readonly request_id: string;
    readonly request_digest: string;
    readonly receipt_id: string;
    readonly status: "APPROVED_NOT_DISPATCHED";
    readonly created_at: string;
    readonly last_intake_event: string;
  };
  readonly disposition: "CREATED" | "DUPLICATE_RECONCILED";
}
