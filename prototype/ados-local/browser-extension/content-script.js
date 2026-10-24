const PROFILE_API = globalThis.ADOS_CAPTURE_PROFILE;
const PROFILE = PROFILE_API.definition;

chrome.runtime.onMessage.addListener(onExtensionMessage);

function currentPageBinding() {
  return PROFILE_API.pageBinding(chrome.runtime.id, location.origin, location.pathname);
}

function onExtensionMessage(message, _sender, sendResponse) {
  if (message?.kind === PROFILE_API.messages.ping) {
    sendResponse({
      ok: true,
      kind: PROFILE_API.messages.ready,
      binding: currentPageBinding(),
    });
    return false;
  }
  if (message?.kind !== PROFILE_API.messages.capture) return false;
  void captureSelection(message.binding)
    .then((capture) => sendResponse({ ok: true, capture }))
    .catch((error) => sendResponse({
      ok: false,
      error: captureBlocker(error),
    }));
  return true;
}

function blocked(code) {
  throw new Error(`BLOCKED_CAPTURE:${code}`);
}

function captureBlocker(error) {
  const message = error && typeof error.message === "string" ? error.message : "";
  const match = /^BLOCKED_CAPTURE:[A-Z0-9_]+/u.exec(message);
  return match?.[0] ?? "BLOCKED_CAPTURE:DOM_STRUCTURE";
}

function normalizeText(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function visible(element) {
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    element.getAttribute("aria-hidden") !== "true";
}

function isElementNode(node) {
  return node !== null &&
    typeof node === "object" &&
    node.nodeType === 1 &&
    typeof node.tagName === "string" &&
    typeof node.getAttribute === "function" &&
    typeof node.matches === "function";
}

function intersects(range, node) {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

async function stableTurnId(order, role, text) {
  const bytes = new TextEncoder().encode(JSON.stringify({ order, role, text }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const code = [...digest.subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `turn-${code}`;
}

function messageEvidence(message) {
  if (!isElementNode(message) || message.tagName.toLowerCase() !== "div") {
    return blocked("MESSAGE_CONTAINER");
  }
  const turn = message.closest(PROFILE.domContract.turnSelector);
  const evidence = PROFILE_API.messageRoleEvidence({
    message_tag: message.tagName.toLowerCase(),
    raw_role: message.getAttribute("data-message-author-role"),
    turn_tag: turn?.tagName?.toLowerCase() ?? null,
    turn_testid: turn?.getAttribute?.("data-testid") ?? null,
  });
  if (evidence.ok !== true) return blocked(evidence.blocker);
  return evidence;
}

function domText(root, excludeQuotes) {
  const parts = [];
  function visit(node) {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (!isElementNode(node)) return;
    if (node !== root) {
      if (excludeQuotes && node.tagName.toLowerCase() === "blockquote") return;
      if (node.matches(PROFILE.domContract.excludedTextSelector)) return;
    }
    for (const child of node.childNodes) visit(child);
  }
  visit(root);
  return normalizeText(parts.join(" "));
}

async function captureSelection(expectedBinding) {
  const bindingError = PROFILE_API.bindingBlocker(expectedBinding, currentPageBinding());
  if (bindingError !== null) return blocked(bindingError);
  const conversationIdentity = await PROFILE_API.parseConversationIdentity(location.href);
  if (conversationIdentity === null) {
    return blocked("ORIGIN_OR_CONVERSATION");
  }
  const selection = getSelection();
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) {
    return blocked("SELECTION_EMPTY");
  }
  const range = selection.getRangeAt(0);
  const messages = [...document.querySelectorAll(PROFILE.roleSelector)]
    .filter((node) => isElementNode(node) && visible(node) && intersects(range, node));
  if (messages.length === 0 || messages.length > PROFILE.maxTurns) {
    return blocked("MESSAGE_WINDOW");
  }
  const turns = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    const evidence = messageEvidence(message);
    const quotes = [...message.querySelectorAll("blockquote")]
      .filter((node) => isElementNode(node) &&
        visible(node) &&
        intersects(range, node) &&
        node.parentElement?.closest("blockquote") === null);
    const mainText = domText(message, true);
    if (mainText.length > 0) {
      const order = messageIndex * 100;
      turns.push({
        turn_id: await stableTurnId(order, evidence.role, mainText),
        order,
        role: evidence.role,
        text: mainText,
        role_proof: {
          selector: PROFILE.roleSelector,
          raw_role: evidence.raw_role,
          quoted: false,
          visible: true,
        },
      });
    }
    for (let quoteIndex = 0; quoteIndex < quotes.length; quoteIndex += 1) {
      const quoteText = domText(quotes[quoteIndex], false);
      if (quoteText.length === 0) continue;
      const order = messageIndex * 100 + quoteIndex + 1;
      turns.push({
        turn_id: await stableTurnId(order, "quoted_external", quoteText),
        order,
        role: "quoted_external",
        text: quoteText,
        role_proof: {
          selector: PROFILE.roleSelector,
          raw_role: evidence.raw_role,
          quoted: true,
          visible: true,
        },
      });
    }
  }
  if (turns.length === 0 || !turns.some((turn) => turn.role === "owner")) {
    return blocked("OWNER_TURN_MISSING");
  }
  return {
    schema_version: "chatgpt-capture-pack/v0.1",
    capture_profile_id: PROFILE.id,
    capture_profile_version: PROFILE.version,
    page_origin: PROFILE.origin,
    conversation_ref: conversationIdentity.conversation_ref,
    captured_at: new Date().toISOString(),
    selected_turn_ids: turns.map((turn) => turn.turn_id),
    turns,
    retention: "local_raw_until_submit",
  };
}
