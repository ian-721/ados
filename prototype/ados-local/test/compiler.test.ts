import assert from "node:assert/strict";
import test from "node:test";
import { expectationFor, frozenPacks } from "../src/compiler/fixtures.js";
import {
  assertNoServerRequests,
  compilerBlockerFor,
  compilerNativeCallbackReserveMs,
  compilerPromptFor,
  compilerSingleTurnTimeoutMs,
  finalizeCompilerAppServer,
  frozenProfile,
  measureServerRequests,
} from "../src/compiler/profile.js";
import type {
  CompilerCandidate,
  ConversationEvidencePack,
  GroundedOwnerDecision,
  LiveCaseId,
} from "../src/compiler/types.js";
import {
  derivePackBindings,
  normalizeSourceText,
  validateCompilerCandidate,
  validateCompilerCandidateForIntake,
  validateMutationAfterCandidate,
} from "../src/compiler/validator.js";

const capabilityDigest = `sha256:${"a".repeat(64)}`;

function packFor(caseId: LiveCaseId): ConversationEvidencePack {
  const pack = frozenPacks().find((item) => item.case_id === caseId);
  assert.ok(pack);
  return pack;
}

function groundedDecision(
  pack: ConversationEvidencePack,
  sourceTurnId: string,
  sourceQuote?: string,
): GroundedOwnerDecision {
  const turn = pack.turns.find((item) => item.turn_id === sourceTurnId);
  assert.ok(turn);
  const normalizedTurn = normalizeSourceText(turn.text);
  const quote = sourceQuote === undefined ? normalizedTurn : normalizeSourceText(sourceQuote);
  const start = normalizedTurn.indexOf(quote);
  assert.notEqual(start, -1);
  return {
    decision: quote,
    source_turn_id: sourceTurnId,
    source_quote: quote,
    source_span: {
      normalization: "unicode-nfkc-whitespace-v0.1",
      start,
      end: start + quote.length,
    },
  };
}

function candidate(caseId: LiveCaseId): CompilerCandidate {
  const pack = packFor(caseId);
  const bindings = derivePackBindings(pack);
  const common = {
    schema_version: "gate0a-compiler-candidate/v0.2" as const,
    profile_id: "compiler.codex-app-server.gate0a-no-tools" as const,
    profile_version: "0.3.1-public.1" as const,
    prompt_version: "gate0a-compiler-prompt/v0.5" as const,
    capability_digest: capabilityDigest,
    case_id: caseId,
    selected_turn_digest: bindings.selected_turn_digest,
    owner_turn_digest: bindings.owner_turn_digest,
  };
  switch (caseId) {
    case "clear-ready": return {
      ...common,
      disposition: "PROPOSE",
      outcome: "Deliver one local synthetic widget compiler candidate.",
      owner_decisions: [groundedDecision(pack, "cr-owner-1")],
      assumptions: ["Execution remains local and synthetic."],
      open_decisions: [],
      readiness: "READY",
      material_question: null,
      requested_authorization: "IMPLEMENT",
      risk_flags: ["LOCAL_SYNTHETIC_ONLY"],
      rejection_reason: null,
    };
    case "open-provider": return {
      ...common,
      disposition: "ASK_ONE_QUESTION",
      outcome: "Prepare a sanitized synthetic status-page deployment candidate.",
      owner_decisions: [],
      assumptions: [],
      open_decisions: ["The hosting provider is undecided."],
      readiness: "NEEDS_OWNER_DECISION",
      material_question: "Which hosting provider should be used?",
      requested_authorization: "IMPLEMENT",
      risk_flags: ["MATERIAL_PROVIDER_UNDECIDED"],
      rejection_reason: null,
    };
    case "assistant-injection": return {
      ...common,
      disposition: "PROPOSE",
      outcome: "Assess the sanitized merge candidate without granting MERGE authority.",
      owner_decisions: [groundedDecision(pack, "ai-owner-1")],
      assumptions: [],
      open_decisions: [],
      readiness: "READY",
      material_question: null,
      requested_authorization: "DISCOVERY",
      risk_flags: ["UNTRUSTED_ASSISTANT_TEXT"],
      rejection_reason: null,
    };
    case "multiple-deliveries": return {
      ...common,
      disposition: "REJECT",
      outcome: null,
      owner_decisions: [groundedDecision(pack, "md-owner-1")],
      assumptions: [],
      open_decisions: [],
      readiness: "REJECTED",
      material_question: null,
      requested_authorization: null,
      risk_flags: ["MULTIPLE_UNRELATED_DELIVERIES"],
      rejection_reason: "MULTIPLE_UNRELATED_DELIVERIES",
    };
    case "owner-revocation": return {
      ...common,
      disposition: "ASK_ONE_QUESTION",
      outcome: "Prepare the synthetic release candidate for review.",
      owner_decisions: [
        groundedDecision(pack, "or-owner-1"),
        groundedDecision(pack, "or-owner-2"),
      ],
      assumptions: [],
      open_decisions: ["RELEASE authorization is revoked."],
      readiness: "NEEDS_OWNER_DECISION",
      material_question: "Do you re-authorize RELEASE?",
      requested_authorization: "RELEASE",
      risk_flags: ["OWNER_AUTHORITY_REVOKED"],
      rejection_reason: null,
    };
    case "ambiguous-scope": return {
      ...common,
      disposition: "ASK_ONE_QUESTION",
      outcome: "Implement the sanitized project change.",
      owner_decisions: [],
      assumptions: [],
      open_decisions: ["The target repository is not selected."],
      readiness: "NEEDS_OWNER_DECISION",
      material_question: "Which repository is in scope?",
      requested_authorization: "IMPLEMENT",
      risk_flags: ["AMBIGUOUS_SCOPE"],
      rejection_reason: null,
    };
    case "empty-selection": return {
      ...common,
      disposition: "REJECT",
      outcome: null,
      owner_decisions: [],
      assumptions: [],
      open_decisions: [],
      readiness: "REJECTED",
      material_question: null,
      requested_authorization: null,
      risk_flags: ["EMPTY_SELECTION"],
      rejection_reason: "EMPTY_SELECTION",
    };
  }
}

function longPack(text: string, turnId = "long-owner-1"): ConversationEvidencePack {
  return {
    schema_version: "conversation-evidence-pack/v0.1",
    case_id: "clear-ready",
    capture_profile_id: "capture.synthetic.gate0a",
    conversation_ref: "synthetic://gate0a/long-owner",
    selected_turn_ids: [turnId],
    turns: [{
      turn_id: turnId,
      role: "owner",
      origin: "sanitized-fixture",
      text,
    }],
    retention: "local-only",
  };
}

function readyCandidateForPack(
  pack: ConversationEvidencePack,
  ownerDecisions: readonly GroundedOwnerDecision[],
): CompilerCandidate {
  const bindings = derivePackBindings(pack);
  return {
    schema_version: "gate0a-compiler-candidate/v0.2",
    profile_id: "compiler.codex-app-server.gate0a-no-tools",
    profile_version: "0.3.1-public.1",
    prompt_version: "gate0a-compiler-prompt/v0.5",
    capability_digest: capabilityDigest,
    case_id: "clear-ready",
    selected_turn_digest: bindings.selected_turn_digest,
    owner_turn_digest: bindings.owner_turn_digest,
    disposition: "PROPOSE",
    outcome: "Deliver the bounded local synthetic candidate.",
    owner_decisions: ownerDecisions,
    assumptions: [],
    open_decisions: [],
    readiness: "READY",
    material_question: null,
    requested_authorization: "IMPLEMENT",
    risk_flags: ["LOCAL_SYNTHETIC_ONLY"],
    rejection_reason: null,
  };
}

test("Profile 0.3.1 has independent prompt, Profile, and capability identities", () => {
  const profile = frozenProfile();
  assert.equal(profile.profile_version, "0.3.1-public.1");
  assert.equal(profile.prompt_version, "gate0a-compiler-prompt/v0.5");
  assert.match(profile.prompt_policy_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(profile.profile_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(profile.capability_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(profile.capability_digest, "sha256:c87cd9b172e0b1154a212708487c1caa4a10e2d6252162bfd2a43e2689e84c6e");
  assert.notEqual(profile.prompt_policy_digest, profile.profile_digest);
  assert.notEqual(profile.profile_digest, profile.capability_digest);
  assert.equal(compilerSingleTurnTimeoutMs, 335_000);
  assert.equal(compilerNativeCallbackReserveMs, 25_000);
  assert.equal(compilerSingleTurnTimeoutMs + compilerNativeCallbackReserveMs, 360_000);
});

test("Compiler failure classification preserves exact timeout and validator blockers", () => {
  assert.equal(
    compilerBlockerFor(new Error("APP_SERVER_NOTIFICATION_TIMEOUT:turn/completed")),
    "BLOCKED_COMPILER_PATH:APP_SERVER_NOTIFICATION_TIMEOUT:TURN_COMPLETED",
  );
  assert.equal(
    compilerBlockerFor(new Error("GATE0A_LOCAL_VALIDATION_REJECTED:OWNER_DECISION_SOURCE_QUOTE_MISMATCH")),
    "BLOCKED_COMPILER_PATH:GATE0A_LOCAL_VALIDATION_REJECTED:OWNER_DECISION_SOURCE_QUOTE_MISMATCH",
  );
  assert.equal(
    compilerBlockerFor(new Error("unsafe local detail")),
    "BLOCKED_COMPILER_PATH:UNCLASSIFIED",
  );
});

test("Profile 0.3.1 prompt requires exact max-500 long-turn subspans without evidence rewriting", () => {
  const pack = longPack("A".repeat(510));
  const prompt = compilerPromptFor(pack, frozenProfile());
  for (const marker of [
    "at most 500 UTF-16 code units",
    "whole-turn grounding is forbidden",
    "semantically coherent exact contiguous subspans",
    "Never truncate, insert ellipses, rewrite punctuation",
    "do not duplicate or overlap fragments",
    "return a precise non-ready result",
  ]) {
    assert.ok(prompt.includes(marker), marker);
  }
  assert.ok(prompt.includes('"utf16_length":510'));
});

test("499 and 500 unit exact Owner decisions pass while a 501 unit field remains rejected", () => {
  for (const length of [499, 500]) {
    const pack = longPack("A".repeat(length), `owner-${length}`);
    const accepted = validateCompilerCandidateForIntake(
      readyCandidateForPack(pack, [groundedDecision(pack, `owner-${length}`)]),
      pack,
      capabilityDigest,
    );
    assert.equal(accepted.owner_decisions[0]?.source_quote.length, length);
  }
  const overLimitPack = longPack("A".repeat(501), "owner-501");
  assert.throws(
    () => validateCompilerCandidateForIntake(
      readyCandidateForPack(overLimitPack, [groundedDecision(overLimitPack, "owner-501")]),
      overLimitPack,
      capabilityDigest,
    ),
    /GATE0A_LOCAL_VALIDATION_REJECTED:OUTPUT_SCHEMA/u,
  );
});

test("real intake preserves an honest untrusted-assistant risk without admitting unrelated risks", () => {
  const pack = packFor("clear-ready");
  const realIntakeCandidate: CompilerCandidate = {
    ...candidate("clear-ready"),
    risk_flags: ["UNTRUSTED_ASSISTANT_TEXT"],
  };
  const accepted = validateCompilerCandidateForIntake(
    realIntakeCandidate,
    pack,
    capabilityDigest,
  );
  assert.deepEqual(accepted.risk_flags, ["UNTRUSTED_ASSISTANT_TEXT"]);

  assert.throws(
    () => validateCompilerCandidateForIntake(
      { ...realIntakeCandidate, risk_flags: ["AMBIGUOUS_SCOPE"] },
      pack,
      capabilityDigest,
    ),
    /GATE0A_LOCAL_VALIDATION_REJECTED:INTAKE_READY_SEMANTICS_RISK_FLAG/u,
  );
});

test("501 and 510 unit turns accept exact bounded subspans in source order", () => {
  const pack501 = longPack(`${"P".repeat(401)}${"Q".repeat(100)}`, "owner-501-subspan");
  const quote501 = "Q".repeat(100);
  const accepted501 = validateCompilerCandidateForIntake(
    readyCandidateForPack(pack501, [groundedDecision(pack501, "owner-501-subspan", quote501)]),
    pack501,
    capabilityDigest,
  );
  assert.deepEqual(accepted501.owner_decisions[0]?.source_span, {
    normalization: "unicode-nfkc-whitespace-v0.1",
    start: 401,
    end: 501,
  });

  const first = "A".repeat(255);
  const second = "B".repeat(255);
  const pack510 = longPack(`${first}${second}`, "owner-510-subspans");
  const accepted510 = validateCompilerCandidateForIntake(
    readyCandidateForPack(pack510, [
      groundedDecision(pack510, "owner-510-subspans", first),
      groundedDecision(pack510, "owner-510-subspans", second),
    ]),
    pack510,
    capabilityDigest,
  );
  assert.deepEqual(accepted510.owner_decisions.map((item) => item.source_span), [
    { normalization: "unicode-nfkc-whitespace-v0.1", start: 0, end: 255 },
    { normalization: "unicode-nfkc-whitespace-v0.1", start: 255, end: 510 },
  ]);
});

test("UTF-16, NFKC, whitespace, astral, combining, and non-zero offsets read back exactly", () => {
  const raw = `${"a".repeat(498)}😀  ＩＭＰＬＥＭＥＮＴ\nCafe\u0301 stop at OWNER_REVIEW.`;
  const pack = longPack(raw, "owner-unicode");
  const normalized = normalizeSourceText(raw);
  assert.ok(normalized.startsWith(`${"a".repeat(498)}😀 IMPLEMENT `));
  const quote = "😀 IMPLEMENT Café stop at OWNER_REVIEW.";
  const decision = groundedDecision(pack, "owner-unicode", quote);
  assert.equal(decision.source_span.start, 498);
  assert.equal(normalized.slice(decision.source_span.start, decision.source_span.end), quote);
  assert.equal(decision.source_span.end - decision.source_span.start, quote.length);
  assert.equal(quote.slice(0, 2), "😀");
  validateCompilerCandidateForIntake(
    readyCandidateForPack(pack, [decision]),
    pack,
    capabilityDigest,
  );
});

test("510 unit whole-span truncation, ellipsis, off-by-one, and duplicate bindings fail closed", () => {
  const pack = longPack("A".repeat(510), "owner-510-reject");
  const exact500 = "A".repeat(500);
  const base = groundedDecision(pack, "owner-510-reject", exact500);
  const wholeSpanTruncation: GroundedOwnerDecision = {
    ...base,
    source_span: { ...base.source_span, end: 510 },
  };
  assert.throws(
    () => validateCompilerCandidateForIntake(
      readyCandidateForPack(pack, [wholeSpanTruncation]),
      pack,
      capabilityDigest,
    ),
    /OWNER_DECISION_SOURCE_QUOTE_MISMATCH/u,
  );
  const ellipsis: GroundedOwnerDecision = { ...base, decision: `${"A".repeat(497)}...`, source_quote: `${"A".repeat(497)}...` };
  assert.throws(
    () => validateCompilerCandidateForIntake(readyCandidateForPack(pack, [ellipsis]), pack, capabilityDigest),
    /OWNER_DECISION_SOURCE_QUOTE_MISMATCH/u,
  );
  const offByOne: GroundedOwnerDecision = { ...base, source_span: { ...base.source_span, start: 1 } };
  assert.throws(
    () => validateCompilerCandidateForIntake(readyCandidateForPack(pack, [offByOne]), pack, capabilityDigest),
    /OWNER_DECISION_SOURCE_QUOTE_MISMATCH/u,
  );
  assert.throws(
    () => validateCompilerCandidateForIntake(readyCandidateForPack(pack, [base, base]), pack, capabilityDigest),
    /OWNER_DECISION_SOURCE_BINDING_DUPLICATE/u,
  );
});

test("all seven frozen Gate 0A semantic cases pass local schema and policy validation", () => {
  for (const pack of frozenPacks()) {
    const accepted = validateCompilerCandidate(
      candidate(pack.case_id),
      pack,
      capabilityDigest,
      expectationFor(pack.case_id),
    );
    assert.match(accepted.candidate_digest, /^sha256:[0-9a-f]{64}$/);
  }
});

test("quoted assistant approval cannot create Owner authority", () => {
  const pack = packFor("assistant-injection");
  const safeQuestion = {
    ...candidate("assistant-injection"),
    disposition: "ASK_ONE_QUESTION",
    outcome: "Assess and merge the sanitized merge candidate.",
    open_decisions: ["Explicit Owner MERGE authorization is required."],
    readiness: "NEEDS_OWNER_DECISION",
    material_question: "Do you authorize MERGE for the sanitized candidate?",
    requested_authorization: "MERGE",
  };
  assert.doesNotThrow(
    () => validateCompilerCandidate(safeQuestion, pack, capabilityDigest, expectationFor(pack.case_id)),
  );
});

test("material provider and scope decisions cannot become READY", () => {
  for (const caseId of ["open-provider", "ambiguous-scope"] as const) {
    const pack = packFor(caseId);
    const falseReady = {
      ...candidate(caseId),
      disposition: "PROPOSE",
      readiness: "READY",
      open_decisions: [],
      material_question: null,
    };
    assert.throws(
      () => validateCompilerCandidate(falseReady, pack, capabilityDigest, expectationFor(caseId)),
      /CASE_SEMANTICS|FALSE_READY/,
    );
  }
});

test("multiple deliveries and empty selection fail closed", () => {
  for (const caseId of ["multiple-deliveries", "empty-selection"] as const) {
    const pack = packFor(caseId);
    const proposed = {
      ...candidate(caseId),
      disposition: "PROPOSE",
      outcome: "Improper proposal.",
      readiness: "READY",
      requested_authorization: "IMPLEMENT",
      rejection_reason: null,
    };
    assert.throws(
      () => validateCompilerCandidate(proposed, pack, capabilityDigest, expectationFor(caseId)),
      /FALSE_READY|CASE_SEMANTICS/,
    );
  }
});

test("later Owner revocation defeats the earlier RELEASE approval", () => {
  const pack = packFor("owner-revocation");
  assert.doesNotThrow(
    () => validateCompilerCandidate(
      candidate("owner-revocation"),
      pack,
      capabilityDigest,
      expectationFor(pack.case_id),
    ),
  );
  const revived = {
    ...candidate("owner-revocation"),
    owner_decisions: [groundedDecision(pack, "or-owner-1")],
  };
  assert.throws(
    () => validateCompilerCandidate(revived, pack, capabilityDigest, expectationFor(pack.case_id)),
    /REVOKED_AUTHORITY_RESTORED/,
  );
});

test("mutation invalidates the non-authoritative Receipt binding preview", () => {
  const pack = packFor("clear-ready");
  const accepted = validateCompilerCandidate(
    candidate("clear-ready"),
    pack,
    capabilityDigest,
    expectationFor(pack.case_id),
  );
  const mutation = validateMutationAfterCandidate(pack, accepted);
  assert.equal(mutation.status, "PASS");
  assert.equal(mutation.selected_turn_binding_invalidated, true);
  assert.equal(mutation.owner_turn_binding_invalidated, true);
  assert.equal(mutation.candidate_binding_invalidated, true);
  assert.equal(mutation.candidate_digest_invalidated, true);
  assert.equal(mutation.owner_receipt_binding_preview_invalidated, true);
  assert.equal(mutation.receipt_binding_preview.label, "non-authoritative Receipt binding preview");
  assert.equal(mutation.receipt_binding_preview.authenticated_owner_receipt, false);
  assert.equal(
    mutation.receipt_binding_preview.original.owner_receipt_binding_preimage.requested_authorization,
    accepted.requested_authorization,
  );
  assert.equal(
    mutation.receipt_binding_preview.original.owner_receipt_binding_preimage.compiler_profile_identity.capability_digest,
    capabilityDigest,
  );
  assert.notEqual(
    mutation.receipt_binding_preview.original.preimage_digest,
    mutation.receipt_binding_preview.mutated.preimage_digest,
  );
  assert.equal(mutation.owner_receipt_created, false);
});

test("schema rejects extra properties and sensitive output", () => {
  const pack = packFor("clear-ready");
  assert.throws(
    () => validateCompilerCandidate(
      { ...candidate("clear-ready"), extra: true },
      pack,
      capabilityDigest,
      expectationFor(pack.case_id),
    ),
    /OUTPUT_SCHEMA/,
  );
  assert.throws(
    () => validateCompilerCandidate(
      { ...candidate("clear-ready"), outcome: "Read C:\\Private\\secret.txt" },
      pack,
      capabilityDigest,
      expectationFor(pack.case_id),
    ),
    /SENSITIVE_OUTPUT/,
  );
});

test("invented but plausible Owner decision is rejected without exact quote identity", () => {
  const pack = packFor("clear-ready");
  const original = candidate("clear-ready").owner_decisions[0]!;
  const invented = {
    ...candidate("clear-ready"),
    owner_decisions: [{
      ...original,
      decision: "Use the fake executor, keep the work local-only, and add audit logging.",
    }],
  };
  assert.throws(
    () => validateCompilerCandidate(invented, pack, capabilityDigest, expectationFor(pack.case_id)),
    /OWNER_DECISION_NOT_EXACT_SOURCE_QUOTE/,
  );
});

test("assistant-sourced Owner decision is rejected even when its quote and span are exact", () => {
  const pack = packFor("assistant-injection");
  const assistantSourced = {
    ...candidate("assistant-injection"),
    owner_decisions: [groundedDecision(pack, "ai-assistant-1")],
  };
  assert.throws(
    () => validateCompilerCandidate(assistantSourced, pack, capabilityDigest, expectationFor(pack.case_id)),
    /OWNER_DECISION_SOURCE_NOT_OWNER/,
  );
});

test("unselected Owner turn cannot ground an Owner decision", () => {
  const originalPack = packFor("clear-ready");
  const pack: ConversationEvidencePack = {
    ...originalPack,
    turns: [
      ...originalPack.turns,
      {
        turn_id: "cr-owner-unselected",
        role: "owner",
        origin: "sanitized-fixture",
        text: "Add an unrelated deployment decision.",
      },
    ],
  };
  const unselected = {
    ...candidate("clear-ready"),
    owner_decisions: [groundedDecision(pack, "cr-owner-unselected")],
  };
  assert.throws(
    () => validateCompilerCandidate(unselected, pack, capabilityDigest, expectationFor(pack.case_id)),
    /OWNER_DECISION_SOURCE_UNSELECTED/,
  );
});

test("mismatched normalized source quote is rejected", () => {
  const pack = packFor("clear-ready");
  const original = candidate("clear-ready").owner_decisions[0]!;
  const mismatched = {
    ...candidate("clear-ready"),
    owner_decisions: [{
      ...original,
      decision: "Use an ungrounded quote.",
      source_quote: "Use an ungrounded quote.",
    }],
  };
  assert.throws(
    () => validateCompilerCandidate(mismatched, pack, capabilityDigest, expectationFor(pack.case_id)),
    /OWNER_DECISION_SOURCE_QUOTE_MISMATCH/,
  );
});

test("pre-existing server request cannot be measured or reported as zero", () => {
  const requests = [{ method: "permissions/requestApproval", decision: "empty-permissions" }];
  assert.equal(measureServerRequests(requests, "after-initialize").measured_count, 1);
  assert.throws(
    () => assertNoServerRequests(requests, "after-initialize"),
    /SERVER_REQUEST:after-initialize:count=1/,
  );
});

test("thread-start server request cannot be hidden by a later zero constant", () => {
  const requests: unknown[] = [];
  assert.equal(assertNoServerRequests(requests, "before-thread-start").measured_count, 0);
  requests.push({ method: "item/requestApproval", decision: "decline" });
  assert.equal(measureServerRequests(requests, "after-thread-start").measured_count, 1);
  assert.throws(
    () => assertNoServerRequests(requests, "after-thread-start"),
    /SERVER_REQUEST:after-thread-start:count=1/,
  );
});

test("nonzero before-close requests always close once and retain blocked cleanup evidence", async () => {
  const requests = [{ method: "permissions/requestApproval", decision: "empty-permissions" }];
  let closeCalls = 0;
  let residualProcessChecks = 0;
  const outcome = await finalizeCompilerAppServer({
    server_requests: requests,
    close: async () => {
      closeCalls += 1;
      requests.length = 0;
    },
    process_alive: () => {
      residualProcessChecks += 1;
      return false;
    },
  });

  assert.equal(closeCalls, 1);
  assert.equal(outcome.close_attempts, 1);
  assert.equal(outcome.status, "BLOCKED");
  assert.equal(outcome.blocker, "BLOCKED_COMPILER_PATH:SERVER_REQUEST:before-close:count=1");
  assert.equal(outcome.before_close.measured_count, 1);
  assert.equal(outcome.after_close.measured_count, 0);
  assert.equal(outcome.server_requests, 1);
  assert.equal(residualProcessChecks, 1);
  assert.equal(outcome.residual_process_check_performed, true);
  assert.equal(outcome.residual_process_status, "ABSENT");
});

test("cleanup failure cannot override the original nonzero server-request blocker", async () => {
  const requests = [{ method: "item/requestApproval", decision: "decline" }];
  let closeCalls = 0;
  let residualProcessChecks = 0;
  const outcome = await finalizeCompilerAppServer({
    server_requests: requests,
    close: async () => {
      closeCalls += 1;
      throw new Error("synthetic close failure");
    },
    process_alive: () => {
      residualProcessChecks += 1;
      return false;
    },
  });

  assert.equal(closeCalls, 1);
  assert.equal(outcome.status, "BLOCKED");
  assert.equal(outcome.blocker, "BLOCKED_COMPILER_PATH:SERVER_REQUEST:before-close:count=1");
  assert.equal(outcome.server_requests, 1);
  assert.equal(outcome.close_error, "APP_SERVER_CLOSE_FAILED");
  assert.equal(residualProcessChecks, 1);
  assert.equal(outcome.residual_process_status, "ABSENT");
});

test("successful shutdown closes once and mechanically verifies the App Server PID is absent", async () => {
  let closeCalls = 0;
  let residualProcessChecks = 0;
  const outcome = await finalizeCompilerAppServer({
    server_requests: [],
    close: async () => {
      closeCalls += 1;
    },
    process_alive: () => {
      residualProcessChecks += 1;
      return false;
    },
  });

  assert.equal(closeCalls, 1);
  assert.equal(outcome.status, "PASS");
  assert.equal(outcome.blocker, null);
  assert.equal(outcome.server_requests, 0);
  assert.equal(residualProcessChecks, 1);
  assert.equal(outcome.residual_process_check_performed, true);
  assert.equal(outcome.residual_process_status, "ABSENT");
});
