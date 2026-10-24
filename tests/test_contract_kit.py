"""Focused public regressions, using fictional records only."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools import ados  # noqa: E402


class ContractKitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.obj = json.loads((ROOT / "examples/objectives/minimal-objective.json").read_text("utf-8"))
        cls.ev = json.loads((ROOT / "examples/evidence/minimal-evidence.json").read_text("utf-8"))

    def codes(self, errors):
        return {e.code for e in errors}

    def cli(self, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "tools/ados.py"), *args],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )

    def test_schemas_are_json(self):
        for f in (ROOT / "contracts/schemas").glob("*.json"):
            with self.subTest(f=f.name):
                s = json.loads(f.read_text("utf-8"))
                self.assertEqual("object", s["type"])
                self.assertFalse(s["additionalProperties"])

    def test_synthetic_examples_bind(self):
        self.assertEqual([], ados.validate_objective(self.obj))
        self.assertEqual([], ados.validate_evidence(self.ev))
        self.assertEqual([], ados.validate_evidence_binding(self.obj, self.ev))

    def test_schema_and_contract_version_are_separate(self):
        self.assertEqual("objective-record/v0.2", self.obj["schema_version"])
        self.assertEqual("0.2.0", self.obj["contract_version"])
        changed = deepcopy(self.obj)
        changed["contract_version"] = "0.1.0"
        self.assertEqual([], ados.validate_objective(changed))

    def test_missing_required_field(self):
        changed = deepcopy(self.obj)
        del changed["outcome"]
        self.assertIn("E_REQUIRED", self.codes(ados.validate_objective(changed)))

    def test_unknown_field_rejected(self):
        changed = deepcopy(self.obj)
        changed["override_security"] = True
        self.assertIn("E_UNKNOWN_FIELD", self.codes(ados.validate_objective(changed)))

    def test_pin_must_be_immutable(self):
        for pin in ("contract_ref", "project_harness_ref"):
            changed = deepcopy(self.obj)
            changed[pin] = "example-org/repo@main"
            self.assertIn("E_REF_NOT_IMMUTABLE", self.codes(ados.validate_objective(changed)))

    def test_scope_overlap_rejected(self):
        changed = deepcopy(self.obj)
        changed["forbidden_scope"].append("src/")
        self.assertIn("E_SCOPE_CONFLICT", self.codes(ados.validate_objective(changed)))

    def test_check_output_is_not_artifact(self):
        changed = deepcopy(self.obj)
        changed["owner_artifact"].update(location="tests passed", description="all checks passed")
        self.assertIn("E_OWNER_ARTIFACT", self.codes(ados.validate_objective(changed)))

    def test_acceptance_status_requires_owner(self):
        changed = deepcopy(self.obj)
        changed["status"] = "DONE"
        self.assertIn("E_OWNER_ACCEPTANCE_REQUIRED", self.codes(ados.validate_objective(changed)))
        changed = deepcopy(self.ev)
        changed["product_acceptance_status"] = "ACCEPTED"
        self.assertIn("E_PRODUCT_ACCEPTANCE_MASQUERADE", self.codes(ados.validate_evidence(changed)))

    def test_valid_transition(self):
        after = deepcopy(self.obj)
        after["status"] = "OWNER_REVIEW"
        self.assertEqual([], ados.validate_transition(self.obj, after))

    def test_illegal_transition(self):
        after = deepcopy(self.obj)
        after["status"] = "READY"
        self.assertIn("E_ILLEGAL_TRANSITION", self.codes(ados.validate_transition(self.obj, after)))

    def test_authorization_escalation(self):
        after = deepcopy(self.obj)
        after.update(status="OWNER_REVIEW", authorization="MERGE")
        self.assertIn("E_AUTHORIZATION_ESCALATION", self.codes(ados.validate_transition(self.obj, after)))
        after["owner_approval_ref"] = "local://explicit-owner-approval"
        self.assertEqual([], ados.validate_transition(self.obj, after))

    def test_frozen_harness_drift(self):
        after = deepcopy(self.obj)
        after["status"] = "OWNER_REVIEW"
        after["project_harness_ref"] = "example-org/example-project@abcdef0123456789abcdef0123456789abcdef01#docs/HARNESS.md"
        self.assertIn("E_MIGRATION_REQUIRED", self.codes(ados.validate_transition(self.obj, after)))

    def test_done_terminal(self):
        done = deepcopy(self.obj)
        done["status"] = "DONE"
        done["owner_acceptance_ref"] = "local://acceptance"
        after = deepcopy(done)
        after["status"] = "OWNER_REVIEW"
        after["owner_acceptance_ref"] = None
        self.assertIn("E_DONE_TERMINAL", self.codes(ados.validate_transition(done, after)))

    def test_evidence_binding_rejects_harness_drift(self):
        changed = deepcopy(self.ev)
        changed["project_harness_ref"] = "other/other@0123456789abcdef0123456789abcdef01234567"
        self.assertIn("E_EVIDENCE_BINDING", self.codes(ados.validate_evidence_binding(self.obj, changed)))

    def test_evidence_scope_limit(self):
        changed = deepcopy(self.ev)
        changed["changes"][0]["path"] = "deployment/secret.txt"
        self.assertIn("E_SCOPE_VIOLATION", self.codes(ados.validate_evidence_binding(self.obj, changed)))

    def test_patch_byte_limit_and_method(self):
        changed = deepcopy(self.ev)
        changed["change_accounting"]["limit_bytes"] = 200
        self.assertIn("E_CHANGE_LIMIT_EXCEEDED", self.codes(ados.validate_evidence(changed)))
        changed["change_accounting"].update(limit_bytes=4096, method="full_file_bytes")
        self.assertIn("E_CHANGED_BYTE_ACCOUNTING", self.codes(ados.validate_evidence(changed)))

    def test_unique_candidate_identity(self):
        changed = deepcopy(self.ev)
        changed["publication"]["candidate_refs"].append("local://second-candidate")
        self.assertIn("E_DUPLICATE_CANDIDATE", self.codes(ados.validate_evidence(changed)))

    def test_state_writeback_required(self):
        changed = deepcopy(self.ev)
        changed["publication"]["state_writeback_ref"] = None
        self.assertIn("E_STATE_WRITEBACK_INCOMPLETE", self.codes(ados.validate_evidence(changed)))

    def test_merge_gate_rejects_implement_only(self):
        changed = deepcopy(self.ev)
        changed["publication"].update(
            state="MERGED", merged=True, branch_refs=["refs/heads/fixture"],
            pull_request_refs=["local://pr/1"], merge_approval_ref="local://owner",
        )
        self.assertIn("E_AUTHORIZATION_BOUNDARY", self.codes(ados.validate_evidence(changed)))

    def test_execution_posture(self):
        changed = deepcopy(self.ev)
        changed["execution_posture"].update(temporary_activation=True, post_run_state="ENABLED")
        self.assertIn("E_EXECUTION_POSTURE", self.codes(ados.validate_evidence(changed)))

    def test_cli_valid_objective(self):
        proc = self.cli("validate-objective", "examples/objectives/minimal-objective.json")
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("VALID", proc.stdout)

    def test_cli_valid_evidence(self):
        proc = self.cli("validate-evidence", "examples/evidence/minimal-evidence.json")
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("VALID", proc.stdout)

    def test_cli_binding(self):
        proc = self.cli("validate-binding", "examples/objectives/minimal-objective.json", "examples/evidence/minimal-evidence.json")
        self.assertEqual(0, proc.returncode, proc.stderr)

    def test_cli_errors_exit_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.json"
            obj = deepcopy(self.obj)
            obj["contract_ref"] = "movable"
            path.write_text(json.dumps(obj), encoding="utf-8")
            proc = self.cli("validate-objective", str(path))
            self.assertEqual(1, proc.returncode)
            self.assertIn("E_REF_NOT_IMMUTABLE", proc.stderr)

    def test_cli_io_and_json_errors_exit_2(self):
        proc = self.cli("validate-objective", "does-not-exist.json")
        self.assertEqual(2, proc.returncode)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.json"
            path.write_text("{oops", encoding="utf-8")
            proc = self.cli("validate-objective", str(path))
            self.assertEqual(2, proc.returncode)
            self.assertIn("E_JSON_PARSE", proc.stderr)

    def test_approval_reference_is_not_authenticated(self):
        after = deepcopy(self.obj)
        after.update(status="OWNER_REVIEW", authorization="MERGE")
        after["owner_approval_ref"] = "fictional://not-an-authenticated-decision"
        self.assertEqual([], ados.validate_transition(self.obj, after))

    def test_pin_shape_does_not_resolve_a_repository(self):
        changed = deepcopy(self.obj)
        changed["contract_ref"] = "fictional/no-such-repository@" + "0" * 40
        self.assertEqual([], ados.validate_objective(changed))

    def test_failed_check_can_be_a_valid_evidence_record(self):
        changed = deepcopy(self.ev)
        changed["engineering_checks"][0]["status"] = "FAIL"
        self.assertEqual([], ados.validate_evidence_binding(self.obj, changed))

    def test_demo_is_offline_and_passes(self):
        proc = self.cli("demo")
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("14/14", proc.stdout)


if __name__ == "__main__":
    unittest.main()
