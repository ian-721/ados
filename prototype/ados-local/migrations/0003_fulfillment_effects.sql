CREATE TABLE workspaces (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  repository_full_name TEXT NOT NULL,
  base_sha TEXT NOT NULL CHECK (base_sha GLOB '[0-9a-f]*' AND length(base_sha) = 40),
  branch_name TEXT NOT NULL,
  worktree_path_digest TEXT NOT NULL CHECK (worktree_path_digest GLOB 'sha256:[0-9a-f]*' AND length(worktree_path_digest) = 71),
  candidate_sha TEXT CHECK (candidate_sha IS NULL OR (candidate_sha GLOB '[0-9a-f]*' AND length(candidate_sha) = 40)),
  candidate_revision INTEGER NOT NULL CHECK (candidate_revision > 0),
  status TEXT NOT NULL CHECK (status IN ('BOUND','MUTATED','VERIFIED','PUBLISHED')),
  last_event_seq INTEGER NOT NULL REFERENCES events(seq)
) STRICT;

CREATE TABLE publications (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  effect_kind TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  outbox_id TEXT NOT NULL UNIQUE REFERENCES outbox(outbox_id),
  target_ref TEXT NOT NULL,
  candidate_sha TEXT CHECK (candidate_sha IS NULL OR (candidate_sha GLOB '[0-9a-f]*' AND length(candidate_sha) = 40)),
  status TEXT NOT NULL CHECK (status IN ('INTENT_COMMITTED','CONFIRMED')),
  result_ref TEXT,
  readback_digest TEXT CHECK (readback_digest IS NULL OR (readback_digest GLOB 'sha256:[0-9a-f]*' AND length(readback_digest) = 71)),
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  PRIMARY KEY (run_id, effect_kind, identity_key)
) STRICT;

CREATE INDEX publications_status ON publications(run_id, status, effect_kind);
