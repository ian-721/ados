import type { LiveCompilerMatrixResult } from "./profile.js";
import type { GroundedOwnerDecision } from "./types.js";

function list(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.map((value) => `- ${value}`).join("\n");
}

function groundedOwnerDecisions(values: readonly GroundedOwnerDecision[]): string {
  return values.length === 0
    ? "(none)"
    : values.map((item) => [
      `- ${item.decision}`,
      `  source: selected Owner turn ${item.source_turn_id}; normalized span [${item.source_span.start},${item.source_span.end})`,
      `  exact source quote: ${item.source_quote}`,
    ].join("\n")).join("\n");
}

export function renderDeliveryCard(result: LiveCompilerMatrixResult): string {
  const candidate = result.accepted_clear_ready;
  const matrixLines = result.rounds.map((round) =>
    `Round ${round.round}: ${round.status} — ${round.cases.map((item) => `${item.case_id}=PASS`).join(", ")} — ${round.round_digest}`
  );
  return [
    "# Gate 0A Owner Delivery Card",
    "",
    `Outcome: ${candidate.outcome ?? "(none)"}`,
    "",
    "Owner decisions:",
    groundedOwnerDecisions(candidate.owner_decisions),
    "",
    "Assumptions:",
    list(candidate.assumptions),
    "",
    "Open decisions:",
    list(candidate.open_decisions),
    "",
    `Readiness: ${candidate.readiness} (T0 candidate; local validation passed; Owner confirmation still required)`,
    `Material question: ${candidate.material_question ?? "(none)"}`,
    `Requested authorization: ${candidate.requested_authorization ?? "(none)"}`,
    "",
    "Risk flags:",
    list(candidate.risk_flags),
    "",
    "Evidence bindings:",
    `- Selected-turn digest: ${candidate.selected_turn_digest}`,
    `- Owner-turn digest: ${candidate.owner_turn_digest}`,
    `- Candidate digest: ${candidate.candidate_digest}`,
    "",
    "Compiler Profile:",
    `- Identity: ${result.profile.profile_id}@${result.profile.profile_version}`,
    `- Model identity: ${result.profile.model_provider}/${result.profile.model}`,
    `- Prompt version: ${result.profile.prompt_version}`,
    `- Output schema digest: ${result.profile.schema_digest}`,
    `- Frozen case-set digest: ${result.profile.case_set_digest}`,
    `- Capability digest: ${result.profile.capability_digest}`,
    `- Blocked-path cleanup: ${result.profile.blocked_path_cleanup}`,
    `- Codex identity: ${result.profile.executable_version}; sha256:${result.profile.executable_sha256}`,
    "",
    "Five-round semantic matrix:",
    ...matrixLines,
    `Mutation-after-candidate: ${result.mutation.status} — selected-turn, Owner-turn, candidate, and candidate-digest bindings invalidated — ${result.mutation.mutation_digest}`,
    "Non-authoritative Receipt binding preview:",
    `- Label: ${result.mutation.receipt_binding_preview.label}`,
    `- Original owner_receipt_binding_preimage digest: ${result.mutation.receipt_binding_preview.original.preimage_digest}`,
    `- Mutated owner_receipt_binding_preimage digest: ${result.mutation.receipt_binding_preview.mutated.preimage_digest}`,
    `- Mutation invalidated preview: ${result.mutation.receipt_binding_preview.invalidated}`,
    `- Authenticated Owner Receipt: ${result.mutation.receipt_binding_preview.authenticated_owner_receipt ? "CREATED" : "NOT CREATED OR VERIFIED"}`,
    `Matrix digest: ${result.matrix_digest}`,
    `Isolation: ${result.unique_live_threads}/${result.live_threads} unique ephemeral read-only approvalPolicy=never no-tool Compiler threads; measured App Server requests=${result.server_requests} across ${result.server_request_checkpoints.length} checkpoints; App Server cleanup=${result.app_server_cleanup}`,
    `Shutdown evidence: status=${result.app_server_shutdown.status}; close attempts=${result.app_server_shutdown.close_attempts}; residual PID=${result.app_server_shutdown.residual_process_status}; PID check=${result.app_server_shutdown.residual_process_check_performed ? "PERFORMED" : "SKIPPED"}`,
    "",
    "Authenticated Owner Receipt: NOT CREATED OR VERIFIED.",
    "Task dispatch: NOT PERFORMED.",
    "Target repository/GitHub mutation: NOT PERFORMED.",
    "Browser Capture and Native Messaging: NOT IMPLEMENTED OR CLAIMED.",
    "Slice 3 and Alpha completion: NOT CLAIMED.",
  ].join("\n");
}
