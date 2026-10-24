import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(join(process.cwd(), "browser-extension", "native-message.js"), "utf8");
const sidePanelSource = readFileSync(join(process.cwd(), "browser-extension", "side-panel.js"), "utf8");

function harness(sendNativeMessage) {
  const timers = new Map();
  let nextTimer = 1;
  const runtime = { sendNativeMessage };
  const context = vm.createContext({
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(source, context);
  return {
    api: context.ADOS_NATIVE_MESSAGE,
    runtime,
    timers,
    fireTimeout() {
      assert.equal(timers.size, 1);
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
  };
}

function sidePanelHarness(restore) {
  const ids = [
    "status-dot", "status-title", "status-detail", "capture", "card", "card-title",
    "readiness", "decisions", "authorization", "risks", "digest-selected", "digest-owner",
    "digest-candidate", "digest-request", "profiles", "confirm", "activation", "receipt-id",
    "activation-id", "request-id", "dispatch", "dispatch-state", "objective-ref", "run-id",
    "target-branch", "candidate-sha", "target-pr", "evidence", "selected-context",
    "target", "lineage", "contract", "boundary", "consequence",
  ];

  function element() {
    const classes = new Set();
    return {
      children: [],
      className: "",
      disabled: false,
      textContent: "",
      classList: {
        add(...values) {
          for (const value of values) classes.add(value);
        },
        remove(...values) {
          for (const value of values) classes.delete(value);
        },
      },
      addEventListener() {},
      append(child) {
        this.children.push(child);
      },
      removeAttribute(name) {
        delete this[name];
      },
      replaceChildren() {
        this.children = [];
      },
    };
  }

  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  const messages = [];
  const context = vm.createContext({
    __restore: restore,
    __messages: messages,
    chrome: {
      runtime: { id: "fpmliiakgebgdlgaddocgddllidmkomd" },
      tabs: {},
    },
    document: {
      createElement: element,
      getElementById(id) {
        return elements[id];
      },
    },
  });
  vm.runInContext(`
    globalThis.ADOS_CAPTURE_PROFILE = {};
    globalThis.ADOS_NATIVE_MESSAGE = {
      send(_runtime, _host, message) {
        globalThis.__messages.push(message);
        if (globalThis.__restore.error) {
          return Promise.reject(new Error(globalThis.__restore.error));
        }
        return Promise.resolve(globalThis.__restore.result);
      },
    };
  `, context);
  vm.runInContext(sidePanelSource, context);
  return {
    elements,
    messages,
    async settle() {
      await new Promise(setImmediate);
      await new Promise(setImmediate);
    },
  };
}

function boundRepairCard() {
  return {
    outcome: "Repair Slice 4 through the existing governed path",
    readiness: "READY",
    requested_authorization: "IMPLEMENT",
    owner_decisions: [{ decision: "Approve IMPLEMENT for this synthetic fixture only; do not merge, release or deploy." }],
    risk_flags: ["multi_repository"],
    forbidden_scope_hints: ["No Ready, Merge, Release or Deploy."],
    target_hint: "EXACT_EXISTING_SLICE4_REPAIR_IDENTITIES",
    authority_notice: "CONFIRM_AUTHORIZES_EXACT_BOUND_REPAIR_AFTER_RECEIPT_ACTIVATION",
    repair_binding: {
      selected_context: {
        authority: "NON_AUTHORITATIVE_SELECTED_ASSISTANT_CONTEXT",
        source_turn_id: "turn-assistant-repair",
        source_quote: "This synthetic repair fixture requires a separate IMPLEMENT decision before any repair Run, candidate revision or evidence update.",
      },
      local: {
        objective_ref: "fixture.invalid/ados-local#11",
        draft_pr: "fixture.invalid/ados-local#12",
        revision_1_sha: "6bfbb7b8b74bad18144c97d439260a98e11384f3",
      },
      fixture: {
        objective_ref: "fixture.invalid/ados-fixture-delivery#5",
        draft_pr: "fixture.invalid/ados-fixture-delivery#6",
        revision_1_sha: "710bd4c9e1ba5912219ba401e205e9cec91268d4",
      },
      evidence_comment: "fixture.invalid/ados-fixture-delivery#6:issuecomment-1000001",
      retained_lineage: "REJECTED_CAUSAL_EVIDENCE_GAP",
      execution_profile: "safety.fixture-dogfood-gate@0.1.1-public.1",
      authorized_effects: ["one", "two", "three", "four", "five"],
      forbidden_effects: ["one", "two"],
    },
    digest_short_codes: {
      selected_turn: "selected",
      owner_turn: "owner",
      candidate: "candidate",
      request: "request",
    },
    capture_profile: "capture.chatgpt.visible-selection@0.1.1-public.1",
    compiler_profile: "compiler.delivery-request@0.2.0",
  };
}

test("native callback timeouts are request-kind aware and bounded", () => {
  const { api } = harness(() => {});
  assert.equal(api.timeoutFor("status"), 15_000);
  assert.equal(api.timeoutFor("restore-ready-card"), 120_000);
  assert.equal(api.timeoutFor("prepare-confirm"), 15_000);
  assert.equal(api.timeoutFor("confirm"), 15_000);
  assert.equal(api.timeoutFor("compile"), 360_000);
  assert.equal(api.timeoutFor("dispatch"), 360_000);
  assert.equal(api.timeoutFor("resume"), 360_000);
  assert.ok(api.timeoutFor("compile") >= 335_000 + 25_000);
  assert.throws(() => api.timeoutFor("unknown"), /BLOCKED_NATIVE_HOST:REQUEST_KIND/u);
});

test("Side Panel startup rehydrates the sole durable Card without Capture, Compiler, JIT, or confirm", () => {
  const handler = /async function restoreStatus\(\) \{([\s\S]*?)\n\}/u.exec(sidePanelSource)?.[1] ?? "";
  assert.match(handler, /kind: "restore-ready-card"/u);
  assert.match(handler, /pending = await nativeMessage/u);
  assert.match(handler, /renderCard\(pending\)/u);
  assert.doesNotMatch(handler, /kind: "compile"|kind: "prepare-confirm"|kind: "confirm"|capture\(\)|beginDispatch/u);
  assert.doesNotMatch(sidePanelSource, /chrome\.storage|sessionStorage|localStorage/u);
});

test("NO_CANDIDATE restoration permits one new capture while keeping confirmation disabled", async () => {
  const state = sidePanelHarness({ error: "BLOCKED_READY_CARD_RESTORE:NO_CANDIDATE" });
  await state.settle();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].schema_version, "slice3a-native-message/v0.1");
  assert.equal(state.messages[0].kind, "restore-ready-card");
  assert.equal(state.elements.capture.disabled, false);
  assert.equal(state.elements.confirm.disabled, true);
  assert.equal(state.elements["status-detail"].textContent, "BLOCKED_READY_CARD_RESTORE:NO_CANDIDATE");
});

test("successful READY Card restoration prevents unintended recapture", async () => {
  const state = sidePanelHarness({
    result: {
      card: boundRepairCard(),
    },
  });
  await state.settle();
  assert.equal(state.elements.capture.disabled, true);
  assert.equal(state.elements.confirm.disabled, false);
  assert.equal(state.elements["status-title"].textContent, "Ready for your confirmation");
  assert.match(state.elements.target.textContent, /ados-local#11.*ados-local#12/su);
  assert.match(state.elements.target.textContent, /ados-fixture-delivery#5.*ados-fixture-delivery#6/su);
  assert.match(state.elements.boundary.textContent, /No protected effect before local_extension_confirm Receipt/u);
});

test("restored unbound Card cannot confirm and permits a replacement capture", async () => {
  const unbound = boundRepairCard();
  delete unbound.repair_binding;
  unbound.target_hint = "UNVERIFIED";
  unbound.authority_notice = "NO_OBJECTIVE_NO_RUN_NO_DISPATCH_NO_TARGET_MUTATION";
  const state = sidePanelHarness({ result: { card: unbound } });
  await state.settle();
  assert.equal(state.elements.capture.disabled, false);
  assert.equal(state.elements.confirm.disabled, true);
  assert.equal(state.elements["status-detail"].textContent, "BLOCKED_READY_CARD_RESTORE:UNBOUND_REPAIR_CARD");
});

test("one visible confirmation click performs prepare-confirm before confirm without Capture or Compiler", () => {
  const handler = /async function confirm\(\) \{([\s\S]*?)\n\}/u.exec(sidePanelSource)?.[1] ?? "";
  assert.match(handler, /kind: "prepare-confirm"/u);
  assert.match(handler, /kind: "confirm"/u);
  assert.ok(handler.indexOf('kind: "prepare-confirm"') < handler.indexOf('kind: "confirm"'));
  assert.doesNotMatch(handler, /kind: "compile"|capture\(\)/u);
  assert.match(handler, /request_digest: pending\.challenge\.request_digest/u);
});

test("native callback success settles and clears its timeout", async () => {
  const result = { status: "PASS" };
  const state = harness((_host, _message, callback) => callback({ ok: true, result }));
  assert.deepEqual(await state.api.send(state.runtime, "host", { kind: "status" }), result);
  assert.equal(state.timers.size, 0);
});

test("missing Chrome callback fails closed and ignores a late callback", async () => {
  let callback;
  const state = harness((_host, _message, value) => {
    callback = value;
  });
  const pending = state.api.send(state.runtime, "host", { kind: "compile" });
  assert.equal([...state.timers.values()][0].delay, 360_000);
  state.fireTimeout();
  await assert.rejects(pending, /BLOCKED_NATIVE_HOST:CALLBACK_TIMEOUT/u);
  callback({ ok: true, result: { late: true } });
  await Promise.resolve();
  assert.equal(state.timers.size, 0);
});

test("Chrome runtime errors are sanitized instead of exposing raw text", async () => {
  const state = harness((_host, _message, callback) => {
    state.runtime.lastError = { message: "raw Chrome implementation detail" };
    callback(undefined);
  });
  await assert.rejects(
    state.api.send(state.runtime, "host", { kind: "confirm" }),
    /BLOCKED_NATIVE_HOST:UNAVAILABLE/u,
  );
  assert.equal(state.timers.size, 0);
});
