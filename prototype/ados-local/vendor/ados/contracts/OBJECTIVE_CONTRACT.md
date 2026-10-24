# Objective Contract

The Objective Contract is the platform-independent record that turns one approved outcome into bounded delivery work. An Issue or local task record instantiates this contract; the transport may change, but the meaning and lifecycle do not.

## Canonical machine record

ADOS v0.2 uses [Canonical Objective Record v0.2](schemas/objective-record-v0.2.schema.json) as the JSON machine-exchange form of this contract. Markdown remains the human-readable view. An Issue, task card, or generated Markdown view must preserve the same fields and semantics; it must not become a second, divergent contract.

The canonical record uses `schema_version: objective-record/v0.2`. This serialization version is distinct from `contract_version`: a running Objective may be represented in the v0.2 JSON shape while remaining governed by its previously frozen ADOS contract version and reference. Exact contract and Harness references use:

```text
owner/repository@<full-40-character-commit-sha>#optional/path
```

A branch, tag, short SHA, latest pointer, or other movable reference is not an exact pin.

## Required fields

| Field | Meaning |
| --- | --- |
| `objective_id` | Stable identifier for this objective. |
| `project_id` | Stable identifier for the owning project. |
| `contract_version` | Semantic version of the Objective Contract fixed at objective start. |
| `contract_ref` | Exact immutable reference to the ADOS contract revision used at start. |
| `project_harness_ref` | Exact immutable reference to the project's active Harness used at start. |
| `authorization` | Highest action level currently approved by the Owner. |
| `status` | Current objective lifecycle state. |
| `outcome` | One Owner-verifiable result, expressed as an end state rather than activity. |
| `why_now` | Product value, urgency, and the present bottleneck. |
| `sources` | Authoritative briefs, decisions, files, runtime evidence, or records required for the work. |
| `allowed_scope` | Files, systems, actions, and state changes explicitly permitted. |
| `forbidden_scope` | Explicit exclusions and protected boundaries. |
| `quality_bar` | Approved product and implementation quality that must not be silently lowered. |
| `engineering_acceptance` | Relevant mechanical checks and evidence required for an engineering candidate. |
| `product_acceptance` | Owner-observable experience and acceptance conditions. |
| `owner_artifact` | Directly reviewable artifact, preview, build, recording, demonstration, or other product evidence. |
| `dependencies` | Approved prerequisites, permissions, services, assets, or upstream decisions. |
| `stop_conditions` | Conditions that invalidate the approved path or require an Owner decision. |

All fields are required. Use an explicit empty collection only when the contract has established that no entries apply; do not omit the field. The JSON record also carries its `schema_version`. Transition-only approval and migration fields are optional until their event occurs.

## Authorization

Authorization is monotonic only through explicit Owner approval:

- `DISCOVERY` — inspect, research, clarify, and report without implementing.
- `PLAN` — produce a decision-ready plan or specification without implementing it.
- `IMPLEMENT` — make and verify the approved bounded changes.
- `MERGE` — perform the separately approved integration action after rechecking its gates.
- `RELEASE` — perform the separately approved publication or production action after rechecking its gates.

Approval of an outcome or a lower level does not imply approval of any higher level. A pull request, passing check, Agent, workflow, model, or Evidence Manifest cannot grant or redefine authorization. An authorization increase in a transition requires `owner_approval_ref`.

## Status

- `READY` — the contract is complete, pinned, and eligible to start.
- `RUNNING` — approved work is actively executing under the pinned contract.
- `OWNER_REVIEW` — the engineering and product candidate evidence is ready for Owner review.
- `BLOCKED` — a stop condition or unresolved required decision prevents valid progress.
- `DONE` — the Owner has explicitly accepted the outcome and work has stopped.

The Issue or local task record is the unique source of truth for the current objective, authorization, scope, status, and acceptance. A pull request contains implementation changes and evidence only; it must not redefine authorization, status, scope, or product acceptance.

## Mechanical lifecycle

The local validator accepts only these transitions:

```text
READY → RUNNING
RUNNING → OWNER_REVIEW
RUNNING → BLOCKED
BLOCKED → RUNNING
OWNER_REVIEW → RUNNING
OWNER_REVIEW → DONE
```

All other transitions are rejected by default. `DONE` is terminal. `OWNER_REVIEW → DONE` requires `owner_acceptance_ref`; engineering checks, CI, a generated report, or publication of a Draft PR cannot supply that reference.

## Acceptance and completion

Engineering checks establish an engineering candidate; they do not establish product acceptance. Until the Owner explicitly accepts the experience, the only completion report is:

`Candidate ready for Owner review.`

At acceptance, record the explicit Owner acceptance reference, set the objective to `DONE`, and stop. Do not create or start a subsequent phase automatically. The Owner artifact must be directly reviewable and cannot be only “tests passed,” “CI passed,” or an equivalent engineering statement.

## Contract pinning and migration

At objective start, freeze all three references:

- `contract_version`
- `contract_ref`
- `project_harness_ref`

A new contract version applies to new objectives. An already running objective remains on its pinned version unless the Owner explicitly approves migration. A migration record must identify:

- the exact old pin set;
- the exact new pin set;
- the reason;
- the impact on scope, authorization, quality, evidence, acceptance, and existing work;
- the explicit Owner approval reference.

An urgent safety change pauses affected work. The objective must record and explicitly approve the migration before execution resumes; a central contract or project Harness must never be silently substituted beneath running work.

## Evidence binding

[Evidence Manifest v0.1](schemas/evidence-manifest-v0.1.schema.json) records one execution candidate. It binds to the objective through the same `objective_id`, `authorization`, `contract_ref`, `project_harness_ref`, and current objective status. It records inputs, actual changed scope, exact staged-patch byte accounting, engineering checks, Owner artifact, product-acceptance status, trusted publication state, post-run execution posture, stop conditions, generation time, and generator version.

An Evidence Manifest may record `PENDING_OWNER`, `ACCEPTED`, or `REJECTED`, but `ACCEPTED` and `REJECTED` require an explicit Owner decision reference. It cannot infer product acceptance from engineering success. Publication recovery must reconcile one stable candidate identity and complete its trusted state writeback rather than create duplicate branches, commits, or Draft PRs.

The local command surface and error codes are documented in [Objective & Evidence Kit](../docs/OBJECTIVE_AND_EVIDENCE_KIT.md).
