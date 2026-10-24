# Agentic Delivery OS (ADOS)

### Sustained AI work. Human control.

**From an approved decision to a result you can inspect and accept.**

[中文](README.zh-CN.md) · [System design](docs/DESIGN.md) · [Research](docs/RESEARCH.md) · [Try the code](#try-the-reference-kit) · [Status & evidence](docs/STATUS.md)

ADOS is a local-first research and systems project for carrying AI work across sessions, interruptions and changing requirements. People decide the outcome, authorize consequential actions and accept the result. The surrounding system is designed to preserve those decisions, coordinate execution, support recovery and collect evidence—rather than leave everything in an agent's conversation.

This is the **public home of Yanyang Zhao's ADOS design, reference kit and complete local prototype source**. It contains the system rationale, architecture, research connections and a runnable Objective & Evidence Kit. The [complete ADOS Local prototype source](prototype/ados-local/README.md) is published under `prototype/ados-local/` as an independent, sanitized source distribution. ADOS is not yet a production service.

## The problem: keeping work on track

Imagine asking an agent to improve a checkout page, preserve payment behavior and prepare a preview—but **not deploy it**. Halfway through, the session ends. Later, you change one requirement.

Continuing well takes more than remembering the conversation. The next executor needs to know which decisions still apply, what work remains valid, which version it is changing, what it may do, and how the result will be checked. You should not have to reconstruct all of that by hand. Nor should a green build become permission to deploy.

**ADOS treats the delivery objective—not the chat session—as the unit of continuing work.** Its product goal is less repeated preparation, coordination, interruption, review and rework, without weakening quality or human control. Those gains still need to be measured in real use.

## What the system is designed to do

| Responsibility | What it means in practice |
| --- | --- |
| **Keep the outcome explicit** | Preserve the approved goal, quality bar, scope and acceptance conditions. |
| **Separate permission from capability** | An agent's ability to call a tool does not grant permission to use it. |
| **Keep state outside the conversation** | Retain confirmed decisions, task identity, version references, recovery state and evidence. |
| **Continue without starting over** | Recover the same work after interruption; retain valid work when an authorized requirement changes. |
| **Check what actually happened** | Distinguish the agent's account from independent checks, external readback and an inspectable artifact. |
| **Learn without rewriting its own authority** | Evaluate reusable experience before adopting it; do not silently turn a reflection into a rule. |

These responsibilities describe the system direction. Their implementation and evidence differ; see [current status](docs/STATUS.md).

## How it fits together

```text
Human intent and decisions
          |
          v
Bounded objective + explicit authorization
          |
          v
Project context + pinned rules + recoverable state
          |
          v
Replaceable agents and tools
          |
          v
Checked artifact + evidence  ---->  explicit blocker when needed
          |
          v
Human review: accept, revise or stop
```

*The diagram describes the intended delivery path, not an end-to-end application installed by this repository.*

The core separation is straightforward: **people own consequential decisions; agents perform delegated work; project systems hold the authoritative facts; verification checks the result.** An executing agent must not grant itself new permissions or certify its own final acceptance.

A project-specific *Harness* supplies its commands, tests, constraints and evidence requirements. Models, coding agents and forges are replaceable execution surfaces. ADOS is not a new foundation model, IDE or universal agent scheduler.

[Read the design →](docs/DESIGN.md)

## What you can inspect today

| Component | Availability | What it establishes |
| --- | --- | --- |
| **Objective & Evidence Kit** | Code, schemas, fictional examples and tests in this repository | Selected record-format, transition and cross-record consistency checks. |
| **ADOS Local** | [Complete prototype source](prototype/ados-local/README.md) | Coordinator, SQLite persistence, compiler, browser extension, Native Host, migrations and tests. Offline synthetic validation is reproducible; Windows/live integration and real-product Dogfood remain unverified for this distribution. |
| **WSEOM** | [Public research agenda](https://doi.org/10.5281/zenodo.22992066) | Questions about the division of cognitive work, experience, verification and authority between models and surrounding systems. Not evidence that the entire ADOS product works. |
| **Real-product deployment and broad continuity** | Not established | General cross-device/model recovery, production reliability, transferable experience and reduced human workload remain to be demonstrated. |

**The public kit validates records; it does not enforce permissions on a running agent.** It does not authenticate an approval, execute the listed tests, inspect a claimed artifact, or confirm that an external action happened. A plausible approval string can satisfy a presence check. See [security and trust limits](SECURITY.md) before integrating it.

## Try the reference kit

Python **3.10+** is the intended language baseline; the current publication was tested with **Python 3.13.5 on Linux**. No third-party Python dependencies, API key, model, account or network connection is required to run the kit after obtaining the files.

```bash
git clone https://github.com/ian-721/ados.git
cd ados
python tools/ados.py demo
python -m unittest discover -s tests -v
```

Use `python3` when that is the Python executable on your system. The demo runs fictional valid and invalid records and ends with:

```text
Result: 14/14 expected outcomes
```

For example, it rejects a transition record that escalates from `IMPLEMENT` to `MERGE` without an approval reference, a record declaring `DONE` without an acceptance reference, and evidence bound to the wrong task rules. The checks are about **what the records say**, not proof of real-world authorization or completion.

Validate an Objective and its Evidence together:

```bash
python tools/ados.py validate-binding examples/objectives/minimal-objective.json examples/evidence/minimal-evidence.json
```

[Commands, exit codes and integration boundaries →](docs/CONTRACT_KIT.md) · [Actual demo output →](docs/DEMO.md)

## Why research is part of the project

ADOS grew out of building products with AI agents. Repeated problems with keeping decisions, applying earlier guidance and judging completion led to **WSEOM—What Should Exist Outside the Model?** The relationship runs both ways: practical failures motivate controlled studies; research helps question the system's assumptions.

The agenda asks when external support helps or harms, which experience transfers, how guidance differs from enforceable authority, and whether the whole arrangement reduces human work. It does not assume that adding more memory, rules or agents improves delivery.

For ADOS, this means evaluating **decisions, evidence quality, delivered results, resource cost and human work separately**. Lower token use is not automatically lower total cost. A better citation is not automatically a better decision. Information that influences an action is not the same thing as authority that permits it.

[Research questions and evidence boundaries →](docs/RESEARCH.md)

## Author and collaboration

Created by **Yanyang (Ian) Zhao**, an independent AI researcher and research engineer. His work connects agent evaluation with the practical problems of sustained task delivery: what belongs in the model, what belongs in surrounding systems, and what must remain under human control.

[GitHub](https://github.com/ian-721) · [LinkedIn](https://www.linkedin.com/in/yanyang-zhao/) · [ORCID](https://orcid.org/0009-0000-7190-4574) · [WSEOM agenda](https://doi.org/10.5281/zenodo.22992066)

Feedback is especially useful when it exposes a concrete failure case, an unclear trust boundary or a reproducible improvement to the reference kit. See [contributing](CONTRIBUTING.md). Research collaborations and product adoption should preserve the distinction between a useful hypothesis, an implemented mechanism and a demonstrated benefit.

## License and project identity

The code and documentation in **this repository** are available under [Apache-2.0](LICENSE); see [NOTICE](NOTICE). Linked publications and material not included here retain their own terms. This release does not license private implementations, personal records or unpublished research data.

This is **Yanyang Zhao's ADOS project at `ian-721/ados`**, not an affiliation with other projects using the same name. ADOS remains a working project name. To reference this repository, use [CITATION.cff](CITATION.cff) and the exact commit used; cite the research agenda separately.
