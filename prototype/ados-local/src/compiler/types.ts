export const liveCaseIds = [
  "clear-ready",
  "open-provider",
  "assistant-injection",
  "multiple-deliveries",
  "owner-revocation",
  "ambiguous-scope",
  "empty-selection",
] as const;

export type LiveCaseId = typeof liveCaseIds[number];

export type ConversationRole = "owner" | "assistant";

export interface ConversationTurn {
  readonly turn_id: string;
  readonly role: ConversationRole;
  readonly origin: "sanitized-fixture" | "chatgpt-visible-selection";
  readonly text: string;
}

export interface ConversationEvidencePack {
  readonly schema_version: "conversation-evidence-pack/v0.1";
  readonly case_id: LiveCaseId;
  readonly capture_profile_id: "capture.synthetic.gate0a" | "capture.chatgpt.visible-selection";
  readonly conversation_ref: string;
  readonly selected_turn_ids: readonly string[];
  readonly turns: readonly ConversationTurn[];
  readonly retention: "local-only";
}

export type CandidateDisposition = "PROPOSE" | "ASK_ONE_QUESTION" | "REJECT";
export type CandidateReadiness = "READY" | "NEEDS_OWNER_DECISION" | "REJECTED";
export type RequestedAuthorization = "DISCOVERY" | "PLAN" | "IMPLEMENT" | "MERGE" | "RELEASE";
export type RiskFlag =
  | "LOCAL_SYNTHETIC_ONLY"
  | "MATERIAL_PROVIDER_UNDECIDED"
  | "UNTRUSTED_ASSISTANT_TEXT"
  | "MULTIPLE_UNRELATED_DELIVERIES"
  | "OWNER_AUTHORITY_REVOKED"
  | "AMBIGUOUS_SCOPE"
  | "EMPTY_SELECTION";
export type RejectionReason = "MULTIPLE_UNRELATED_DELIVERIES" | "EMPTY_SELECTION";

export interface NormalizedSourceSpan {
  readonly normalization: "unicode-nfkc-whitespace-v0.1";
  readonly start: number;
  readonly end: number;
}

export interface GroundedOwnerDecision {
  readonly decision: string;
  readonly source_turn_id: string;
  readonly source_quote: string;
  readonly source_span: NormalizedSourceSpan;
}

export interface CompilerCandidate {
  readonly schema_version: "gate0a-compiler-candidate/v0.2";
  readonly profile_id: "compiler.codex-app-server.gate0a-no-tools";
  readonly profile_version: "0.3.1-public.1";
  readonly prompt_version: "gate0a-compiler-prompt/v0.5";
  readonly capability_digest: string;
  readonly case_id: LiveCaseId;
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly disposition: CandidateDisposition;
  readonly outcome: string | null;
  readonly owner_decisions: readonly GroundedOwnerDecision[];
  readonly assumptions: readonly string[];
  readonly open_decisions: readonly string[];
  readonly readiness: CandidateReadiness;
  readonly material_question: string | null;
  readonly requested_authorization: RequestedAuthorization | null;
  readonly risk_flags: readonly RiskFlag[];
  readonly rejection_reason: RejectionReason | null;
}

export interface AcceptedCompilerCandidate extends CompilerCandidate {
  readonly candidate_digest: string;
}

export interface CaseExpectation {
  readonly disposition: CandidateDisposition;
  readonly readiness: CandidateReadiness;
  readonly requested_authorization: RequestedAuthorization | null;
  readonly required_risk_flag: RiskFlag;
  readonly rejection_reason: RejectionReason | null;
  readonly owner_decisions: "ONE_OR_MORE" | "NONE" | "ANY";
  readonly open_decisions: "ONE_OR_MORE" | "NONE";
  readonly question_terms: readonly string[];
}

export interface PackBindings {
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly pack_digest: string;
}

export interface LiveCaseResult {
  readonly case_id: LiveCaseId;
  readonly status: "PASS";
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly prompt_digest: string;
  readonly candidate_digest: string;
  readonly thread_digest: string;
  readonly tool_items: 0;
  readonly server_requests: number;
}

export interface MatrixRoundResult {
  readonly round: number;
  readonly status: "PASS";
  readonly cases: readonly LiveCaseResult[];
  readonly round_digest: string;
}

export interface OwnerReceiptBindingPreimage {
  readonly kind: "owner_receipt_binding_preimage";
  readonly authority: "NON_AUTHORITATIVE_PREVIEW";
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly candidate_digest: string;
  readonly requested_authorization: RequestedAuthorization | null;
  readonly compiler_profile_identity: {
    readonly profile_id: "compiler.codex-app-server.gate0a-no-tools";
    readonly profile_version: "0.3.1-public.1";
    readonly capability_digest: string;
  };
}

export interface NonAuthoritativeReceiptBindingPreview {
  readonly label: "non-authoritative Receipt binding preview";
  readonly authenticated_owner_receipt: false;
  readonly original: {
    readonly owner_receipt_binding_preimage: OwnerReceiptBindingPreimage;
    readonly preimage_digest: string;
  };
  readonly mutated: {
    readonly owner_receipt_binding_preimage: OwnerReceiptBindingPreimage;
    readonly preimage_digest: string;
  };
  readonly invalidated: true;
}

export interface MutationEvidence {
  readonly case_id: "mutation-after-candidate";
  readonly status: "PASS";
  readonly selected_turn_binding_invalidated: true;
  readonly owner_turn_binding_invalidated: true;
  readonly candidate_binding_invalidated: true;
  readonly candidate_digest_invalidated: true;
  readonly owner_receipt_binding_preview_invalidated: true;
  readonly receipt_binding_preview: NonAuthoritativeReceiptBindingPreview;
  readonly owner_receipt_created: false;
  readonly mutation_digest: string;
}

export interface ServerRequestCheckpoint {
  readonly checkpoint: string;
  readonly measured_count: number;
}

export interface AppServerShutdownOutcome {
  readonly status: "PASS" | "BLOCKED";
  readonly blocker: string | null;
  readonly before_close: ServerRequestCheckpoint;
  readonly after_close: ServerRequestCheckpoint;
  readonly server_requests: number;
  readonly close_attempts: 1;
  readonly close_error: "APP_SERVER_CLOSE_FAILED" | null;
  readonly residual_process_check_performed: true;
  readonly residual_process_status: "ABSENT" | "PRESENT" | "CHECK_FAILED";
}

export interface FrozenCompilerProfile {
  readonly profile_id: "compiler.codex-app-server.gate0a-no-tools";
  readonly profile_version: "0.3.1-public.1";
  readonly prompt_version: "gate0a-compiler-prompt/v0.5";
  readonly model: "gpt-5.6-sol";
  readonly model_provider: "openai";
  readonly executable_version: "codex-cli 0.146.0-alpha.9.2" | "codex-cli 0.147.0-alpha.1.2";
  readonly executable_sha256: string;
  readonly schema_digest: string;
  readonly case_set_digest: string;
  readonly prompt_policy_digest: string;
  readonly profile_digest: string;
  readonly capability_digest: string;
  readonly blocked_path_cleanup: "always-close-preserve-blocker-pid-check/v0.1";
}
