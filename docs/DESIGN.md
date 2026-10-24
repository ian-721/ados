# ADOS system design

[Home](../README.md) · [Research](RESEARCH.md) · [Status](STATUS.md) · [Reference kit](CONTRACT_KIT.md)

## Design goal

A person should be able to delegate a result without becoming the transport layer between conversations, agents, repositories and verification tools. ADOS aims to preserve the meaning of that delegation as work continues: its goal, permissions, valid decisions, evidence and remaining obligations.

The first engineering setting is bounded software work. The intended concepts are broader than coding, but extending them to other domains is a design question, not an available capability.

## 1. A delivery objective is not an agent session

A session is one executor's working context. An Objective is the project-owned record of an approved outcome. Multiple sessions may contribute to it without inventing new permission or forgetting accepted work.

A Delivery Request expresses what the person wants and has decided. A project Harness supplies actual repository facts, commands, constraints and verification requirements. The execution snapshot binds those inputs to a particular run. None should silently overwrite another source of authority.

| Object | Purpose | Does not establish by itself |
| --- | --- | --- |
| Delivery Request | Express the requested outcome and decisions | Authorization or a correct environment |
| Owner authorization record | Bind an explicit decision to a defined action and scope | Unbounded or permanent permission |
| Objective | Hold the project's outcome, scope, authorization and lifecycle | That an artifact is good |
| Harness reference | Fix the applicable project instructions and checks | That those checks ran |
| Run state | Track the executor, progress, recovery and effects | A second authoritative project ledger |
| Artifact | Give the person a result to inspect or use | Acceptance |
| Evidence | Connect claims and checks to the same candidate and rules | Truth merely because a JSON document is valid |
| Owner acceptance | Record acceptance of the intended outcome | Permission to start an unrelated next task |

Only Objective and Evidence records, their transitions and selected consistency rules are executable in this public kit. Other objects describe the broader prototype and design.

## 2. Separate the responsibilities

**The Owner** decides direction, priorities, quality, risk tolerance, consequential authorization and final acceptance.

**The project** owns its architecture, code, Harness, live Objective and actual evidence. A central system should read these sources when needed, not maintain a competing copy.

**The coordinator** is intended to bind the approved request to the correct project and execution context, preserve task identity, manage recovery and present a result or blocker. Coordination does not make its model an authority.

**Agents and tools** perform bounded work. They may propose plans, request permission, modify allowed files and run approved checks. They cannot convert their own request into approval.

**Verification** checks relevant facts at the required trust level. A second model agreeing with the first is not automatically independent evidence. Some questions need a clean execution, external state readback or a person's direct inspection.

The full separation needs real enforcement in the host environment. A prompt, schema or record of permission is not enough. This public code is not that enforcement layer.

## 3. Permissions stay distinct from progress

The reference contract uses five ordered authorization levels:

```text
DISCOVERY < PLAN < IMPLEMENT < MERGE < RELEASE
```

They describe different approvals, not a conveyor belt. Approving a goal is not approving implementation, and an implementation approval is not permission to merge or deploy.

The public Objective lifecycle is smaller:

```text
READY -> RUNNING -> OWNER_REVIEW -> DONE
           |              |
           v              v
        BLOCKED ------> RUNNING
```

The precise allowed edges are `READY -> RUNNING`, `RUNNING -> OWNER_REVIEW`, `RUNNING -> BLOCKED`, `BLOCKED -> RUNNING`, `OWNER_REVIEW -> RUNNING`, and `OWNER_REVIEW -> DONE`. `DONE` is terminal. An acceptance reference is required before the recorded transition to `DONE`.

**Important version boundary:** this Objective schema does not implement a general cancellation or revocation protocol. The broader design distinguishes a frozen authorization ceiling from later authenticated pause, restriction, cancellation and revocation events. It must never interpret a resume as permission to exceed the original ceiling. That richer effective-authority mechanism remains a separate design, not a feature of the public validator.

## 4. Continuing work means preserving commitments

An interruption should not erase the task's identity or lead to duplicate side effects. Recovery should establish what was attempted, what actually happened externally, which result belongs to which candidate, and what can safely happen next.

A complete continuity design needs to preserve more than a text summary:

- the approved intent and still-valid decisions;
- the applicable permissions and exact contract/Harness versions;
- execution progress, environment assumptions and unresolved obligations;
- artifact identity, evidence and any confirmed external effects.

The local prototype has explored bounded persistence and recovery in synthetic software tasks; its [sanitized source candidate](../prototype/ados-local/README.md) is included here. This does not establish reliable continuation across arbitrary devices, models, outages or projects.

## 5. Changing requirements should not erase valid work

Suppose the Owner changes the checkout layout but keeps payment behavior and the no-deployment boundary. The system should retain work that still satisfies the goal, identify which checks are affected and revise only the invalidated part.

This requires an explicit, authorized change to the relevant task record or contract—not an agent quietly replacing its constraints with a newer README. Running work keeps pinned rule and Harness versions unless an approved migration says otherwise.

A useful test is not simply whether the resumed agent remembers the old task. It is whether it preserves the right decisions, discards superseded assumptions and remains inside current permission.

## 6. Evidence and acceptance answer different questions

A test can establish a property of an implementation. External readback can establish which candidate was published. Neither alone decides whether the user received the intended product.

The intended terminal handoff is an inspectable artifact plus relevant evidence, or a precise blocker stating what is missing. The person can accept, request a bounded revision or stop. A checker returning success is not a substitute for that decision.

The reference kit implements a small piece of this distinction: it rejects certain inconsistent records, including accepted-status claims with no acceptance reference. It does not inspect the referenced artifact or authenticate the human decision.

## 7. Learning is controlled adoption, not automatic rule accumulation

An actual delivery episode may yield useful experience: a recurring failure, an effective recovery, or a project-specific constraint. That does not make every trace or reflection suitable for reuse.

A lesson should preserve its source, applicability, exclusions and evidence. Project-specific lessons stay local. Shared rules require cross-project value and explicit adoption. The executing agent must not draft a rule, approve it, migrate its own task and certify compliance on its own authority.

Whether experience improves later tasks, transfers across models or creates harmful path dependence is a research question. There is no general autonomous learning platform in this repository.

## 8. Keep the system no larger than the problem

The direction is a personal, local-first delivery endpoint using replaceable agents and tools. A service, database, scheduler, adapter or dashboard should be introduced only to resolve a demonstrated problem, not because it appears in a future architecture diagram.

A broader fulfillment network may eventually be useful. It would first need evidence of reliable outcomes, real demand, manageable human work and clear responsibility. It is not part of this release.
