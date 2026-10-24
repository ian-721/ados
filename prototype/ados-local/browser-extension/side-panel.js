const HOST = "org.ados.public_fixture.slice3a";
const PROTOCOL = "slice3a-native-message/v0.1";
const CAPTURE_PROFILE = globalThis.ADOS_CAPTURE_PROFILE;
const NATIVE_MESSAGE = globalThis.ADOS_NATIVE_MESSAGE;

const elements = Object.fromEntries([
  "status-dot", "status-title", "status-detail", "capture", "card", "card-title",
  "readiness", "decisions", "authorization", "risks", "digest-selected", "digest-owner",
  "digest-candidate", "digest-request", "profiles", "confirm", "activation", "receipt-id",
  "activation-id", "request-id",
  "dispatch", "dispatch-state", "objective-ref", "run-id", "target-branch",
  "candidate-sha", "target-pr", "evidence", "selected-context", "target", "lineage",
  "contract", "boundary", "consequence",
].map((id) => [id, document.getElementById(id)]));

let pending = null;

function setStatus(kind, title, detail) {
  elements["status-dot"].className = `status-dot ${kind}`;
  elements["status-title"].textContent = title;
  elements["status-detail"].textContent = detail;
}

function list(target, values, empty = "None") {
  target.replaceChildren();
  const items = values.length === 0 ? [empty] : values;
  for (const value of items) {
    const item = document.createElement("li");
    item.textContent = value;
    target.append(item);
  }
}

function nativeMessage(message) {
  return NATIVE_MESSAGE.send(chrome.runtime, HOST, message);
}

function blockerCode(error, fallback) {
  const value = error instanceof Error ? error.message.split(/\s/u)[0] : "";
  return /^BLOCKED_[A-Z0-9_]+(?::[A-Z0-9_]+)+$/u.test(value) ? value : fallback;
}

function isBoundRepairCard(card) {
  const binding = card?.repair_binding;
  return card?.target_hint === "EXACT_EXISTING_SLICE4_REPAIR_IDENTITIES" &&
    card?.authority_notice === "CONFIRM_AUTHORIZES_EXACT_BOUND_REPAIR_AFTER_RECEIPT_ACTIVATION" &&
    binding?.selected_context?.authority === "NON_AUTHORITATIVE_SELECTED_ASSISTANT_CONTEXT" &&
    binding?.selected_context?.source_quote ===
      "This synthetic repair fixture requires a separate IMPLEMENT decision before any repair Run, candidate revision or evidence update." &&
    binding?.local?.objective_ref === "fixture.invalid/ados-local#11" &&
    binding?.local?.draft_pr === "fixture.invalid/ados-local#12" &&
    binding?.local?.revision_1_sha === "6bfbb7b8b74bad18144c97d439260a98e11384f3" &&
    binding?.fixture?.objective_ref === "fixture.invalid/ados-fixture-delivery#5" &&
    binding?.fixture?.draft_pr === "fixture.invalid/ados-fixture-delivery#6" &&
    binding?.fixture?.revision_1_sha === "710bd4c9e1ba5912219ba401e205e9cec91268d4" &&
    binding?.evidence_comment === "fixture.invalid/ados-fixture-delivery#6:issuecomment-1000001" &&
    binding?.retained_lineage === "REJECTED_CAUSAL_EVIDENCE_GAP" &&
    binding?.execution_profile === "safety.fixture-dogfood-gate@0.1.1-public.1" &&
    Array.isArray(binding?.authorized_effects) && binding.authorized_effects.length === 5 &&
    Array.isArray(binding?.forbidden_effects) && binding.forbidden_effects.length === 2;
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch {
    throw new Error("BLOCKED_CAPTURE:ACTIVE_TAB");
  }
}

async function tabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error("BLOCKED_CAPTURE:CONTENT_SCRIPT_UNREACHABLE");
  }
}

async function readyCaptureBinding() {
  const initialTab = await activeTab();
  const binding = CAPTURE_PROFILE.tabBinding(initialTab, chrome.runtime.id);
  if (binding.page_origin !== CAPTURE_PROFILE.definition.origin) {
    throw new Error("BLOCKED_CAPTURE:ACTIVE_TAB_ORIGIN");
  }
  const pong = await tabMessage(binding.tab_id, {
    kind: CAPTURE_PROFILE.messages.ping,
    binding,
  });
  if (pong?.ok !== true || pong.kind !== CAPTURE_PROFILE.messages.ready) {
    throw new Error("BLOCKED_CAPTURE:PROFILE_PING_REJECTED");
  }
  const bindingError = CAPTURE_PROFILE.bindingBlocker(binding, pong.binding);
  if (bindingError !== null) throw new Error(`BLOCKED_CAPTURE:${bindingError}`);
  const currentTab = await activeTab();
  const activeError = CAPTURE_PROFILE.activeTabBlocker(binding, currentTab, chrome.runtime.id);
  if (activeError !== null) throw new Error(`BLOCKED_CAPTURE:${activeError}`);
  return binding;
}

function renderCard(result) {
  const card = result.card;
  const binding = card.repair_binding;
  const bound = isBoundRepairCard(card);
  elements.card.classList.remove("hidden");
  elements["card-title"].textContent = card.outcome;
  elements.readiness.textContent = card.readiness;
  elements.authorization.textContent = card.requested_authorization;
  list(elements.decisions, card.owner_decisions.map((item) => item.decision));
  elements["selected-context"].textContent = bound
    ? `${binding.selected_context.source_quote}\nSource: selected assistant turn ${binding.selected_context.source_turn_id}; authority remains the adjacent grounded Owner decision.`
    : "Selected assistant context is not bound to the exact Repair contract.";
  elements.target.textContent = bound
    ? `${binding.local.objective_ref} · ${binding.local.draft_pr}\n${binding.fixture.objective_ref} · ${binding.fixture.draft_pr}`
    : "Unverified hint";
  list(elements.lineage, bound ? [
    `ADOS Local r1 ${binding.local.revision_1_sha}`,
    `Fixture r1 ${binding.fixture.revision_1_sha}`,
    `${binding.retained_lineage} · ${binding.evidence_comment}`,
  ] : [], "Unbound");
  list(elements.contract, bound ? binding.authorized_effects : [], "No bound Repair effects");
  list(elements.risks, [...card.risk_flags, ...card.forbidden_scope_hints]);
  elements.boundary.textContent = bound
    ? "No protected effect before local_extension_confirm Receipt, immutable Activation and exact Activation-to-repair-Run binding. Only the listed Repair effects are authorized afterward."
    : "No Objective · No Run · No dispatch · No target mutation";
  elements.consequence.textContent = bound
    ? "RECEIPT · ACTIVATION · EXACT BOUND REPAIR"
    : "NOT CONFIRMABLE · TARGET OR AUTHORITY UNBOUND";
  elements["digest-selected"].textContent = card.digest_short_codes.selected_turn;
  elements["digest-owner"].textContent = card.digest_short_codes.owner_turn;
  elements["digest-candidate"].textContent = card.digest_short_codes.candidate;
  elements["digest-request"].textContent = card.digest_short_codes.request;
  elements.profiles.textContent = `${card.capture_profile} · ${card.compiler_profile}`;
  elements.confirm.disabled = !bound ||
    !(card.readiness === "READY" || card.readiness === "READY_WITH_ASSUMPTIONS");
  return bound;
}

function renderActivation(intake) {
  elements.activation.classList.remove("hidden");
  elements.card.classList.add("hidden");
  elements["receipt-id"].textContent = intake.receipt.receipt_id.slice(0, 20);
  elements["activation-id"].textContent = intake.activation.activation_id.slice(0, 20);
  elements["request-id"].textContent = intake.request_id.slice(0, 20);
  setStatus("pass", "Authenticated Activation ready", "Dispatch uses the same immutable Request and Receipt without a second confirmation.");
}

function safeGithubLink(element, value) {
  if (typeof value === "string" && /^https:\/\/github\.com\/fixture\.invalid\/ados-fixture-delivery\/pull\/\d+(?:#.*)?$/u.test(value)) {
    element.href = value;
    element.classList.remove("hidden");
  } else {
    element.removeAttribute("href");
    element.classList.add("hidden");
  }
}

function renderDispatch(status) {
  if (!status) return;
  elements.dispatch.classList.remove("hidden");
  elements["dispatch-state"].textContent = status.state;
  elements["objective-ref"].textContent = status.objective_ref ?? "Resolving";
  elements["run-id"].textContent = status.run_id?.slice(0, 36) ?? "Pending";
  elements["target-branch"].textContent = status.target_branch ?? "Pending";
  elements["candidate-sha"].textContent = status.candidate_sha?.slice(0, 12) ?? "Pending";
  safeGithubLink(elements["target-pr"], status.target_pr_url);
  safeGithubLink(elements.evidence, status.evidence_url);
  if (status.state === "OWNER_REVIEW") {
    setStatus("pass", "Candidate ready for Owner review", "The fixture Draft PR and candidate-bound Evidence are ready. No Ready, merge, release or deploy occurred.");
  } else if (status.state === "BLOCKED") {
    setStatus("blocked", "Fulfillment blocked", status.blocker ?? "BLOCKED_DISPATCH:UNKNOWN");
  } else {
    setStatus("working", status.state, "The same Run, worktree, Codex session, candidate revision and publication identities are being reconciled.");
  }
}

async function statusFor(requestDigest) {
  return nativeMessage({ schema_version: PROTOCOL, kind: "status", request_digest: requestDigest });
}

async function beginDispatch(intake) {
  setStatus("working", "RESOLVING", "Resolving the sole eligible RUNNING fixture Objective and freezing one Run Envelope.");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await nativeMessage({
        schema_version: PROTOCOL,
        kind: attempt === 0 ? "dispatch" : "resume",
        activation_id: intake.activation.activation_id,
      });
    } catch (error) {
      const code = blockerCode(error, "BLOCKED_DISPATCH:UNKNOWN");
      if (code !== "BLOCKED_NATIVE_HOST:UNAVAILABLE") {
        throw error;
      }
    }
    const restored = await statusFor(intake.request_digest);
    renderDispatch(restored.dispatch);
    if (restored.dispatch?.state === "OWNER_REVIEW") return;
    if (restored.dispatch?.state === "BLOCKED") {
      throw new Error(restored.dispatch.blocker ?? "BLOCKED_DISPATCH:STATE");
    }
    if (!["RUNNING", "RECOVERING", "VERIFYING", "PUBLISHING"].includes(restored.dispatch?.state)) {
      throw new Error("BLOCKED_DISPATCH:STATE");
    }
    setStatus("working", "RECOVERING", "Resuming the same repair Run, worktree, persistent Codex session and candidate through authoritative readback.");
  }
  throw new Error("BLOCKED_DISPATCH:RECOVERY_LIMIT");
}

async function capture() {
  pending = null;
  elements.capture.disabled = true;
  elements.confirm.disabled = true;
  elements.card.classList.add("hidden");
  elements.activation.classList.add("hidden");
  elements.dispatch.classList.add("hidden");
  setStatus("working", "Checking capture profile", "The active ChatGPT tab and loaded capture profile are being bound.");
  let fallback = "BLOCKED_CAPTURE:PROFILE_RUNTIME";
  try {
    const binding = await readyCaptureBinding();
    setStatus("working", "Capturing visible selection", "Role proof and local digests are being validated.");
    fallback = "BLOCKED_CAPTURE:CONTENT_RESPONSE";
    const response = await tabMessage(binding.tab_id, {
      kind: CAPTURE_PROFILE.messages.capture,
      binding,
    });
    if (response?.ok !== true) {
      throw new Error(blockerCode(new Error(response?.error ?? ""), fallback));
    }
    setStatus("working", "Compiling locally", "The frozen no-tool Compiler Profile is producing one candidate.");
    fallback = "BLOCKED_COMPILER:CALL";
    pending = await nativeMessage({ schema_version: PROTOCOL, kind: "compile", capture: response.capture });
    fallback = "BLOCKED_COMPILER:RESULT";
    if (!renderCard(pending)) {
      pending = null;
      throw new Error("BLOCKED_INTAKE:UNBOUND_REPAIR_CARD");
    }
    setStatus("ready", "Ready for your confirmation", "Read the exact Card. Confirmation creates durable intake only.");
  } catch (error) {
    pending = null;
    const code = blockerCode(error, fallback);
    setStatus("blocked", "Capture blocked", code);
  } finally {
    elements.capture.disabled = pending !== null;
  }
}

async function confirm() {
  if (!pending || !isBoundRepairCard(pending.card)) return;
  elements.confirm.disabled = true;
  setStatus("working", "Revalidating approval", "The same Card and live Objective bindings are being checked without durable writes.");
  try {
    const prepared = await nativeMessage({
      schema_version: PROTOCOL,
      kind: "prepare-confirm",
      challenge: pending.challenge,
      challenge_token: pending.challenge_token,
    });
    setStatus("working", "Committing approved intake", "The original Challenge is consumed once; Request, Receipt and Activation are atomic.");
    let result;
    try {
      result = await nativeMessage({
        schema_version: PROTOCOL,
        kind: "confirm",
        challenge: pending.challenge,
        challenge_token: pending.challenge_token,
        jit_binding: prepared.jit_binding,
        jit_token: prepared.jit_token,
      });
    } catch (error) {
      const code = blockerCode(error, "BLOCKED_RECEIPT:UNKNOWN");
      if (code !== "BLOCKED_NATIVE_HOST:CALLBACK_TIMEOUT" && code !== "BLOCKED_NATIVE_HOST:UNAVAILABLE") {
        throw error;
      }
      const readback = await nativeMessage({
        schema_version: PROTOCOL,
        kind: "status",
        request_digest: pending.challenge.request_digest,
      });
      if (!readback.intake) throw error;
      result = readback.intake;
    }
    renderActivation(result);
    pending = null;
    await beginDispatch(result);
  } catch (error) {
    setStatus("blocked", "Delivery blocked", blockerCode(error, "BLOCKED_RECEIPT:UNKNOWN"));
    elements.confirm.disabled = false;
  }
}

/*
 * Confirmation remains one Owner-visible click. The two Native Messaging calls
 * are intentionally internal and neither prepare-confirm nor readback can mint
 * a second Card or invoke Capture/Compiler.
 */

async function restoreStatus() {
  elements.capture.disabled = true;
  elements.confirm.disabled = true;
  setStatus("working", "Restoring approved Card", "Loading the sole immutable READY Card through the latest JIT runtime without Capture or Compiler.");
  try {
    pending = await nativeMessage({ schema_version: PROTOCOL, kind: "restore-ready-card" });
    if (renderCard(pending)) {
      setStatus("ready", "Ready for your confirmation", "The same immutable IMPLEMENT / READY Card was rehydrated. Review only; no confirmation has occurred.");
    } else {
      pending = null;
      elements.capture.disabled = false;
      elements.confirm.disabled = true;
      setStatus("blocked", "READY Card replacement required", "BLOCKED_READY_CARD_RESTORE:UNBOUND_REPAIR_CARD");
    }
  } catch (error) {
    pending = null;
    const code = blockerCode(error, "BLOCKED_READY_CARD_RESTORE:UNKNOWN");
    setStatus("blocked", "READY Card restoration blocked", code);
    elements.capture.disabled = ![
      "BLOCKED_READY_CARD_RESTORE:NO_CANDIDATE",
      "BLOCKED_READY_CARD_RESTORE:FROZEN_IDENTITY_DRIFT",
    ].includes(code);
    elements.confirm.disabled = true;
  }
}

elements.capture.addEventListener("click", () => void capture());
elements.confirm.addEventListener("click", () => void confirm());
void restoreStatus();
