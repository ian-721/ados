"""Schema and Objective validation primitives for the ADOS v0.2 kit."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping

ROOT = Path(__file__).resolve().parents[1]
OBJECTIVE_SCHEMA_PATH = ROOT / "contracts" / "schemas" / "objective-record-v0.2.schema.json"
EVIDENCE_SCHEMA_PATH = ROOT / "contracts" / "schemas" / "evidence-manifest-v0.1.schema.json"

AUTHORIZATION_LEVELS = ("DISCOVERY", "PLAN", "IMPLEMENT", "MERGE", "RELEASE")
AUTHORIZATION_RANK = {value: index for index, value in enumerate(AUTHORIZATION_LEVELS)}
STATUS_VALUES = ("READY", "RUNNING", "OWNER_REVIEW", "BLOCKED", "DONE")
ALLOWED_TRANSITIONS = {
    ("READY", "RUNNING"),
    ("RUNNING", "OWNER_REVIEW"),
    ("RUNNING", "BLOCKED"),
    ("BLOCKED", "RUNNING"),
    ("OWNER_REVIEW", "RUNNING"),
    ("OWNER_REVIEW", "DONE"),
}
PIN_FIELDS = ("contract_version", "contract_ref", "project_harness_ref")


@dataclass(frozen=True, order=True)
class ValidationError:
    """One stable, machine-addressable validation error."""

    path: str
    code: str
    message: str

    def render(self) -> str:
        return f"ERROR [{self.code}] {self.path}: {self.message}"


def _error(path: str, code: str, message: str) -> ValidationError:
    return ValidationError(path=path, code=code, message=message)


def _load_json_file(path: Path) -> tuple[Any | None, list[ValidationError]]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, [_error("$", "E_IO", f"cannot read {path}: {exc}")]
    try:
        return json.loads(text), []
    except json.JSONDecodeError as exc:
        return None, [
            _error(
                "$",
                "E_JSON_PARSE",
                f"invalid JSON in {path} at line {exc.lineno}, column {exc.colno}: {exc.msg}",
            )
        ]


def _load_schema(path: Path) -> Mapping[str, Any]:
    data, errors = _load_json_file(path)
    if errors:
        raise RuntimeError(errors[0].message)
    if not isinstance(data, dict):
        raise RuntimeError(f"schema root must be an object: {path}")
    return data


OBJECTIVE_SCHEMA = _load_schema(OBJECTIVE_SCHEMA_PATH)
EVIDENCE_SCHEMA = _load_schema(EVIDENCE_SCHEMA_PATH)


def _resolve_local_ref(root_schema: Mapping[str, Any], ref: str) -> Mapping[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"unsupported non-local schema reference: {ref}")
    current: Any = root_schema
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, Mapping) or token not in current:
            raise ValueError(f"unresolvable schema reference: {ref}")
        current = current[token]
    if not isinstance(current, Mapping):
        raise ValueError(f"schema reference is not an object: {ref}")
    return current


def _json_type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    raise ValueError(f"unsupported schema type: {expected}")


def _child_path(path: str, key: str) -> str:
    return f"{path}.{key}" if path != "$" else f"$.{key}"


def _index_path(path: str, index: int) -> str:
    return f"{path}[{index}]"


def _pattern_error(path: str, pattern: str) -> ValidationError:
    if path.endswith("contract_ref") or path.endswith("project_harness_ref"):
        return _error(
            path,
            "E_REF_NOT_IMMUTABLE",
            (
                "reference must use owner/repository@<40-hex-commit>, optionally followed by #path; "
                "branches and short SHAs are forbidden"
            ),
        )
    return _error(path, "E_FORMAT", f"value does not match required pattern {pattern!r}")


def _is_valid_datetime(value: str) -> bool:
    if not value or value[-1] not in "Zz" and not re.search(r"[+-][0-9]{2}:[0-9]{2}$", value):
        return False
    normalized = value[:-1] + "+00:00" if value[-1] in "Zz" else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _validate_schema_node(
    value: Any,
    schema: Mapping[str, Any],
    root_schema: Mapping[str, Any],
    path: str,
) -> list[ValidationError]:
    if "$ref" in schema:
        try:
            target = _resolve_local_ref(root_schema, str(schema["$ref"]))
        except ValueError as exc:
            return [_error(path, "E_SCHEMA", str(exc))]
        return _validate_schema_node(value, target, root_schema, path)

    if "anyOf" in schema:
        branches = schema["anyOf"]
        if not isinstance(branches, list):
            return [_error(path, "E_SCHEMA", "anyOf must be an array")]
        attempts = [_validate_schema_node(value, branch, root_schema, path) for branch in branches]
        if any(not errors for errors in attempts):
            return []
        nonempty = [errors for errors in attempts if errors]
        if nonempty:
            return min(nonempty, key=lambda errors: (len(errors), [e.code for e in errors]))
        return [_error(path, "E_SCHEMA_ANY_OF", "value does not match any allowed form")]

    errors: list[ValidationError] = []
    expected_type = schema.get("type")
    if expected_type is not None:
        if not isinstance(expected_type, str):
            return [_error(path, "E_SCHEMA", "only single-string schema types are supported")]
        if not _json_type_matches(value, expected_type):
            actual = "null" if value is None else type(value).__name__
            return [_error(path, "E_TYPE", f"expected {expected_type}, got {actual}")]

    if "const" in schema and value != schema["const"]:
        errors.append(_error(path, "E_CONST", f"expected constant value {schema['const']!r}"))

    enum = schema.get("enum")
    if enum is not None and value not in enum:
        rendered = ", ".join(repr(item) for item in enum)
        errors.append(_error(path, "E_ENUM", f"expected one of: {rendered}"))

    if isinstance(value, str):
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(value) < min_length:
            errors.append(_error(path, "E_EMPTY", f"string must contain at least {min_length} character(s)"))
        max_length = schema.get("maxLength")
        if isinstance(max_length, int) and len(value) > max_length:
            errors.append(_error(path, "E_LENGTH", f"string must contain at most {max_length} character(s)"))
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.search(pattern, value) is None:
            errors.append(_pattern_error(path, pattern))
        if schema.get("format") == "date-time" and not _is_valid_datetime(value):
            errors.append(_error(path, "E_FORMAT", "expected an RFC 3339 date-time with an explicit timezone"))

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        if isinstance(minimum, (int, float)) and value < minimum:
            errors.append(_error(path, "E_RANGE", f"number must be at least {minimum}"))

    if isinstance(value, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(value) < min_items:
            errors.append(_error(path, "E_EMPTY", f"array must contain at least {min_items} item(s)"))
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(value) > max_items:
            errors.append(_error(path, "E_LENGTH", f"array must contain at most {max_items} item(s)"))
        if schema.get("uniqueItems") is True:
            seen: set[str] = set()
            for index, item in enumerate(value):
                canonical = json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                if canonical in seen:
                    errors.append(_error(_index_path(path, index), "E_DUPLICATE_VALUE", "array items must be unique"))
                seen.add(canonical)
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(value):
                errors.extend(_validate_schema_node(item, item_schema, root_schema, _index_path(path, index)))

    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if key not in value:
                    errors.append(_error(_child_path(path, str(key)), "E_REQUIRED", "required field is missing"))
        properties = schema.get("properties", {})
        if not isinstance(properties, Mapping):
            properties = {}
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in properties:
                    errors.append(
                        _error(
                            _child_path(path, str(key)),
                            "E_UNKNOWN_FIELD",
                            "field is not defined by this contract",
                        )
                    )
        for key, child_schema in properties.items():
            if key in value and isinstance(child_schema, Mapping):
                errors.extend(
                    _validate_schema_node(value[key], child_schema, root_schema, _child_path(path, str(key)))
                )

    return errors


def validate_against_schema(value: Any, schema: Mapping[str, Any]) -> list[ValidationError]:
    return _dedupe_errors(_validate_schema_node(value, schema, schema, "$"))


def _dedupe_errors(errors: Iterable[ValidationError]) -> list[ValidationError]:
    return sorted(set(errors), key=lambda item: (item.path, item.code, item.message))


def _normalized_scope(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold()).rstrip("/")


def _artifact_is_insufficient(artifact: Mapping[str, Any]) -> bool:
    text = f"{artifact.get('location', '')} {artifact.get('description', '')}".casefold()
    tokens = set(re.findall(r"[a-z0-9]+", text))
    engineering_only = {
        "all",
        "build",
        "checks",
        "check",
        "ci",
        "engineering",
        "green",
        "pass",
        "passed",
        "success",
        "successful",
        "test",
        "tests",
    }
    return bool(tokens) and tokens <= engineering_only


def _semantic_objective_errors(record: Mapping[str, Any]) -> list[ValidationError]:
    errors: list[ValidationError] = []

    allowed = record.get("allowed_scope")
    forbidden = record.get("forbidden_scope")
    if isinstance(allowed, list) and isinstance(forbidden, list):
        forbidden_map = {
            _normalized_scope(item): index
            for index, item in enumerate(forbidden)
            if isinstance(item, str)
        }
        for index, item in enumerate(allowed):
            if not isinstance(item, str):
                continue
            normalized = _normalized_scope(item)
            if normalized and normalized in forbidden_map:
                errors.append(
                    _error(
                        f"$.allowed_scope[{index}]",
                        "E_SCOPE_CONFLICT",
                        f"directly conflicts with $.forbidden_scope[{forbidden_map[normalized]}]",
                    )
                )

    artifact = record.get("owner_artifact")
    if isinstance(artifact, Mapping) and _artifact_is_insufficient(artifact):
        errors.append(
            _error(
                "$.owner_artifact",
                "E_OWNER_ARTIFACT",
                "Owner artifact must be directly reviewable and cannot consist only of engineering checks passing",
            )
        )

    status = record.get("status")
    acceptance_ref = record.get("owner_acceptance_ref")
    if status == "DONE" and not acceptance_ref:
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_OWNER_ACCEPTANCE_REQUIRED",
                "DONE requires an explicit Owner acceptance reference",
            )
        )
    elif status != "DONE" and acceptance_ref:
        errors.append(
            _error(
                "$.owner_acceptance_ref",
                "E_PRODUCT_ACCEPTANCE_MASQUERADE",
                "an Objective may carry Owner acceptance only when its authoritative status is DONE",
            )
        )

    return errors


def validate_objective(record: Any) -> list[ValidationError]:
    errors = validate_against_schema(record, OBJECTIVE_SCHEMA)
    if errors or not isinstance(record, Mapping):
        return errors
    errors.extend(_semantic_objective_errors(record))
    return _dedupe_errors(errors)
