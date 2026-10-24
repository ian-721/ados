# Status and evidence boundaries

[Home](../README.md) · [Design](DESIGN.md) · [Reference kit](CONTRACT_KIT.md)

Snapshot: **24 October 2026**. This page describes this public source release and the broader project's maturity. It is not a live task ledger.

## Public and reproducible here

The Objective & Evidence Kit contains two JSON schemas, their Python validators, a command-line interface, fictional example records and focused regression tests. The core validator and schema bytes were extracted unchanged from the existing implementation; the public CLI and examples need no private repository access.

Run `python tools/ados.py demo` and `python -m unittest discover -s tests -v` from the root. The publication verification used **Linux and Python 3.13.5**. The intended Python minimum is 3.10, but this release does not claim a completed multi-version or Windows test matrix.

The demo covers **14 expected outcomes**. The test suite covers valid and invalid records, transitions, binding, CLI behavior and three explicit trust limitations. See [the captured demonstration](DEMO.md).

## Separate local prototype

The broader ADOS Local prototype is private and Windows-first. The maintainer's accepted synthetic-task work includes browser-to-local capture, a delivery compiler, SQLite event persistence, bounded coding-agent execution, GitHub objective/evidence links, and selected interruption, cancellation and recovery checks.

This is a **maintainer-reported prototype status**, not independently reproducible evidence provided by this public repository. No private source tree, execution logs, approval records, credentials or user data are included. The public code does not install the browser extension, coordinator or local runtime.

Acceptance of the bounded synthetic safety path establishes neither a complete product nor a successful real-product dogfood. The latter remains unproven in the evidence reviewed for this publication.

## Designed or unproven—not shipped here

General cross-device, cross-host and cross-model continuity; protected runtime-wide authority and revocation; broad real-product fulfillment; automatic cross-project experience transfer; multi-agent scheduling; cloud services; a marketplace; and reductions in actual human workload are not established capabilities of this release.

Descriptions of those responsibilities are architecture or research directions. They are not a delivery schedule, benchmark claim or service-level commitment.

## What the current tests do not prove

The validator accepts supplied records. It does not authenticate people, resolve Git pins against a repository, execute the listed tests, inspect artifacts, discover undeclared changes or observe an external effect. It uses a limited set of JSON Schema features and simple declared-path matching, not a general schema engine or a filesystem sandbox.

Passing tests shows that selected record checks behaved as expected for the tested inputs. It does not establish adversarial security, production suitability or end-to-end user benefit. The explicit boundary tests document that a plausible approval string, a non-resolving pin and a declared failed check can still form structurally valid records.

## What would strengthen the evidence

The nearest product question is a bounded real workflow: can the system preserve valid decisions and work across an interruption or approved change, deliver an inspectable artifact, and reduce total coordination and rework without exceeding permission?

That requires an authorized target, a comparable baseline, actual outcome and human-work measurements, and visible failure cases. It does not require building a universal orchestration platform first.

## Versioning

`VERSION` identifies the public reference-kit package. `objective-record/v0.2` and `evidence-manifest/v0.1` identify its schemas; they are not the whole ADOS product version. An Objective's `contract_version` is yet another identity: the rules bound to that specific task. These versions must not be conflated.

Cite the exact public commit used for any reproduction. The first public history starts with selected files, not an import of the private development history.
