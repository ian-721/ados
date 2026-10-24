CREATE TABLE activation_dispatch_bindings_v2 (
  dispatch_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL UNIQUE REFERENCES activations(activation_id),
  request_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL UNIQUE CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  receipt_id TEXT NOT NULL UNIQUE,
  resolver_profile_id TEXT NOT NULL CHECK (resolver_profile_id = 'resolver.fixture-single-running-objective'),
  resolver_profile_version TEXT NOT NULL,
  resolver_capability_digest TEXT NOT NULL CHECK (resolver_capability_digest GLOB 'sha256:[0-9a-f]*' AND length(resolver_capability_digest) = 71),
  resolution_digest TEXT NOT NULL CHECK (resolution_digest GLOB 'sha256:[0-9a-f]*' AND length(resolution_digest) = 71),
  repository_full_name TEXT NOT NULL CHECK (repository_full_name = 'fixture.invalid/ados-fixture-delivery'),
  repository_id TEXT NOT NULL,
  objective_ref TEXT NOT NULL,
  objective_digest TEXT NOT NULL CHECK (objective_digest GLOB 'sha256:[0-9a-f]*' AND length(objective_digest) = 71),
  project_harness_ref TEXT NOT NULL,
  harness_digest TEXT NOT NULL CHECK (harness_digest GLOB 'sha256:[0-9a-f]*' AND length(harness_digest) = 71),
  base_sha TEXT NOT NULL,
  execution_profile_id TEXT NOT NULL CHECK (execution_profile_id = 'executor.codex-app-server.fixture-v0.1'),
  execution_profile_version TEXT NOT NULL,
  execution_capability_digest TEXT NOT NULL CHECK (execution_capability_digest GLOB 'sha256:[0-9a-f]*' AND length(execution_capability_digest) = 71),
  run_id TEXT NOT NULL UNIQUE,
  envelope_digest TEXT NOT NULL CHECK (envelope_digest GLOB 'sha256:[0-9a-f]*' AND length(envelope_digest) = 71),
  bound_at TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  CHECK (
    (
      resolver_profile_version = '0.1.0-public.1'
      AND resolver_capability_digest = 'sha256:88d6d6733713bd7c6af1971dbd84a3f6ca428efe560891cace3264ef229d7f4c'
      AND objective_ref = 'fixture.invalid/ados-fixture-delivery#3'
      AND project_harness_ref = 'fixture.invalid/ados-fixture-delivery@e75d162750acf4775a7a1ba1d1955ca9d60bc73f#docs/HARNESS.md'
      AND base_sha = 'e75d162750acf4775a7a1ba1d1955ca9d60bc73f'
      AND execution_profile_version = '0.1.0-public.1'
      AND execution_capability_digest = 'sha256:bc904e3b85e49ea09c82deae06c6a4d46de92a38c97eb92b3093ea0523906ba5'
    )
    OR
    (
      resolver_profile_version = '0.1.1-public.1'
      AND resolver_capability_digest = 'sha256:030b43c80e90aa1add25d35f6ab212951539b14e4e12a6f58073c52508faaf05'
      AND objective_ref = 'fixture.invalid/ados-fixture-delivery#5'
      AND project_harness_ref = 'fixture.invalid/ados-fixture-delivery@4e772e775cbc843420c8580fcff8a85c92754bdd#docs/HARNESS.md'
      AND base_sha = '4e772e775cbc843420c8580fcff8a85c92754bdd'
      AND execution_profile_version = '0.1.0-slice4-repair-public.1'
      AND execution_capability_digest = 'sha256:b055bbe3fa2aa44c6b069b85e13bdc8909ab0250ae991e4d7e387d5a46eea157'
    )
  )
) STRICT;

INSERT INTO activation_dispatch_bindings_v2(
  dispatch_id, activation_id, request_id, request_digest, receipt_id,
  resolver_profile_id, resolver_profile_version, resolver_capability_digest,
  resolution_digest, repository_full_name, repository_id,
  objective_ref, objective_digest, project_harness_ref, harness_digest,
  base_sha, execution_profile_id, execution_profile_version,
  execution_capability_digest, run_id, envelope_digest, bound_at, last_event_seq
)
SELECT
  dispatch_id, activation_id, request_id, request_digest, receipt_id,
  resolver_profile_id, resolver_profile_version, resolver_capability_digest,
  resolution_digest, repository_full_name, repository_id,
  objective_ref, objective_digest, project_harness_ref, harness_digest,
  base_sha, execution_profile_id, execution_profile_version,
  execution_capability_digest, run_id, envelope_digest, bound_at, last_event_seq
FROM activation_dispatch_bindings;

DROP TABLE activation_dispatch_bindings;
ALTER TABLE activation_dispatch_bindings_v2 RENAME TO activation_dispatch_bindings;

CREATE INDEX activation_dispatch_bindings_resolution
ON activation_dispatch_bindings(resolution_digest);

CREATE INDEX activation_dispatch_bindings_objective
ON activation_dispatch_bindings(objective_ref, objective_digest);

CREATE TRIGGER activation_dispatch_bindings_no_update
BEFORE UPDATE ON activation_dispatch_bindings
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ACTIVATION_DISPATCH_BINDING');
END;

CREATE TRIGGER activation_dispatch_bindings_no_delete
BEFORE DELETE ON activation_dispatch_bindings
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ACTIVATION_DISPATCH_BINDING');
END;
