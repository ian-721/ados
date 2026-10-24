import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const extensionDirectory = join(process.cwd(), "browser-extension");
const profileSource = readFileSync(join(extensionDirectory, "capture-profile.js"), "utf8");
const contentSource = readFileSync(join(extensionDirectory, "content-script.js"), "utf8");
const domFixture = JSON.parse(readFileSync(
  join(extensionDirectory, "fixtures", "chatgpt-message-dom-v0.1.json"),
  "utf8",
));
const extensionId = "fpmliiakgebgdlgaddocgddllidmkomd";

function profileApi() {
  const context = vm.createContext({ URL, TextEncoder, crypto: globalThis.crypto });
  vm.runInContext(profileSource, context);
  return context.ADOS_CAPTURE_PROFILE;
}

function contentRuntime(pathname) {
  const listeners = [];
  const context = vm.createContext({
    URL,
    TextEncoder,
    crypto: globalThis.crypto,
    location: {
      origin: "https://chatgpt.com",
      pathname,
      href: `https://chatgpt.com${pathname}`,
    },
    chrome: {
      runtime: {
        id: extensionId,
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
    },
    getSelection: () => null,
  });
  vm.runInContext(profileSource, context);
  vm.runInContext(contentSource, context);
  assert.equal(listeners.length, 1);
  return { context, listener: listeners[0] };
}

class FakeTextNode {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = null;
    this.childNodes = [];
  }
}

class FakeElementNode {
  constructor(tagName, attributes = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.parentElement = null;
    this.childNodes = [];
    for (const child of children) this.append(child);
  }

  append(child) {
    child.parentElement = this;
    this.childNodes.push(child);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const value = part.trim();
      if (value === "button" || value === "footer" || value === "nav" || value === "blockquote") {
        return this.tagName.toLowerCase() === value;
      }
      if (value === "[hidden]") return Object.hasOwn(this.attributes, "hidden");
      if (value === "[aria-hidden=\"true\"]") return this.getAttribute("aria-hidden") === "true";
      if (value === "[role=\"button\"]") return this.getAttribute("role") === "button";
      if (value === "section[data-testid^=\"conversation-turn-\"]") {
        return this.tagName === "SECTION" && (this.getAttribute("data-testid") ?? "").startsWith("conversation-turn-");
      }
      return false;
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child === node ||
      (child.nodeType === 1 && child.contains(node)));
  }

  querySelectorAll(selector) {
    const matches = [];
    const walk = (node) => {
      if (node.nodeType !== 1) return;
      if (node.matches(selector)) matches.push(node);
      for (const child of node.childNodes) walk(child);
    };
    for (const child of this.childNodes) walk(child);
    return matches;
  }

  getClientRects() {
    return [{}];
  }
}

function structuredContentRuntime(options = {}) {
  const listeners = [];
  const ownerMessage = new FakeElementNode("div", { "data-message-author-role": "user" }, [
    new FakeElementNode("div", {}, [new FakeTextNode("Owner evidence.")]),
  ]);
  const assistantMessage = new FakeElementNode("div", { "data-message-author-role": "assistant" }, [
    new FakeElementNode("p", {}, [new FakeTextNode("Assistant evidence.")]),
    new FakeElementNode("button", {}, [new FakeTextNode("Copy action")]),
    new FakeElementNode("footer", {}, [new FakeTextNode("Footer action")]),
    new FakeElementNode("div", { "aria-hidden": "true" }, [new FakeTextNode("Decorative text")]),
  ]);
  const ownerTurn = new FakeElementNode("section", { "data-testid": "conversation-turn-17" }, [
    new FakeElementNode("h4", {}, [new FakeTextNode("Turn heading UI")]),
    new FakeElementNode("div", {}, [new FakeElementNode("div", {}, [ownerMessage])]),
  ]);
  const assistantTurn = new FakeElementNode("section", { "data-testid": "conversation-turn-18" }, [
    new FakeElementNode("h4", {}, [new FakeTextNode("Turn heading UI")]),
    new FakeElementNode("div", {}, [new FakeElementNode("div", {}, [assistantMessage])]),
  ]);
  const root = new FakeElementNode("main", {}, [ownerTurn, assistantTurn]);
  const context = vm.createContext({
    URL,
    TextEncoder,
    crypto: globalThis.crypto,
    location: {
      origin: "https://chatgpt.com",
      pathname: "/c/conversation-1",
      href: "https://chatgpt.com/c/conversation-1",
    },
    chrome: {
      runtime: {
        id: extensionId,
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
    },
    document: {
      querySelectorAll(selector) {
        if (options.queryFailure === true) throw new TypeError("sanitized DOM probe failure");
        return selector.includes("data-message-author-role") ? [ownerMessage, assistantMessage] : [];
      },
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    getSelection: () => ({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        commonAncestorContainer: root,
        intersectsNode: () => true,
      }),
    }),
  });
  vm.runInContext(profileSource, context);
  vm.runInContext(contentSource, context);
  assert.equal(listeners.length, 1);
  return { context, listener: listeners[0] };
}

function send(listener, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("TEST_RESPONSE_TIMEOUT")), 1000);
    const asyncResponse = listener(message, {}, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    if (asyncResponse === false) clearTimeout(timeout);
  });
}

test("capture routes accept only direct and gizmo/project conversation paths", () => {
  const profile = profileApi();
  for (const path of [
    "/c/00000000-0000-4000-8000-000000000001",
    "/g/g-p-00000000000000000000000000000001-owner-project/c/conversation-1",
  ]) {
    assert.equal(profile.isSupportedConversationPath(path), true, path);
  }
  for (const path of [
    "/",
    "/c/",
    "/c/conversation/extra",
    "/g/project",
    "/g/project/c/",
    "/g/project/c/conversation/extra",
    "/share/conversation",
  ]) {
    assert.equal(profile.isSupportedConversationPath(path), false, path);
  }
});

test("route acceptance and canonical conversation identity share one parse result", async () => {
  const profile = profileApi();
  const cases = [
    {
      url: "https://chatgpt.com/c/conversation-direct-1",
      routeKind: "direct",
    },
    {
      url: "https://chatgpt.com/g/project-1/c/conversation-scoped-1",
      routeKind: "scoped",
    },
  ];
  for (const item of cases) {
    const route = profile.parseConversationRoute(item.url);
    const identity = await profile.parseConversationIdentity(item.url);
    assert.notEqual(route, null, item.url);
    assert.notEqual(identity, null, item.url);
    assert.equal(profile.isSupportedConversationPath(new URL(item.url).pathname), true);
    assert.equal(identity.route_kind, route.route_kind);
    assert.equal(identity.conversation_id, route.conversation_id);
    assert.equal(identity.route_kind, item.routeKind);
    assert.match(
      identity.conversation_ref,
      new RegExp(`^chatgpt://conversation/${item.routeKind}/[a-f0-9]{64}$`, "u"),
    );
  }
});

test("versioned DOM contract accepts only explicit Owner and assistant evidence", () => {
  const profile = profileApi();
  assert.equal(profile.definition.version, "0.1.1-public.1");
  assert.equal(profile.definition.domContract.version, domFixture.contract_version);
  for (const item of domFixture.accepted) {
    const evidence = profile.messageRoleEvidence(item);
    assert.equal(evidence.ok, true, item.name);
    assert.equal(evidence.role, item.expected_role, item.name);
    assert.equal(evidence.raw_role, item.raw_role, item.name);
  }
  for (const item of domFixture.rejected) {
    const evidence = profile.messageRoleEvidence(item);
    assert.equal(evidence.ok, false, item.name);
    assert.equal(evidence.blocker, item.expected_blocker, item.name);
  }
});

test("real-structure equivalent capture is realm-neutral and excludes non-message UI", async () => {
  const runtime = structuredContentRuntime();
  const binding = runtime.context.ADOS_CAPTURE_PROFILE.pageBinding(
    extensionId,
    "https://chatgpt.com",
    "/c/conversation-1",
  );
  const response = await send(runtime.listener, {
    kind: "ADOS_CAPTURE_VISIBLE_SELECTION",
    binding,
  });
  assert.equal(response.ok, true, response.error);
  assert.equal(response.capture.capture_profile_version, "0.1.1-public.1");
  assert.deepEqual(Array.from(response.capture.turns, (turn) => turn.role), ["owner", "assistant"]);
  assert.deepEqual(Array.from(response.capture.turns, (turn) => turn.text), ["Owner evidence.", "Assistant evidence."]);
  assert.ok(response.capture.turns.every((turn) => turn.role_proof.selector ===
    runtime.context.ADOS_CAPTURE_PROFILE.definition.roleSelector));
  assert.doesNotMatch(JSON.stringify(response.capture.turns), /Turn heading UI|Copy action|Footer action|Decorative text/u);
});

test("unclassified DOM failures return a precise fail-closed blocker", async () => {
  const runtime = structuredContentRuntime({ queryFailure: true });
  const binding = runtime.context.ADOS_CAPTURE_PROFILE.pageBinding(
    extensionId,
    "https://chatgpt.com",
    "/c/conversation-1",
  );
  const response = await send(runtime.listener, {
    kind: "ADOS_CAPTURE_VISIBLE_SELECTION",
    binding,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error, "BLOCKED_CAPTURE:DOM_STRUCTURE");
});

test("missing and additional route segments fail closed without a derivable ref", async () => {
  const profile = profileApi();
  for (const path of [
    "/",
    "/c/",
    "/c/conversation/extra",
    "/g/project",
    "/g/project/c/",
    "/g/project/c/conversation/extra",
    "/g//c/conversation",
    "/share/conversation",
  ]) {
    const url = `https://chatgpt.com${path}`;
    assert.equal(profile.isSupportedConversationPath(path), false, path);
    assert.equal(profile.parseConversationRoute(url), null, path);
    assert.equal(await profile.parseConversationIdentity(url), null, path);
  }
  assert.equal(
    await profile.parseConversationIdentity("https://example.invalid/c/conversation"),
    null,
  );
  assert.equal(
    await profile.parseConversationIdentity("https://owner:secret@chatgpt.com/c/conversation"),
    null,
  );
});

test("query, hash, account hints, and project state do not enter durable conversation identity", async () => {
  const profile = profileApi();
  const direct = await profile.parseConversationIdentity("https://chatgpt.com/c/conversation-1");
  const directDecorated = await profile.parseConversationIdentity(
    "https://chatgpt.com/c/conversation-1?account=owner%40example.invalid#dynamic-state",
  );
  const scopedA = await profile.parseConversationIdentity(
    "https://chatgpt.com/g/project-a/c/conversation-1?temporary=1#selection",
  );
  const scopedB = await profile.parseConversationIdentity(
    "https://chatgpt.com/g/project-b/c/conversation-1",
  );
  assert.equal(direct.conversation_ref, directDecorated.conversation_ref);
  assert.equal(scopedA.conversation_ref, scopedB.conversation_ref);
  assert.notEqual(direct.conversation_ref, scopedA.conversation_ref);
  for (const identity of [direct, scopedA]) {
    assert.doesNotMatch(identity.conversation_ref, /https?:|chatgpt\.com|conversation-1|project-|owner/u);
    assert.deepEqual(Object.keys(identity).sort(), ["conversation_id", "conversation_ref", "route_kind"]);
  }
});

test("CAPTURE_PROFILE_PING listener is ready even on a non-conversation ChatGPT route", () => {
  const { context, listener } = contentRuntime("/");
  let response;
  const asynchronous = listener({ kind: "CAPTURE_PROFILE_PING" }, {}, (value) => {
    response = value;
  });
  assert.equal(asynchronous, false);
  assert.equal(response.ok, true);
  assert.equal(response.kind, "CAPTURE_PROFILE_READY");
  assert.equal(response.binding.extension_id, extensionId);
  assert.equal(response.binding.capture_profile_id, context.ADOS_CAPTURE_PROFILE.definition.id);
  assert.equal(response.binding.capture_profile_version, "0.1.1-public.1");
  assert.equal(response.binding.page_origin, "https://chatgpt.com");
  assert.equal(response.binding.page_path, "/");
});

test("capture route fails closed after listener readiness", async () => {
  const unsupported = contentRuntime("/share/conversation");
  const unsupportedBinding = unsupported.context.ADOS_CAPTURE_PROFILE.pageBinding(
    extensionId,
    "https://chatgpt.com",
    "/share/conversation",
  );
  const unsupportedResponse = await send(unsupported.listener, {
    kind: "ADOS_CAPTURE_VISIBLE_SELECTION",
    binding: unsupportedBinding,
  });
  assert.equal(unsupportedResponse.ok, false);
  assert.equal(unsupportedResponse.error, "BLOCKED_CAPTURE:ORIGIN_OR_CONVERSATION");

  const supported = contentRuntime("/g/project/c/conversation");
  const supportedBinding = supported.context.ADOS_CAPTURE_PROFILE.pageBinding(
    extensionId,
    "https://chatgpt.com",
    "/g/project/c/conversation",
  );
  const supportedResponse = await send(supported.listener, {
    kind: "ADOS_CAPTURE_VISIBLE_SELECTION",
    binding: supportedBinding,
  });
  assert.equal(supportedResponse.ok, false);
  assert.equal(supportedResponse.error, "BLOCKED_CAPTURE:SELECTION_EMPTY");
});

test("profile and page bindings fail with exact mismatch codes", () => {
  const profile = profileApi();
  const expected = profile.pageBinding(extensionId, "https://chatgpt.com", "/c/conversation");
  assert.equal(profile.bindingBlocker(expected, { ...expected, extension_id: "other" }), "EXTENSION_ID_MISMATCH");
  assert.equal(
    profile.bindingBlocker(expected, { ...expected, capture_profile_version: "0.2.0" }),
    "CAPTURE_PROFILE_MISMATCH",
  );
  assert.equal(
    profile.bindingBlocker(expected, { ...expected, page_path: "/c/other" }),
    "PAGE_BINDING_MISMATCH",
  );
});

test("active-tab binding detects tab id and route drift", () => {
  const profile = profileApi();
  const expected = profile.tabBinding({
    id: 41,
    url: "https://chatgpt.com/g/project/c/conversation",
  }, extensionId);
  assert.equal(profile.activeTabBlocker(expected, {
    id: 42,
    url: "https://chatgpt.com/g/project/c/conversation",
  }, extensionId), "ACTIVE_TAB_MISMATCH");
  assert.equal(profile.activeTabBlocker(expected, {
    id: 41,
    url: "https://chatgpt.com/g/project/c/other",
  }, extensionId), "ACTIVE_TAB_MISMATCH");
  assert.equal(profile.activeTabBlocker(expected, {
    id: 41,
    url: "https://chatgpt.com/g/project/c/conversation",
  }, extensionId), null);
});
