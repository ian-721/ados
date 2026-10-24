# Operating Model

ADOS standardizes the delivery protocol and lifecycle without forcing projects to share an implementation.

## Roles and records

| Term | Responsibility |
| --- | --- |
| **Owner** | Sets product direction, priority, taste, risk preference, authorization, and final acceptance. |
| **Portfolio** | Enforces cross-project priority and work-in-progress limits. |
| **Radar Sensor** | Observes one declared domain and writes a deduplicated run record; it does not create authority or notify the Owner directly. |
| **Owner Inbox** | Reads authoritative ledgers and surfaces at most one decision, blocker, P0/P1 event, or Owner-review candidate at a time. |
| **Orchestrator** | A separately approved future coordinator that may route objectives and agents without owning product truth. |
| **Agent** | Executes a bounded objective under its authorization, contract pins, and project Harness. |
| **Harness** | Project-owned instructions, facts, commands, tests, constraints, and evidence rules. |
| **MCP** | A transport protocol through which a tool or context provider may be exposed; it is not the Kernel or source of product truth. |
| **Adapter** | Replaceable integration with a forge, model provider, execution surface, or other external platform. |
| **Artifact** | The Owner-reviewable output or evidence produced by delivery. |
| **Trace** | A bounded record of actions and evidence for a specific execution. |
| **Evidence Manifest** | A machine-readable summary of one candidate's inputs, actual changes, checks, artifact, product-acceptance status, and publication state. |
| **Eval** | A reproducible product correction or judgment used to test future behavior. |

## Portfolio constraint

The portfolio permits one primary delivery objective and at most one maintenance objective. The current frozen names, outcomes, blockers, and ordering are defined only in [portfolio/projects.yml](../portfolio/projects.yml). This operating standard deliberately does not duplicate that dynamic Portfolio state.

## Three loops

### Delivery

The Owner-approved Objective Contract combines with the project Harness. An Agent performs only the allowed work, runs relevant checks, and produces engineering evidence plus a directly reviewable product Artifact. The Evidence Manifest records the candidate but does not grant Owner acceptance. Owner acceptance closes the objective.

### Governance

Portfolio limits select what may run. Contract pins preserve the rules that govern an active objective. Authorization controls actions independently from status, and stop conditions return material decisions to the Owner. The local validator mechanically rejects mutable pins, frozen-reference drift, illegal lifecycle transitions, unapproved authorization escalation, Owner-gate bypass, incomplete publication state, duplicate candidate identities, and product-acceptance masquerade.

### Learning

Findings are classified, reproduced, evaluated, validated in real project work, and promoted only to their correct durable home. Promotion improves later delivery without rewriting active objectives. Sanitized fixtures keep only the cross-project invariant and expected failure signal; they do not copy project logs or live state.

## Radar and Owner Inbox

Radar Sensors are upstream evidence producers, not a parallel Portfolio or task database. The approved topology and current legacy-task mapping are defined in [the Radar Registry](../portfolio/radars.yml), and its behavior is governed by [the Radar Contract](../contracts/RADAR_CONTRACT.md).

Sensors:

- write to the ledger owned by their domain;
- preserve deterministic run and dedupe identities;
- remain silent for no-change, running, handoff-ready, and validation-in-progress states;
- escalate only a decision, Owner-review candidate, blocker, or P0/P1 event;
- never convert evidence into implementation authorization.

The Owner Inbox is the single notification projection. It may poll through a scheduled condition-watch adapter, but it is not a daemon, Orchestrator, Kernel, or source of truth. A notification is a pointer to an authoritative ledger state, not a replacement for that state.

## Dynamic state

The Issue or local task record is the unique source of truth for an objective's current authorization, scope, status, and acceptance. Product repositories remain authoritative for project code, architecture, Harnesses, ADRs, runtime behavior, artifacts, and implementation evidence. The central ADOS repository contains stable cross-project contracts, schemas, validators, and minimized regression fixtures; it must not duplicate either source.

A participating Forge Adapter may read the authoritative project record and write validated Evidence back to that same record. It may not become a parallel task database or reinterpret the project's own source-priority rules. Where a project Harness assigns authority to Issues, a Pull Request remains an implementation and review surface rather than the Objective authority.

## Local and platform responsibilities

- **Local working copies** are the execution and editing entry points and must be sufficient to read and validate the governing contracts.
- **Git commits** provide exact, immutable identities for contracts and Harnesses.
- **JSON Objective Records and Evidence Manifests** provide portable exchange semantics.
- **`tools/ados.py`** provides local validation using only the Python standard library.
- **`tools/ados_handoff.py`** is an optional GitHub Forge Adapter that performs one read-only Objective handoff and one explicit, idempotent Evidence writeback; it is not a scheduler or state store.
- **`tools/ados_radar.py`** validates the versioned Radar Registry; it does not run sensors or notify the Owner.
- **GitHub** is the first optional remote, collaboration surface, and Forge Adapter.
- **Codex** is a replaceable execution adapter.
- **Future platforms** may replace either adapter while preserving the same objective fields, authorization levels, statuses, contract pins, evidence semantics, and stable failure codes.

GitHub availability and model access must not be required to interpret or validate ADOS records already available locally. The v0.2 CLI and the optional Handoff Adapter are not services, daemons, Kernels, Orchestrators, MCP Servers, or persistence layers.

## Safe parallelism

Work may run in parallel only when all three isolation conditions hold:

1. **Context isolation** — each objective has independent sources, decisions, and acceptance.
2. **File isolation** — write scopes do not overlap and integration ownership is explicit.
3. **External-state isolation** — credentials, environments, resources, deployments, and irreversible actions cannot collide.

If any condition fails, serialize the work under one primary objective. Unified protocol and lifecycle do not imply unified languages, databases, services, architecture, or project-specific acceptance methods.
