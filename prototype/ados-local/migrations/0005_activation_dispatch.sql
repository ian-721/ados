CREATE TABLE activation_dispatch_bindings (
  dispatch_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL UNIQUE REFERENCES activations(activation_id),
  request_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL UNIQUE CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  receipt_id TEXT NOT NULL UNIQUE,
  resolver_profile_id TEXT NOT NULL CHECK (resolver_profile_id = 'resolver.fixture-single-running-objective'),
  resolver_profile_version TEXT NOT NULL CHECK (resolver_profile_version = '0.1.0-public.1'),
  resolver_capability_digest TEXT NOT NULL CHECK (resolver_capability_digest GLOB 'sha256:[0-9a-f]*' AND length(resolver_capability_digest) = 71),
  resolution_digest TEXT NOT NULL CHECK (resolution_digest GLOB 'sha256:[0-9a-f]*' AND length(resolution_digest) = 71),
  repository_full_name TEXT NOT NULL CHECK (repository_full_name = 'fixture.invalid/ados-fixture-delivery'),
  repository_id TEXT NOT NULL,
  objective_ref TEXT NOT NULL CHECK (objective_ref = 'fixture.invalid/ados-fixture-delivery#3'),
  objective_digest TEXT NOT NULL CHECK (objective_digest GLOB 'sha256:[0-9a-f]*' AND length(objective_digest) = 71),
  project_harness_ref TEXT NOT NULL CHECK (project_harness_ref = 'fixture.invalid/ados-fixture-delivery@e75d162750acf4775a7a1ba1d1955ca9d60bc73f#docs/HARNESS.md'),
  harness_digest TEXT NOT NULL CHECK (harness_digest GLOB 'sha256:[0-9a-f]*' AND length(harness_digest) = 71),
  base_sha TEXT NOT NULL CHECK (base_sha = 'e75d162750acf4775a7a1ba1d1955ca9d60bc73f'),
  execution_profile_id TEXT NOT NULL CHECK (execution_profile_id = 'executor.codex-app-server.fixture-v0.1'),
  execution_profile_version TEXT NOT NULL CHECK (execution_profile_version = '0.1.0-public.1'),
  execution_capability_digest TEXT NOT NULL CHECK (execution_capability_digest GLOB 'sha256:[0-9a-f]*' AND length(execution_capability_digest) = 71),
  run_id TEXT NOT NULL UNIQUE,
  envelope_digest TEXT NOT NULL CHECK (envelope_digest GLOB 'sha256:[0-9a-f]*' AND length(envelope_digest) = 71),
  bound_at TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

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
