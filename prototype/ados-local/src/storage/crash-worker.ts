import { canonicalJson, hashCanonical } from "../canonical/index.js";
import type { JsonObject } from "../types.js";
import { BetterSqlite3Driver } from "./better-sqlite3-driver.js";

type Boundary =
  | "before-begin"
  | "after-begin"
  | "after-event"
  | "after-projection"
  | "after-commit";

async function hold(boundary: Boundary): Promise<never> {
  process.send?.({ type: "ready", boundary });
  setInterval(() => undefined, 1000);
  return new Promise<never>(() => undefined);
}

const [databasePath, runId, holderId, tokenText, boundaryText] = process.argv.slice(2);
if (
  databasePath === undefined ||
  runId === undefined ||
  holderId === undefined ||
  tokenText === undefined ||
  boundaryText === undefined
) {
  throw new Error("CRASH_WORKER_ARGUMENTS_INVALID");
}
const boundary = boundaryText as Boundary;
if (!new Set<Boundary>(["before-begin", "after-begin", "after-event", "after-projection", "after-commit"]).has(boundary)) {
  throw new Error("CRASH_WORKER_BOUNDARY_INVALID");
}
const fencingToken = Number.parseInt(tokenText, 10);
const driver = new BetterSqlite3Driver(databasePath, { fileMustExist: true });
driver.pragma("journal_mode = WAL");
driver.pragma("synchronous = FULL");
driver.pragma("foreign_keys = ON");
driver.pragma("busy_timeout = 5000");
driver.pragma("trusted_schema = OFF");

if (boundary === "before-begin") {
  await hold(boundary);
}

driver.exec("BEGIN IMMEDIATE");
if (boundary === "after-begin") {
  await hold(boundary);
}

const run = driver.get<{
  readonly state: string;
  readonly fencing_token: number;
  readonly objective_ref: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly candidate_revision: number;
}>(
  `SELECT state, fencing_token, objective_ref, objective_digest,
          envelope_digest, candidate_revision
   FROM runs WHERE run_id = ?`,
  [runId],
);
const lease = driver.get<{
  readonly holder_id: string;
  readonly fencing_token: number;
  readonly live: number;
}>("SELECT holder_id, fencing_token, live FROM leases WHERE run_id = ?", [runId]);
if (
  run?.state !== "EXECUTING" ||
  run.fencing_token !== fencingToken ||
  lease?.holder_id !== holderId ||
  lease.fencing_token !== fencingToken ||
  lease.live !== 1
) {
  driver.exec("ROLLBACK");
  throw new Error("CRASH_WORKER_FENCING_REJECTED");
}
const previous = driver.get<{ readonly event_hash: string }>(
  "SELECT event_hash FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
  [runId],
);
const eventId = `evt-crash-${boundary}`;
const occurredAt = "2026-08-02T02:00:00.000Z";
const idempotencyKey = `${runId}:crash:${boundary}`;
const outboxId = `${runId}:crash:${boundary}:state`;
const payload: JsonObject = {
  from: "EXECUTING",
  to: "VERIFYING",
  event_binding: {
    objective_ref: run.objective_ref,
    objective_digest: run.objective_digest,
    envelope_digest: run.envelope_digest,
    candidate_revision: run.candidate_revision,
  },
  outbox: { outbox_id: outboxId, kind: "RUN_STATE_CHANGED", status: "PENDING" },
};
const eventHash = hashCanonical({
  event_id: eventId,
  run_id: runId,
  event_type: "RUN_STATE_CHANGED",
  payload,
  occurred_at: occurredAt,
  idempotency_key: idempotencyKey,
  prev_hash: previous?.event_hash ?? null,
  fencing_token: fencingToken,
});
const inserted = driver.run(
  `INSERT INTO events(
    event_id, run_id, event_type, payload_jcs, occurred_at,
    idempotency_key, prev_hash, event_hash, fencing_token
  ) VALUES (?, ?, 'RUN_STATE_CHANGED', ?, ?, ?, ?, ?, ?)`,
  [
    eventId,
    runId,
    canonicalJson(payload),
    occurredAt,
    idempotencyKey,
    previous?.event_hash ?? null,
    eventHash,
    fencingToken,
  ],
);
const eventSeq = Number(inserted.lastInsertRowid);
if (boundary === "after-event") {
  await hold(boundary);
}

driver.run(
  `UPDATE runs SET state = 'VERIFYING', updated_at = ?, last_event_seq = ?, last_event_hash = ?
   WHERE run_id = ? AND state = 'EXECUTING' AND fencing_token = ?`,
  [occurredAt, eventSeq, eventHash, runId, fencingToken],
);
driver.run(
  `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
   VALUES (?, ?, 'RUN_STATE_CHANGED', ?, 'PENDING', ?)`,
  [outboxId, runId, canonicalJson({ run_id: runId, from: "EXECUTING", to: "VERIFYING" }), eventSeq],
);
driver.run(
  "UPDATE projection_meta SET last_event_seq = ?, last_event_hash = ? WHERE singleton = 1",
  [eventSeq, eventHash],
);
if (boundary === "after-projection") {
  await hold(boundary);
}

driver.exec("COMMIT");
await hold("after-commit");
