"""Evidence, transition, and Objective binding validation for ADOS v0.2."""

from __future__ import annotations

from typing import Any, Mapping

try:
    from .ados_core import (
        ALLOWED_TRANSITIONS,
        AUTHORIZATION_RANK,
        EVIDENCE_SCHEMA,
        PIN_FIELDS,
        ValidationError,
        _artifact_is_insufficient,
        _dedupe_errors,
        _error,
        validate_against_schema,
        validate_objective,
    )
except ImportError:  # Support `python tools/ados.py ...`.
    from ados_core import (
        ALLOWED_TRANSITIONS,
        AUTHORIZATION_RANK,
        EVIDENCE_SCHEMA,
        PIN_FIELDS,
        ValidationError,
        _artifact_is_insufficient,
        _dedupe_errors,
        _error,
        validate_against_schema,
        validate_objective,
    )

def _publication_requires_candidate(state: str) -> bool:
    return state in {"VERIFIED", "DRAFT_OPEN", "MERGED", "RELEASED"}


def _publication_requires_draft_identity(state: str) -> bool:
    return state in {"DRAFT_OPEN", "MERGED", "RELEASED"}


def _semantic_evidence_errors(manifest: Mapping[str, Any]) -> list[ValidationError]:
    errors: list[ValidationError] = []

    artifact = manifest.get("owner_artifact")
    if isinstance(artifact, Mapping) and _artifact_is_insufficient(artifact):
        errors.append(
            _error(
                "$.owner_artifact",
                "E_OWNER_ARTIFACT",
                "Owner artifact must be directly reviewable and cannot consist only of engineering checks passing",
            )
        )

    acceptance_status = manifest.get("product_acceptance_status")
    acceptance_ref = manifest.get("owner_acceptance_ref")
    if acceptance_status == "ACCEPTED" and not acceptance_ref:
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_PRODUCT_ACCEPTANCE_MASQUERADE",
                "engineering evidence cannot declare product acceptance without an explicit Owner acceptance reference",
            )
        )
    elif acceptance_status == "REJECTED" and not acceptance_ref:
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_OWNER_ACCEPTANCE_REQUIRED",
                "an Owner rejection status requires an explicit Owner decision reference",
            )
        )
    elif acceptance_status == "PENDING_OWNER" and acceptance_ref:
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_PRODUCT_ACCEPTANCE_MASQUERADE",
                "PENDING_OWNER must not carry a product acceptance reference",
            )
        )

    changes = manifest.get("changes")
    accounting = manifest.get("change_accounting")
    if isinstance(changes, list) and isinstance(accounting, Mapping):
        measured = sum(
            change.get("bytes_changed", 0)
            for change in changes
            if isinstance(change, Mapping) and isinstance(change.get("bytes_changed"), int)
        )
        if accounting.get("method") != "staged_patch_bytes":
            errors.append(
                _error(
                    "$.change_accounting.method",
                    "E_CHANGED_BYTE_ACCOUNTING",
                    (
                        "changed bytes must be measured from the exact staged patch, "
                        "not complete post-change file or blob size"
                    ),
                )
            )
        if accounting.get("total_changed_bytes") != measured:
            errors.append(
                _error(
                    "$.change_accounting.total_changed_bytes",
                    "E_CHANGED_BYTE_ACCOUNTING",
                    f"declared total does not equal the sum of per-change patch bytes ({measured})",
                )
            )
        limit = accounting.get("limit_bytes")
        if isinstance(limit, int) and measured > limit:
            errors.append(
                _error(
                    "$.change_accounting.total_changed_bytes",
                    "E_CHANGE_LIMIT_EXCEEDED",
                    f"exact staged patch bytes {measured} exceed the approved limit {limit}",
                )
            )

    posture = manifest.get("execution_posture")
    if isinstance(posture, Mapping):
        temporary = posture.get("temporary_activation")
        post_run_state = posture.get("post_run_state")
        restoration_ref = posture.get("restoration_evidence_ref")
        if temporary is True and (post_run_state != "DISABLED" or not restoration_ref):
            errors.append(
                _error(
                    "$.execution_posture",
                    "E_EXECUTION_POSTURE",
                    "a temporary execution activation must finish in DISABLED state with restoration evidence",
                )
            )
        if temporary is False and post_run_state == "ENABLED":
            errors.append(
                _error(
                    "$.execution_posture.post_run_state",
                    "E_EXECUTION_POSTURE",
                    "an evidence manifest cannot leave an unapproved execution surface enabled",
                )
            )
        if post_run_state == "NOT_APPLICABLE" and restoration_ref is not None:
            errors.append(
                _error(
                    "$.execution_posture.restoration_evidence_ref",
                    "E_EXECUTION_POSTURE",
                    "NOT_APPLICABLE must not carry restoration evidence",
                )
            )

    publication = manifest.get("publication")
    if not isinstance(publication, Mapping):
        return errors

    candidate_id = manifest.get("candidate_id")
    if publication.get("identity_key") != candidate_id:
        errors.append(
            _error(
                "$.publication.identity_key",
                "E_CANDIDATE_IDENTITY",
                "publication identity must equal candidate_id so recovery reconciles one stable candidate",
            )
        )

    for field in ("branch_refs", "candidate_refs", "pull_request_refs"):
        refs = publication.get(field)
        if isinstance(refs, list) and len(refs) > 1:
            errors.append(
                _error(
                    f"$.publication.{field}",
                    "E_DUPLICATE_CANDIDATE",
                    "one objective candidate may reconcile at most one branch, candidate commit, and Draft PR identity",
                )
            )

    state = publication.get("state")
    branch_refs = publication.get("branch_refs") if isinstance(publication.get("branch_refs"), list) else []
    candidate_refs = publication.get("candidate_refs") if isinstance(publication.get("candidate_refs"), list) else []
    pr_refs = publication.get("pull_request_refs") if isinstance(publication.get("pull_request_refs"), list) else []
    state_writeback_ref = publication.get("state_writeback_ref")

    if state == "NOT_STARTED":
        if branch_refs or candidate_refs or pr_refs or state_writeback_ref:
            errors.append(
                _error(
                    "$.publication",
                    "E_PUBLICATION_STATE",
                    "NOT_STARTED cannot carry publication identities or a state writeback reference",
                )
            )
    else:
        if not state_writeback_ref:
            errors.append(
                _error(
                    "$.publication.state_writeback_ref",
                    "E_STATE_WRITEBACK_INCOMPLETE",
                    "every started, blocked, verified, or published candidate must record its trusted state writeback",
                )
            )

    if isinstance(state, str) and _publication_requires_candidate(state) and len(candidate_refs) != 1:
        errors.append(
            _error(
                "$.publication.candidate_refs",
                "E_PUBLICATION_IDENTITY",
                f"{state} requires exactly one verified candidate reference",
            )
        )

    if isinstance(state, str) and _publication_requires_draft_identity(state):
        if len(branch_refs) != 1:
            errors.append(
                _error(
                    "$.publication.branch_refs",
                    "E_PUBLICATION_IDENTITY",
                    f"{state} requires exactly one deterministic branch reference",
                )
            )
        if len(pr_refs) != 1:
            errors.append(
                _error(
                    "$.publication.pull_request_refs",
                    "E_PUBLICATION_IDENTITY",
                    f"{state} requires exactly one Draft PR reference",
                )
            )

    merged = publication.get("merged")
    released = publication.get("released")
    authorization = manifest.get("authorization")
    auth_rank = AUTHORIZATION_RANK.get(authorization, -1)

    if state in {"MERGED", "RELEASED"} and merged is not True:
        errors.append(_error("$.publication.merged", "E_PUBLICATION_STATE", f"{state} requires merged=true"))
    if state == "RELEASED" and released is not True:
        errors.append(_error("$.publication.released", "E_PUBLICATION_STATE", "RELEASED requires released=true"))
    if released is True and merged is not True:
        errors.append(_error("$.publication.released", "E_PUBLICATION_STATE", "release cannot precede merge"))
    if merged is True and state not in {"MERGED", "RELEASED"}:
        errors.append(
            _error(
                "$.publication.state",
                "E_PUBLICATION_STATE",
                "merged=true requires MERGED or RELEASED state",
            )
        )
    if released is True and state != "RELEASED":
        errors.append(_error("$.publication.state", "E_PUBLICATION_STATE", "released=true requires RELEASED state"))

    if merged is True:
        if auth_rank < AUTHORIZATION_RANK["MERGE"]:
            errors.append(
                _error(
                    "$.authorization",
                    "E_AUTHORIZATION_BOUNDARY",
                    "candidate was merged without MERGE authorization",
                )
            )
        if not publication.get("merge_approval_ref"):
            errors.append(
                _error(
                    "$.publication.merge_approval_ref",
                    "E_OWNER_APPROVAL_REQUIRED",
                    "merged publication requires an explicit Owner merge approval reference",
                )
            )

    if released is True:
        if auth_rank < AUTHORIZATION_RANK["RELEASE"]:
            errors.append(
                _error(
                    "$.authorization",
                    "E_AUTHORIZATION_BOUNDARY",
                    "candidate was released without RELEASE authorization",
                )
            )
        if not publication.get("release_approval_ref"):
            errors.append(
                _error(
                    "$.publication.release_approval_ref",
                    "E_OWNER_APPROVAL_REQUIRED",
                    "released publication requires an explicit Owner release approval reference",
                )
            )

    return errors


def validate_evidence(manifest: Any) -> list[ValidationError]:
    errors = validate_against_schema(manifest, EVIDENCE_SCHEMA)
    if errors or not isinstance(manifest, Mapping):
        return errors
    errors.extend(_semantic_evidence_errors(manifest))
    return _dedupe_errors(errors)


def _pin_set(record: Mapping[str, Any]) -> dict[str, Any]:
    return {field: record.get(field) for field in PIN_FIELDS}


def _validate_migration(
    before: Mapping[str, Any], after: Mapping[str, Any], migration: Any
) -> list[ValidationError]:
    errors: list[ValidationError] = []
    if not isinstance(migration, Mapping):
        return [
            _error(
                "$.contract_migration",
                "E_MIGRATION_REQUIRED",
                "frozen contract or Harness references changed without an explicit migration record",
            )
        ]

    expected_from = _pin_set(before)
    expected_to = _pin_set(after)
    if migration.get("from") != expected_from:
        errors.append(
            _error(
                "$.contract_migration.from",
                "E_MIGRATION_MISMATCH",
                "migration source pins do not exactly match the before record",
            )
        )
    if migration.get("to") != expected_to:
        errors.append(
            _error(
                "$.contract_migration.to",
                "E_MIGRATION_MISMATCH",
                "migration target pins do not exactly match the after record",
            )
        )
    if not migration.get("owner_approval_ref"):
        errors.append(
            _error(
                "$.contract_migration.owner_approval_ref",
                "E_OWNER_APPROVAL_REQUIRED",
                "contract migration requires explicit Owner approval",
            )
        )
    return errors


def validate_transition(before: Any, after: Any) -> list[ValidationError]:
    before_errors = validate_objective(before)
    after_errors = validate_objective(after)
    if before_errors or after_errors:
        prefixed: list[ValidationError] = []
        prefixed.extend(
            ValidationError(path=f"$before{error.path[1:]}", code=error.code, message=error.message)
            for error in before_errors
        )
        prefixed.extend(
            ValidationError(path=f"$after{error.path[1:]}", code=error.code, message=error.message)
            for error in after_errors
        )
        return _dedupe_errors(prefixed)
    if not isinstance(before, Mapping) or not isinstance(after, Mapping):
        return [_error("$", "E_TYPE", "before and after must both be objective objects")]

    errors: list[ValidationError] = []
    if before.get("objective_id") != after.get("objective_id"):
        errors.append(_error("$.objective_id", "E_OBJECTIVE_ID_DRIFT", "objective_id cannot change in a transition"))
    if before.get("project_id") != after.get("project_id"):
        errors.append(_error("$.project_id", "E_PROJECT_ID_DRIFT", "project_id cannot change in a transition"))

    before_status = before.get("status")
    after_status = after.get("status")
    if before_status == "DONE":
        errors.append(_error("$.status", "E_DONE_TERMINAL", "DONE is terminal and cannot transition"))
    elif (before_status, after_status) not in ALLOWED_TRANSITIONS:
        errors.append(
            _error(
                "$.status",
                "E_ILLEGAL_TRANSITION",
                f"transition {before_status} -> {after_status} is not allowed",
            )
        )

    before_auth = before.get("authorization")
    after_auth = after.get("authorization")
    before_rank = AUTHORIZATION_RANK.get(before_auth, -1)
    after_rank = AUTHORIZATION_RANK.get(after_auth, -1)
    if after_rank > before_rank and not after.get("owner_approval_ref"):
        errors.append(
            _error(
                "$.owner_approval_ref",
                "E_AUTHORIZATION_ESCALATION",
                f"authorization escalation {before_auth} -> {after_auth} requires explicit Owner approval",
            )
        )
    elif after_rank < before_rank:
        errors.append(
            _error(
                "$.authorization",
                "E_AUTHORIZATION_DECREASE",
                f"authorization cannot silently decrease from {before_auth} to {after_auth}",
            )
        )

    changed_pins = [field for field in PIN_FIELDS if before.get(field) != after.get(field)]
    migration = after.get("contract_migration")
    if changed_pins:
        errors.append(
            _error(
                "$",
                "E_FROZEN_REF_DRIFT",
                "frozen pins changed: " + ", ".join(changed_pins),
            )
        )
        migration_errors = _validate_migration(before, after, migration)
        if not migration_errors:
            errors = [error for error in errors if error.code != "E_FROZEN_REF_DRIFT"]
        else:
            errors.extend(migration_errors)
    elif migration is not None:
        errors.append(
            _error(
                "$.contract_migration",
                "E_MIGRATION_UNNECESSARY",
                "migration record is present but no frozen pin changed",
            )
        )

    if (before_status, after_status) == ("OWNER_REVIEW", "DONE") and not after.get("owner_acceptance_ref"):
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_OWNER_ACCEPTANCE_REQUIRED",
                "OWNER_REVIEW -> DONE requires an explicit Owner acceptance reference",
            )
        )

    return _dedupe_errors(errors)


def _path_scope_entry(entry: str) -> str | None:
    value = entry.strip()
    if value.lower().startswith("path:"):
        value = value[5:].strip()
    if not value or " " in value or value.startswith("!"):
        return None
    if value.endswith("/**"):
        value = value[:-3]
    elif value.endswith("/*"):
        value = value[:-2]
    return value.rstrip("/")


def _path_matches(path: str, scope_entry: str) -> bool:
    scope = _path_scope_entry(scope_entry)
    if scope is None:
        return False
    normalized_path = path.strip().lstrip("./").rstrip("/")
    normalized_scope = scope.lstrip("./")
    return normalized_path == normalized_scope or normalized_path.startswith(normalized_scope + "/")


def validate_evidence_binding(
    objective: Any, manifest: Any
) -> list[ValidationError]:
    errors = validate_objective(objective) + validate_evidence(manifest)
    if errors or not isinstance(objective, Mapping) or not isinstance(manifest, Mapping):
        return _dedupe_errors(errors)

    for field in ("objective_id", "contract_ref", "project_harness_ref", "authorization"):
        if objective.get(field) != manifest.get(field):
            errors.append(
                _error(
                    f"$.{field}",
                    "E_EVIDENCE_BINDING",
                    f"evidence {field} does not match the frozen objective",
                )
            )
    if objective.get("status") != manifest.get("objective_status"):
        errors.append(
            _error(
                "$.objective_status",
                "E_EVIDENCE_BINDING",
                "evidence objective_status does not match the objective record",
            )
        )

    allowed = [item for item in objective.get("allowed_scope", []) if isinstance(item, str)]
    forbidden = [item for item in objective.get("forbidden_scope", []) if isinstance(item, str)]
    path_like_allowed = [item for item in allowed if _path_scope_entry(item) is not None]
    for index, change in enumerate(manifest.get("changes", [])):
        if not isinstance(change, Mapping) or not isinstance(change.get("path"), str):
            continue
        path = change["path"]
        if path_like_allowed and not any(_path_matches(path, item) for item in path_like_allowed):
            errors.append(
                _error(
                    f"$.changes[{index}].path",
                    "E_SCOPE_VIOLATION",
                    "changed path is outside the objective allowed_scope",
                )
            )
        if any(_path_matches(path, item) for item in forbidden):
            errors.append(
                _error(
                    f"$.changes[{index}].path",
                    "E_SCOPE_VIOLATION",
                    "changed path is inside the objective forbidden_scope",
                )
            )

    if manifest.get("product_acceptance_status") == "ACCEPTED" and objective.get("status") != "DONE":
        errors.append(
            _error(
                "$.product_acceptance_status",
                "E_EVIDENCE_BINDING",
                "accepted product evidence must bind to an objective already transitioned to DONE",
            )
        )

    return _dedupe_errors(errors)
