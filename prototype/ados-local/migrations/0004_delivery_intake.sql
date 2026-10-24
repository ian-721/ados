CREATE TABLE intake_challenges (
  challenge_id TEXT PRIMARY KEY,
  nonce_digest TEXT NOT NULL CHECK (nonce_digest GLOB 'sha256:[0-9a-f]*' AND length(nonce_digest) = 71),
  extension_origin TEXT NOT NULL CHECK (extension_origin = 'chrome-extension://fpmliiakgebgdlgaddocgddllidmkomd/'),
  actor_id TEXT NOT NULL,
  card_digest TEXT NOT NULL CHECK (card_digest GLOB 'sha256:[0-9a-f]*' AND length(card_digest) = 71),
  selected_turn_digest TEXT NOT NULL CHECK (selected_turn_digest GLOB 'sha256:[0-9a-f]*' AND length(selected_turn_digest) = 71),
  request_id TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL UNIQUE CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  owner_turn_digest TEXT NOT NULL CHECK (owner_turn_digest GLOB 'sha256:[0-9a-f]*' AND length(owner_turn_digest) = 71),
  requested_authorization TEXT NOT NULL CHECK (requested_authorization IN ('DISCOVERY','PLAN','IMPLEMENT','MERGE','RELEASE')),
  capture_profile_id TEXT NOT NULL,
  capture_profile_version TEXT NOT NULL,
  compiler_profile_id TEXT NOT NULL,
  compiler_profile_version TEXT NOT NULL,
  compiler_candidate_digest TEXT NOT NULL CHECK (compiler_candidate_digest GLOB 'sha256:[0-9a-f]*' AND length(compiler_candidate_digest) = 71),
  capture_digest TEXT NOT NULL CHECK (capture_digest GLOB 'sha256:[0-9a-f]*' AND length(capture_digest) = 71),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  card_json TEXT NOT NULL CHECK (json_valid(card_json)),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  receipt_id TEXT
) STRICT;

CREATE TABLE intake_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  activation_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('INTAKE_APPROVED')),
  occurred_at TEXT NOT NULL,
  previous_digest TEXT CHECK (previous_digest IS NULL OR (previous_digest GLOB 'sha256:[0-9a-f]*' AND length(previous_digest) = 71)),
  event_digest TEXT NOT NULL UNIQUE CHECK (event_digest GLOB 'sha256:[0-9a-f]*' AND length(event_digest) = 71),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
) STRICT;

CREATE TABLE approved_delivery_requests (
  request_id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL UNIQUE CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  capture_digest TEXT NOT NULL CHECK (capture_digest GLOB 'sha256:[0-9a-f]*' AND length(capture_digest) = 71),
  compiler_candidate_digest TEXT NOT NULL CHECK (compiler_candidate_digest GLOB 'sha256:[0-9a-f]*' AND length(compiler_candidate_digest) = 71),
  created_at TEXT NOT NULL,
  last_intake_event INTEGER NOT NULL REFERENCES intake_events(seq)
) STRICT;

CREATE TABLE intake_receipts (
  receipt_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES approved_delivery_requests(request_id),
  challenge_id TEXT NOT NULL UNIQUE REFERENCES intake_challenges(challenge_id),
  actor_id TEXT NOT NULL,
  authn_method TEXT NOT NULL CHECK (authn_method = 'local_extension_confirm'),
  action TEXT NOT NULL CHECK (action = 'approve_delivery'),
  authorization TEXT NOT NULL CHECK (authorization IN ('DISCOVERY','PLAN','IMPLEMENT','MERGE','RELEASE')),
  approval_ref TEXT NOT NULL UNIQUE,
  owner_turn_digest TEXT NOT NULL CHECK (owner_turn_digest GLOB 'sha256:[0-9a-f]*' AND length(owner_turn_digest) = 71),
  request_digest TEXT NOT NULL CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  approved_at TEXT NOT NULL,
  last_intake_event INTEGER NOT NULL REFERENCES intake_events(seq)
) STRICT;

CREATE TABLE activations (
  activation_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES approved_delivery_requests(request_id),
  request_digest TEXT NOT NULL UNIQUE CHECK (request_digest GLOB 'sha256:[0-9a-f]*' AND length(request_digest) = 71),
  receipt_id TEXT NOT NULL UNIQUE REFERENCES intake_receipts(receipt_id),
  status TEXT NOT NULL CHECK (status = 'APPROVED_NOT_DISPATCHED'),
  created_at TEXT NOT NULL,
  last_intake_event INTEGER NOT NULL REFERENCES intake_events(seq)
) STRICT;

CREATE INDEX activations_status_created ON activations(status, created_at);

CREATE TRIGGER intake_events_no_update
BEFORE UPDATE ON intake_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INTAKE_EVENT');
END;

CREATE TRIGGER intake_events_no_delete
BEFORE DELETE ON intake_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INTAKE_EVENT');
END;

CREATE TRIGGER approved_delivery_requests_no_update
BEFORE UPDATE ON approved_delivery_requests
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_APPROVED_REQUEST');
END;

CREATE TRIGGER approved_delivery_requests_no_delete
BEFORE DELETE ON approved_delivery_requests
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_APPROVED_REQUEST');
END;

CREATE TRIGGER intake_receipts_no_update
BEFORE UPDATE ON intake_receipts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INTAKE_RECEIPT');
END;

CREATE TRIGGER intake_receipts_no_delete
BEFORE DELETE ON intake_receipts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INTAKE_RECEIPT');
END;

CREATE TRIGGER activations_no_update
BEFORE UPDATE ON activations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ACTIVATION');
END;

CREATE TRIGGER activations_no_delete
BEFORE DELETE ON activations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ACTIVATION');
END;

CREATE TRIGGER intake_challenges_no_delete
BEFORE DELETE ON intake_challenges
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CHALLENGE');
END;

CREATE TRIGGER intake_challenges_consume_once
BEFORE UPDATE ON intake_challenges
WHEN OLD.consumed_at IS NOT NULL
  OR NEW.challenge_id <> OLD.challenge_id
  OR NEW.nonce_digest <> OLD.nonce_digest
  OR NEW.extension_origin <> OLD.extension_origin
  OR NEW.actor_id <> OLD.actor_id
  OR NEW.card_digest <> OLD.card_digest
  OR NEW.selected_turn_digest <> OLD.selected_turn_digest
  OR NEW.request_id <> OLD.request_id
  OR NEW.request_digest <> OLD.request_digest
  OR NEW.owner_turn_digest <> OLD.owner_turn_digest
  OR NEW.requested_authorization <> OLD.requested_authorization
  OR NEW.capture_profile_id <> OLD.capture_profile_id
  OR NEW.capture_profile_version <> OLD.capture_profile_version
  OR NEW.compiler_profile_id <> OLD.compiler_profile_id
  OR NEW.compiler_profile_version <> OLD.compiler_profile_version
  OR NEW.compiler_candidate_digest <> OLD.compiler_candidate_digest
  OR NEW.capture_digest <> OLD.capture_digest
  OR NEW.request_json <> OLD.request_json
  OR NEW.card_json <> OLD.card_json
  OR NEW.issued_at <> OLD.issued_at
  OR NEW.expires_at <> OLD.expires_at
  OR NEW.consumed_at IS NULL
  OR NEW.receipt_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'CHALLENGE_REWRITE_FORBIDDEN');
END;
