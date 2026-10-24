import { hashCanonical } from "../canonical/index.js";
import type { ConversationEvidencePack, ConversationTurn } from "../compiler/types.js";
import type { JsonValue } from "../types.js";
import {
  captureProfile,
  type CaptureRole,
  type CapturedTurn,
  type ChatGptCapturePack,
  type ValidatedCapturePack,
} from "./types.js";

function blocked(code: string): never {
  throw new Error(`BLOCKED_CAPTURE:${code}`);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return blocked(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    blocked(code);
  }
}

export function normalizeCaptureText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function requiredString(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return blocked(code);
  }
  return value;
}

function parseTurn(value: unknown): CapturedTurn {
  const turn = record(value, "TURN_SHAPE");
  exactKeys(turn, ["turn_id", "order", "role", "text", "role_proof"], "TURN_FIELDS");
  const turnId = requiredString(turn.turn_id, "TURN_ID", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(turnId)) {
    blocked("TURN_ID");
  }
  if (!Number.isSafeInteger(turn.order) || Number(turn.order) < 0) {
    blocked("TURN_ORDER");
  }
  const roles: readonly CaptureRole[] = ["owner", "assistant", "quoted_external", "unknown"];
  if (!roles.includes(turn.role as CaptureRole)) {
    blocked("ROLE_UNSUPPORTED");
  }
  const role = turn.role as CaptureRole;
  if (role === "unknown") {
    blocked("ROLE_UNKNOWN");
  }
  const rawText = requiredString(turn.text, "TURN_TEXT", captureProfile.max_turn_bytes);
  const text = normalizeCaptureText(rawText);
  if (text.length === 0 || text !== rawText || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    blocked("TURN_TEXT_NORMALIZATION");
  }
  const proof = record(turn.role_proof, "ROLE_PROOF_SHAPE");
  exactKeys(proof, ["selector", "raw_role", "quoted", "visible"], "ROLE_PROOF_FIELDS");
  if (
    proof.selector !== captureProfile.role_selector ||
    (proof.raw_role !== "user" && proof.raw_role !== "assistant") ||
    typeof proof.quoted !== "boolean" ||
    proof.visible !== true
  ) {
    blocked("ROLE_PROOF_INVALID");
  }
  const expectedRole = proof.quoted
    ? "quoted_external"
    : proof.raw_role === "user" ? "owner" : "assistant";
  if (role !== expectedRole) {
    blocked("ROLE_PROOF_MISMATCH");
  }
  return {
    turn_id: turnId,
    order: Number(turn.order),
    role,
    text,
    role_proof: {
      selector: captureProfile.role_selector,
      raw_role: proof.raw_role,
      quoted: proof.quoted,
      visible: true,
    },
  };
}

function canonicalConversationRef(value: string): string {
  if (!/^chatgpt:\/\/conversation\/(?:direct|scoped)\/[a-f0-9]{64}$/u.test(value)) {
    blocked("CONVERSATION_REF");
  }
  return value;
}

export function validateCapturePack(value: unknown): ValidatedCapturePack {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  if (encoded.byteLength > captureProfile.max_request_bytes) {
    blocked("REQUEST_TOO_LARGE");
  }
  const input = record(value, "PACK_SHAPE");
  exactKeys(input, [
    "schema_version",
    "capture_profile_id",
    "capture_profile_version",
    "page_origin",
    "conversation_ref",
    "captured_at",
    "selected_turn_ids",
    "turns",
    "retention",
  ], "PACK_FIELDS");
  if (
    input.schema_version !== "chatgpt-capture-pack/v0.1" ||
    input.capture_profile_id !== captureProfile.profile_id ||
    input.capture_profile_version !== captureProfile.profile_version ||
    input.page_origin !== captureProfile.origin ||
    input.retention !== "local_raw_until_submit"
  ) {
    blocked("PROFILE_IDENTITY");
  }
  const capturedAt = requiredString(input.captured_at, "CAPTURED_AT", 64);
  if (!Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).toISOString() !== capturedAt) {
    blocked("CAPTURED_AT");
  }
  const rawConversationRef = requiredString(input.conversation_ref, "CONVERSATION_REF", 2048);
  const conversationRef = canonicalConversationRef(rawConversationRef);
  if (!Array.isArray(input.turns) || input.turns.length === 0 || input.turns.length > captureProfile.max_turns) {
    blocked("TURN_COUNT");
  }
  const turns = input.turns.map(parseTurn).sort((left, right) => left.order - right.order);
  if (new Set(turns.map((turn) => turn.turn_id)).size !== turns.length) {
    blocked("TURN_ID_DUPLICATE");
  }
  if (turns.some((turn, index) => index > 0 && turn.order <= turns[index - 1]!.order)) {
    blocked("TURN_ORDER");
  }
  if (!Array.isArray(input.selected_turn_ids) || input.selected_turn_ids.length === 0) {
    blocked("SELECTION_EMPTY");
  }
  const selectedTurnIds = input.selected_turn_ids.map((item) => requiredString(item, "SELECTED_TURN_ID", 128));
  if (new Set(selectedTurnIds).size !== selectedTurnIds.length) {
    blocked("SELECTION_DUPLICATE");
  }
  const byId = new Map(turns.map((turn) => [turn.turn_id, turn]));
  const selected = selectedTurnIds.map((id) => byId.get(id) ?? blocked("SELECTED_TURN_MISSING"));
  const selectedOrders = selected.map((turn) => turn.order);
  if (selectedOrders.some((order, index) => index > 0 && order <= selectedOrders[index - 1]!)) {
    blocked("SELECTION_ORDER");
  }
  const owner = selected.filter((turn) => turn.role === "owner");
  if (owner.length === 0) {
    blocked("OWNER_TURN_MISSING");
  }
  const roleCounts = new Map<Exclude<CaptureRole, "unknown">, number>();
  for (const turn of selected) {
    const role = turn.role as Exclude<CaptureRole, "unknown">;
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const roleSummary = (["owner", "assistant", "quoted_external"] as const)
    .flatMap((role) => {
      const count = roleCounts.get(role);
      return count === undefined ? [] : [{ role, count }];
    });
  const pack: ChatGptCapturePack = {
    schema_version: "chatgpt-capture-pack/v0.1",
    capture_profile_id: captureProfile.profile_id,
    capture_profile_version: captureProfile.profile_version,
    page_origin: captureProfile.origin,
    conversation_ref: rawConversationRef,
    captured_at: capturedAt,
    selected_turn_ids: selectedTurnIds,
    turns,
    retention: "local_raw_until_submit",
  };
  return {
    pack,
    conversation_ref: conversationRef,
    selected_turn_digest: hashCanonical(selected as unknown as JsonValue),
    owner_turn_digest: hashCanonical(owner as unknown as JsonValue),
    capture_digest: hashCanonical(pack as unknown as JsonValue),
    role_summary: roleSummary,
  };
}

export function compilerPackForCapture(capture: ValidatedCapturePack): ConversationEvidencePack {
  const selected = new Set(capture.pack.selected_turn_ids);
  const turns: ConversationTurn[] = capture.pack.turns
    .filter((turn) => selected.has(turn.turn_id))
    .map((turn) => ({
      turn_id: turn.turn_id,
      role: turn.role === "owner" ? "owner" : "assistant",
      origin: "chatgpt-visible-selection",
      text: turn.text,
    }));
  return {
    schema_version: "conversation-evidence-pack/v0.1",
    case_id: "clear-ready",
    capture_profile_id: "capture.chatgpt.visible-selection",
    conversation_ref: capture.conversation_ref,
    selected_turn_ids: turns.map((turn) => turn.turn_id),
    turns,
    retention: "local-only",
  };
}
