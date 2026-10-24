CREATE TABLE sessions (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  profile_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  status TEXT NOT NULL,
  capability_digest TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL REFERENCES events(seq),
  PRIMARY KEY (run_id, profile_id, thread_id)
) STRICT;

CREATE INDEX sessions_thread ON sessions(thread_id, turn_id);
