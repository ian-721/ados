#!/usr/bin/env python3
"""Standalone CLI and synthetic demo for the public Objective & Evidence kit.

The contract validators in ados_core.py and ados_evidence.py are carried
unchanged from the pinned private-source snapshot. This public CLI uses only
synthetic examples and performs no network, repository, or production writes.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import sys
from pathlib import Path
from typing import Any, Callable, Sequence

try:
    from .ados_core import ROOT, ValidationError, _load_json_file, validate_objective
    from .ados_evidence import validate_evidence, validate_evidence_binding, validate_transition
except ImportError:
    from ados_core import ROOT, ValidationError, _load_json_file, validate_objective
    from ados_evidence import validate_evidence, validate_evidence_binding, validate_transition


def _read(path: Path) -> Any:
    value, errors = _load_json_file(path)
    if errors:
        raise ValueError("; ".join(error.render() for error in errors))
    return value


def _validate(paths: Sequence[str], checker: Callable[..., list[ValidationError]], label: str) -> int:
    values = []
    for raw in paths:
        value, errors = _load_json_file(Path(raw))
        if errors:
            for error in errors:
                print(error.render(), file=sys.stderr)
            return 2
        values.append(value)
    errors = checker(*values)
    if errors:
        for error in errors:
            print(error.render(), file=sys.stderr)
        return 1
    print(f"VALID {label}")
    return 0


def demo() -> int:
    """Run self-contained public examples including negative regressions."""
    objective = _read(ROOT / "examples" / "objectives" / "minimal-objective.json")
    evidence = _read(ROOT / "examples" / "evidence" / "minimal-evidence.json")
    checks: list[tuple[str, bool]] = []

    def add(title: str, errors: list[ValidationError], expected: str | None = None) -> None:
        codes = {error.code for error in errors}
        checks.append((title, not errors if expected is None else expected in codes))

    add("valid synthetic objective", validate_objective(objective))
    add("valid synthetic evidence", validate_evidence(evidence))
    add("evidence binds to its objective", validate_evidence_binding(objective, evidence))

    changed = deepcopy(objective)
    changed["contract_ref"] = "example-org/delivery-contract-kit@main"
    add("reject mutable contract pin", validate_objective(changed), "E_REF_NOT_IMMUTABLE")

    changed = deepcopy(objective)
    changed["authorization"] = "MERGE"
    add("reject unapproved authority escalation", validate_transition(objective, changed), "E_AUTHORIZATION_ESCALATION")

    changed = deepcopy(objective)
    changed["status"] = "DONE"
    add("reject DONE without Owner acceptance", validate_objective(changed), "E_OWNER_ACCEPTANCE_REQUIRED")

    changed = deepcopy(objective)
    changed["status"] = "READY"
    add("reject illegal status transition", validate_transition(objective, changed), "E_ILLEGAL_TRANSITION")

    changed = deepcopy(evidence)
    changed["product_acceptance_status"] = "ACCEPTED"
    add("reject engineering as product acceptance", validate_evidence(changed), "E_PRODUCT_ACCEPTANCE_MASQUERADE")

    changed = deepcopy(evidence)
    changed["change_accounting"]["method"] = "full_file_bytes"
    add("reject invalid patch-byte accounting", validate_evidence(changed), "E_CHANGED_BYTE_ACCOUNTING")

    changed = deepcopy(evidence)
    changed["publication"]["state_writeback_ref"] = None
    add("reject incomplete state writeback", validate_evidence(changed), "E_STATE_WRITEBACK_INCOMPLETE")

    changed = deepcopy(evidence)
    changed["publication"]["candidate_refs"].append("local://candidate/duplicate")
    add("reject duplicate candidate identity", validate_evidence(changed), "E_DUPLICATE_CANDIDATE")

    changed = deepcopy(evidence)
    changed["publication"].update(
        state="MERGED", merged=True, branch_refs=["refs/heads/fixture"],
        pull_request_refs=["local://pr/1"], merge_approval_ref="local://owner-approval"
    )
    add("reject unauthorized merge", validate_evidence(changed), "E_AUTHORIZATION_BOUNDARY")

    changed = deepcopy(evidence)
    changed["changes"][0]["path"] = "deployment/secret.yml"
    add("reject changed path beyond scope", validate_evidence_binding(objective, changed), "E_SCOPE_VIOLATION")

    changed = deepcopy(evidence)
    changed["execution_posture"].update(temporary_activation=True, post_run_state="ENABLED")
    add("reject un-restored execution surface", validate_evidence(changed), "E_EXECUTION_POSTURE")

    print("Objective & Evidence Contract Kit — offline demo")
    for title, passed in checks:
        print(f"[{'PASS' if passed else 'FAIL'}] {title}")
    count = sum(passed for _, passed in checks)
    print(f"Result: {count}/{len(checks)} expected outcomes")
    return 0 if count == len(checks) else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Objective and Evidence records with stable error codes.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command, args in (
        ("validate-objective", ["objective"]),
        ("validate-evidence", ["evidence"]),
        ("validate-transition", ["before", "after"]),
        ("validate-binding", ["objective", "evidence"]),
    ):
        cmd = subparsers.add_parser(command)
        for arg in args:
            cmd.add_argument(arg)
    subparsers.add_parser("demo")
    parsed = parser.parse_args(argv)
    commands = {
        "validate-objective": (validate_objective, ["objective"]),
        "validate-evidence": (validate_evidence, ["evidence"]),
        "validate-transition": (validate_transition, ["before", "after"]),
        "validate-binding": (validate_evidence_binding, ["objective", "evidence"]),
    }
    if parsed.command == "demo":
        return demo()
    checker, names = commands[parsed.command]
    return _validate([getattr(parsed, name) for name in names], checker, parsed.command)


if __name__ == "__main__":
    raise SystemExit(main())
