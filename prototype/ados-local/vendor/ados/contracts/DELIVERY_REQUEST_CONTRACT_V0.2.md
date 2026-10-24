# ADOS Delivery Request Contract v0.2

## 1｜Purpose

A Delivery Request is the approved, platform-independent handoff from a conversation surface into ADOS.

It captures:

> **what the Owner has decided should be delivered, at what authorization level, with what quality and acceptance boundary**

It does not capture:

> **how the current machine, repository or Agent will execute it**

A Delivery Request exists before repository discovery, Harness loading, local-path resolution, worktree creation, credential use, Agent selection or command execution.

Canonical serialization: `contracts/schemas/delivery-request-v0.2.schema.json`.

---

## 2｜The web AI is not the contract authority

The web AI may help the Owner think, propose decisions and summarize the conversation. It is not required or trusted to emit the final canonical JSON.

The Alpha standardization path is:

```text
selected conversation evidence
→ local Delivery Compiler
→ schema-constrained candidate
→ deterministic semantic validation
→ compact Delivery Card
→ one Owner confirmation
→ immutable approved Delivery Request
```

The browser surface supplies evidence. The local Compiler owns canonicalization. The Owner owns authorization.

A platform-native structured tool call may become another Capture/Profile later, but it cannot weaken the same local validation and Owner-receipt requirements.

---

## 3｜Authority boundary

A conversation AI, browser page, extension content script, Agent or external document may not:

- grant authorization；
- infer silence as approval；
- convert quoted or pasted text into Owner decisions；
- select a local repository as authoritative without local resolution；
- invent a commit SHA, Harness pin, credential, command, deployment target or local path；
- mark readiness without the local validator；
- mark a task complete。

A `READY` or `READY_WITH_ASSUMPTIONS` request requires an Owner Authorization Receipt that matches the exact request content.

`NEEDS_OWNER_DECISION` and `REJECTED` requests cannot carry an active approval receipt.

---

## 4｜Conversation Evidence Pack

Capture may provide selected evidence containing:

- platform and Capture Profile；
- opaque conversation reference；
- selected message roles and origins；
- selected-turn digest；
- explicit Owner-approval-turn digest；
- retention mode。

All captured content is untrusted data except an independently verified Owner receipt.

The Compiler must distinguish:

- Owner statements；
- assistant proposals；
- quoted/pasted external content；
- tool output；
- inferred assumptions；
- unresolved decisions。

Raw selected conversation remains local by default. Remote persistence may use minimized fields, digests and references.

---

## 5｜Required semantics

### `request_id`

Stable idempotency identity for one proposed delivery. Re-submission reconciles the same request instead of creating a second approved task.

### `capture`

Binds the request to one Capture Profile and selected evidence window. Role attribution that cannot be proven produces `NEEDS_OWNER_DECISION` or `REJECTED`; it is never guessed.

### `compiler`

Records the Compiler implementation, deterministic rules, semantic Compiler Profile/capability digest and optional model reference. A model can propose structure but cannot satisfy authorization, readiness or completion.

### `outcome`

One Owner-verifiable end state, not an activity, phase, audit or vague direction.

### `why_now`

The current user value, defect, bottleneck, obligation or opportunity.

### `owner_decisions`

Only explicit Owner decisions that materially constrain the delivery.

### `assumptions`

Only low-risk, local and reversible assumptions that do not change product direction, system responsibility, authorization, major cost, sensitive-data boundary or irreversible state.

### `open_decisions`

Material unresolved choices. A request with any material open decision cannot be `READY*`.

### `requested_authorization`

The requested upper bound:

```text
DISCOVERY | PLAN | IMPLEMENT | MERGE | RELEASE
```

This is not a grant.

### `target_hint`

Conversation-derived delivery class, project or repository hints. The Local Resolver verifies them and may reject them.

### Scope hints

`allowed_scope_hints` and `forbidden_scope_hints` are intent, not filesystem permission.

### Quality and acceptance

The request separates:

- quality bar；
- engineering acceptance；
- product acceptance；
- Owner Artifact。

Engineering success never equals product acceptance.

### `risk_flags`

Closed high-level signals that force local policy evaluation. An empty array is not proof of safety.

### `readiness`

```text
READY
READY_WITH_ASSUMPTIONS
NEEDS_OWNER_DECISION
REJECTED
```

---

## 6｜Canonical digest

`request_digest` is the SHA-256 digest of the canonical request payload:

- serialized under one documented canonical JSON profile；
- excluding `request_digest` itself；
- excluding `owner_authorization_receipt`；
- including all Capture, Compiler, Outcome, decision, scope, quality, acceptance, risk and readiness fields。

The receipt signs/binds this digest.

Any change to the canonical payload invalidates the receipt and requires:

- a new digest；
- a new Owner confirmation；
- and, when materially different, a new `request_id` or explicit supersession record。

This avoids self-referential hashing and approval-after-mutation ambiguity.

---

## 7｜Owner Authorization Receipt v0.2

Required fields:

```text
receipt_id
actor_id
authn_method
action=approve_delivery
authorization
approval_ref
owner_turn_digest
request_digest
approved_at
```

Alpha authentication methods:

```text
local_extension_confirm
os_user_presence
platform_signed
external_owner_record
```

For `PLAN` or above, the receipt requires both:

1. an explicit Owner approval reference in the selected evidence or another authoritative Owner record；
2. one local user-presence confirmation of the final Delivery Card。

The local confirmation creates the receipt; the web AI cannot create it.

The Runtime rejects a receipt when:

- receipt id was replayed against another request；
- authorization differs from `requested_authorization`；
- request digest differs；
- Owner-turn digest differs；
- approval reference is absent or no longer resolves；
- request changed after confirmation；
- authentication method is unavailable or untrusted；
- project governance requires a separate higher-level approval。

---

## 8｜Compiler invariants

The Delivery Compiler must:

1. produce one Outcome；
2. preserve explicit Owner product taste and quality；
3. separate decisions, assumptions and unknowns；
4. retain external text as untrusted evidence；
5. identify requested authorization；
6. emit one readiness state；
7. flag protected or irreversible areas；
8. ask at most one highest-leverage material question；
9. never invent local execution facts；
10. create the canonical content digest；
11. retain traceability to selected evidence without uploading raw content by default；
12. return structured rejection when the conversation contains multiple unrelated deliveries。

The deterministic validator, not the language model, decides whether the candidate conforms to this contract.

---

## 9｜Local resolution

A valid request is input to the Local Resolver, which may produce:

- a new Objective proposal；
- a transition proposal for an existing Objective；
- `NEEDS_OWNER_DECISION`；
- `BLOCKED`；
- `REJECTED`。

The Resolver verifies:

- Portfolio WIP；
- project registry；
- authoritative repository；
- Objective authority surface；
- current Harness and accepted decisions；
- exact base；
- Git/worktree state；
- protected areas；
- available execution and Forge Profiles；
- required credentials；
- existing run/candidate identity；
- Artifact and acceptance route。

Only after this resolution may the Coordinator freeze a Run Envelope.

The Resolver must not silently reinterpret the approved request.

---

## 10｜Alpha Compiler Gate

Before the full product implementation is approved, a bounded Compiler/Capture spike must compare credible structured-output paths, including at least:

- local invocation of a schema-capable model using a user-owned credential or existing authenticated host；
- a vendor-native structured-output path, when available；
- deterministic no-model rejection/validation fallback。

It must prove:

- selected-turn role attribution；
- schema-constrained extraction；
- one material-question behavior；
- request canonicalization；
- receipt binding；
- mutation invalidation；
- no dependency on the web AI obeying an injected prompt。

The final Compiler host remains replaceable behind the contract.

---

## 11｜Privacy and retention

Default local-only:

- raw selected conversation；
- local paths；
- process details；
- credentials；
- private customer content。

Default remote-safe:

- minimized request；
- digests；
- references；
- status；
- Evidence。

Telemetry is opt-in and excludes raw task content by default.

---

## 12｜Versioning

`ados-delivery-request/v0.2` is immutable for a consumed request.

A schema change creates a new version. It never silently migrates an active Objective or Run.
