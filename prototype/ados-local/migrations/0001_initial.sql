CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (checksum GLOB 'sha256:[0-9a-f]*' AND length(checksum) = 71),
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_jcs TEXT NOT NULL CHECK (json_valid(payload_jcs)),
  occurred_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  prev_hash TEXT CHECK (prev_hash IS NULL OR (prev_hash GLOB 'sha256:[0-9a-f]*' AND length(prev_hash) = 71)),
  event_hash TEXT NOT NULL UNIQUE CHECK (event_hash GLOB 'sha256:[0-9a-f]*' AND length(event_hash) = 71),
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0)
) STRICT;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER migrations_no_update BEFORE UPDATE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'migrations are immutable');
END;

CREATE TRIGGER migrations_no_delete BEFORE DELETE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'migrations are immutable');
END;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  objective_id TEXT NOT NULL,
  objective_ref TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  objective_digest TEXT NOT NULL,
  envelope_digest TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  state TEXT NOT NULL CHECK (state IN ('PREPARED','EXECUTING','WAITING_OWNER','VERIFYING','PUBLISHING','OWNER_REVIEW','BLOCKED','FAILED','CANCELLED','DONE')),
  candidate_revision INTEGER NOT NULL DEFAULT 1 CHECK (candidate_revision > 0),
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  updated_at TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  last_event_hash TEXT NOT NULL
) STRICT;

CREATE TABLE lease_counters (
  lease_key TEXT PRIMARY KEY,
  last_token INTEGER NOT NULL CHECK (last_token >= 0)
) STRICT;

CREATE TABLE leases (
  lease_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
  holder_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  live INTEGER NOT NULL CHECK (live IN (0, 1))
) STRICT;

CREATE TABLE obligations (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  obligation_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('engineering','product_candidate','publication','owner')),
  verifier_id TEXT NOT NULL,
  minimum_trust INTEGER NOT NULL CHECK (minimum_trust BETWEEN 1 AND 4),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SATISFIED','FAILED','BLOCKED')),
  achieved_trust INTEGER CHECK (achieved_trust IS NULL OR achieved_trust BETWEEN 0 AND 4),
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  PRIMARY KEY (run_id, obligation_id)
) STRICT;

CREATE TABLE approvals (
  receipt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  actor_id TEXT NOT NULL,
  authn_method TEXT NOT NULL,
  action TEXT NOT NULL,
  authorization TEXT NOT NULL,
  approval_ref TEXT NOT NULL,
  owner_turn_digest TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  receipt_digest TEXT NOT NULL UNIQUE,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

CREATE TABLE verifier_receipts (
  verifier_receipt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  obligation_id TEXT NOT NULL,
  verifier_id TEXT NOT NULL,
  trust_level INTEGER NOT NULL CHECK (trust_level BETWEEN 1 AND 4),
  result TEXT NOT NULL CHECK (result IN ('PASS','FAIL','BLOCKED','NOT_APPLICABLE')),
  input_digest TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  FOREIGN KEY (run_id, obligation_id) REFERENCES obligations(run_id, obligation_id)
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  kind TEXT NOT NULL,
  location TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

CREATE TABLE evidence_records (
  evidence_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  candidate_revision INTEGER NOT NULL CHECK (candidate_revision > 0),
  request_digest TEXT NOT NULL,
  objective_digest TEXT NOT NULL,
  envelope_digest TEXT NOT NULL,
  candidate_digest TEXT NOT NULL,
  evidence_digest TEXT NOT NULL UNIQUE,
  product_acceptance_status TEXT NOT NULL CHECK (product_acceptance_status IN ('PENDING_OWNER','ACCEPTED','REJECTED')),
  last_event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

CREATE TABLE outbox (
  outbox_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  kind TEXT NOT NULL,
  payload_jcs TEXT NOT NULL CHECK (json_valid(payload_jcs)),
  status TEXT NOT NULL CHECK (status IN ('PENDING','DELIVERED','CANCELLED')),
  event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

CREATE TABLE projection_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_event_seq INTEGER NOT NULL,
  last_event_hash TEXT,
  rebuilt_at TEXT
) STRICT;

INSERT INTO projection_meta(singleton, last_event_seq, last_event_hash, rebuilt_at)
VALUES (1, 0, NULL, NULL);

CREATE INDEX events_run_seq ON events(run_id, seq);
CREATE INDEX outbox_status ON outbox(status, event_seq);
CREATE INDEX obligations_status ON obligations(run_id, status);
