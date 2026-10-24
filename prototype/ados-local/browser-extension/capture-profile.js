(() => {
  "use strict";

  const domContract = Object.freeze({
    version: "chatgpt-message-dom/v0.1",
    turnSelector: "section[data-testid^=\"conversation-turn-\"]",
    messageSelector: "section[data-testid^=\"conversation-turn-\"] div[data-message-author-role=\"user\"], section[data-testid^=\"conversation-turn-\"] div[data-message-author-role=\"assistant\"]",
    excludedTextSelector: "button, footer, nav, [hidden], [aria-hidden=\"true\"], [role=\"button\"]",
  });

  const definition = Object.freeze({
    id: "capture.chatgpt.visible-selection",
    version: "0.1.1-public.1",
    origin: "https://chatgpt.com",
    roleSelector: domContract.messageSelector,
    domContract,
    maxTurns: 64,
  });

  const messages = Object.freeze({
    ping: "CAPTURE_PROFILE_PING",
    ready: "CAPTURE_PROFILE_READY",
    capture: "ADOS_CAPTURE_VISIBLE_SELECTION",
  });

  function parseConversationRoute(value) {
    if (typeof value !== "string") return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.origin !== definition.origin || url.username !== "" || url.password !== "") return null;
    const direct = /^\/c\/([A-Za-z0-9._-]+)$/u.exec(url.pathname);
    if (direct !== null) {
      return Object.freeze({ route_kind: "direct", conversation_id: direct[1] });
    }
    const scoped = /^\/g\/[A-Za-z0-9._-]+\/c\/([A-Za-z0-9._-]+)$/u.exec(url.pathname);
    if (scoped !== null) {
      return Object.freeze({ route_kind: "scoped", conversation_id: scoped[1] });
    }
    return null;
  }

  async function conversationRef(route) {
    const preimage = `chatgpt-conversation-v0.1\u0000${route.route_kind}\u0000${route.conversation_id}`;
    const bytes = new TextEncoder().encode(preimage);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const code = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `chatgpt://conversation/${route.route_kind}/${code}`;
  }

  async function parseConversationIdentity(value) {
    const route = parseConversationRoute(value);
    if (route === null) return null;
    return Object.freeze({
      ...route,
      conversation_ref: await conversationRef(route),
    });
  }

  function messageRoleEvidence(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return Object.freeze({ ok: false, blocker: "MESSAGE_CONTAINER" });
    }
    if (
      value.message_tag !== "div" ||
      value.turn_tag !== "section" ||
      typeof value.turn_testid !== "string" ||
      !/^conversation-turn-[0-9]+$/u.test(value.turn_testid)
    ) {
      return Object.freeze({ ok: false, blocker: "MESSAGE_CONTAINER" });
    }
    if (value.raw_role === "user") {
      return Object.freeze({ ok: true, role: "owner", raw_role: "user" });
    }
    if (value.raw_role === "assistant") {
      return Object.freeze({ ok: true, role: "assistant", raw_role: "assistant" });
    }
    return Object.freeze({ ok: false, blocker: "ROLE_EVIDENCE" });
  }

  function isSupportedConversationPath(pathname) {
    try {
      return parseConversationRoute(new URL(pathname, definition.origin).href) !== null;
    } catch {
      return false;
    }
  }

  function pageBinding(extensionId, origin, pathname) {
    return {
      extension_id: extensionId,
      capture_profile_id: definition.id,
      capture_profile_version: definition.version,
      page_origin: origin,
      page_path: pathname,
    };
  }

  function tabBinding(tab, extensionId) {
    if (!Number.isInteger(tab?.id) || tab.id <= 0 || typeof tab.url !== "string") {
      throw new Error("BLOCKED_CAPTURE:ACTIVE_TAB");
    }
    let url;
    try {
      url = new URL(tab.url);
    } catch {
      throw new Error("BLOCKED_CAPTURE:ACTIVE_TAB");
    }
    return {
      tab_id: tab.id,
      ...pageBinding(extensionId, url.origin, url.pathname),
    };
  }

  function bindingBlocker(expected, actual) {
    if (expected === null || typeof expected !== "object" || actual === null || typeof actual !== "object") {
      return "PROFILE_BINDING_MISMATCH";
    }
    if (actual.extension_id !== expected.extension_id) return "EXTENSION_ID_MISMATCH";
    if (
      actual.capture_profile_id !== expected.capture_profile_id ||
      actual.capture_profile_version !== expected.capture_profile_version
    ) {
      return "CAPTURE_PROFILE_MISMATCH";
    }
    if (actual.page_origin !== expected.page_origin || actual.page_path !== expected.page_path) {
      return "PAGE_BINDING_MISMATCH";
    }
    return null;
  }

  function activeTabBlocker(expected, tab, extensionId) {
    let actual;
    try {
      actual = tabBinding(tab, extensionId);
    } catch {
      return "ACTIVE_TAB_MISMATCH";
    }
    if (actual.tab_id !== expected?.tab_id) return "ACTIVE_TAB_MISMATCH";
    const mismatch = bindingBlocker(expected, actual);
    return mismatch === "PAGE_BINDING_MISMATCH" ? "ACTIVE_TAB_MISMATCH" : mismatch;
  }

  globalThis.ADOS_CAPTURE_PROFILE = Object.freeze({
    definition,
    messages,
    parseConversationRoute,
    parseConversationIdentity,
    messageRoleEvidence,
    isSupportedConversationPath,
    pageBinding,
    tabBinding,
    bindingBlocker,
    activeTabBlocker,
  });
})();
