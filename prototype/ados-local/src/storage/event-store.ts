import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, hashCanonical } from "../canonical/index.js";
import {
  trustNumber,
  type JsonObject,
  type JsonValue,
  type RunProjection,
  type RunSeed,
  type RunState,
  type TrustLevel,
  type WriterLease,
} from "../types.js";
import { BetterSqlite3Driver } from "./better-sqlite3-driver.js";
import type { SqlRow, StorageDriver } from "./driver.js";
import { applyAndVerifyMigrations, type MigrationIdentity } from "./migrations.js";

interface EventRow extends SqlRow {
  readonly seq: number;
  readonly event_id: string;
  readonly run_id: string;
  readonly event_type: string;
  readonly payload_jcs: string;
  readonly occurred_at: string;
  readonly idempotency_key: string;
  readonly prev_hash: string | null;
  readonly event_hash: string;
  readonly fencing_token: number;
}

interface RunRow extends SqlRow, RunProjection {}
interface LeaseRow extends SqlRow, WriterLease {}

interface ObligationRow extends SqlRow {
  readonly run_id: string;
  readonly obligation_id: string;
  readonly category: "engineering" | "product_candidate" | "publication" | "owner";
  readonly verifier_id: string;
  readonly minimum_trust: number;
  readonly status: "PENDING" | "SATISFIED" | "FAILED" | "BLOCKED";
  readonly achieved_trust: number | null;
  readonly last_event_seq: number;
}

interface AppendedEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly eventHash: string;
  readonly occurredAt: string;
}

export interface StoreOptions {
  readonly migrationsDirectory?: string;
  readonly now?: () => string;
  readonly idFactory?: (prefix: string) => string;
}

export interface CreateRunResult {
  readonly disposition: "CREATED" | "DUPLICATE_RECONCILED";
  readonly run: RunProjection;
  readonly lease: WriterLease;
}

interface IntakeEventRow extends SqlRow {
  readonly seq: number;
  readonly event_id: string;
  readonly activation_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly previous_digest: string | null;
  readonly event_digest: string;
  readonly payload_json: string;
}

interface AuthenticatedIntakeRow extends SqlRow {
  readonly activation_id: string;
  readonly activation_request_id: string;
  readonly activation_request_digest: string;
  readonly activation_receipt_id: string;
  readonly activation_status: string;
  readonly activation_created_at: string;
  readonly activation_last_event: number;
  readonly request_json: string;
  readonly receipt_id: string;
  readonly actor_id: string;
  readonly authn_method: string;
  readonly action: string;
  readonly authorization: string;
  readonly approval_ref: string;
  readonly owner_turn_digest: string;
  readonly receipt_request_digest: string;
  readonly approved_at: string;
  readonly challenge_requested_authorization: string;
  readonly challenge_request_id: string;
  readonly challenge_request_digest: string;
  readonly challenge_receipt_id: string | null;
}

interface DispatchApprovalRow extends SqlRow {
  readonly receipt_id: string;
  readonly run_id: string;
  readonly authn_method: string;
  readonly authorization: string;
  readonly request_digest: string;
}

export interface ActivationDispatchBindingInput {
  readonly dispatch_id: string;
  readonly activation_id: string;
  readonly resolver_profile_id: "resolver.fixture-single-running-objective";
  readonly resolver_profile_version: "0.1.0-public.1" | "0.1.1-public.1";
  readonly resolver_capability_digest: string;
  readonly resolution_digest: string;
  readonly repository_full_name: "fixture.invalid/ados-fixture-delivery";
  readonly repository_id: string;
  readonly objective_ref: "fixture.invalid/ados-fixture-delivery#3" | "fixture.invalid/ados-fixture-delivery#5";
  readonly objective_digest: string;
  readonly project_harness_ref:
    | "fixture.invalid/ados-fixture-delivery@e75d162750acf4775a7a1ba1d1955ca9d60bc73f#docs/HARNESS.md"
    | "fixture.invalid/ados-fixture-delivery@4e772e775cbc843420c8580fcff8a85c92754bdd#docs/HARNESS.md";
  readonly harness_digest: string;
  readonly base_sha:
    | "e75d162750acf4775a7a1ba1d1955ca9d60bc73f"
    | "4e772e775cbc843420c8580fcff8a85c92754bdd";
  readonly execution_profile_id: "executor.codex-app-server.fixture-v0.1";
  readonly execution_profile_version: "0.1.0-public.1" | "0.1.0-slice4-repair-public.1";
  readonly execution_capability_digest: string;
  readonly seed: RunSeed;
  readonly fault?: "before_commit" | "after_commit";
}

export interface ActivationDispatchBindingRecord extends SqlRow {
  readonly dispatch_id: string;
  readonly activation_id: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly receipt_id: string;
  readonly resolver_profile_id: string;
  readonly resolver_profile_version: string;
  readonly resolver_capability_digest: string;
  readonly resolution_digest: string;
  readonly repository_full_name: string;
  readonly repository_id: string;
  readonly objective_ref: string;
  readonly objective_digest: string;
  readonly project_harness_ref: string;
  readonly harness_digest: string;
  readonly base_sha: string;
  readonly execution_profile_id: string;
  readonly execution_profile_version: string;
  readonly execution_capability_digest: string;
  readonly run_id: string;
  readonly envelope_digest: string;
  readonly bound_at: string;
  readonly last_event_seq: number;
}

export interface BindActivationResult extends CreateRunResult {
  readonly binding: ActivationDispatchBindingRecord;
  readonly receipt: OwnerReceiptInput;
}

export interface VerifierReceiptInput {
  readonly verifier_receipt_id: string;
  readonly obligation_id: string;
  readonly verifier_id: string;
  readonly trust_level: TrustLevel;
  readonly result: "PASS" | "FAIL" | "BLOCKED" | "NOT_APPLICABLE";
  readonly input_digest: string;
  readonly result_digest: string;
  readonly evidence_ref: string;
}

export interface OwnerReceiptInput {
  readonly receipt_id: string;
  readonly actor_id: string;
  readonly authn_method:
    | "local_extension_confirm"
    | "os_user_presence"
    | "platform_signed"
    | "external_owner_record";
  readonly action: "approve_delivery";
  readonly authorization: "DISCOVERY" | "PLAN" | "IMPLEMENT" | "MERGE" | "RELEASE";
  readonly approval_ref: string;
  readonly owner_turn_digest: string;
  readonly request_digest: string;
  readonly approved_at: string;
}

export interface OwnerCancellationReceiptInput {
  readonly receipt_id: string;
  readonly actor_id: string;
  readonly authn_method: "local_extension_confirm" | "os_user_presence";
  readonly action: "cancel_run";
  readonly run_id: string;
  readonly envelope_digest: string;
  readonly challenge_binding_digest: string;
  readonly reason_digest: string;
  readonly decided_at: string;
  readonly idempotency_key: string;
}

export interface OwnerCancellationReceiptRecord extends OwnerCancellationReceiptInput {
  readonly receipt_digest: string;
}

export interface EvidenceInput {
  readonly evidence_id: string;
  readonly candidate_revision: number;
  readonly request_digest: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly candidate_digest: string;
  readonly product_acceptance_status: "PENDING_OWNER" | "ACCEPTED" | "REJECTED";
}

export interface ArtifactInput {
  readonly artifact_id: string;
  readonly kind: string;
  readonly location: string;
  readonly artifact_digest: string;
}

export interface WorkspaceFactInput {
  readonly repository_full_name: string;
  readonly base_sha: string;
  readonly branch_name: string;
  readonly worktree_path_digest: string;
  readonly candidate_sha: string | null;
  readonly candidate_revision: number;
  readonly status: "BOUND" | "MUTATED" | "VERIFIED" | "PUBLISHED";
}

export interface ExternalEffectIntentInput {
  readonly outbox_id: string;
  readonly effect_kind: string;
  readonly identity_key: string;
  readonly target_ref: string;
  readonly candidate_sha: string | null;
  readonly payload: JsonObject;
}

export interface ExternalEffectResultInput {
  readonly outbox_id: string;
  readonly effect_kind: string;
  readonly identity_key: string;
  readonly result_ref: string;
  readonly readback_digest: string;
}

export interface EvidenceCorrectionInput {
  readonly evidence_outbox_id: string;
  readonly correction_outbox_id: string;
  readonly identity_key: string;
  readonly candidate_sha: string;
  readonly comment_id: number;
  readonly comment_url: string;
  readonly prior_manifest_digest: string;
  readonly corrected_manifest_digest: string;
  readonly corrected_comment_readback_digest: string;
}

export interface PublicationRecord {
  readonly run_id: string;
  readonly effect_kind: string;
  readonly identity_key: string;
  readonly outbox_id: string;
  readonly target_ref: string;
  readonly candidate_sha: string | null;
  readonly status: "INTENT_COMMITTED" | "CONFIRMED";
  readonly result_ref: string | null;
  readonly readback_digest: string | null;
  readonly last_event_seq: number;
}

export interface WorkspaceRecord extends WorkspaceFactInput {
  readonly run_id: string;
  readonly last_event_seq: number;
}

export interface SessionRecord {
  readonly run_id: string;
  readonly profile_id: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly status: string;
  readonly capability_digest: string;
  readonly last_event_seq: number;
}

export interface StoreSummary {
  readonly run: RunProjection;
  readonly lease: WriterLease;
  readonly event_count: number;
  readonly chain_head: string;
  readonly obligations: readonly ObligationRow[];
  readonly approval_count: number;
  readonly verifier_receipt_count: number;
  readonly artifact_count: number;
  readonly evidence_count: number;
  readonly session_count: number;
  readonly outbox_count: number;
  readonly workspace_count: number;
  readonly publication_count: number;
}

export interface EventTimelineItem {
  readonly seq: number;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly event_hash: string;
}

export interface VerifierReceiptRecord {
  readonly verifier_receipt_id: string;
  readonly obligation_id: string;
  readonly verifier_id: string;
  readonly trust_level: number;
  readonly result: string;
  readonly input_digest: string;
  readonly result_digest: string;
  readonly evidence_ref: string;
}

const transitions: Readonly<Record<RunState, readonly RunState[]>> = {
  PREPARED: ["EXECUTING", "BLOCKED", "CANCELLED"],
  EXECUTING: ["WAITING_OWNER", "VERIFYING", "BLOCKED", "FAILED", "CANCELLED"],
  WAITING_OWNER: ["EXECUTING", "BLOCKED", "CANCELLED"],
  VERIFYING: ["EXECUTING", "PUBLISHING", "BLOCKED", "FAILED", "CANCELLED"],
  PUBLISHING: ["OWNER_REVIEW", "BLOCKED", "FAILED"],
  BLOCKED: ["EXECUTING", "VERIFYING", "PUBLISHING", "CANCELLED"],
  FAILED: ["EXECUTING", "VERIFYING", "PUBLISHING", "CANCELLED"],
  OWNER_REVIEW: ["EXECUTING", "DONE", "CANCELLED"],
  CANCELLED: [],
  DONE: [],
};

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function numberValue(value: number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("SQLITE_INTEGER_OUT_OF_RANGE");
  }
  return result;
}

export class EventStore {
  readonly #driver: StorageDriver;
  readonly #now: () => string;
  readonly #idFactory: (prefix: string) => string;
  public readonly migrations: readonly MigrationIdentity[];

  public constructor(databasePath: string, options: StoreOptions = {}) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#driver = new BetterSqlite3Driver(databasePath);
    try {
      this.#establishPragmas();
      this.migrations = applyAndVerifyMigrations(
        this.#driver,
        options.migrationsDirectory ?? join(process.cwd(), "migrations"),
        this.#now,
        3,
      );
      this.verifyPragmas();
      this.verifySchema();
    } catch (error) {
      this.#driver.close();
      throw error;
    }
  }

  #establishPragmas(): void {
    this.#driver.pragma("journal_mode = WAL");
    this.#driver.pragma("synchronous = FULL");
    this.#driver.pragma("foreign_keys = ON");
    this.#driver.pragma("busy_timeout = 5000");
    this.#driver.pragma("trusted_schema = OFF");
  }

  public verifyPragmas(): Record<string, string | number> {
    const readback = {
      journal_mode: String(this.#driver.pragma("journal_mode", true)).toLowerCase(),
      synchronous: Number(this.#driver.pragma("synchronous", true)),
      foreign_keys: Number(this.#driver.pragma("foreign_keys", true)),
      trusted_schema: Number(this.#driver.pragma("trusted_schema", true)),
      busy_timeout: Number(this.#driver.pragma("busy_timeout", true)),
    };
    if (
      readback.journal_mode !== "wal" ||
      readback.synchronous !== 2 ||
      readback.foreign_keys !== 1 ||
      readback.trusted_schema !== 0 ||
      readback.busy_timeout < 5000
    ) {
      throw new Error(`PRAGMA_MISMATCH:${JSON.stringify(readback)}`);
    }
    return readback;
  }

  public verifySchema(): void {
    const dispatchMigrationApplied = (this.#driver.get<{ readonly count: number }>(
      "SELECT count(*) AS count FROM schema_migrations WHERE version = 5 AND name = '0005_activation_dispatch.sql'",
    )?.count ?? 0) === 1;
    const requiredTables = new Set([
      "schema_migrations",
      "events",
      "runs",
      "lease_counters",
      "leases",
      "obligations",
      "approvals",
      "verifier_receipts",
      "artifacts",
      "evidence_records",
      "sessions",
      "outbox",
      "workspaces",
      "publications",
      "projection_meta",
    ]);
    if (dispatchMigrationApplied) requiredTables.add("activation_dispatch_bindings");
    const tables = this.#driver.all<{ readonly name: string; readonly sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const table of tables) {
      requiredTables.delete(table.name);
      if (!/\)\s*STRICT\s*;?$/i.test(table.sql)) {
        throw new Error(`SCHEMA_TABLE_NOT_STRICT:${table.name}`);
      }
    }
    if (requiredTables.size > 0) {
      throw new Error(`SCHEMA_TABLE_MISSING:${[...requiredTables].sort().join(",")}`);
    }
    const triggers = new Set(
      this.#driver
        .all<{ readonly name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .map((row) => row.name),
    );
    const requiredTriggers = [
      "events_no_update",
      "events_no_delete",
      "migrations_no_update",
      "migrations_no_delete",
    ];
    if (dispatchMigrationApplied) {
      requiredTriggers.push(
        "activation_dispatch_bindings_no_update",
        "activation_dispatch_bindings_no_delete",
      );
    }
    for (const trigger of requiredTriggers) {
      if (!triggers.has(trigger)) {
        throw new Error(`SCHEMA_TRIGGER_MISSING:${trigger}`);
      }
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#driver.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#driver.exec("COMMIT");
      return result;
    } catch (error) {
      this.#driver.exec("ROLLBACK");
      throw error;
    }
  }

  #appendEvent(
    runId: string,
    eventType: string,
    payload: JsonObject,
    idempotencyKey: string,
    fencingToken: number,
    occurredAt = this.#now(),
  ): AppendedEvent {
    const duplicate = this.#driver.get<{ readonly event_hash: string }>(
      "SELECT event_hash FROM events WHERE idempotency_key = ?",
      [idempotencyKey],
    );
    if (duplicate !== undefined) {
      throw new Error(`DUPLICATE_EVENT:${idempotencyKey}`);
    }
    const previous = this.#driver.get<{ readonly event_hash: string }>(
      "SELECT event_hash FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
      [runId],
    );
    const existingRun = this.#driver.get<{
      readonly objective_ref: string;
      readonly objective_digest: string;
      readonly envelope_digest: string;
      readonly candidate_revision: number;
    }>(
      "SELECT objective_ref, objective_digest, envelope_digest, candidate_revision FROM runs WHERE run_id = ?",
      [runId],
    );
    const binding = {
      objective_ref: existingRun?.objective_ref ?? String(payload.objective_ref ?? ""),
      objective_digest: existingRun?.objective_digest ?? String(payload.objective_digest ?? ""),
      envelope_digest: existingRun?.envelope_digest ?? String(payload.envelope_digest ?? ""),
      candidate_revision: existingRun?.candidate_revision ?? Number(payload.candidate_revision),
    };
    if (
      binding.objective_ref.length === 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(binding.objective_digest) ||
      !/^sha256:[0-9a-f]{64}$/.test(binding.envelope_digest) ||
      !Number.isSafeInteger(binding.candidate_revision) ||
      binding.candidate_revision < 1
    ) {
      throw new Error(`EVENT_BINDING_INVALID:${runId}`);
    }
    const boundPayload: JsonObject = {
      ...payload,
      event_binding: binding,
    };
    const eventId = this.#idFactory("evt");
    const prevHash = previous?.event_hash ?? null;
    const eventBody: JsonObject = {
      event_id: eventId,
      run_id: runId,
      event_type: eventType,
      payload: boundPayload,
      occurred_at: occurredAt,
      idempotency_key: idempotencyKey,
      prev_hash: prevHash,
      fencing_token: fencingToken,
    };
    const eventHash = hashCanonical(eventBody);
    const result = this.#driver.run(
      `INSERT INTO events(
        event_id, run_id, event_type, payload_jcs, occurred_at,
        idempotency_key, prev_hash, event_hash, fencing_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        runId,
        eventType,
        canonicalJson(boundPayload),
        occurredAt,
        idempotencyKey,
        prevHash,
        eventHash,
        fencingToken,
      ],
    );
    const seq = numberValue(result.lastInsertRowid);
    this.#driver.run(
      "UPDATE projection_meta SET last_event_seq = ?, last_event_hash = ? WHERE singleton = 1",
      [seq, eventHash],
    );
    return { seq, eventId, eventHash, occurredAt };
  }

  #getRunRow(runId: string): RunRow {
    const run = this.#driver.get<RunRow>("SELECT * FROM runs WHERE run_id = ?", [runId]);
    if (run === undefined) {
      throw new Error(`RUN_NOT_FOUND:${runId}`);
    }
    return run;
  }

  #getLeaseRow(runId: string): LeaseRow {
    const lease = this.#driver.get<LeaseRow>("SELECT * FROM leases WHERE run_id = ?", [runId]);
    if (lease === undefined) {
      throw new Error(`LEASE_NOT_FOUND:${runId}`);
    }
    return lease;
  }

  #assertWriter(runId: string, holderId: string, fencingToken: number): {
    readonly run: RunRow;
    readonly lease: LeaseRow;
  } {
    const run = this.#getRunRow(runId);
    const lease = this.#getLeaseRow(runId);
    if (
      lease.live !== 1 ||
      lease.holder_id !== holderId ||
      lease.fencing_token !== fencingToken ||
      run.fencing_token !== fencingToken
    ) {
      throw new Error(`FENCING_REJECTED:${runId}`);
    }
    return { run, lease };
  }

  #reconcileRunSeed(seed: RunSeed): CreateRunResult | null {
    const existing = this.#driver.get<RunRow>(
      "SELECT * FROM runs WHERE request_id = ?",
      [seed.request_id],
    );
    if (existing !== undefined) {
      if (
        existing.run_id !== seed.run_id ||
        existing.objective_ref !== seed.objective_ref ||
        existing.request_digest !== seed.request_digest ||
        existing.objective_digest !== seed.objective_digest ||
        existing.envelope_digest !== seed.envelope_digest
      ) {
        throw new Error(`REQUEST_STATE_DRIFT:${seed.request_id}`);
      }
      return {
        disposition: "DUPLICATE_RECONCILED",
        run: existing,
        lease: this.#getLeaseRow(existing.run_id),
      };
    }
    return null;
  }

  #createRunLocked(seed: RunSeed): CreateRunResult {
    const held = this.#driver.get<LeaseRow>(
      "SELECT * FROM leases WHERE lease_key = ? AND live = 1",
      [seed.lease_key],
    );
    if (held !== undefined) {
      throw new Error(`LEASE_HELD:${seed.lease_key}`);
    }
    const counter = this.#driver.get<{ readonly last_token: number }>(
      "SELECT last_token FROM lease_counters WHERE lease_key = ?",
      [seed.lease_key],
    );
    const fencingToken = (counter?.last_token ?? 0) + 1;
    this.#driver.run(
      `INSERT INTO lease_counters(lease_key, last_token) VALUES (?, ?)
       ON CONFLICT(lease_key) DO UPDATE SET last_token = excluded.last_token`,
      [seed.lease_key, fencingToken],
    );
    const at = this.#now();
    const expiresAt = new Date(Date.parse(at) + seed.ttl_seconds * 1000).toISOString();
    const obligationPayload = seed.obligations.map((obligation) => ({
      obligation_id: obligation.obligation_id,
      category: obligation.category,
      verifier_id: obligation.verifier_id,
      minimum_trust: trustNumber[obligation.minimum_trust],
    }));
    const payload: JsonObject = {
      request_id: seed.request_id,
      objective_id: seed.objective_id,
      objective_ref: seed.objective_ref,
      request_digest: seed.request_digest,
      objective_digest: seed.objective_digest,
      envelope_digest: seed.envelope_digest,
      candidate_revision: 1,
      generation: seed.generation,
      lease_key: seed.lease_key,
      holder_id: seed.holder_id,
      expires_at: expiresAt,
      obligations: asJson(obligationPayload),
      outbox: {
        outbox_id: `${seed.run_id}:prepared`,
        kind: "RUN_PREPARED",
        status: "PENDING",
      },
    };
    const event = this.#appendEvent(
      seed.run_id,
      "RUN_PREPARED",
      payload,
      `${seed.run_id}:prepare`,
      fencingToken,
      at,
    );
    this.#driver.run(
      `INSERT INTO runs(
        run_id, request_id, objective_id, objective_ref, request_digest, objective_digest,
        envelope_digest, generation, state, candidate_revision, fencing_token,
        updated_at, last_event_seq, last_event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', 1, ?, ?, ?, ?)`,
      [
        seed.run_id,
        seed.request_id,
        seed.objective_id,
        seed.objective_ref,
        seed.request_digest,
        seed.objective_digest,
        seed.envelope_digest,
        seed.generation,
        fencingToken,
        at,
        event.seq,
        event.eventHash,
      ],
    );
    this.#driver.run(
      `INSERT INTO leases(
        lease_key, run_id, holder_id, fencing_token, heartbeat_at, expires_at, live
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [seed.lease_key, seed.run_id, seed.holder_id, fencingToken, at, expiresAt],
    );
    for (const obligation of seed.obligations) {
      this.#driver.run(
        `INSERT INTO obligations(
          run_id, obligation_id, category, verifier_id, minimum_trust,
          status, achieved_trust, last_event_seq
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, ?)`,
        [
          seed.run_id,
          obligation.obligation_id,
          obligation.category,
          obligation.verifier_id,
          trustNumber[obligation.minimum_trust],
          event.seq,
        ],
      );
    }
    this.#driver.run(
      `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
       VALUES (?, ?, 'RUN_PREPARED', ?, 'PENDING', ?)`,
      [
        `${seed.run_id}:prepared`,
        seed.run_id,
        canonicalJson({ run_id: seed.run_id, state: "PREPARED" }),
        event.seq,
      ],
    );
    return {
      disposition: "CREATED",
      run: this.#getRunRow(seed.run_id),
      lease: this.#getLeaseRow(seed.run_id),
    };
  }

  public createRun(seed: RunSeed): CreateRunResult {
    return this.#transaction(() => this.#reconcileRunSeed(seed) ?? this.#createRunLocked(seed));
  }

  #verifyIntakeEventChain(): void {
    const events = this.#driver.all<IntakeEventRow>("SELECT * FROM intake_events ORDER BY seq");
    let previous: string | null = null;
    for (const event of events) {
      const expected = hashCanonical({
        event_id: event.event_id,
        activation_id: event.activation_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        previous_digest: previous,
        payload: JSON.parse(event.payload_json) as JsonValue,
      });
      if (event.previous_digest !== previous || event.event_digest !== expected) {
        throw new Error(`INTAKE_EVENT_CHAIN_INVALID:${event.event_id}`);
      }
      previous = event.event_digest;
    }
    const counts = this.#driver.get<{
      readonly requests: number;
      readonly receipts: number;
      readonly activations: number;
      readonly events: number;
    }>(`SELECT
      (SELECT count(*) FROM approved_delivery_requests) AS requests,
      (SELECT count(*) FROM intake_receipts) AS receipts,
      (SELECT count(*) FROM activations) AS activations,
      (SELECT count(*) FROM intake_events) AS events`);
    if (
      counts === undefined ||
      counts.requests !== counts.receipts ||
      counts.requests !== counts.activations ||
      counts.requests !== counts.events
    ) {
      throw new Error("INTAKE_PROJECTION_CARDINALITY_DRIFT");
    }
  }

  #authenticatedImplementIntake(activationId: string): {
    readonly request: JsonObject;
    readonly receipt: OwnerReceiptInput;
    readonly row: AuthenticatedIntakeRow;
    readonly event: IntakeEventRow;
  } {
    this.#verifyIntakeEventChain();
    const row = this.#driver.get<AuthenticatedIntakeRow>(
      `SELECT
        a.activation_id,
        a.request_id AS activation_request_id,
        a.request_digest AS activation_request_digest,
        a.receipt_id AS activation_receipt_id,
        a.status AS activation_status,
        a.created_at AS activation_created_at,
        a.last_intake_event AS activation_last_event,
        d.request_json,
        r.receipt_id,
        r.actor_id,
        r.authn_method,
        r.action,
        r.authorization,
        r.approval_ref,
        r.owner_turn_digest,
        r.request_digest AS receipt_request_digest,
        r.approved_at,
        c.requested_authorization AS challenge_requested_authorization,
        c.request_id AS challenge_request_id,
        c.request_digest AS challenge_request_digest,
        c.receipt_id AS challenge_receipt_id
      FROM activations a
      JOIN approved_delivery_requests d ON d.request_id = a.request_id
      JOIN intake_receipts r ON r.receipt_id = a.receipt_id
      JOIN intake_challenges c ON c.challenge_id = r.challenge_id
      WHERE a.activation_id = ?`,
      [activationId],
    );
    if (row === undefined) {
      throw new Error(`BLOCKED_DISPATCH_ACTIVATION_NOT_FOUND:${activationId}`);
    }
    const request = JSON.parse(row.request_json) as JsonObject;
    const receipt: OwnerReceiptInput = {
      receipt_id: row.receipt_id,
      actor_id: row.actor_id,
      authn_method: row.authn_method as OwnerReceiptInput["authn_method"],
      action: row.action as OwnerReceiptInput["action"],
      authorization: row.authorization as OwnerReceiptInput["authorization"],
      approval_ref: row.approval_ref,
      owner_turn_digest: row.owner_turn_digest,
      request_digest: row.receipt_request_digest,
      approved_at: row.approved_at,
    };
    const requestReceipt = request.owner_authorization_receipt;
    if (
      row.activation_status !== "APPROVED_NOT_DISPATCHED" ||
      row.challenge_requested_authorization !== "IMPLEMENT" ||
      row.authorization !== "IMPLEMENT" ||
      row.authn_method !== "local_extension_confirm" ||
      row.action !== "approve_delivery" ||
      row.activation_request_id !== row.challenge_request_id ||
      row.activation_request_digest !== row.challenge_request_digest ||
      row.activation_request_digest !== row.receipt_request_digest ||
      row.activation_receipt_id !== row.receipt_id ||
      row.challenge_receipt_id !== row.receipt_id ||
      request.request_id !== row.activation_request_id ||
      request.request_digest !== row.activation_request_digest ||
      request.requested_authorization !== "IMPLEMENT" ||
      requestReceipt === null ||
      typeof requestReceipt !== "object" ||
      Array.isArray(requestReceipt) ||
      canonicalJson(requestReceipt) !== canonicalJson(receipt as unknown as JsonValue)
    ) {
      throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
    }
    const event = this.#driver.get<IntakeEventRow>(
      "SELECT * FROM intake_events WHERE seq = ?",
      [row.activation_last_event],
    );
    if (event === undefined || event.activation_id !== row.activation_id || event.event_type !== "INTAKE_APPROVED") {
      throw new Error("INTAKE_PROJECTION_EVENT_DRIFT");
    }
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    const expectedActivation = {
      activation_id: row.activation_id,
      request_id: row.activation_request_id,
      request_digest: row.activation_request_digest,
      receipt_id: row.activation_receipt_id,
      status: row.activation_status,
      created_at: row.activation_created_at,
      last_intake_event: event.event_id,
    };
    if (
      payload.request_id !== row.activation_request_id ||
      payload.request_digest !== row.activation_request_digest ||
      payload.receipt_id !== row.receipt_id ||
      payload.activation_id !== row.activation_id ||
      canonicalJson(payload.request as JsonValue) !== canonicalJson(request) ||
      canonicalJson(payload.receipt as JsonValue) !== canonicalJson(receipt as unknown as JsonValue) ||
      canonicalJson(payload.activation as JsonValue) !== canonicalJson(expectedActivation)
    ) {
      throw new Error("INTAKE_PROJECTION_DRIFT");
    }
    return { request, receipt, row, event };
  }

  #dispatchBindingMatches(
    binding: ActivationDispatchBindingRecord,
    input: ActivationDispatchBindingInput,
    requestId: string,
    requestDigest: string,
    receiptId: string,
  ): boolean {
    return (
      binding.dispatch_id === input.dispatch_id &&
      binding.activation_id === input.activation_id &&
      binding.request_id === requestId &&
      binding.request_digest === requestDigest &&
      binding.receipt_id === receiptId &&
      binding.resolver_profile_id === input.resolver_profile_id &&
      binding.resolver_profile_version === input.resolver_profile_version &&
      binding.resolver_capability_digest === input.resolver_capability_digest &&
      binding.resolution_digest === input.resolution_digest &&
      binding.repository_full_name === input.repository_full_name &&
      binding.repository_id === input.repository_id &&
      binding.objective_ref === input.objective_ref &&
      binding.objective_digest === input.objective_digest &&
      binding.project_harness_ref === input.project_harness_ref &&
      binding.harness_digest === input.harness_digest &&
      binding.base_sha === input.base_sha &&
      binding.execution_profile_id === input.execution_profile_id &&
      binding.execution_profile_version === input.execution_profile_version &&
      binding.execution_capability_digest === input.execution_capability_digest &&
      binding.run_id === input.seed.run_id &&
      binding.envelope_digest === input.seed.envelope_digest
    );
  }

  public bindActivationToRun(input: ActivationDispatchBindingInput): BindActivationResult {
    const digests = [
      input.resolver_capability_digest,
      input.resolution_digest,
      input.objective_digest,
      input.harness_digest,
      input.execution_capability_digest,
      input.seed.request_digest,
      input.seed.objective_digest,
      input.seed.envelope_digest,
    ];
    if (
      input.seed.objective_ref !== input.objective_ref ||
      input.seed.objective_digest !== input.objective_digest ||
      input.repository_id.trim().length === 0 ||
      !digests.every((digest) => /^sha256:[0-9a-f]{64}$/.test(digest))
    ) {
      throw new Error("BLOCKED_DISPATCH_BINDING_INPUT");
    }
    const result = this.#transaction(() => {
      const intake = this.#authenticatedImplementIntake(input.activation_id);
      if (
        input.seed.request_id !== intake.row.activation_request_id ||
        input.seed.request_digest !== intake.row.activation_request_digest
      ) {
        throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
      }
      const collisions = this.#driver.all<ActivationDispatchBindingRecord>(
        `SELECT * FROM activation_dispatch_bindings
         WHERE activation_id = ? OR dispatch_id = ? OR run_id = ?
            OR request_id = ? OR request_digest = ? OR receipt_id = ?`,
        [
          input.activation_id,
          input.dispatch_id,
          input.seed.run_id,
          intake.row.activation_request_id,
          intake.row.activation_request_digest,
          intake.row.receipt_id,
        ],
      );
      if (collisions.length > 1) {
        throw new Error("BLOCKED_DISPATCH_BINDING_COLLISION");
      }
      const existingBinding = collisions[0];
      if (existingBinding !== undefined) {
        if (!this.#dispatchBindingMatches(
          existingBinding,
          input,
          intake.row.activation_request_id,
          intake.row.activation_request_digest,
          intake.row.receipt_id,
        )) {
          throw new Error("BLOCKED_DISPATCH_BINDING_CONFLICT");
        }
        const existingRun = this.#reconcileRunSeed(input.seed);
        const approvalCount = this.#driver.get<{ readonly count: number }>(
          "SELECT count(*) AS count FROM approvals WHERE run_id = ? AND receipt_id = ?",
          [input.seed.run_id, intake.receipt.receipt_id],
        )?.count ?? 0;
        if (existingRun === null || approvalCount !== 1) {
          throw new Error("BLOCKED_DISPATCH_BINDING_RECONCILIATION");
        }
        return {
          ...existingRun,
          binding: existingBinding,
          receipt: intake.receipt,
        };
      }
      if (this.#reconcileRunSeed(input.seed) !== null) {
        throw new Error("BLOCKED_DISPATCH_BINDING_CONFLICT");
      }
      if (input.fault === "before_commit") {
        throw new Error("TEST_FAULT:BEFORE_DISPATCH_COMMIT");
      }
      const created = this.#createRunLocked(input.seed);
      this.#recordOwnerApprovalLocked(
        input.seed.run_id,
        input.seed.holder_id,
        created.lease.fencing_token,
        intake.receipt,
        `${input.seed.run_id}:authenticated-owner-approval`,
      );
      const run = this.#getRunRow(input.seed.run_id);
      this.#driver.run(
        `INSERT INTO activation_dispatch_bindings(
          dispatch_id, activation_id, request_id, request_digest, receipt_id,
          resolver_profile_id, resolver_profile_version, resolver_capability_digest,
          resolution_digest, repository_full_name, repository_id,
          objective_ref, objective_digest, project_harness_ref, harness_digest,
          base_sha, execution_profile_id, execution_profile_version,
          execution_capability_digest, run_id, envelope_digest, bound_at, last_event_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.dispatch_id,
          input.activation_id,
          intake.row.activation_request_id,
          intake.row.activation_request_digest,
          intake.row.receipt_id,
          input.resolver_profile_id,
          input.resolver_profile_version,
          input.resolver_capability_digest,
          input.resolution_digest,
          input.repository_full_name,
          input.repository_id,
          input.objective_ref,
          input.objective_digest,
          input.project_harness_ref,
          input.harness_digest,
          input.base_sha,
          input.execution_profile_id,
          input.execution_profile_version,
          input.execution_capability_digest,
          input.seed.run_id,
          input.seed.envelope_digest,
          run.updated_at,
          run.last_event_seq,
        ],
      );
      const binding = this.#driver.get<ActivationDispatchBindingRecord>(
        "SELECT * FROM activation_dispatch_bindings WHERE activation_id = ?",
        [input.activation_id],
      );
      if (binding === undefined) {
        throw new Error("BLOCKED_DISPATCH_BINDING_READBACK");
      }
      return {
        disposition: created.disposition,
        run,
        lease: created.lease,
        binding,
        receipt: intake.receipt,
      };
    });
    if (input.fault === "after_commit") {
      throw new Error("TEST_FAULT:AFTER_DISPATCH_COMMIT");
    }
    return result;
  }

  public dispatchBinding(activationId: string): ActivationDispatchBindingRecord | null {
    return this.#driver.get<ActivationDispatchBindingRecord>(
      "SELECT * FROM activation_dispatch_bindings WHERE activation_id = ?",
      [activationId],
    ) ?? null;
  }

  public transition(
    runId: string,
    expectedState: RunState,
    nextState: RunState,
    holderId: string,
    fencingToken: number,
    idempotencyKey: string,
  ): RunProjection {
    return this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      const duplicate = this.#driver.get<EventRow>(
        "SELECT * FROM events WHERE idempotency_key = ?",
        [idempotencyKey],
      );
      if (duplicate !== undefined) {
        const payload = JSON.parse(duplicate.payload_jcs) as Record<string, unknown>;
        if (
          duplicate.run_id === runId &&
          duplicate.event_type === "RUN_STATE_CHANGED" &&
          payload.from === expectedState &&
          payload.to === nextState &&
          run.state === nextState
        ) {
          if (expectedState === "PREPARED" && nextState === "EXECUTING") {
            const preparedOutbox = this.#driver.get<{
              readonly kind: string;
              readonly status: string;
            }>("SELECT kind, status FROM outbox WHERE outbox_id = ? AND run_id = ?", [
              `${runId}:prepared`,
              runId,
            ]);
            if (preparedOutbox?.kind !== "RUN_PREPARED" || preparedOutbox.status !== "DELIVERED") {
              throw new Error("RUN_PREPARED_OUTBOX_RECONCILIATION");
            }
          }
          return run;
        }
        throw new Error(`DUPLICATE_EVENT_DRIFT:${idempotencyKey}`);
      }
      if (run.state !== expectedState) {
        throw new Error(`STATE_DRIFT:${run.state}:${expectedState}`);
      }
      if (!transitions[run.state].includes(nextState)) {
        throw new Error(`INVALID_TRANSITION:${run.state}:${nextState}`);
      }
      if (expectedState === "PREPARED" && nextState === "EXECUTING") {
        const preparedOutbox = this.#driver.get<{
          readonly kind: string;
          readonly payload_jcs: string;
          readonly status: string;
        }>("SELECT kind, payload_jcs, status FROM outbox WHERE outbox_id = ? AND run_id = ?", [
          `${runId}:prepared`,
          runId,
        ]);
        if (
          preparedOutbox?.kind !== "RUN_PREPARED" ||
          preparedOutbox.status !== "PENDING" ||
          preparedOutbox.payload_jcs !== canonicalJson({ run_id: runId, state: "PREPARED" })
        ) {
          throw new Error("RUN_PREPARED_OUTBOX_DRIFT");
        }
      }
      if (nextState === "OWNER_REVIEW") {
        const unsatisfied = this.#driver.get<{ readonly count: number }>(
          "SELECT count(*) AS count FROM obligations WHERE run_id = ? AND category <> 'owner' AND status <> 'SATISFIED'",
          [runId],
        );
        const evidence = this.#driver.get<{ readonly count: number }>(
          "SELECT count(*) AS count FROM evidence_records WHERE run_id = ?",
          [runId],
        );
        const artifact = this.#driver.get<{ readonly count: number }>(
          "SELECT count(*) AS count FROM artifacts WHERE run_id = ?",
          [runId],
        );
        if ((unsatisfied?.count ?? 1) !== 0 || (evidence?.count ?? 0) === 0 || (artifact?.count ?? 0) === 0) {
          throw new Error("FALSE_COMPLETION_REJECTED:OWNER_REVIEW");
        }
      }
      if (nextState === "DONE") {
        const owner = this.#driver.get<{ readonly count: number }>(
          "SELECT count(*) AS count FROM obligations WHERE run_id = ? AND category = 'owner' AND status = 'SATISFIED' AND achieved_trust = 4",
          [runId],
        );
        if ((owner?.count ?? 0) === 0) {
          throw new Error("FALSE_COMPLETION_REJECTED:DONE_REQUIRES_T4");
        }
      }
      const outboxId = `${runId}:${idempotencyKey}:state`;
      const payload: JsonObject = {
        from: run.state,
        to: nextState,
        outbox: { outbox_id: outboxId, kind: "RUN_STATE_CHANGED", status: "PENDING" },
      };
      const event = this.#appendEvent(
        runId,
        "RUN_STATE_CHANGED",
        payload,
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        `UPDATE runs SET state = ?, updated_at = ?, last_event_seq = ?, last_event_hash = ?
         WHERE run_id = ? AND state = ? AND fencing_token = ?`,
        [nextState, event.occurredAt, event.seq, event.eventHash, runId, expectedState, fencingToken],
      );
      this.#driver.run(
        `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
         VALUES (?, ?, 'RUN_STATE_CHANGED', ?, 'PENDING', ?)`,
        [outboxId, runId, canonicalJson({ run_id: runId, from: run.state, to: nextState }), event.seq],
      );
      if (expectedState === "PREPARED" && nextState === "EXECUTING") {
        const consumed = this.#driver.run(
          "UPDATE outbox SET status = 'DELIVERED', event_seq = ? WHERE outbox_id = ? AND run_id = ? AND kind = 'RUN_PREPARED' AND status = 'PENDING'",
          [event.seq, `${runId}:prepared`, runId],
        );
        if (consumed.changes !== 1) throw new Error("RUN_PREPARED_OUTBOX_CONSUME_FAILED");
      }
      if (nextState === "CANCELLED" || nextState === "DONE") {
        this.#driver.run("UPDATE leases SET live = 0 WHERE run_id = ?", [runId]);
      }
      return this.#getRunRow(runId);
    });
  }

  public recordAgentClaim(
    runId: string,
    holderId: string,
    fencingToken: number,
    claim: string,
    idempotencyKey: string,
  ): RunProjection {
    return this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) {
        throw new Error(`TERMINAL_RUN:${run.state}`);
      }
      const event = this.#appendEvent(
        runId,
        "AGENT_CLAIM_T0",
        { claim, trust: "T0" },
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
      return this.#getRunRow(runId);
    });
  }

  #recordOwnerApprovalLocked(
    runId: string,
    holderId: string,
    fencingToken: number,
    receipt: OwnerReceiptInput,
    idempotencyKey: string,
  ): string {
    const { run } = this.#assertWriter(runId, holderId, fencingToken);
    if (
      receipt.action !== "approve_delivery" ||
      receipt.authorization !== "IMPLEMENT" ||
      receipt.request_digest !== run.request_digest ||
      receipt.approval_ref.trim().length < 8 ||
      !/^sha256:[0-9a-f]{64}$/.test(receipt.owner_turn_digest)
    ) {
      throw new Error("OWNER_RECEIPT_REJECTED:BINDING");
    }
    const receiptDigest = hashCanonical(asJson(receipt));
    const event = this.#appendEvent(
      runId,
      "OWNER_APPROVAL_RECORDED",
      { receipt: asJson(receipt), receipt_digest: receiptDigest },
      idempotencyKey,
      fencingToken,
    );
    this.#driver.run(
      `INSERT INTO approvals(
        receipt_id, run_id, actor_id, authn_method, action, authorization,
        approval_ref, owner_turn_digest, request_digest, approved_at,
        receipt_digest, last_event_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.receipt_id,
        runId,
        receipt.actor_id,
        receipt.authn_method,
        receipt.action,
        receipt.authorization,
        receipt.approval_ref,
        receipt.owner_turn_digest,
        receipt.request_digest,
        receipt.approved_at,
        receiptDigest,
        event.seq,
      ],
    );
    this.#driver.run(
      "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
      [event.occurredAt, event.seq, event.eventHash, runId],
    );
    return receiptDigest;
  }

  public recordOwnerApproval(
    runId: string,
    holderId: string,
    fencingToken: number,
    receipt: OwnerReceiptInput,
    idempotencyKey: string,
  ): string {
    return this.#transaction(() => this.#recordOwnerApprovalLocked(
      runId,
      holderId,
      fencingToken,
      receipt,
      idempotencyKey,
    ));
  }

  public recordOwnerCancellation(
    runId: string,
    holderId: string,
    fencingToken: number,
    receipt: OwnerCancellationReceiptInput,
  ): { readonly disposition: "CREATED" | "DUPLICATE_RECONCILED"; readonly receipt_digest: string } {
    return this.#transaction(() => {
      const run = this.#getRunRow(runId);
      if (
        receipt.action !== "cancel_run" ||
        receipt.run_id !== runId ||
        receipt.envelope_digest !== run.envelope_digest ||
        receipt.actor_id !== "owner" ||
        !["local_extension_confirm", "os_user_presence"].includes(receipt.authn_method) ||
        !/^sha256:[0-9a-f]{64}$/u.test(receipt.challenge_binding_digest) ||
        !/^sha256:[0-9a-f]{64}$/u.test(receipt.reason_digest) ||
        receipt.idempotency_key.trim().length < 8 ||
        !Number.isFinite(Date.parse(receipt.decided_at))
      ) {
        throw new Error("OWNER_CANCELLATION_RECEIPT_REJECTED:BINDING");
      }
      const receiptDigest = hashCanonical(asJson(receipt));
      const duplicate = this.#driver.get<EventRow>(
        "SELECT * FROM events WHERE idempotency_key = ?",
        [receipt.idempotency_key],
      );
      if (duplicate !== undefined) {
        const payload = JSON.parse(duplicate.payload_jcs) as Record<string, unknown>;
        if (
          duplicate.run_id === runId &&
          duplicate.event_type === "OWNER_CANCELLATION_RECORDED" &&
          canonicalJson(payload.receipt as JsonValue) === canonicalJson(receipt as unknown as JsonValue) &&
          payload.receipt_digest === receiptDigest
        ) {
          return { disposition: "DUPLICATE_RECONCILED", receipt_digest: receiptDigest };
        }
        throw new Error(`OWNER_CANCELLATION_RECEIPT_DRIFT:${receipt.idempotency_key}`);
      }
      this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) throw new Error(`TERMINAL_RUN:${run.state}`);
      const event = this.#appendEvent(
        runId,
        "OWNER_CANCELLATION_RECORDED",
        { receipt: asJson(receipt), receipt_digest: receiptDigest },
        receipt.idempotency_key,
        fencingToken,
        receipt.decided_at,
      );
      this.#driver.run(
        `INSERT INTO approvals(
          receipt_id, run_id, actor_id, authn_method, action, authorization,
          approval_ref, owner_turn_digest, request_digest, approved_at,
          receipt_digest, last_event_seq
        ) VALUES (?, ?, ?, ?, 'cancel_run', 'IMPLEMENT', ?, ?, ?, ?, ?, ?)`,
        [
          receipt.receipt_id,
          runId,
          receipt.actor_id,
          receipt.authn_method,
          `local-cancel://${runId}/${receipt.idempotency_key}`,
          receipt.challenge_binding_digest,
          run.request_digest,
          receipt.decided_at,
          receiptDigest,
          event.seq,
        ],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
      return { disposition: "CREATED", receipt_digest: receiptDigest };
    });
  }

  public ownerCancellationReceipt(runId: string): OwnerCancellationReceiptRecord | null {
    const row = this.#driver.get<{
      readonly receipt_id: string;
      readonly actor_id: string;
      readonly authn_method: "local_extension_confirm" | "os_user_presence";
      readonly receipt_digest: string;
      readonly payload_jcs: string;
    }>(
      `SELECT a.receipt_id, a.actor_id, a.authn_method, a.receipt_digest, e.payload_jcs
       FROM approvals a
       JOIN events e ON e.seq = a.last_event_seq
       WHERE a.run_id = ? AND a.action = 'cancel_run'`,
      [runId],
    );
    if (row === undefined) return null;
    const payload = JSON.parse(row.payload_jcs) as Record<string, unknown>;
    const receipt = payload.receipt as OwnerCancellationReceiptInput | undefined;
    if (
      receipt === undefined ||
      receipt.receipt_id !== row.receipt_id ||
      receipt.actor_id !== row.actor_id ||
      receipt.authn_method !== row.authn_method ||
      hashCanonical(asJson(receipt)) !== row.receipt_digest
    ) {
      throw new Error("OWNER_CANCELLATION_RECEIPT_PROJECTION_DRIFT");
    }
    return { ...receipt, receipt_digest: row.receipt_digest };
  }

  public satisfyObligation(
    runId: string,
    holderId: string,
    fencingToken: number,
    receipt: VerifierReceiptInput,
    idempotencyKey: string,
  ): void {
    this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) {
        throw new Error(`TERMINAL_RUN:${run.state}`);
      }
      const obligation = this.#driver.get<ObligationRow>(
        "SELECT * FROM obligations WHERE run_id = ? AND obligation_id = ?",
        [runId, receipt.obligation_id],
      );
      if (obligation === undefined) {
        throw new Error(`OBLIGATION_NOT_FOUND:${receipt.obligation_id}`);
      }
      const trust = trustNumber[receipt.trust_level];
      if (
        receipt.result !== "PASS" ||
        receipt.verifier_id !== obligation.verifier_id ||
        trust < obligation.minimum_trust ||
        (obligation.category === "owner" && trust !== trustNumber.T4)
      ) {
        throw new Error(`OBLIGATION_TRUST_REJECTED:${receipt.obligation_id}`);
      }
      if (obligation.status === "SATISFIED") {
        throw new Error(`OBLIGATION_ALREADY_SATISFIED:${receipt.obligation_id}`);
      }
      const event = this.#appendEvent(
        runId,
        "OBLIGATION_SATISFIED",
        { receipt: asJson(receipt), trust },
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        `INSERT INTO verifier_receipts(
          verifier_receipt_id, run_id, obligation_id, verifier_id, trust_level,
          result, input_digest, result_digest, evidence_ref, last_event_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receipt.verifier_receipt_id,
          runId,
          receipt.obligation_id,
          receipt.verifier_id,
          trust,
          receipt.result,
          receipt.input_digest,
          receipt.result_digest,
          receipt.evidence_ref,
          event.seq,
        ],
      );
      this.#driver.run(
        `UPDATE obligations SET status = 'SATISFIED', achieved_trust = ?, last_event_seq = ?
         WHERE run_id = ? AND obligation_id = ?`,
        [trust, event.seq, runId, receipt.obligation_id],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
    });
  }

  public recordArtifact(
    runId: string,
    holderId: string,
    fencingToken: number,
    artifact: ArtifactInput,
    idempotencyKey: string,
  ): void {
    this.#recordBoundProjection(
      runId,
      holderId,
      fencingToken,
      "ARTIFACT_RECORDED",
      { artifact: asJson(artifact) },
      idempotencyKey,
      (event) => {
        this.#driver.run(
          `INSERT INTO artifacts(artifact_id, run_id, kind, location, artifact_digest, last_event_seq)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [artifact.artifact_id, runId, artifact.kind, artifact.location, artifact.artifact_digest, event.seq],
        );
      },
    );
  }

  public recordEvidence(
    runId: string,
    holderId: string,
    fencingToken: number,
    evidence: EvidenceInput,
    idempotencyKey: string,
  ): string {
    const run = this.#getRunRow(runId);
    if (
      evidence.request_digest !== run.request_digest ||
      evidence.objective_digest !== run.objective_digest ||
      evidence.envelope_digest !== run.envelope_digest ||
      evidence.candidate_revision !== run.candidate_revision ||
      evidence.product_acceptance_status !== "PENDING_OWNER"
    ) {
      throw new Error("EVIDENCE_BINDING_REJECTED");
    }
    const evidenceDigest = hashCanonical(asJson(evidence));
    this.#recordBoundProjection(
      runId,
      holderId,
      fencingToken,
      "EVIDENCE_RECORDED",
      { evidence: asJson(evidence), evidence_digest: evidenceDigest },
      idempotencyKey,
      (event) => {
        this.#driver.run(
          `INSERT INTO evidence_records(
            evidence_id, run_id, candidate_revision, request_digest, objective_digest,
            envelope_digest, candidate_digest, evidence_digest,
            product_acceptance_status, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            evidence.evidence_id,
            runId,
            evidence.candidate_revision,
            evidence.request_digest,
            evidence.objective_digest,
            evidence.envelope_digest,
            evidence.candidate_digest,
            evidenceDigest,
            evidence.product_acceptance_status,
            event.seq,
          ],
        );
      },
    );
    return evidenceDigest;
  }

  public recordSessionFact(
    runId: string,
    holderId: string,
    fencingToken: number,
    fact: {
      readonly profile_id: string;
      readonly thread_id: string;
      readonly turn_id: string | null;
      readonly status: string;
      readonly capability_digest: string;
    },
    idempotencyKey: string,
  ): void {
    this.#recordBoundProjection(
      runId,
      holderId,
      fencingToken,
      "SESSION_BOUND",
      { session: asJson(fact) },
      idempotencyKey,
      (event) => {
        this.#driver.run(
          `INSERT INTO sessions(
            run_id, profile_id, thread_id, turn_id, status, capability_digest, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, profile_id, thread_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            status = excluded.status,
            capability_digest = excluded.capability_digest,
            last_event_seq = excluded.last_event_seq`,
          [
            runId,
            fact.profile_id,
            fact.thread_id,
            fact.turn_id,
            fact.status,
            fact.capability_digest,
            event.seq,
          ],
        );
      },
    );
  }

  public recordWorkspaceFact(
    runId: string,
    holderId: string,
    fencingToken: number,
    fact: WorkspaceFactInput,
    idempotencyKey: string,
  ): void {
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fact.repository_full_name) ||
      !/^[0-9a-f]{40}$/.test(fact.base_sha) ||
      !/^sha256:[0-9a-f]{64}$/.test(fact.worktree_path_digest) ||
      (fact.candidate_sha !== null && !/^[0-9a-f]{40}$/.test(fact.candidate_sha)) ||
      !Number.isSafeInteger(fact.candidate_revision) ||
      fact.candidate_revision < 1
    ) {
      throw new Error("WORKSPACE_FACT_INVALID");
    }
    this.#recordBoundProjection(
      runId,
      holderId,
      fencingToken,
      "WORKSPACE_BOUND",
      { workspace: asJson(fact) },
      idempotencyKey,
      (event) => {
        this.#driver.run(
          `INSERT INTO workspaces(
            run_id, repository_full_name, base_sha, branch_name, worktree_path_digest,
            candidate_sha, candidate_revision, status, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            repository_full_name = excluded.repository_full_name,
            base_sha = excluded.base_sha,
            branch_name = excluded.branch_name,
            worktree_path_digest = excluded.worktree_path_digest,
            candidate_sha = excluded.candidate_sha,
            candidate_revision = excluded.candidate_revision,
            status = excluded.status,
            last_event_seq = excluded.last_event_seq`,
          [
            runId,
            fact.repository_full_name,
            fact.base_sha,
            fact.branch_name,
            fact.worktree_path_digest,
            fact.candidate_sha,
            fact.candidate_revision,
            fact.status,
            event.seq,
          ],
        );
      },
    );
  }

  public recordExternalEffectIntent(
    runId: string,
    holderId: string,
    fencingToken: number,
    intent: ExternalEffectIntentInput,
    idempotencyKey: string,
  ): "CREATED" | "REUSED" {
    if (
      intent.outbox_id.length < 3 ||
      intent.effect_kind.length < 1 ||
      intent.identity_key.length < 3 ||
      intent.target_ref.length < 1 ||
      (intent.candidate_sha !== null && !/^[0-9a-f]{40}$/.test(intent.candidate_sha))
    ) {
      throw new Error("EXTERNAL_EFFECT_INTENT_INVALID");
    }
    return this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) {
        throw new Error(`TERMINAL_RUN:${run.state}`);
      }
      const existing = this.#driver.get<PublicationRecord & SqlRow>(
        "SELECT * FROM publications WHERE outbox_id = ?",
        [intent.outbox_id],
      );
      if (existing !== undefined) {
        if (
          existing.run_id !== runId ||
          existing.effect_kind !== intent.effect_kind ||
          existing.identity_key !== intent.identity_key ||
          existing.target_ref !== intent.target_ref ||
          existing.candidate_sha !== intent.candidate_sha
        ) {
          throw new Error(`EXTERNAL_EFFECT_INTENT_DRIFT:${intent.outbox_id}`);
        }
        return "REUSED";
      }
      const payload: JsonObject = {
        intent: asJson({
          outbox_id: intent.outbox_id,
          effect_kind: intent.effect_kind,
          identity_key: intent.identity_key,
          target_ref: intent.target_ref,
          candidate_sha: intent.candidate_sha,
          payload: intent.payload,
        }),
      };
      const event = this.#appendEvent(
        runId,
        "EXTERNAL_EFFECT_INTENT_RECORDED",
        payload,
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [intent.outbox_id, runId, intent.effect_kind, canonicalJson(intent.payload), event.seq],
      );
      this.#driver.run(
        `INSERT INTO publications(
          run_id, effect_kind, identity_key, outbox_id, target_ref, candidate_sha,
          status, result_ref, readback_digest, last_event_seq
        ) VALUES (?, ?, ?, ?, ?, ?, 'INTENT_COMMITTED', NULL, NULL, ?)`,
        [
          runId,
          intent.effect_kind,
          intent.identity_key,
          intent.outbox_id,
          intent.target_ref,
          intent.candidate_sha,
          event.seq,
        ],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
      return "CREATED";
    });
  }

  public reconcileExternalEffect(
    runId: string,
    holderId: string,
    fencingToken: number,
    result: ExternalEffectResultInput,
    idempotencyKey: string,
  ): "CONFIRMED" | "REUSED" {
    if (!/^sha256:[0-9a-f]{64}$/.test(result.readback_digest)) {
      throw new Error("EXTERNAL_EFFECT_READBACK_INVALID");
    }
    return this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) {
        throw new Error(`TERMINAL_RUN:${run.state}`);
      }
      const existing = this.#driver.get<PublicationRecord & SqlRow>(
        "SELECT * FROM publications WHERE outbox_id = ?",
        [result.outbox_id],
      );
      if (
        existing === undefined ||
        existing.run_id !== runId ||
        existing.effect_kind !== result.effect_kind ||
        existing.identity_key !== result.identity_key
      ) {
        throw new Error(`EXTERNAL_EFFECT_INTENT_NOT_FOUND:${result.outbox_id}`);
      }
      if (existing.status === "CONFIRMED") {
        if (
          existing.result_ref !== result.result_ref ||
          existing.readback_digest !== result.readback_digest
        ) {
          throw new Error(`EXTERNAL_EFFECT_RESULT_DRIFT:${result.outbox_id}`);
        }
        return "REUSED";
      }
      const event = this.#appendEvent(
        runId,
        "EXTERNAL_EFFECT_RECONCILED",
        { result: asJson(result) },
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        "UPDATE outbox SET status = 'DELIVERED', event_seq = ? WHERE outbox_id = ? AND status = 'PENDING'",
        [event.seq, result.outbox_id],
      );
      this.#driver.run(
        `UPDATE publications SET status = 'CONFIRMED', result_ref = ?, readback_digest = ?,
           last_event_seq = ? WHERE outbox_id = ? AND status = 'INTENT_COMMITTED'`,
        [result.result_ref, result.readback_digest, event.seq, result.outbox_id],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
      return "CONFIRMED";
    });
  }

  public workspace(runId: string): WorkspaceRecord | null {
    return this.#driver.get<WorkspaceRecord & SqlRow>(
      "SELECT * FROM workspaces WHERE run_id = ?",
      [runId],
    ) ?? null;
  }

  public publications(runId: string): readonly PublicationRecord[] {
    return this.#driver.all<PublicationRecord & SqlRow>(
      "SELECT * FROM publications WHERE run_id = ? ORDER BY effect_kind, identity_key",
      [runId],
    );
  }

  public sessions(runId: string): readonly SessionRecord[] {
    return this.#driver.all<SessionRecord & SqlRow>(
      "SELECT * FROM sessions WHERE run_id = ? ORDER BY profile_id, thread_id",
      [runId],
    );
  }

  public pendingExternalEffects(runId: string): readonly PublicationRecord[] {
    return this.#driver.all<PublicationRecord & SqlRow>(
      "SELECT * FROM publications WHERE run_id = ? AND status = 'INTENT_COMMITTED' ORDER BY effect_kind, identity_key",
      [runId],
    );
  }

  public reconcileEvidenceCorrection(
    runId: string,
    holderId: string,
    fencingToken: number,
    correction: EvidenceCorrectionInput,
    idempotencyKey: string,
  ): "RECORDED" | "REUSED" {
    if (
      correction.evidence_outbox_id.length < 3 ||
      correction.correction_outbox_id.length < 3 ||
      correction.identity_key.length < 3 ||
      !/^[0-9a-f]{40}$/.test(correction.candidate_sha) ||
      !Number.isSafeInteger(correction.comment_id) ||
      correction.comment_id < 1 ||
      !correction.comment_url.endsWith(`#issuecomment-${correction.comment_id}`) ||
      !/^sha256:[0-9a-f]{64}$/.test(correction.prior_manifest_digest) ||
      !/^sha256:[0-9a-f]{64}$/.test(correction.corrected_manifest_digest) ||
      correction.prior_manifest_digest === correction.corrected_manifest_digest ||
      !/^sha256:[0-9a-f]{64}$/.test(correction.corrected_comment_readback_digest)
    ) {
      throw new Error("EVIDENCE_CORRECTION_INVALID");
    }
    return this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (run.state !== "OWNER_REVIEW") {
        throw new Error(`EVIDENCE_CORRECTION_STATE_INVALID:${run.state}`);
      }
      const duplicate = this.#driver.get<EventRow>(
        "SELECT * FROM events WHERE idempotency_key = ?",
        [idempotencyKey],
      );
      if (duplicate !== undefined) {
        const payload = JSON.parse(duplicate.payload_jcs) as Record<string, unknown>;
        const recorded = payload.correction as Record<string, unknown> | undefined;
        const publication = this.#driver.get<PublicationRecord & SqlRow>(
          "SELECT * FROM publications WHERE outbox_id = ?",
          [correction.evidence_outbox_id],
        );
        if (
          duplicate.run_id === runId &&
          duplicate.event_type === "EVIDENCE_CORRECTION_RECONCILED" &&
          recorded !== undefined &&
          canonicalJson(asJson(recorded)) === canonicalJson(asJson(correction)) &&
          publication?.readback_digest === correction.corrected_comment_readback_digest
        ) {
          return "REUSED";
        }
        throw new Error(`EVIDENCE_CORRECTION_DRIFT:${idempotencyKey}`);
      }
      const evidencePublication = this.#driver.get<PublicationRecord & SqlRow>(
        "SELECT * FROM publications WHERE outbox_id = ?",
        [correction.evidence_outbox_id],
      );
      const correctionPublication = this.#driver.get<PublicationRecord & SqlRow>(
        "SELECT * FROM publications WHERE outbox_id = ?",
        [correction.correction_outbox_id],
      );
      if (
        evidencePublication?.run_id !== runId ||
        evidencePublication.effect_kind !== "EVIDENCE_COMMENT" ||
        evidencePublication.identity_key !== correction.identity_key ||
        evidencePublication.candidate_sha !== correction.candidate_sha ||
        evidencePublication.status !== "CONFIRMED" ||
        evidencePublication.result_ref !== correction.comment_url ||
        correctionPublication?.run_id !== runId ||
        correctionPublication.effect_kind !== "EVIDENCE_CORRECTION" ||
        correctionPublication.identity_key !== correction.identity_key ||
        correctionPublication.candidate_sha !== correction.candidate_sha ||
        correctionPublication.status !== "CONFIRMED" ||
        correctionPublication.result_ref !== correction.comment_url ||
        correctionPublication.readback_digest !== correction.corrected_comment_readback_digest
      ) {
        throw new Error("EVIDENCE_CORRECTION_PUBLICATION_DRIFT");
      }
      const event = this.#appendEvent(
        runId,
        "EVIDENCE_CORRECTION_RECONCILED",
        { correction: asJson(correction) },
        idempotencyKey,
        fencingToken,
      );
      this.#driver.run(
        "UPDATE publications SET readback_digest = ?, last_event_seq = ? WHERE outbox_id = ?",
        [correction.corrected_comment_readback_digest, event.seq, correction.evidence_outbox_id],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
      return "RECORDED";
    });
  }

  #recordBoundProjection(
    runId: string,
    holderId: string,
    fencingToken: number,
    eventType: string,
    payload: JsonObject,
    idempotencyKey: string,
    projection: (event: AppendedEvent) => void,
  ): void {
    this.#transaction(() => {
      const { run } = this.#assertWriter(runId, holderId, fencingToken);
      if (["CANCELLED", "DONE"].includes(run.state)) {
        throw new Error(`TERMINAL_RUN:${run.state}`);
      }
      const event = this.#appendEvent(
        runId,
        eventType,
        payload,
        idempotencyKey,
        fencingToken,
      );
      projection(event);
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurredAt, event.seq, event.eventHash, runId],
      );
    });
  }

  public heartbeat(
    runId: string,
    holderId: string,
    fencingToken: number,
    ttlSeconds: number,
    idempotencyKey: string,
  ): WriterLease {
    return this.#transaction(() => {
      this.#assertWriter(runId, holderId, fencingToken);
      const at = this.#now();
      const expiresAt = new Date(Date.parse(at) + ttlSeconds * 1000).toISOString();
      const event = this.#appendEvent(
        runId,
        "LEASE_HEARTBEAT",
        { heartbeat_at: at, expires_at: expiresAt },
        idempotencyKey,
        fencingToken,
        at,
      );
      this.#driver.run(
        "UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE run_id = ? AND fencing_token = ?",
        [at, expiresAt, runId, fencingToken],
      );
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [at, event.seq, event.eventHash, runId],
      );
      return this.#getLeaseRow(runId);
    });
  }

  public getRun(runId: string): RunProjection {
    return this.#getRunRow(runId);
  }

  public getLease(runId: string): WriterLease {
    return this.#getLeaseRow(runId);
  }

  public summary(runId: string): StoreSummary {
    const run = this.#getRunRow(runId);
    const count = (table: string): number => {
      if (!new Set([
        "events",
        "approvals",
        "verifier_receipts",
        "artifacts",
        "evidence_records",
        "sessions",
        "outbox",
        "workspaces",
        "publications",
      ]).has(table)) {
        throw new Error("UNSAFE_TABLE_NAME");
      }
      return this.#driver.get<{ readonly count: number }>(
        `SELECT count(*) AS count FROM ${table} WHERE run_id = ?`,
        [runId],
      )?.count ?? 0;
    };
    return {
      run,
      lease: this.#getLeaseRow(runId),
      event_count: count("events"),
      chain_head: run.last_event_hash,
      obligations: this.#driver.all<ObligationRow>(
        "SELECT * FROM obligations WHERE run_id = ? ORDER BY obligation_id",
        [runId],
      ),
      approval_count: count("approvals"),
      verifier_receipt_count: count("verifier_receipts"),
      artifact_count: count("artifacts"),
      evidence_count: count("evidence_records"),
      session_count: count("sessions"),
      outbox_count: count("outbox"),
      workspace_count: count("workspaces"),
      publication_count: count("publications"),
    };
  }

  public eventTimeline(runId: string): readonly EventTimelineItem[] {
    return this.#driver.all<EventTimelineItem & SqlRow>(
      `SELECT seq, event_type, occurred_at, event_hash
       FROM events WHERE run_id = ? ORDER BY seq`,
      [runId],
    );
  }

  public verifierReceipts(runId: string): readonly VerifierReceiptRecord[] {
    return this.#driver.all<VerifierReceiptRecord & SqlRow>(
      `SELECT verifier_receipt_id, obligation_id, verifier_id, trust_level,
              result, input_digest, result_digest, evidence_ref
       FROM verifier_receipts WHERE run_id = ? ORDER BY verifier_receipt_id`,
      [runId],
    );
  }

  public verifyEventChain(): { readonly events: number; readonly head: string | null } {
    const rows = this.#driver.all<EventRow>("SELECT * FROM events ORDER BY seq");
    const heads = new Map<string, string | null>();
    let globalHead: string | null = null;
    for (const row of rows) {
      const expectedPrevious = heads.get(row.run_id) ?? null;
      if (row.prev_hash !== expectedPrevious) {
        throw new Error(`EVENT_CHAIN_PREVIOUS_MISMATCH:${row.seq}`);
      }
      const payload = JSON.parse(row.payload_jcs) as JsonValue;
      const expectedHash = hashCanonical({
        event_id: row.event_id,
        run_id: row.run_id,
        event_type: row.event_type,
        payload,
        occurred_at: row.occurred_at,
        idempotency_key: row.idempotency_key,
        prev_hash: row.prev_hash,
        fencing_token: row.fencing_token,
      });
      if (expectedHash !== row.event_hash) {
        throw new Error(`EVENT_CHAIN_HASH_MISMATCH:${row.seq}`);
      }
      const run = this.#getRunRow(row.run_id);
      const binding = (payload as Record<string, unknown>).event_binding as
        | Record<string, unknown>
        | undefined;
      if (
        binding?.objective_ref !== run.objective_ref ||
        binding.objective_digest !== run.objective_digest ||
        binding.envelope_digest !== run.envelope_digest ||
        binding.candidate_revision !== run.candidate_revision
      ) {
        throw new Error(`EVENT_BINDING_MISMATCH:${row.seq}`);
      }
      heads.set(row.run_id, row.event_hash);
      globalHead = row.event_hash;
    }
    return { events: rows.length, head: globalHead };
  }

  public verifyProjectionConsistency(): void {
    for (const run of this.#driver.all<RunRow>("SELECT * FROM runs ORDER BY run_id")) {
      const events = this.#driver.all<EventRow>(
        "SELECT * FROM events WHERE run_id = ? ORDER BY seq",
        [run.run_id],
      );
      const latest = events.at(-1);
      if (
        latest === undefined ||
        run.last_event_seq !== latest.seq ||
        run.last_event_hash !== latest.event_hash ||
        run.fencing_token !== latest.fencing_token
      ) {
        throw new Error(`PROJECTION_DRIFT:${run.run_id}`);
      }
      let expectedState: RunState | undefined;
      const expectedObligations = new Map<string, "PENDING" | "SATISFIED">();
      for (const event of events) {
        const payload = JSON.parse(event.payload_jcs) as Record<string, unknown>;
        if (event.event_type === "RUN_PREPARED") {
          expectedState = "PREPARED";
          for (const obligation of payload.obligations as Array<Record<string, unknown>>) {
            expectedObligations.set(String(obligation.obligation_id), "PENDING");
          }
        } else if (event.event_type === "RUN_STATE_CHANGED") {
          expectedState = String(payload.to) as RunState;
        } else if (event.event_type === "OBLIGATION_SATISFIED") {
          const receipt = payload.receipt as Record<string, unknown>;
          expectedObligations.set(String(receipt.obligation_id), "SATISFIED");
        }
      }
      if (run.state !== expectedState) {
        throw new Error(`PROJECTION_STATE_DRIFT:${run.run_id}:${run.state}:${expectedState ?? "missing"}`);
      }
      const actualObligations = this.#driver.all<ObligationRow>(
        "SELECT * FROM obligations WHERE run_id = ? ORDER BY obligation_id",
        [run.run_id],
      );
      if (actualObligations.length !== expectedObligations.size) {
        throw new Error(`PROJECTION_OBLIGATION_COUNT_DRIFT:${run.run_id}`);
      }
      for (const obligation of actualObligations) {
        if (expectedObligations.get(obligation.obligation_id) !== obligation.status) {
          throw new Error(`PROJECTION_OBLIGATION_DRIFT:${run.run_id}:${obligation.obligation_id}`);
        }
      }
    }
    const dispatchTablePresent = (this.#driver.get<{ readonly count: number }>(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'activation_dispatch_bindings'",
    )?.count ?? 0) === 1;
    for (const binding of dispatchTablePresent
      ? this.#driver.all<ActivationDispatchBindingRecord>(
          "SELECT * FROM activation_dispatch_bindings ORDER BY dispatch_id",
        )
      : []) {
      const run = this.#driver.get<RunRow>(
        "SELECT * FROM runs WHERE run_id = ?",
        [binding.run_id],
      );
      const approval = this.#driver.get<DispatchApprovalRow>(
        "SELECT * FROM approvals WHERE run_id = ? AND receipt_id = ?",
        [binding.run_id, binding.receipt_id],
      );
      if (
        run === undefined ||
        approval === undefined ||
        run.request_id !== binding.request_id ||
        run.request_digest !== binding.request_digest ||
        run.objective_ref !== binding.objective_ref ||
        run.objective_digest !== binding.objective_digest ||
        run.envelope_digest !== binding.envelope_digest ||
        approval.request_digest !== binding.request_digest ||
        approval.authorization !== "IMPLEMENT" ||
        approval.authn_method !== "local_extension_confirm"
      ) {
        throw new Error(`ACTIVATION_DISPATCH_BINDING_DRIFT:${binding.dispatch_id}`);
      }
    }
  }

  public integrity(): { readonly quick_check: string; readonly integrity_check: string } {
    this.verifySchema();
    const quick = String(this.#driver.pragma("quick_check", true));
    const full = String(this.#driver.pragma("integrity_check", true));
    if (quick !== "ok" || full !== "ok") {
      throw new Error(`DATABASE_CORRUPT:${quick}:${full}`);
    }
    return { quick_check: quick, integrity_check: full };
  }

  public sqliteVersion(): string {
    const row = this.#driver.get<{ readonly version: string }>(
      "SELECT sqlite_version() AS version",
    );
    if (row === undefined) {
      throw new Error("SQLITE_VERSION_UNAVAILABLE");
    }
    return row.version;
  }

  public checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "FULL"): unknown {
    return this.#driver.checkpoint(mode);
  }

  public async backup(destinationPath: string): Promise<void> {
    mkdirSync(dirname(destinationPath), { recursive: true });
    await this.#driver.backup(destinationPath);
  }

  public rebuildProjections(): void {
    const events = this.#driver.all<EventRow>("SELECT * FROM events ORDER BY seq");
    this.#transaction(() => {
      for (const table of [
        "publications",
        "workspaces",
        "outbox",
        "evidence_records",
        "sessions",
        "artifacts",
        "verifier_receipts",
        "approvals",
        "obligations",
        "leases",
        "runs",
        "lease_counters",
      ]) {
        this.#driver.exec(`DELETE FROM ${table}`);
      }
      this.#driver.run(
        "UPDATE projection_meta SET last_event_seq = 0, last_event_hash = NULL, rebuilt_at = ? WHERE singleton = 1",
        [this.#now()],
      );
      for (const event of events) {
        this.#replayProjection(event);
      }
    });
    this.verifyEventChain();
    this.verifyProjectionConsistency();
  }

  #replayProjection(event: EventRow): void {
    const payload = JSON.parse(event.payload_jcs) as Record<string, unknown>;
    if (event.event_type === "RUN_PREPARED") {
      this.#driver.run(
        `INSERT INTO runs(
          run_id, request_id, objective_id, objective_ref, request_digest, objective_digest,
          envelope_digest, generation, state, candidate_revision, fencing_token,
          updated_at, last_event_seq, last_event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', 1, ?, ?, ?, ?)`,
        [
          event.run_id,
          String(payload.request_id),
          String(payload.objective_id),
          String(payload.objective_ref),
          String(payload.request_digest),
          String(payload.objective_digest),
          String(payload.envelope_digest),
          Number(payload.generation),
          event.fencing_token,
          event.occurred_at,
          event.seq,
          event.event_hash,
        ],
      );
      const leaseKey = String(payload.lease_key);
      this.#driver.run("INSERT INTO lease_counters(lease_key, last_token) VALUES (?, ?)", [leaseKey, event.fencing_token]);
      this.#driver.run(
        `INSERT INTO leases(lease_key, run_id, holder_id, fencing_token, heartbeat_at, expires_at, live)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [leaseKey, event.run_id, String(payload.holder_id), event.fencing_token, event.occurred_at, String(payload.expires_at)],
      );
      const obligations = payload.obligations as Array<Record<string, unknown>>;
      for (const obligation of obligations) {
        this.#driver.run(
          `INSERT INTO obligations(
            run_id, obligation_id, category, verifier_id, minimum_trust,
            status, achieved_trust, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, ?)`,
          [
            event.run_id,
            String(obligation.obligation_id),
            String(obligation.category),
            String(obligation.verifier_id),
            Number(obligation.minimum_trust),
            event.seq,
          ],
        );
      }
      this.#driver.run(
        `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
         VALUES (?, ?, 'RUN_PREPARED', ?, 'PENDING', ?)`,
        [
          `${event.run_id}:prepared`,
          event.run_id,
          canonicalJson({ run_id: event.run_id, state: "PREPARED" }),
          event.seq,
        ],
      );
    } else {
      if (event.event_type === "RUN_STATE_CHANGED") {
        const nextState = String(payload.to) as RunState;
        this.#driver.run("UPDATE runs SET state = ? WHERE run_id = ?", [nextState, event.run_id]);
        const outbox = payload.outbox as Record<string, unknown>;
        this.#driver.run(
          `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
           VALUES (?, ?, 'RUN_STATE_CHANGED', ?, 'PENDING', ?)`,
          [
            String(outbox.outbox_id),
            event.run_id,
            canonicalJson({ run_id: event.run_id, from: asJson(payload.from), to: asJson(payload.to) }),
            event.seq,
          ],
        );
        if (nextState === "CANCELLED" || nextState === "DONE") {
          this.#driver.run("UPDATE leases SET live = 0 WHERE run_id = ?", [event.run_id]);
        }
      } else if (event.event_type === "OWNER_APPROVAL_RECORDED") {
        const receipt = payload.receipt as Record<string, string>;
        this.#driver.run(
          `INSERT INTO approvals(
            receipt_id, run_id, actor_id, authn_method, action, authorization,
            approval_ref, owner_turn_digest, request_digest, approved_at,
            receipt_digest, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receipt.receipt_id ?? "",
            event.run_id,
            receipt.actor_id ?? "",
            receipt.authn_method ?? "",
            receipt.action ?? "",
            receipt.authorization ?? "",
            receipt.approval_ref ?? "",
            receipt.owner_turn_digest ?? "",
            receipt.request_digest ?? "",
            receipt.approved_at ?? "",
            String(payload.receipt_digest),
            event.seq,
          ],
        );
      } else if (event.event_type === "OWNER_CANCELLATION_RECORDED") {
        const receipt = payload.receipt as Record<string, string>;
        const run = this.#driver.get<{ readonly request_digest: string }>(
          "SELECT request_digest FROM runs WHERE run_id = ?",
          [event.run_id],
        );
        if (run === undefined) throw new Error("OWNER_CANCELLATION_REPLAY_RUN_MISSING");
        this.#driver.run(
          `INSERT INTO approvals(
            receipt_id, run_id, actor_id, authn_method, action, authorization,
            approval_ref, owner_turn_digest, request_digest, approved_at,
            receipt_digest, last_event_seq
          ) VALUES (?, ?, ?, ?, 'cancel_run', 'IMPLEMENT', ?, ?, ?, ?, ?, ?)`,
          [
            receipt.receipt_id ?? "",
            event.run_id,
            receipt.actor_id ?? "",
            receipt.authn_method ?? "",
            `local-cancel://${event.run_id}/${receipt.idempotency_key ?? ""}`,
            receipt.challenge_binding_digest ?? "",
            run.request_digest,
            receipt.decided_at ?? "",
            String(payload.receipt_digest),
            event.seq,
          ],
        );
        if (payload.from === "PREPARED" && payload.to === "EXECUTING") {
          this.#driver.run(
            "UPDATE outbox SET status = 'DELIVERED', event_seq = ? WHERE outbox_id = ? AND run_id = ? AND kind = 'RUN_PREPARED' AND status = 'PENDING'",
            [event.seq, `${event.run_id}:prepared`, event.run_id],
          );
        }
      } else if (event.event_type === "OBLIGATION_SATISFIED") {
        const receipt = payload.receipt as Record<string, string>;
        const trust = Number(payload.trust);
        this.#driver.run(
          `INSERT INTO verifier_receipts(
            verifier_receipt_id, run_id, obligation_id, verifier_id, trust_level,
            result, input_digest, result_digest, evidence_ref, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            receipt.verifier_receipt_id ?? "",
            event.run_id,
            receipt.obligation_id ?? "",
            receipt.verifier_id ?? "",
            trust,
            receipt.result ?? "",
            receipt.input_digest ?? "",
            receipt.result_digest ?? "",
            receipt.evidence_ref ?? "",
            event.seq,
          ],
        );
        this.#driver.run(
          "UPDATE obligations SET status = 'SATISFIED', achieved_trust = ?, last_event_seq = ? WHERE run_id = ? AND obligation_id = ?",
          [trust, event.seq, event.run_id, receipt.obligation_id ?? ""],
        );
      } else if (event.event_type === "ARTIFACT_RECORDED") {
        const artifact = payload.artifact as Record<string, string>;
        this.#driver.run(
          "INSERT INTO artifacts(artifact_id, run_id, kind, location, artifact_digest, last_event_seq) VALUES (?, ?, ?, ?, ?, ?)",
          [artifact.artifact_id ?? "", event.run_id, artifact.kind ?? "", artifact.location ?? "", artifact.artifact_digest ?? "", event.seq],
        );
      } else if (event.event_type === "EVIDENCE_RECORDED") {
        const evidence = payload.evidence as Record<string, string | number>;
        this.#driver.run(
          `INSERT INTO evidence_records(
            evidence_id, run_id, candidate_revision, request_digest, objective_digest,
            envelope_digest, candidate_digest, evidence_digest,
            product_acceptance_status, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(evidence.evidence_id),
            event.run_id,
            Number(evidence.candidate_revision),
            String(evidence.request_digest),
            String(evidence.objective_digest),
            String(evidence.envelope_digest),
            String(evidence.candidate_digest),
            String(payload.evidence_digest),
            String(evidence.product_acceptance_status),
            event.seq,
          ],
        );
      } else if (event.event_type === "LEASE_HEARTBEAT") {
        this.#driver.run(
          "UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE run_id = ?",
          [String(payload.heartbeat_at), String(payload.expires_at), event.run_id],
        );
      } else if (event.event_type === "SESSION_BOUND") {
        const session = payload.session as Record<string, unknown>;
        this.#driver.run(
          `INSERT INTO sessions(
            run_id, profile_id, thread_id, turn_id, status, capability_digest, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, profile_id, thread_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            status = excluded.status,
            capability_digest = excluded.capability_digest,
            last_event_seq = excluded.last_event_seq`,
          [
            event.run_id,
            String(session.profile_id),
            String(session.thread_id),
            session.turn_id === null ? null : String(session.turn_id),
            String(session.status),
            String(session.capability_digest),
            event.seq,
          ],
        );
      } else if (event.event_type === "WORKSPACE_BOUND") {
        const workspace = payload.workspace as Record<string, unknown>;
        this.#driver.run(
          `INSERT INTO workspaces(
            run_id, repository_full_name, base_sha, branch_name, worktree_path_digest,
            candidate_sha, candidate_revision, status, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            repository_full_name = excluded.repository_full_name,
            base_sha = excluded.base_sha,
            branch_name = excluded.branch_name,
            worktree_path_digest = excluded.worktree_path_digest,
            candidate_sha = excluded.candidate_sha,
            candidate_revision = excluded.candidate_revision,
            status = excluded.status,
            last_event_seq = excluded.last_event_seq`,
          [
            event.run_id,
            String(workspace.repository_full_name),
            String(workspace.base_sha),
            String(workspace.branch_name),
            String(workspace.worktree_path_digest),
            workspace.candidate_sha === null ? null : String(workspace.candidate_sha),
            Number(workspace.candidate_revision),
            String(workspace.status),
            event.seq,
          ],
        );
      } else if (event.event_type === "EXTERNAL_EFFECT_INTENT_RECORDED") {
        const intent = payload.intent as Record<string, unknown>;
        const effectPayload = intent.payload as JsonObject;
        this.#driver.run(
          `INSERT INTO outbox(outbox_id, run_id, kind, payload_jcs, status, event_seq)
           VALUES (?, ?, ?, ?, 'PENDING', ?)`,
          [
            String(intent.outbox_id),
            event.run_id,
            String(intent.effect_kind),
            canonicalJson(effectPayload),
            event.seq,
          ],
        );
        this.#driver.run(
          `INSERT INTO publications(
            run_id, effect_kind, identity_key, outbox_id, target_ref, candidate_sha,
            status, result_ref, readback_digest, last_event_seq
          ) VALUES (?, ?, ?, ?, ?, ?, 'INTENT_COMMITTED', NULL, NULL, ?)`,
          [
            event.run_id,
            String(intent.effect_kind),
            String(intent.identity_key),
            String(intent.outbox_id),
            String(intent.target_ref),
            intent.candidate_sha === null ? null : String(intent.candidate_sha),
            event.seq,
          ],
        );
      } else if (event.event_type === "EXTERNAL_EFFECT_RECONCILED") {
        const result = payload.result as Record<string, unknown>;
        this.#driver.run(
          "UPDATE outbox SET status = 'DELIVERED', event_seq = ? WHERE outbox_id = ?",
          [event.seq, String(result.outbox_id)],
        );
        this.#driver.run(
          `UPDATE publications SET status = 'CONFIRMED', result_ref = ?, readback_digest = ?,
             last_event_seq = ? WHERE outbox_id = ?`,
          [
            String(result.result_ref),
            String(result.readback_digest),
            event.seq,
            String(result.outbox_id),
          ],
        );
      } else if (event.event_type === "EVIDENCE_CORRECTION_RECONCILED") {
        const correction = payload.correction as Record<string, unknown>;
        this.#driver.run(
          "UPDATE publications SET readback_digest = ?, last_event_seq = ? WHERE outbox_id = ?",
          [
            String(correction.corrected_comment_readback_digest),
            event.seq,
            String(correction.evidence_outbox_id),
          ],
        );
      }
      this.#driver.run(
        "UPDATE runs SET updated_at = ?, last_event_seq = ?, last_event_hash = ? WHERE run_id = ?",
        [event.occurred_at, event.seq, event.event_hash, event.run_id],
      );
    }
    this.#driver.run(
      "UPDATE projection_meta SET last_event_seq = ?, last_event_hash = ? WHERE singleton = 1",
      [event.seq, event.event_hash],
    );
  }

  public testOnlyExec(sql: string): void {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("TEST_ONLY_DATABASE_MUTATION_DISABLED");
    }
    this.#driver.exec(sql);
  }

  public close(): void {
    this.#driver.close();
  }
}
