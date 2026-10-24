# ADOS Adapter Profile Contract v0.1

## 1｜Purpose

An ADOS Adapter Profile maps ADOS fulfillment semantics onto an existing execution, capture, forge, verifier or remote-resource protocol.

It is not a new universal wire protocol.

---

## 2｜Profile classes

```text
capture.browser
compiler.semantic
executor.local_agent
forge.github
verifier.local
sensor.remote
executor.remote
```

Alpha implements later:

- one `capture.browser`；
- one `compiler.semantic` or deterministic compiler fallback；
- one `executor.local_agent`；
- one `forge.github`；
- local verifiers。

---

## 3｜Required profile document

```text
profile_id
profile_version
adapter_class
transport_protocol
transport_version
implementation_identity
supported_os
capabilities
required_permissions
policy_mapping
event_mapping
evidence_mapping
recovery_semantics
cancel_semantics
cleanup_semantics
known_limits
security_notes
```

Capability document is hashed and pinned in Run Envelope.

---

## 4｜Protocol composition

### Agent Client

Use:

- ACP where supported；
- vendor-native APIs where necessary。

Alpha candidates:

- Codex App Server；
- Codex SDK；
- `codex exec`。

### Tools

MCP profile maps allowed tools/resources to ADOS Policy.

### Remote Agents

A2A profile is future-only.

### Forge

GitHub REST/GraphQL/Git/gh as implementation, under one Profile.

---

## 5｜ADOS-specific binding

Every operation binds:

```text
run_id
objective_id
envelope_digest
operation_id
idempotency_key
requested capability
deadline
```

Profile rejects mismatch.

---

## 6｜Event normalization

Required event fields:

```text
event_id
run_id
operation_id
sequence
occurred_at
type
severity
summary
evidence_refs
requires_owner
source_trust
```

Core event types:

- OPERATION_STARTED；
- PROGRESS；
- FILE_CHANGE；
- COMMAND_STARTED / FINISHED；
- CHECK_RESULT；
- ARTIFACT_READY；
- APPROVAL_REQUIRED；
- BLOCKED；
- RECOVERY_REQUIRED；
- CANCELLED；
- FAILED；
- FINISHED。

Events never directly transition Objective or close Obligation.

---

## 7｜Policy mapping

Profile documents how ADOS permissions map to protocol/host controls:

- filesystem；
- shell；
- network；
- MCP tools；
- credential handles；
- external mutation；
- publication；
- cancel；
- subagent。

If the host cannot enforce a required deny, Profile must reject or run in lower capability mode.

---

## 8｜Evidence mapping

Profile must distinguish:

- Agent claim；
- host receipt；
- command receipt；
- verifier result；
- Forge state；
- Owner decision。

It may not label T0/T1 evidence as T2+.

---

## 9｜Idempotency and reconcile

Before mutation:

- branch exists；
- PR exists；
- Evidence marker exists；
- session exists；
- operation receipt exists。

Reuse exact identity.

Duplicate identities are blocking.

---

## 10｜Cancel and cleanup

Profile proves:

- session cancel requested；
- child processes handled；
- mutation stopped；
- credentials released；
- temp capability revoked；
- final state returned。

Failure to prove cleanup blocks lease release.

---

## 11｜Compiler Semantic Profile candidate

Gate 0A must establish:

- exact provider/host identity；
- schema-constrained output capability；
- model or deterministic implementation reference；
- selected-evidence input boundary；
- no tool or local filesystem authority；
- timeout/retry/error semantics；
- output provenance and capability digest；
- deterministic validator ownership；
- redaction and retention；
- fallback to structured rejection when extraction is unsafe。

The Profile proposes a Delivery Request candidate. It cannot create the Owner Receipt or declare readiness without the local validator.

---

## 12｜Codex App Server Profile candidate

Gate 0 must establish:

- exact binary/version；
- JSON-RPC methods；
- thread/turn identity；
- stream events；
- dynamic tool/approval handling；
- working directory；
- cancel/reconnect；
- structured outputs；
- error model；
- clean shutdown。

If insufficient, evaluate SDK then `codex exec`.

---

## 13｜GitHub Profile candidate

Capabilities:

- resolve repository；
- read Objective；
- create/reuse branch；
- create/reuse Draft PR；
- read checks/reviews；
- write/reconcile Evidence；
- record Owner reference。

Forbidden Alpha:

- Ready；
- Merge；
- Release；
- Deploy；
- production mutation。

Credential stays in Coordinator/Profile process, not Agent prompt.

---

## 14｜Browser Capture Profile candidate

- platform parser version；
- selected turns only；
- role attribution；
- digests；
- Delivery Card；
- Native Messaging；
- status events；
- no local privileged actions。

Ambiguous parse blocks.

---

## 15｜Versioning

Profile upgrades require:

- conformance fixtures；
- security review；
- capability diff；
- migration impact；
- no active Run silent change。
