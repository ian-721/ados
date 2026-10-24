# Objective & Evidence Kit

[Home](../README.md) · [Design](DESIGN.md) · [Security limits](../SECURITY.md)

## What it does

This is an offline record-validation library and CLI. It checks two supplied documents and selected lifecycle rules:

- An **Objective** records one outcome, scope, authorization, exact rule/Harness references, quality requirements, acceptance and stop conditions.
- **Evidence** records one candidate's declared changes, checks, reviewable artifact, publication identity and acceptance state.
- **Binding** checks that the two records refer to the same task, rules, authorization and status, and checks declared paths against supported scope entries.

The schemas are [Objective Record v0.2](../contracts/schemas/objective-record-v0.2.schema.json) and [Evidence Manifest v0.1](../contracts/schemas/evidence-manifest-v0.1.schema.json). The Python implementation supports the subset of JSON Schema used by these files; it is not a general Draft 2020-12 implementation.

## Run it

Python 3.10+ is the intended baseline. Publication testing used Python 3.13.5 on Linux. There are no third-party runtime dependencies.

From the repository root:

```bash
python tools/ados.py demo
python tools/ados.py validate-objective examples/objectives/minimal-objective.json
python tools/ados.py validate-evidence examples/evidence/minimal-evidence.json
python tools/ados.py validate-binding examples/objectives/minimal-objective.json examples/evidence/minimal-evidence.json
python tools/ados.py validate-transition BEFORE.json AFTER.json
python -m unittest discover -s tests -v
```

`BEFORE.json` and `AFTER.json` are your own Objective records; they are not bundled filenames. All included records are fictional. Example Git references have the correct shape but are not resolvable project provenance. `local://` values are illustrative identifiers, not files created by the demo.

| Exit code | Meaning |
| --- | --- |
| `0` | The selected validation found no errors, or all demo expectations were met |
| `1` | The supplied records violated a checked rule |
| `2` | A file could not be read, JSON could not be parsed, or CLI usage was invalid |

A reported error has a stable code and a field path, for example:

```text
ERROR [E_REF_NOT_IMMUTABLE] $.contract_ref: reference must use owner/repository@<40-hex-commit>, optionally followed by #path; branches and short SHAs are forbidden
```

## Python use

```python
import json
from pathlib import Path
from tools.ados_core import validate_objective
from tools.ados_evidence import validate_evidence_binding

objective = json.loads(Path("examples/objectives/minimal-objective.json").read_text("utf-8"))
evidence = json.loads(Path("examples/evidence/minimal-evidence.json").read_text("utf-8"))
errors = validate_objective(objective) + validate_evidence_binding(objective, evidence)
for error in errors:
    print(error.render())
```

This snippet prints nothing for the bundled valid pair. It does not run a task or grant permission.

## Selected checks

A pin must use `owner/repository@<40-character-commit>#optional/path`. An unapproved authorization escalation is rejected. Frozen-reference changes need a matching migration record. `DONE` and recorded acceptance need references. Evidence must bind to the Objective and reconcile one candidate identity. Declared patch-byte totals must agree, and temporary execution activation must have a declared restoration state.

Each statement concerns the supplied record. A reference's presence is not authenticity; a full-length SHA is not a repository lookup; arithmetic consistency is not measurement of a real patch; and declared restoration is not process inspection.

## Use it as one component, not a security boundary

An integration would need authenticated decisions, independently acquired evidence, trusted state storage, real tool/process controls and verified side-effect handling. This release does not provide them. Do not place the validator in front of an agent and assume it prevents unauthorized execution.

Scope checks operate on simple textual entries and declared paths. They are not safe path resolution, symlink handling, filesystem confinement or comprehensive natural-language scope interpretation. JSON parsing and schema checks are intended for bounded local inputs, not an untrusted public validation service.

See [SECURITY.md](../SECURITY.md) for the trust model and [DEMO.md](DEMO.md) for a real run of the included demonstration.
