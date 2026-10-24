# ADOS Run Envelope Contract v0.2

## 1｜Purpose

A Run Envelope is the immutable local fulfillment contract for one generation of one approved Objective.

It answers:

> **On this verified machine, against this exact repository and Harness, through this exact execution Profile, what may happen, what must be proven, and how must interruption be reconciled?**

Canonical serialization: `contracts/schemas/run-envelope-v0.2.schema.json`.

A Delivery Request records approved intent. An Objective owns project authorization and acceptance. A Run Envelope freezes one local attempt.

---

## 2｜Boundary

The Envelope is not:

- a second Objective；
- an Agent plan；
- dynamic process/session state；
- a Run Journal；
- Pull Request state；
- Evidence；
- Owner Acceptance。

It contains exact references, policy upper bounds, obligations, verifier requirements, publication limits and recovery rules.

Dynamic events, process ids, Agent session refs, current lease holder/timestamps, candidate revisions and sync cursors belong in the append-only Run Journal.

---

## 3｜Construction requirements

The Coordinator may freeze an Envelope only after verifying:

- one eligible Objective under Portfolio WIP；
- exact Objective, contract and Harness pins；
- project-registry match；
- authoritative repository id and exact base；
- safe repository/worktree allocation；
- no conflicting active run after reconciliation；
- execution Profile identity, protocol and capability digest；
- effective policy intersection；
- credential boundaries；
- obligations and minimum evidence trust；
- verifier availability；
- Draft-only publication route；
- cancellation and recovery capability。

No Agent may create, edit or replace its own Envelope.

For the first real Alpha dogfood, the target project must expose an Issue-based Objective authority. PR fallback remains a protocol compatibility path but is not required for the first product acceptance.

---

## 4｜Canonical digest and immutability

`envelope_digest` is computed over canonical JSON excluding only the `envelope_digest` field itself.

`policy_digest` is stored once under `digests` and binds the compiled effective policy.

After `PREPARED → EXECUTING`, the Envelope is immutable.

A material change to authorization, Objective/Harness/contract pin, repository/base, execution Profile, scope, tool permission, obligation, verifier trust, approval gate, publication boundary or stop condition requires:

- a new Envelope generation；
- a recorded reason；
- and, when the approved delivery changes, a new Owner receipt and Objective transition。

Runtime events do not mutate the Envelope.

---

## 5｜Identity and duplicate prevention

The Envelope freezes:

```text
run_id
generation
request_id + request_digest
objective_id + objective_digest
base_sha
execution Profile + capability digest
envelope_digest
```

Alpha allows one active run lease per Objective.

The Envelope contains immutable lease policy:

```text
lease key
max_active=1
TTL
heartbeat policy
stale-recovery-requires-reconcile
```

The current holder, acquired time, expiry and heartbeat events belong in the Journal.

Before any start or recovery, reconcile:

- Journal；
- local process tree；
- Agent host/session；
- worktree and branch；
- open/closed Pull Requests；
- Evidence markers；
- prior candidate revisions。

A repeated Deliver/start attaches to, resumes or rejects the same run. It never silently creates another branch, PR, generator or candidate revision.

---

## 6｜Execution Profile

The Envelope freezes:

```text
profile_id
profile_version
adapter_class
transport_protocol
transport_version
implementation_identity
capability_digest
```

The dynamic Agent session/thread reference is recorded after start in the Journal and must bind back to the Envelope digest.

There is no silent protocol downgrade, host substitution or fallback. A Profile change is a new Envelope generation and may require Owner approval.

---

## 7｜Agent autonomy

The Envelope freezes:

```text
goal_ref
allowed_to_plan
allowed_to_iterate
max_parallel_writers
prohibited_self_authority
```

Alpha:

```text
allowed_to_plan: true
allowed_to_iterate: true
max_parallel_writers: 1
```

The Coordinator governs identity, policy, obligation, approval, recovery and publication. It does not encode the Agent's internal reasoning path or file-by-file plan.

---

## 8｜Closed Run lifecycle

States:

```text
PREPARED
EXECUTING
WAITING_OWNER
VERIFYING
PUBLISHING
OWNER_REVIEW
BLOCKED
FAILED
CANCELLED
DONE
```

Valid transitions:

```text
PREPARED       → EXECUTING | BLOCKED | CANCELLED
EXECUTING      → WAITING_OWNER | VERIFYING | BLOCKED | FAILED | CANCELLED
WAITING_OWNER  → EXECUTING | BLOCKED | CANCELLED
VERIFYING      → EXECUTING | PUBLISHING | BLOCKED | FAILED | CANCELLED
PUBLISHING     → OWNER_REVIEW | BLOCKED | FAILED
BLOCKED        → EXECUTING | VERIFYING | PUBLISHING | CANCELLED
FAILED         → EXECUTING | VERIFYING | PUBLISHING | CANCELLED
OWNER_REVIEW   → EXECUTING | DONE | CANCELLED
```

`DONE` and `CANCELLED` are terminal.

Rules:

- `BLOCKED` means valid progress requires an external fact, capability or decision；
- `FAILED` means an execution/system failure and requires a recovery receipt；
- transition from `BLOCKED` or `FAILED` records `resume_to`, reason and reconciled identities；
- `OWNER_REVIEW → EXECUTING` is a bounded revision in the same Objective and Draft PR；
- permanent abandonment cancels the Run and uses the governing Objective record's supported close/not-planned mechanism; it does not masquerade as `DONE`；
- Objective state remains governed by the Objective Contract and is never inferred from Run state alone。

---

## 9｜Policy

Effective policy is the most restrictive intersection:

```text
Owner authorization
∩ Objective
∩ Harness
∩ local policy
∩ Adapter Profile
∩ protocol capability
```

Default deny.

The Envelope contains path, command, network, credential, external-state, size/time and publication permissions plus approval gates.

A lower protocol permission cannot raise Objective authority. An available MCP tool, ACP session permission or Agent capability is not authorization.

---

## 10｜Obligations and evidence trust

Each acceptance item becomes an Obligation:

```text
obligation_id
category
description
evidence_required
verifier_id
minimum_trust
initial_status=PENDING
```

Categories:

- engineering；
- product_candidate；
- publication；
- owner。

Evidence trust:

```text
T0 Agent claim / free text
T1 same-process deterministic receipt
T2 separate process or clean checkout
T3 external Forge/deployment state
T4 authenticated Owner decision
```

Only a configured Verifier with sufficient trust can close a non-Owner Obligation. Only T4 Owner Acceptance can close an Owner Obligation.

`NOT_RUN` never satisfies an Obligation.

---

## 11｜Verifiers

A Verifier records:

- verifier identity and kind；
- trusted source；
- independence；
- trust level；
- input digest；
- result digest；
- sanitized evidence refs。

Result:

```text
PASS | FAIL | BLOCKED | NOT_APPLICABLE
```

An Agent-provided assertion is T0 and cannot be relabeled as independent evidence.

---

## 12｜Approval gates

Mandatory gates include:

- authorization escalation；
- protected-area change；
- new dependency/service；
- credential-scope increase；
- external purchase；
- production mutation；
- merge；
- release；
- irreversible action。

`WAITING_OWNER` projects one decision with evidence, impact, credible alternatives and requested authority.

A decision receipt binds the exact gate and Envelope digest.

---

## 13｜Publication and candidate revisions

Alpha publication is:

```text
one deterministic branch
→ one Draft PR
→ one active candidate revision
→ one bound Evidence record for that revision
→ OWNER_REVIEW
```

Maximum open PRs for the Objective: one.

For retries of the same candidate, publication reconciles the same Evidence identity.

If verification or Owner review requires a bounded revision:

- keep the same Objective, Run generation, worktree, branch and Draft PR；
- increment candidate revision in the Journal；
- create a new candidate digest and superseding Evidence identity；
- retain prior Evidence as immutable history；
- record the revision reason；
- do not start a second generator unless separately approved。

No Ready, Merge, Release, Deploy or production credential exists in the Alpha Envelope.

---

## 14｜Recovery

Recovery order:

1. rebuild derived state from Journal；
2. reconcile process tree and Agent host；
3. reconnect the same session when safe；
4. reuse worktree and branch；
5. rerun only missing/invalidated Verifiers；
6. reconcile the same Draft PR；
7. reconcile the same Evidence for the same candidate revision；
8. otherwise enter `BLOCKED` with one exact decision。

Publication failure never starts a new generator.

A stale lease is not proof that execution stopped.

---

## 15｜Cancellation and cleanup

Cancellation must:

- request Profile cancellation；
- handle child processes；
- watch for post-cancel mutation；
- freeze/preserve worktree evidence；
- revoke temporary capabilities；
- reconcile remote state；
- release the lease only after safe-stop proof；
- record actor and reason。

Failure to prove cleanup remains `BLOCKED` or `FAILED`; it does not free the Objective for duplicate execution.

---

## 16｜Completion

The Run may enter `OWNER_REVIEW` only when:

- all non-Owner Obligations are satisfied；
- required trust levels are met；
- Artifact exists and is accessible；
- Evidence binds request, Objective, Envelope and candidate revision；
- no unresolved stop condition exists；
- executor mutation has ended；
- publication is reconciled and Draft-only。

The Run may enter `DONE` only after a T4 Owner Acceptance Receipt.

Tests, an Agent message, a Pull Request or Artifact existence cannot produce `DONE`.

---

## 17｜Privacy

Remote Evidence must not expose:

- local username or home path；
- secrets；
- raw conversation；
- browser storage；
- private customer payload；
- process command lines containing credentials。

The full Envelope and Journal remain local by default. Remote records use minimized references and digests.

---

## 18｜Versioning

`run-envelope/v0.2` is immutable after execution starts.

Any material contract change creates a new version or Envelope generation and never silently changes an active Run.
